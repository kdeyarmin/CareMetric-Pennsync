import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runOperatorAcceptance, main, FIXTURE } from './operator-acceptance.mjs';
import { loadConfig } from './runtime.mjs';

const env={SUPABASE_URL:'https://xsqobvvreaovwibxwyvv.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'synthetic-only-key',
 INTEGRATIONS_ENCRYPTION_KEY:'1'.repeat(64),INTEGRATIONS_HASH_KEY:'2'.repeat(64),ANTHROPIC_API_KEY:'synthetic-only-ai',
 SENDGRID_API_KEY:'synthetic-only-mail',NOTIFICATION_FROM_EMAIL:'sender@example.test',INTEGRATIONS_RELEASE:'disabled',INTEGRATIONS_ALLOWED_OPERATIONS:''};
function mockNetwork({modelFailure=false,foreignFileLeak=false}={}) {
 const jobs=new Map(),objects=new Map(),files=new Map(),calls=[];
 async function fetcher(raw,options={}) {
  const url=new URL(raw);calls.push({origin:url.origin,path:url.pathname,method:options.method||'GET'});
  if(url.origin==='https://api.anthropic.com') {
   if(modelFailure)return Response.json({error:'Synthetic provider failure'},{status:503});
   const body=JSON.parse(options.body);
   return Response.json({stop_reason:body.tools?'tool_use':'end_turn',content:body.tools?
    [{type:'tool_use',name:'return_result',input:{result:{asset:'Synthetic acceptance vehicle',mileage:12345}}}]:[{type:'text',text:'PENNSYNC_EXTERNAL_OK'}]});
  }
  if(url.origin==='https://api.sendgrid.com') {
   const body=JSON.parse(options.body);assert.equal(body.mail_settings.sandbox_mode.enable,true);
   assert.deepEqual(body.personalizations,[{to:[{email:'acceptance@example.invalid'}]}]);
   return new Response(null,{status:200});
  }
  assert.equal(url.origin,env.SUPABASE_URL);
  if(url.pathname.startsWith('/rest/v1/rpc/')) {
   const body=JSON.parse(options.body);const name=url.pathname.split('/').at(-1);
   if(name==='cm_integration_reserve') {
    const key=[body.p_app_id,body.p_subject,body.p_operation,body.p_request_id].join(':');let job=jobs.get(key);
    if(job)return Response.json({id:job.id,outcome:job.hash!==body.p_payload_hash?'conflict':job.state==='started'?'pending':job.state,result:job.result});
    job={id:randomUUID(),claim:body.p_claim,hash:body.p_payload_hash,state:'started'};jobs.set(key,job);return Response.json({id:job.id,outcome:'owned'});
   }
   if(name==='cm_integration_finish') {
    const job=[...jobs.values()].find(row=>row.id===body.p_id);
    if(!job||job.claim!==body.p_claim||job.state!=='started')return Response.json(false);
    job.state=body.p_state;job.result=body.p_result;return Response.json(true);
   }
   if(name==='cm_integration_file_record') {
    files.set(body.p_id,{id:body.p_id,app_id:body.p_app_id,subject:body.p_subject,object_path:body.p_object_path,content_type:body.p_content_type,size_bytes:body.p_size,sha256:body.p_sha256});return Response.json(true);
   }
   if(name==='cm_integration_file_get') {
    const f=files.get(body.p_id);return Response.json(f&&(foreignFileLeak||(f.app_id===body.p_app_id&&f.subject===body.p_subject))?f:null);
   }
   throw new Error('Unexpected RPC');
  }
  const prefix='/storage/v1/object/';
  if(url.pathname.startsWith(prefix+'sign/')) {
   const objectPath=url.pathname.slice((prefix+'sign/').length);
   if(options.method==='POST')return Response.json({signedURL:'/object/sign/'+objectPath+'?token=synthetic-signed-link'});
   return new Response(objects.get(objectPath),{status:200});
  }
  if(url.pathname.startsWith(prefix+'authenticated/'))return new Response(objects.get(url.pathname.slice((prefix+'authenticated/').length)),{status:200});
  assert.ok(url.pathname.startsWith(prefix));assert.equal(options.method,'POST');assert.equal(options.headers['x-upsert'],'false');
  objects.set(url.pathname.slice(prefix.length),Buffer.from(options.body));return Response.json({key:'synthetic'});
 }
 return {fetcher,calls,jobs,objects,files};
}

