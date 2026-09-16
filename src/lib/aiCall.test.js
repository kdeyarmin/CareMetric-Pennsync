import { test } from "node:test";
import assert from "node:assert/strict";
import { withTimeout, runWithRetry, defaultShouldRetry } from "./aiCall.js";

test("withTimeout resolves when the promise settles in time", async () => {
  assert.equal(await withTimeout(Promise.resolve("ok"), 1000), "ok");
});
test("withTimeout rejects with AI_TIMEOUT when too slow", async () => {
  await assert.rejects(() => withTimeout(new Promise(() => {}), 10), err => err.code === "AI_TIMEOUT" && err.retryable === false && err.operationMayHaveExecuted === true);
});
test("withTimeout with non-positive ms disables the timeout", async () => {
  assert.equal(await withTimeout(Promise.resolve(42), 0), 42);
});
test("runWithRetry returns on first success without retrying", async () => {
  let calls=0; assert.equal(await runWithRetry(() => { calls++;return Promise.resolve('v'); },{backoffMs:0}), 'v');assert.equal(calls,1);
});
test("runWithRetry retries transient failures then succeeds", async () => {
  let calls=0;
  const result=await runWithRetry(() => { calls++;if(calls<3)throw new Error('blip');return Promise.resolve('done'); },{retries:2,backoffMs:0});
  assert.equal(result,'done');assert.equal(calls,3);
});
test("runWithRetry throws after exhausting retries", async () => {
  let calls=0;await assert.rejects(()=>runWithRetry(()=>{calls++;throw new Error('always');},{retries:1,backoffMs:0}),/always/);assert.equal(calls,2);
});
test("runWithRetry does not retry non-retryable errors", async () => {
  let calls=0;await assert.rejects(()=>runWithRetry(()=>{calls++;throw Object.assign(new Error('forbidden'),{status:403});},{retries:3,backoffMs:0}),/forbidden/);assert.equal(calls,1);
});
test("runWithRetry surfaces a timeout when an attempt is too slow", async () => {
  await assert.rejects(()=>runWithRetry(()=>new Promise(()=>{}),{retries:0,timeoutMs:10,backoffMs:0}),err=>err.code==='AI_TIMEOUT');
});
test("defaultShouldRetry classifies errors correctly", () => {
  assert.equal(defaultShouldRetry({status:500}),true);assert.equal(defaultShouldRetry({status:429}),true);
  assert.equal(defaultShouldRetry({code:'AI_TIMEOUT'}),false);
  for(const status of [400,401,402,403,422])assert.equal(defaultShouldRetry({status}),false);
  assert.equal(defaultShouldRetry({data:{extra_data:{reason:'integration_credits_limit_reached'}}}),false);
  assert.equal(defaultShouldRetry({response:{data:{extra_data:{reason:'integration_credits_limit_reached'}}}}),false);
});
test("unabortable timeouts cannot be replayed by a permissive retry callback", async () => {
  let calls=0;
  await assert.rejects(()=>runWithRetry(()=>{calls++;return new Promise(()=>{});},{retries:3,timeoutMs:5,backoffMs:0,shouldRetry:()=>true}),err=>err.code==='AI_TIMEOUT');
  assert.equal(calls,1);
});
test("explicitly uncertain external operations never automatically retry", async () => {
  for(const flags of [{retryable:false},{operationMayHaveExecuted:true}]) {
    let calls=0;
    await assert.rejects(()=>runWithRetry(()=>{calls++;throw Object.assign(new Error('uncertain'),flags);},{retries:3,backoffMs:0,shouldRetry:()=>true}));
    assert.equal(calls,1);
  }
});
