import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from './app.mjs';
import { createAdmission, readRequestBody } from './admission.mjs';
import { signedStorageUrl, validateParams } from './providers.mjs';
import { loadConfig, performDurable } from './runtime.mjs';
import { runPreflight } from './preflight.mjs';
import { fail } from './safety.mjs';

const config = () => loadConfig({SUPABASE_URL:'https://xsqobvvreaovwibxwyvv.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic',
 INTEGRATIONS_ENCRYPTION_KEY:'1'.repeat(64),INTEGRATIONS_HASH_KEY:'2'.repeat(64),INTEGRATIONS_RELEASE:'enabled-v1',
 INTEGRATIONS_ALLOWED_OPERATIONS:'InvokeLLM,SendEmail',ANTHROPIC_API_KEY:'synthetic',SENDGRID_API_KEY:'synthetic',NOTIFICATION_FROM_EMAIL:'test@example.test'});
const actor={subject:'a'.repeat(64),snapshot:'test-authority',canEmail:true};
const payload={agency_id:'agency-a',request_id:'test-one',operation:'InvokeLLM',params:{prompt:'Synthetic only'}};
const request=(body=payload,auth='Bearer synthetic-session-token-value')=>new Request('https://runtime.test/v1/integrations',{method:'POST',headers:{authorization:auth,'content-type':'application/json'},body:JSON.stringify(body)});

