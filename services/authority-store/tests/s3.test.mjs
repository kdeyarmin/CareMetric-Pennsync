import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { s3Fields, s3Tables } from './s3-fixture.mjs';

const app='6a9881683dc68a0bd54f1ef7';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`60000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db, fixtures;
before(async()=>{
  db=new PGlite(); await db.exec(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(f,dir),'utf8'));
  fixtures=await readFile(new URL('./fixtures.sql',import.meta.url),'utf8');
});
after(async()=>db?.close());
async function login(n=1) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})]);
  await db.exec('set local role authenticated');
}
async function rpc(name,args) { return (await db.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; }
const scope=(o={})=>Object.values({app,agency:'agency-a',patient:'patient-a1',actorVersion:1,patientVersion:1,...o});
const create=(fields=s3Fields(),o={},id=1)=>rpc('s3_create',[...scope(o),request(id),JSON.stringify(fields)]);
const confirm=(referral,o={},id=2,version=1)=>rpc('s3_confirm',[...scope(o),referral,version,request(id)]);
const read=(referral,o={})=>rpc('s3_read',[...scope(o),referral]);
async function privileged(sql,params=[]) { await db.exec('reset role'); const r=await db.query(sql,params); await db.exec('set local role authenticated'); return r; }
async function denied(fn,pattern) {
  await db.exec('savepoint denied');
  try { await assert.rejects(fn,e=>!pattern||e.message.includes(pattern)); }
  finally { await db.exec('rollback to savepoint denied'); }
}
async function counts() { return Object.values((await privileged(`select ${s3Tables.map(x=>`(select count(*)::int from pennsync_private.${x}) ${x}`).join(',')}`)).rows[0]); }
function scenario(name,fn) { test(name,async()=>{
  await db.exec('begin'); try { await db.exec(fixtures); await login(); await fn(); } finally { await db.exec('rollback'); }
}); }

scenario('S3 creates a manual referral and confirms exactly the existing-patient source fields',async()=>{
  const first=await create(), before=first.referral;
  assert.equal(first.contract,'cm.pennsync.s3-referral.staging.v1'); assert.equal(first.replayed,false);
  assert.equal(before.version,1); assert.equal(before.patient_id,'patient-a1'); assert.equal(before.agency_id,'agency-a');
  assert.equal(before.created_by_user_id,first.context.user_id);
  assert.equal(before.created_by_user_email_normalized,'admin-a@example.invalid');
  assert.equal(before.referral_creation_key,`agency-a:${first.context.user_id}:${request(1)}`);
  for(const [key,value] of Object.entries(s3Fields())) assert.deepEqual(before[key],value);
  assert.deepEqual((await read(before.id)).referral,before);
  assert.deepEqual(await create(),{...first,replayed:true});
  const accepted=await confirm(before.id), after=accepted.referral;
  assert.equal(accepted.action,'confirm'); assert.equal(after.version,2);
  const {updated_date:date1,...rest1}=before;
  const {updated_date:date2,...rest2}=after;
  assert.ok(Date.parse(date1)<=Date.parse(date2));
  assert.deepEqual(rest2,{...rest1,patient_id:'patient-a1',requires_manual_review:false,manually_confirmed:true,status:'ready_for_admission',version:2});
  assert.deepEqual(await confirm(before.id),{...accepted,replayed:true});
  assert.deepEqual((await read(before.id)).referral,after);
  assert.deepEqual(await counts(),[1,2]);
});
scenario('S3 source create retry after confirmation conflicts and never recreates or reverses the referral',async()=>{
  const first=await create(); await confirm(first.referral.id);
  await denied(()=>create(),'PENNSYNC_S3_REPLAY_STATE_CHANGED');
  await denied(()=>confirm(first.referral.id,{},3),'PENNSYNC_S3_REFERRAL_VERSION_CHANGED');
  await denied(()=>confirm(first.referral.id,{},2,2),'PENNSYNC_S3_REFERRAL_VERSION_CHANGED');
  assert.equal((await read(first.referral.id)).referral.status,'ready_for_admission'); assert.deepEqual(await counts(),[1,2]);
});
scenario('S3 exact full-payload replay rejects changed input, patient, revision and reused action',async()=>{
  const first=await create();
  for(const fields of [s3Fields({priority:'urgent'}),s3Fields({patient_name:'Synthetic Other'})])
    await denied(()=>create(fields),'PENNSYNC_S3_IDEMPOTENCY_CONFLICT');
  await denied(()=>create(s3Fields(),{patient:'patient-a2'}),'PENNSYNC_S3_IDEMPOTENCY_CONFLICT');
  await denied(()=>confirm(first.referral.id,{},1),'PENNSYNC_S3_IDEMPOTENCY_CONFLICT');
  const another=await create(s3Fields(),{},3); await confirm(first.referral.id);
  await denied(()=>confirm(another.referral.id),'PENNSYNC_S3_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await counts(),[2,3]);
});
scenario('S3 both clinicians and foreign agency/patient are denied at create, confirm and read',async()=>{
  const first=await create();
  for(const [actor,agency,patient] of [[2,'agency-a','patient-a1'],[3,'agency-a','patient-a1'],[1,'agency-a','patient-b1'],[4,'agency-b','patient-a1'],[4,'agency-a','patient-a1']]) {
    await login(actor); const o={agency,patient};
    await denied(()=>create(s3Fields(),o)); await denied(()=>confirm(first.referral.id,o)); await denied(()=>read(first.referral.id,o));
  }
  await login(4); const b=await create(s3Fields({patient_name:'Synthetic Agency B One'}),{agency:'agency-b',patient:'patient-b1'});
  await confirm(b.referral.id,{agency:'agency-b',patient:'patient-b1'});
  await login(1); await denied(()=>read(b.referral.id),'PENNSYNC_S3_REFERRAL_DENIED');
  assert.deepEqual(await counts(),[2,3]);
});
scenario('S3 request deduplication preserves the source agency and actor dimensions',async()=>{
  const a=await create();
  await privileged(`insert into pennsync_private.membership(app_id,id,agency_id,auth_user_id,base44_user_id,tenant_role,status)
    select app_id,'membership-admin-a-b','agency-b',auth_user_id,base44_user_id,'agency_admin','active'
    from pennsync_private.identity_map where auth_user_id=$1`,[uid(1)]);
  const b=await create(s3Fields(),{agency:'agency-b',patient:'patient-b1'});
  assert.notEqual(a.referral.id,b.referral.id); assert.deepEqual(await create(),{...a,replayed:true});
  assert.deepEqual(await create(s3Fields(),{agency:'agency-b',patient:'patient-b1'}),{...b,replayed:true});
  await login(4); const other=await create(s3Fields(),{agency:'agency-b',patient:'patient-b1'});
  assert.notEqual(other.referral.id,b.referral.id); assert.deepEqual(await counts(),[3,3]);
});
scenario('S3 manager and assigned office staff preserve intake authority and may confirm another intake actor referral',async()=>{
  const first=await create();
  await privileged("update pennsync_private.membership set tenant_role='manager' where id='membership-2'");
  await login(2); assert.equal((await read(first.referral.id)).context.tenant_role,'manager'); await confirm(first.referral.id);
  const manager=await create(s3Fields(),{},3);
  await privileged("update pennsync_private.membership set tenant_role='office_staff' where id='membership-3'");
  await privileged("insert into pennsync_private.assignment(app_id,agency_id,patient_id,membership_id,status,changed_by) values($1,'agency-a','patient-a1','membership-3','active',$2)",[app,uid(1)]);
  await login(3); await confirm(manager.referral.id);
  const office=await create(s3Fields(),{},3); assert.equal(office.context.tenant_role,'office_staff');
  for(const role of ['social_worker','spiritual_care','clinician']) {
    await privileged("update pennsync_private.membership set tenant_role=$1 where id='membership-3'",[role]);
    await denied(()=>create(s3Fields(),{},3),'PENNSYNC_S3_INTAKE_ROLE_REQUIRED');
    await denied(()=>read(office.referral.id),'PENNSYNC_S3_INTAKE_ROLE_REQUIRED');
  }
  assert.deepEqual(await counts(),[3,5]);
});
scenario('S3 rejects unknown fields, clinical work, relinking and invalid names without any writes',async()=>{
  for(const changes of [{patient_id:'patient-b1'},{agency_id:'agency-b'},{created_by:'forged'},
    {assigned_to:'admin-a@example.invalid'},{extracted_data:{}},{follow_up_requests:[]},
    {document_type:'pdf'},{status:'ready_for_admission'},{requires_manual_review:false},{manually_confirmed:true},
    {priority:null},{priority:'emergency'},{patient_name:null},{patient_name:'Customer Name'},{patient_name:'Synthetic '},
    {patient_name:'Synthetic '+'x'.repeat(111)},{patient_name:'Synthetic '+'🩺'.repeat(56)}])
    await denied(()=>create(s3Fields(changes)),'PENNSYNC_S3_');
  const missing=s3Fields(); delete missing.priority; await denied(()=>create(missing),'PENNSYNC_S3_UNSUPPORTED_FIELDS');
  assert.deepEqual(await counts(),[0,0]);
  for(const [i,priority] of ['low','normal','high','urgent'].entries()) await create(s3Fields({priority,patient_name:'Synthetic '+'🩺'.repeat(55)}),{},i+1);
  assert.deepEqual(await counts(),[4,4]);
});
scenario('S3 native logout denies pending confirmation, current read and both exact retries',async()=>{
  const pending=await create(), completed=await create(s3Fields(),{},3); await confirm(completed.referral.id,{},4);
  await privileged('delete from auth.sessions where id=$1',[sid(1)]);
  for(const fn of [()=>create(),()=>confirm(pending.referral.id),()=>confirm(completed.referral.id,{},4),()=>read(completed.referral.id)])
    await denied(fn,'PENNSYNC_SESSION_INACTIVE');
  assert.deepEqual(await counts(),[2,3]);
});
scenario('S3 membership changes, suspension and patient deactivation deny fresh writes and recovery',async()=>{
  const first=await create();
  for(const sql of ["update pennsync_private.membership set status='revoked',revoked_at=clock_timestamp(),revoked_by='10000000-0000-4000-8000-000000000004' where id='membership-1'",
    "update pennsync_private.agency set status='suspended' where id='agency-a'","update pennsync_private.patient set status='inactive' where id='patient-a1'"]) {
    await db.exec('savepoint mutation'); await privileged(sql);
    for(const fn of [()=>create(),()=>confirm(first.referral.id),()=>read(first.referral.id)]) await denied(fn);
    await db.exec('rollback to savepoint mutation');
  }
  await privileged("update pennsync_private.membership set version=2 where id='membership-1'");
  await denied(()=>create(),'PENNSYNC_ACTOR_VERSION_CHANGED');
  await denied(()=>create(s3Fields(),{actorVersion:2}),'PENNSYNC_S3_IDEMPOTENCY_CONFLICT');
  await denied(()=>confirm(first.referral.id),'PENNSYNC_ACTOR_VERSION_CHANGED');
  assert.equal((await read(first.referral.id,{actorVersion:2})).referral.version,1);
  await privileged("update pennsync_private.patient set version=2 where id='patient-a1'");
  await denied(()=>read(first.referral.id,{actorVersion:2}),'PENNSYNC_PATIENT_VERSION_CHANGED');
  assert.deepEqual(await counts(),[1,1]);
});
scenario('S3 receipt/result integrity rejects corrupt state and immutable receipts reject writes',async()=>{
  const first=await create();
  await denied(()=>privileged("update pennsync_private.s3_receipt set result='{}'"),'PENNSYNC_S3_IMMUTABLE');
  for(const sql of ["alter table pennsync_private.s3_referral disable trigger transition; update pennsync_private.s3_referral set data=data||'{\"patient_name\":\"Synthetic Tampered\"}'",
    "alter table pennsync_private.s3_receipt disable trigger immutable; update pennsync_private.s3_receipt set payload=payload||'{\"tampered\":true}'"]) {
    await db.exec('savepoint corrupt'); await db.exec('reset role'); await db.exec(sql); await db.exec('set local role authenticated');
    await denied(()=>read(first.referral.id),'PENNSYNC_S3_RESULT_CHANGED');
    await denied(()=>confirm(first.referral.id),'PENNSYNC_S3_RESULT_CHANGED');
    await db.exec('rollback to savepoint corrupt');
  }
});
scenario('S3 insert and receipt failures leave creation empty and confirmation unchanged',async()=>{
  await privileged("create function pennsync_private.s3_test_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'INJECTED_S3_FAILURE'; end $$");
  for(const table of s3Tables) {
    await db.exec('savepoint inject');
    await privileged(`create trigger injected before insert on pennsync_private.${table} for each row execute function pennsync_private.s3_test_failure()`);
    await denied(()=>create(),'INJECTED_S3_FAILURE'); assert.deepEqual(await counts(),[0,0]); await db.exec('rollback to savepoint inject');
  }
  const first=await create();
  for(const [table,event] of [['s3_referral','update'],['s3_receipt','insert']]) {
    await db.exec('savepoint inject');
    await privileged(`create trigger injected before ${event} on pennsync_private.${table} for each row execute function pennsync_private.s3_test_failure()`);
    await denied(()=>confirm(first.referral.id),'INJECTED_S3_FAILURE');
    assert.deepEqual((await read(first.referral.id)).referral,first.referral); assert.deepEqual(await counts(),[1,1]); await db.exec('rollback to savepoint inject');
  }
});
scenario('S3 RLS and function grants exclude direct CRUD, internal helpers, anonymous and service-role calls',async()=>{
  await create();
  for(const table of s3Tables) {
    await denied(()=>db.query(`select * from pennsync_private.${table}`),'permission denied');
    await privileged(`grant select,insert,update,delete on pennsync_private.${table} to authenticated`);
    assert.deepEqual((await db.query(`select * from pennsync_private.${table}`)).rows,[]);
  }
  await denied(()=>db.query('select pennsync_private.s3_fields($1)',[JSON.stringify(s3Fields())]),'permission denied');
  for(const role of ['anon','service_role']) { await db.exec(`set local role ${role}`); await denied(()=>create(),'permission denied'); }
});
