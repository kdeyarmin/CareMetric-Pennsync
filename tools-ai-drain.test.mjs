import test from 'node:test';
import assert from 'node:assert/strict';
import { runWithRetry } from './src/lib/aiCall.js';
import { createAIScheduler } from './src/lib/aiScheduler.js';

test('direct SDK timeouts cannot be overridden by a permissive retry callback', async () => {
  let calls=0;
  await assert.rejects(()=>runWithRetry(()=>{calls++;throw Object.assign(new Error('SDK timeout'),{code:'AI_TIMEOUT'});},
    {retries:3,backoffMs:0,shouldRetry:()=>true}),error=>error.code==='AI_TIMEOUT');
  assert.equal(calls,1);
});
test('timed-out SDK work retains budget until its known original promise settles', async () => {
  const scheduler=createAIScheduler({maxConcurrent:1});
  let releaseOriginal,secondStarted=false;
  const original=new Promise(resolve=>{releaseOriginal=resolve;});
  await assert.rejects(()=>scheduler.schedule(()=>runWithRetry(()=>original,{timeoutMs:5,retries:0})),error=>error.code==='AI_TIMEOUT');
  const second=scheduler.schedule(async()=>{secondStarted=true;return 'second';});
  await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(secondStarted,false);assert.equal(scheduler.stats().active,1);assert.equal(scheduler.stats().queued,1);
  releaseOriginal('late result');assert.equal(await second,'second');
});
test('late rejection after timeout releases exactly one scheduler slot', async () => {
  const scheduler=createAIScheduler({maxConcurrent:1});let rejectOriginal;
  const original=new Promise((_,reject)=>{rejectOriginal=reject;});
  await assert.rejects(()=>scheduler.schedule(()=>runWithRetry(()=>original,{timeoutMs:5,retries:0})));
  const second=scheduler.schedule(async()=>42);
  rejectOriginal(new Error('Synthetic late failure'));assert.equal(await second,42);
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(scheduler.stats().active,0);
});