for(const rawKind of ['relative','storagePath','absolute']) test(`Supabase signing accepts exact ${rawKind} form`,()=>{
 const origin=config().supabaseUrl;const path=`${config().appId}/${actor.subject}/${randomUUID()}`;
 const relative=`/object/sign/pennsync-external-integrations/${path}?token=synthetic-token`;
 const raw=rawKind==='relative'?relative:rawKind==='storagePath'?'/storage/v1'+relative:origin+'/storage/v1'+relative;
 assert.equal(signedStorageUrl(raw,origin,path),origin+'/storage/v1'+relative);
});
test('signing rejects foreign hosts, traversal, credentials, duplicate tokens and unrelated files',()=>{
 const origin=config().supabaseUrl;const path=`${config().appId}/${actor.subject}/${randomUUID()}`;
 const good=`${origin}/storage/v1/object/sign/pennsync-external-integrations/${path}?token=synthetic`;
 for(const raw of ['',null,'/other/path?token=x',good.replace(origin,'https://evil.test'),good+'&token=second',good+'&redirect=evil',good+'#fragment',good.replace(path,path+'/../other'),good.replace('https://','https://user:password@')]) assert.throws(()=>signedStorageUrl(raw,origin,path));
});
for(const key of ['model','response_json_schema']) test(`defined malformed ${key} never reaches provider preparation`,()=>{
 for(const value of [null,false,0,'',undefined]) assert.throws(()=>validateParams('InvokeLLM',{prompt:'test',[key]:value},config()));
});
test('missing credentials do not read a streaming body or enter an operation slot',async()=>{
 let pulls=0;const admission=createAdmission();
 const handler=createHandler(config(),{admission,authority:()=>{throw new Error('Unexpected auth');},store:{},provider:()=>{throw new Error('Unexpected provider');}});
 const stream=new ReadableStream({pull(){pulls++;}},{highWaterMark:0});
 const req=new Request('https://runtime.test/v1/integrations',{method:'POST',body:stream,duplex:'half',headers:{'content-type':'application/json'}});
 assert.equal((await handler(req)).status,401);assert.equal(pulls,0);assert.equal(admission.stats().reading,0);assert.equal(admission.stats().running,0);
});
test('slow authenticated-looking body expires without occupying provider slots',async()=>{
 const admission=createAdmission();let authCalls=0,cancelled=false;
 const handler=createHandler(config(),{admission,bodyDeadlineMs:15,authority:()=>{authCalls++;},store:{},provider:()=>{throw new Error('Unexpected provider');}});
 const stream=new ReadableStream({pull(){},cancel(){cancelled=true;}},{highWaterMark:0});
 const req=new Request('https://runtime.test/v1/integrations',{method:'POST',body:stream,duplex:'half',headers:{authorization:'Bearer synthetic-session-token-value','content-type':'application/json'}});
 const response=await handler(req);assert.equal(response.status,408);assert.equal(cancelled,true);assert.equal(authCalls,0);
 assert.equal(admission.stats().running,0);assert.equal(admission.stats().reading,0);
});
test('declared and streamed oversize bodies fail before authority or provider work',async()=>{
 await assert.rejects(()=>readRequestBody(new Request('https://r.test',{method:'POST',body:'12345',headers:{'content-length':'5'}}),4),e=>e.status===413);
 await assert.rejects(()=>readRequestBody(new Request('https://r.test',{method:'POST',body:'12345'}),4),e=>e.status===413);
});
test('body and verified-operation pools are independent and release only once',()=>{
 const a=createAdmission({bodySlots:1,operationSlots:2,actorOperationSlots:1});
 const body=a.body('token');const work=a.operation('actor');assert.throws(()=>a.body('other'));assert.throws(()=>a.operation('actor'));
 const other=a.operation('another-actor');body();body();work();work();other();assert.deepEqual(a.stats(),{reading:0,checking:0,running:0,keys:0});
});
test('invalid auth cannot enter the verified provider-work pool',async()=>{
 const admission=createAdmission();const handler=createHandler(config(),{admission,authority:async()=>fail(403,'DENIED'),store:{},provider:()=>{throw new Error('Unexpected provider');}});
 assert.equal((await handler(request())).status,403);assert.equal(admission.stats().running,0);
});
test('authority callbacks are rate-bounded even when every request fails later',async()=>{
 const a=createAdmission({tokenAuthorityLimit:2,authorityLimit:3});let count=0;
 await a.authority('one',async()=>{count++;});await a.authority('one',async()=>{count++;});
 await assert.rejects(()=>a.authority('one',async()=>{count++;}),e=>e.status===429);
 await a.authority('two',async()=>{count++;});await assert.rejects(()=>a.authority('three',async()=>{count++;}),e=>e.status===429);assert.equal(count,3);
});
test('cheap request budgets bound key growth and expire without storing raw credentials',()=>{
 let clock=0;const a=createAdmission({now:()=>clock,maxKeys:2,requestLimit:3,tokenRequestLimit:2});
 a.request('digest-one');a.request('digest-one');assert.throws(()=>a.request('digest-one'));
 a.request('digest-two');assert.throws(()=>a.request('digest-three'));assert.equal(a.stats().keys,2);
 clock=60001;a.request('digest-three');assert.equal(a.stats().keys,1);
});
test('quota-exhausted requests cannot keep invoking the authority backend without bound',async()=>{
 let calls=0;const handler=createHandler(config(),{admission:createAdmission({tokenAuthorityLimit:2}),
 authority:async()=>{calls++;return actor;},store:{reserve:async()=>({id:randomUUID(),outcome:'quota'})},provider:()=>{throw new Error('Must not execute');}});
 for(let n=0;n<5;n++)assert.equal((await handler(request({...payload,request_id:`request-${n}`}))).status,429);
 assert.equal(calls,2);
});
test('confirmed pre-execution failures can retry after authority recovers without duplicate paid work',async()=>{
 let auth=0,paid=0,row;
 const store={
 reserve:async b=>{if(!row)row={id:randomUUID(),state:'started',claim:b.p_claim};else if(row.state==='failed')Object.assign(row,{state:'started',claim:b.p_claim});else return {...row,outcome:row.state==='started'?'pending':row.state};return {id:row.id,outcome:'owned'};},
 finish:async b=>{if(row.state!=='started'||row.claim!==b.p_claim)return false;row.state=b.p_state;row.result=b.p_result;return true;},
 };
 const call=()=>performDurable({config:config(),req:request(),agencyId:'agency-a',operation:'InvokeLLM',params:{prompt:'test'},requestId:'same',store,
 authority:async()=>{auth++;if(auth===2)throw new Error('Transient authority failure');return actor;},provider:async()=>{paid++;return 'result';}});
 await assert.rejects(call);assert.equal(row.state,'failed');assert.equal(paid,0);
 assert.equal(await call(),'result');assert.equal(paid,1);assert.equal(row.state,'completed');
});
test('uncertain provider execution is never mislabeled as failed before execution',async()=>{
 const finishes=[];await assert.rejects(()=>performDurable({config:config(),req:request(),agencyId:'agency-a',operation:'InvokeLLM',params:{prompt:'test'},requestId:'same',
 store:{reserve:async()=>({id:randomUUID(),outcome:'owned'}),finish:async b=>{finishes.push(b);return true;}},authority:async()=>actor,provider:async()=>{throw new Error('Provider outcome unknown');}}));
 assert.equal(finishes.length,1);assert.equal(finishes[0].p_state,'uncertain');
});
test('provider preflight requirements match operations and validate sender syntax',async()=>{
 const metadata=async url=>{
  if(url.includes('/scopes'))return Response.json({scopes:['mail.send']});
  if(url.includes('/verified_senders'))return Response.json({results:[{from_email:'test@example.test',verified:true}]});
  if(url.includes('/whitelabel/domains'))return Response.json([]);
  if(url.includes('/models'))return Response.json({data:[{id:'claude-sonnet-4-6'}]});
  if(url.includes('/bucket/'))return Response.json({id:'pennsync-external-integrations',public:false,file_size_limit:8388608});
  return Response.json(null);
 };
 const emailOnly={...config(),operations:['SendEmail'],anthropicKey:''};
 assert.equal((await runPreflight(emailOnly,metadata)).passed,true);
 assert.equal((await runPreflight({...emailOnly,fromEmail:'not-an-email'},metadata)).passed,false);
 const aiOnly={...config(),operations:['InvokeLLM'],sendgridKey:'',fromEmail:''};
 assert.equal((await runPreflight(aiOnly,metadata)).passed,true);
});
