import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createHandler } from './app.mjs';
import { authorize, createStore, loadConfig, performDurable } from './runtime.mjs';
import { createProviders, validateParams } from './providers.mjs';
import { conforms, fileBytes, hash, seal, unseal, validateSchema } from './safety.mjs';
import { runPreflight } from './preflight.mjs';

// All keys, users and payloads in these tests are synthetic. No real network.
const cfg = (overrides = {}) => ({ ...loadConfig({
  SUPABASE_URL: 'https://xsqobvvreaovwibxwyvv.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key',
  INTEGRATIONS_ENCRYPTION_KEY: '1'.repeat(64), INTEGRATIONS_HASH_KEY: '2'.repeat(64),
  INTEGRATIONS_RELEASE: 'enabled-v1', INTEGRATIONS_ALLOWED_OPERATIONS: 'InvokeLLM,SendEmail,UploadPrivateFile,CreateFileSignedUrl',
  ANTHROPIC_API_KEY: 'synthetic-anthropic', SENDGRID_API_KEY: 'synthetic-sendgrid', NOTIFICATION_FROM_EMAIL: 'test@example.test',
}), ...overrides });
const req = (body = {}, extra = {}) => new Request('https://runtime.example.test/v1/integrations', {
  method: 'POST', headers: { authorization: 'Bearer synthetic-session-token-value', 'content-type': 'application/json', ...extra }, body: JSON.stringify(body),
});
const input = () => ({ agency_id: 'agency-a', request_id: 'request-one', operation: 'InvokeLLM', params: { prompt: 'Synthetic prompt' } });
const actor = { subject: 'a'.repeat(64), snapshot: 'exact-authority-v1', canEmail: true };
function harness({ changeAt = Infinity, providerFailure = false, reserveOutcome = null } = {}) {
  const jobs = new Map(); let calls = 0, reads = 0;
  const store = {
    async reserve(body) {
      if (reserveOutcome) return { outcome: reserveOutcome, id: randomUUID() };
      const key = body.p_request_id; const old = jobs.get(key);
      if (old) return { id: old.id, outcome: old.hash !== body.p_payload_hash ? 'conflict' : old.state === 'started' ? 'pending' : old.state, result: old.result };
      const job = { id: randomUUID(), claim: body.p_claim, hash: body.p_payload_hash, state: 'started' }; jobs.set(key, job);
      return { id: job.id, outcome: 'owned' };
    },
    async finish(body) {
      const job = [...jobs.values()].find(row => row.id === body.p_id);
      if (!job || job.claim !== body.p_claim || job.state !== 'started') return false;
      job.state = body.p_state; job.result = body.p_result; return true;
    },
  };
  const authority = async () => { reads++; return { ...actor, snapshot: reads >= changeAt ? 'changed' : actor.snapshot }; };
  const provider = async () => { calls++; if (providerFailure) throw new Error('SYNTHETIC_SECRET_EXCEPTION'); return { answer: 'synthetic result' }; };
  return { store, authority, provider, jobs, calls: () => calls, reads: () => reads };
}
function execute(h, overrides = {}) {
  return performDurable({ config: cfg(), req: req(), agencyId: 'agency-a', operation: 'InvokeLLM',
    params: { prompt: 'synthetic' }, requestId: 'request-one', ...h, ...overrides });
}

test('default deployment is paused; health is not integration readiness', async () => {
  let touched = false;
  const handler = createHandler(loadConfig({}), { store: {}, provider: () => { touched = true; }, authority: () => { touched = true; } });
  assert.equal((await handler(new Request('https://runtime.test/healthz'))).status, 200);
  const ready = await handler(new Request('https://runtime.test/readyz'));
  assert.equal(ready.status, 503); assert.equal((await ready.json()).base44ExecutionDependency, true);
  assert.equal((await handler(req(input()))).status, 503); assert.equal(touched, false);
});
test('malicious app, storage and origin configuration cannot redirect secrets', () => {
  for (const env of [{INTEGRATIONS_APP_ID:'attacker'}, {SUPABASE_URL:'https://evil.test'}, {INTEGRATIONS_ALLOWED_ORIGINS:'https://good.test/path'}, {INTEGRATIONS_ALLOWED_OPERATIONS:'DeleteEverything'}]) assert.throws(() => loadConfig(env));
});
test('origin and preflight headers are exact and credentials are never CORS cookies', async () => {
  const h = createHandler(cfg(), harness());
  assert.equal((await h(req(input(), {origin:'https://evil.test'}))).status, 403);
  const request = new Request('https://runtime.test/v1/integrations', {method:'OPTIONS', headers:{origin:'https://app.caremetricai.com','access-control-request-method':'POST','access-control-request-headers':'authorization,content-type'}});
  const good = await h(request); assert.equal(good.status,204); assert.equal(good.headers.get('access-control-allow-credentials'),null);
  const bad = new Request(request, {headers:{origin:'https://app.caremetricai.com','access-control-request-method':'POST','access-control-request-headers':'Base44-Service-Authorization'}});
  assert.equal((await h(bad)).status,403);
});
test('real bearer is required before contacting the authority backend', async () => {
  for (const authorization of ['', 'Basic whatever', 'Bearer short']) {
    let called=false;
    await assert.rejects(() => authorize(cfg(), req({}, {authorization}), 'agency-a', async () => {called=true;}), e => e.status===401);
    assert.equal(called,false);
  }
});
const tenant = { user_id:'user-1', user_email:'staff@example.test', agency_id:'agency-a', agency:{id:'agency-a',status:'active'},
  is_platform_owner:false, tenant_role:'clinician', membership_id:'member-1', membership_key:'agency-a:user-1', membership_version:1, membership_status:'active' };
