import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from './app.mjs';
import { authorize, loadConfig, performDurable, publicReadiness } from './runtime.mjs';
import { seal } from './safety.mjs';

const config = () => loadConfig({ SUPABASE_URL:'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY:'synthetic',
  INTEGRATIONS_ENCRYPTION_KEY:'1'.repeat(64), INTEGRATIONS_HASH_KEY:'2'.repeat(64), INTEGRATIONS_RELEASE:'enabled-v1',
  INTEGRATIONS_ALLOWED_OPERATIONS:'InvokeLLM,SendEmail,CreateFileSignedUrl', ANTHROPIC_API_KEY:'synthetic', SENDGRID_API_KEY:'synthetic', NOTIFICATION_FROM_EMAIL:'sender@example.test' });
const actor={subject:'a'.repeat(64),snapshot:'synthetic-exact-authority',canEmail:true};
function request(body, headers={}) { return new Request('https://runtime.example.test/v1/integrations',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer synthetic-session-token-value',...headers},body:JSON.stringify(body)}); }

test('readiness cannot pass if a selected operation lacks its required provider',()=>{
  assert.equal(publicReadiness(config()).ready,true);
  for(const missing of [{anthropicKey:''},{sendgridKey:''},{fromEmail:'not-an-email'},{configured:false},{released:false},{operations:[]}]) {
    assert.equal(publicReadiness({...config(),...missing}).ready,false);
  }
});
test('configuration rejects duplicate operations and invalid origin URLs',()=>{
  assert.throws(()=>loadConfig({INTEGRATIONS_ALLOWED_OPERATIONS:'InvokeLLM,InvokeLLM'}));
  for(const origin of ['http://evil.test','https://good.test/?redirect=evil','https://user:pass@good.test','*']) assert.throws(()=>loadConfig({INTEGRATIONS_ALLOWED_ORIGINS:origin}));
});
test('stored short-lived links cannot be replayed after their own expiration',async()=>{
  const c=config(); const id=randomUUID(); let called=0;
  for(const expires_at_ms of [undefined,Date.now()-1]) {
    const saved={signed_url:'https://synthetic.test/signed',...(expires_at_ms===undefined?{}:{expires_at_ms})};
    const encrypted=seal(c.encryptionKey,`${c.appId}:${actor.subject}:${id}`,saved);
    await assert.rejects(()=>performDurable({config:c,req:request({}),agencyId:'agency-a',operation:'CreateFileSignedUrl',params:{file_uri:`cmfile:${id}`},requestId:'one',
      authority:async()=>actor,store:{reserve:async()=>({id,outcome:'completed',result:encrypted})},provider:async()=>{called++;}}),e=>e.code==='SIGNED_URL_EXPIRED_REQUEST_NEW_LINK');
  }
  assert.equal(called,0);
});
test('a fresh signed-link replay retains its expiry without reminting',async()=>{
  const c=config();const id=randomUUID();const value={signed_url:'https://synthetic.test/signed',expires_at_ms:Date.now()+60000};
  const result=await performDurable({config:c,req:request({}),agencyId:'agency-a',operation:'CreateFileSignedUrl',params:{file_uri:`cmfile:${id}`},requestId:'one',
    authority:async()=>actor,store:{reserve:async()=>({id,outcome:'completed',result:seal(c.encryptionKey,`${c.appId}:${actor.subject}:${id}`,value)})},provider:async()=>{throw new Error('Must not remint');}});
  assert.deepEqual(result,value);
});
test('HTTP layer binds the signed result lease before provider latency',async()=>{
  const c=config();const id=randomUUID();const beganAt=Date.now();
  const handler=createHandler(c,{authority:async()=>actor,store:{reserve:async()=>({id,outcome:'owned'}),finish:async()=>true},provider:async()=>({signed_url:'https://synthetic.test/signed',expires_in:60})});
  const response=await handler(request({agency_id:'agency-a',operation:'CreateFileSignedUrl',request_id:'new-link',params:{file_uri:`cmfile:${id}`}}));
  assert.equal(response.status,200);const {result}=await response.json();
  assert.ok(result.expires_at_ms>=beganAt+60000 && result.expires_at_ms<=Date.now()+60000);
});
test('invalid body fields and missing request identifiers cannot start a paid operation',async()=>{
  let calls=0;
  const handler=createHandler(config(),{authority:async()=>actor,store:{},provider:async()=>{calls++;}});
  for(const body of [null,[],{agency_id:'agency-a',operation:'InvokeLLM',params:{prompt:'test'}},
    {agency_id:'agency-a',operation:'InvokeLLM',request_id:'one',params:{prompt:'test'},service_token:'forged'}]) {
    const response=await handler(request(body));assert.equal(response.status,400);
  }
  assert.equal(calls,0);
});
test('invalid authority email and mixed owner/member shapes are rejected',async()=>{
  const owner={user_id:'owner-1',user_email:'owner@example.test',agency_id:'agency-a',agency:{id:'agency-a',status:'active'},tenant_role:'platform_owner',is_platform_owner:true,membership_id:null,membership_key:null,membership_version:null,membership_status:null};
  for(const edit of [{user_email:undefined},{user_email:' Owner@EXAMPLE.test '},{membership_key:'agency-a:owner-1'},{membership_status:'active'}]) {
    await assert.rejects(()=>authorize(config(),request({}),'agency-a',async()=>Response.json({tenant_context:{...owner,...edit}})),e=>e.status===403);
  }
  assert.equal((await authorize(config(),request({}),'agency-a',async()=>Response.json({tenant_context:owner}))).canEmail,true);
});
test('malformed durable record IDs cannot produce a successful response',async()=>{
  await assert.rejects(()=>performDurable({config:config(),req:request({}),agencyId:'agency-a',operation:'InvokeLLM',params:{prompt:'test'},requestId:'one',authority:async()=>actor,
    store:{reserve:async()=>({id:'-'.repeat(36),outcome:'owned'})},provider:async()=>{throw new Error('Should not execute');}}),e=>e.code==='INVALID_RESERVATION');
});