test('operator acceptance requires both exact authorization and a paused configured runtime',async()=>{
 for(const [edit,authorization]of [[{},undefined],[{},'yes'],[{released:true},'explicit-synthetic-v1'],[{configured:false},'explicit-synthetic-v1']]) {
  let called=false;await assert.rejects(()=>runOperatorAcceptance({...loadConfig(env),...edit},{authorization,fetcher:async()=>{called=true;}}));assert.equal(called,false);
 }
});
test('fixed synthetic end-to-end invokes direct providers and sandbox mail without Base44',async()=>{
 const n=mockNetwork();const result=await runOperatorAcceptance(loadConfig(env),{authorization:'explicit-synthetic-v1',fetcher:n.fetcher});
 assert.equal(result.passed,true);assert.equal(result.actualEmailDelivery,false);assert.equal(result.customerRecordsAccessed,false);
 assert.equal(result.counts.modelRequests,3);assert.equal(result.counts.emailSandboxRequests,1);assert.equal(result.counts.storageUploads,1);assert.equal(result.counts.base44Requests,0);
 assert.ok(n.calls.every(c=>!c.origin.includes('base44')));assert.equal(n.objects.size,1);assert.equal([...n.objects.values()][0].toString(),FIXTURE);
 const serialized=JSON.stringify(result);assert.ok(!serialized.includes('synthetic-only'));assert.ok(!serialized.includes('token='));assert.ok(!serialized.includes('cmfile:'));
});
test('operator retry reuses completed AI, email and upload receipts rather than rebilling',async()=>{
 const n=mockNetwork(),c=loadConfig(env);await runOperatorAcceptance(c,{authorization:'explicit-synthetic-v1',fetcher:n.fetcher});
 const result=await runOperatorAcceptance(c,{authorization:'explicit-synthetic-v1',fetcher:n.fetcher});
 assert.equal(result.passed,true);assert.equal(result.counts.modelRequests,0);assert.equal(result.counts.emailSandboxRequests,0);assert.equal(result.counts.storageUploads,0);
 assert.equal(n.objects.size,1);
});
test('uncertain provider failure cannot be repeated by the fixed acceptance request',async()=>{
 const n=mockNetwork({modelFailure:true}),c=loadConfig(env);await assert.rejects(()=>runOperatorAcceptance(c,{authorization:'explicit-synthetic-v1',fetcher:n.fetcher}));
 const before=n.calls.filter(r=>r.origin==='https://api.anthropic.com').length;
 await assert.rejects(()=>runOperatorAcceptance(c,{authorization:'explicit-synthetic-v1',fetcher:n.fetcher}));
 assert.equal(n.calls.filter(r=>r.origin==='https://api.anthropic.com').length,before);
});
test('foreign-owner file metadata causes acceptance failure, never a passing privacy claim',async()=>{
 const n=mockNetwork({foreignFileLeak:true});await assert.rejects(()=>runOperatorAcceptance(loadConfig(env),{authorization:'explicit-synthetic-v1',fetcher:n.fetcher}),e=>e.code==='SYNTHETIC_OWNER_BOUNDARY_FAILED');
});
test('operator CLI rejects missing or additional arguments without execution',async()=>{
 const records=[];
 for(const args of [[],['--run'],['--execute-synthetic-v1','extra']])assert.equal(await main(args,{},value=>records.push(value)),2);
 assert.equal(records.length,3);assert.ok(records.every(r=>r.code==='EXPLICIT_FLAG_REQUIRED'));
});
test('normal public runtime has no operator route or automatic acceptance import',()=>{
 for(const file of ['app.mjs','server.mjs']) {
  const source=readFileSync(fileURLToPath(new URL(file,import.meta.url)),'utf8');assert.ok(!source.includes('operator-acceptance'));assert.ok(!source.includes('runOperatorAcceptance'));
 }
});