test('authority uses only the fixed app backend and forwards no supplied service credential', async () => {
  let seen;
  const result=await authorize(cfg(),req({}, {'Base44-Service-Authorization':'Bearer attacker','Base44-Api-Url':'https://evil.test'}),'agency-a',async(url,options)=>{seen={url,options};return Response.json({tenant_context:tenant});});
  assert.equal(result.canEmail,false);assert.match(result.subject,/^[a-f0-9]{64}$/);
  assert.equal(new URL(seen.url).origin,'https://base44.app');assert.equal(seen.options.headers['Base44-Service-Authorization'],undefined);
});
test('wrong, revoked and incomplete tenant contexts are rejected', async () => {
  for (const changed of [{agency_id:'foreign'},{membership_status:'revoked'},{membership_key:'forged'},{membership_version:0},{tenant_role:'super_admin'},{agency:{id:'agency-a',status:'suspended'}}]) {
    await assert.rejects(() => authorize(cfg(),req(),'agency-a',async()=>Response.json({tenant_context:{...tenant,...changed}})),e=>e.status===403);
  }
});
test('encrypted results reject changed job binding and tampering', () => {
  const token=seal(cfg().encryptionKey,'job-a',{secret:'synthetic'});
  assert.deepEqual(unseal(cfg().encryptionKey,'job-a',token),{secret:'synthetic'});
  assert.throws(()=>unseal(cfg().encryptionKey,'job-b',token));
  assert.throws(()=>unseal(cfg().encryptionKey,'job-a',token.slice(0,-4)+'AAAA'));
  assert.equal(token.includes('synthetic'),false);
});
test('hashes preserve meaning independent of object property order', () => {
  assert.equal(hash('test',{b:2,a:1}),hash('test',{a:1,b:2}));
  assert.notEqual(hash('test',{a:1}),hash('test',{a:2}));
});
test('sequential identical retries reuse one durable result and one paid operation', async () => {
  const h=harness();const first=await execute(h);const next=await execute(h);
  assert.deepEqual(first,next);assert.equal(h.calls(),1);assert.equal(h.jobs.size,1);
});
test('changed payload under an existing request ID is not a new paid request', async () => {
  const h=harness();await execute(h);
  await assert.rejects(()=>execute(h,{params:{prompt:'changed'}}),e=>e.status===409);assert.equal(h.calls(),1);
});
test('uncertain provider outcomes are retained and never automatically repeated', async () => {
  const h=harness({providerFailure:true});await assert.rejects(()=>execute(h),e=>e.code==='OPERATION_OUTCOME_UNCERTAIN');
  await assert.rejects(()=>execute(h),e=>e.status===409);assert.equal(h.calls(),1);
  assert.equal([...h.jobs.values()][0].state,'uncertain');
});
test('revocation during reservation prevents paid work; revocation after work prevents disclosure', async () => {
  const before=harness({changeAt:2});await assert.rejects(()=>execute(before),e=>e.code==='AUTHORITY_CHANGED');assert.equal(before.calls(),0);
  const after=harness({changeAt:3});await assert.rejects(()=>execute(after),e=>e.code==='AUTHORITY_CHANGED');assert.equal(after.calls(),1);
  assert.equal([...after.jobs.values()][0].state,'completed');
});
test('pending and uncertain reservations never produce success or another provider call', async () => {
  for (const reserveOutcome of ['pending','uncertain','failed','conflict','quota']) {
    const h=harness({reserveOutcome});await assert.rejects(()=>execute(h),e=>[409,429].includes(e.status));assert.equal(h.calls(),0);
  }
});
test('non-admin staff cannot use an arbitrary-recipient email endpoint', async () => {
  const h=harness();await assert.rejects(()=>execute(h,{operation:'SendEmail',authority:async()=>({...actor,canEmail:false})}),e=>e.status===403);
  assert.equal(h.jobs.size,0);assert.equal(h.calls(),0);
});
test('private file validation rejects arbitrary URLs and MIME spoofing', () => {
  assert.throws(()=>validateParams('CreateFileSignedUrl',{file_uri:'https://evil.test/private'},cfg()));
  assert.throws(()=>fileBytes(Buffer.from('not pdf').toString('base64'),'application/pdf'));
  assert.throws(()=>fileBytes('!!==','text/plain'));
  assert.equal(fileBytes(Buffer.from('synthetic text').toString('base64'),'text/plain').toString(),'synthetic text');
});
test('unsupported input cannot silently choose a different model or ignore search', () => {
  for (const params of [{prompt:'x',model:'gpt-forged'},{prompt:'x',add_context_from_internet:true},{prompt:'x',file_urls:['https://example.test']}]) assert.throws(()=>validateParams('InvokeLLM',params,cfg()));
});
test('strict schema supports primitives and rejects unsupported semantics', () => {
  for (const schema of [{type:'string',pattern:'anything'},{type:'object',$ref:'https://evil.test'},{type:'string',minLength:10,maxLength:2},{type:'array'}]) assert.throws(()=>validateSchema(schema));
  const schema=validateSchema({type:'object',properties:{value:{type:'integer',minimum:0}},required:['value'],additionalProperties:false});
  assert.equal(conforms({value:2},schema),true);assert.equal(conforms({value:'2'},schema),false);assert.equal(conforms({value:2,other:true},schema),false);
});
test('text AI uses Anthropic directly without any Base44 Core request', async () => {
  const urls=[];const provider=createProviders(cfg(),{},async(url,options)=>{urls.push(url);const b=JSON.parse(options.body);assert.equal(b.model,cfg().model);return Response.json({content:[{type:'text',text:'Synthetic answer'}],stop_reason:'end_turn'});});
  assert.equal(await provider('InvokeLLM',{prompt:'synthetic'},actor),'Synthetic answer');assert.deepEqual(urls,['https://api.anthropic.com/v1/messages']);
});
test('structured AI uses a nonexecuting envelope and rejects truncated or invalid results', async () => {
  const schema={type:'array',items:{type:'integer'}};
  for(const output of [[1,2],['wrong']]) {
    const provider=createProviders(cfg(),{},async(_url,options)=>{const b=JSON.parse(options.body);assert.equal(b.tools[0].input_schema.type,'object');return Response.json({content:[{type:'tool_use',name:'return_result',input:{result:output}}],stop_reason:'tool_use'});});
    if(typeof output[0]==='number')assert.deepEqual(await provider('InvokeLLM',{prompt:'x',response_json_schema:schema},actor),output);
    else await assert.rejects(()=>provider('InvokeLLM',{prompt:'x',response_json_schema:schema},actor),e=>e.status===502);
  }
});
test('email means provider accepted, not delivered, and its sender is server controlled', async () => {
  const provider=createProviders(cfg(),{},async(url,options)=>{assert.equal(url,'https://api.sendgrid.com/v3/mail/send');const body=JSON.parse(options.body);assert.equal(body.from.email,'test@example.test');assert.equal(body.tracking_settings.open_tracking.enable,false);return new Response(null,{status:202});});
  assert.deepEqual(await provider('SendEmail',{to:'recipient@example.test',subject:'Synthetic',body:'Synthetic test'},actor),{accepted:true,delivered:false,provider:'sendgrid'});
});
test('the storage adapter only calls named restricted RPCs', async () => {
  let target;const store=createStore(cfg(),async(url)=>{target=url;return Response.json(null);});
  assert.equal(await store.fileGet({p_id:randomUUID(),p_app_id:cfg().appId,p_subject:actor.subject}),null);
  assert.equal(new URL(target).pathname,'/rest/v1/rpc/cm_integration_file_get');
});
test('preflight uses only metadata and a nonexistent exact lookup, never paid operations', async () => {
  const urls=[];const report=await runPreflight(cfg(),async(url,options={})=>{urls.push(url);
    if(url.includes('/v1/models'))return Response.json({data:[{id:cfg().model}]});
    if(url.endsWith('/v3/scopes'))return Response.json({scopes:['mail.send']});
    // Asking the provider whether the sender may send is metadata too: two GETs
    // of our own account's sender identities, neither of which sends anything.
    if(url.includes('/v3/verified_senders'))return Response.json({results:[{from_email:'test@example.test',verified:true}]});
    if(url.includes('/v3/whitelabel/domains'))return Response.json([]);
    if(url.includes('/bucket/'))return Response.json({id:'pennsync-external-integrations',public:false,file_size_limit:8388608});
    assert.ok(url.endsWith('/rpc/cm_integration_file_get'));assert.equal(JSON.parse(options.body).p_id,'00000000-0000-0000-0000-000000000000');return Response.json(null);
  });
  assert.equal(report.passed,true);assert.equal(report.paidCalls,0);assert.equal(report.writes,0);
  assert.ok(urls.every(url=>!url.includes('base44.app')&&!url.endsWith('/messages')&&!url.endsWith('/mail/send')));
});
test('public errors contain no provider exceptions and disable automatic retry', async () => {
  const h=harness({providerFailure:true});const response=await createHandler(cfg(),h)(req(input()));const body=await response.json();
  assert.equal(response.status,503);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(body.retryable,false);assert.equal(JSON.stringify(body).includes('SYNTHETIC_SECRET'),false);
});
