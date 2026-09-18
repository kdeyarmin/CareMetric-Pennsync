import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { toNoteConversionFields } from '../../../src/components/smartNote/compliance/coverageScore.js';
import { buildAuditFields, buildVisitReportingFields } from '../../../src/components/smartNote/compliance/reportingFields.js';
import { s4Fields, s4Tables } from './s4-fixture.mjs';

const app='6a9881683dc68a0bd54f1ef7';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`40000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db, fixtures;
before(async()=>{
  db=new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
  const dir=new URL('../supabase/migrations/',import.meta.url);
  for(const f of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(f,dir),'utf8'));
  fixtures=await readFile(new URL('./fixtures.sql',import.meta.url),'utf8');
});
after(async()=>db?.close());
async function login(n=1,extra={}) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600,...extra})]);
  await db.exec('set local role authenticated');
}
async function rpc(name,args) { return (await db.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; }
const args=(overrides={})=>Object.values({app,agency:'agency-a',patient:'patient-a1',actorVersion:1,patientVersion:1,request:request(1),...overrides});
const save=(fields=s4Fields(),overrides={})=>rpc('s4_create',[...args(overrides),JSON.stringify(fields)]);
const read=(overrides={})=>rpc('s4_read',args(overrides));
async function privileged(sql,params=[]) { await db.exec('reset role'); const r=await db.query(sql,params); await db.exec('set local role authenticated'); return r; }
async function denied(fn,pattern) {
  await db.exec('savepoint denied');
  try { await assert.rejects(fn,e=>!pattern||e.message.includes(pattern)); }
  finally { await db.exec('rollback to savepoint denied'); }
}
async function counts() { return (await privileged(`select ${s4Tables.map(x=>`(select count(*)::int from pennsync_private.${x}) ${x}`).join(',')}`)).rows[0]; }
function scenario(name,fn) { test(name,async()=>{
  await db.exec('begin'); try { await db.exec(fixtures); await login(); await fn(); } finally { await db.exec('rollback'); }
}); }

scenario('S4 subset saves four exact artifacts and round-trips unchanged through current receipt and retry',async()=>{
  const f=s4Fields(), result=await save(f);
  assert.equal(result.contract,'cm.pennsync.s4-create.staging.v1'); assert.equal(result.replayed,false);
  assert.equal(result.context.auth_user_id,uid(1)); assert.equal(result.context.agency_id,'agency-a');
  assert.deepEqual(Object.keys(result.artifacts).sort(),['compliance_audit','note_conversion','note_history','visit']);
  const {visit,note_history:history,note_conversion:conversion,compliance_audit:audit}=result.artifacts;
  assert.equal(new Set(Object.values(result.artifacts).map(x=>x.id)).size,4);
  assert.equal(visit.nurse_notes,f.nurse_notes); assert.equal(visit.raw_transcription,f.raw_transcription);
  assert.deepEqual(visit.vital_signs,{heart_rate:72}); assert.equal(visit.status,'completed');
  assert.equal(visit.grounding_pending,false); assert.equal(visit.homebound_status_verified,false);
  assert.equal(visit.skilled_intervention_documented,false); assert.equal(visit.documentation_review_ack,null);
  assert.equal(visit.emr_handoff_status,'not_started'); assert.deepEqual(visit.emr_handoff_history,[]);
  assert.equal(visit.created_by_user_id,result.context.user_id); assert.equal(visit.created_by_user_email_normalized,'admin-a@example.invalid');
  for(const row of Object.values(result.artifacts)) { assert.equal(row.agency_id,'agency-a'); assert.equal(row.patient_id,'patient-a1'); }
  for(const row of [history,conversion,audit]) assert.equal(row.visit_id,visit.id);
  assert.equal(history.note,visit.nurse_notes); assert.equal(history.clinical_notes,visit.nurse_notes);
  assert.equal(history.mode,'append'); assert.equal(history.actor_user_id,result.context.user_id);
  assert.equal(history.note_sha256,createHash('sha256').update(f.nurse_notes).digest('hex'));
  const expected=toNoteConversionFields({coverageScore:f.compliance_score,draftPresenceScore:f.draft_presence_score,
    roughLen:f.raw_transcription.length,enhancedLen:f.nurse_notes.length,visitType:f.visit_type,diagnosis:'',nurseEmail:'admin-a@example.invalid',patientId:'patient-a1'});
  for(const [k,v] of Object.entries(expected)) assert.deepEqual(conversion[k],v,k);
  for(const [k,v] of Object.entries(buildAuditFields({coverageScore:f.compliance_score}))) assert.deepEqual(audit[k],v,k);
  for(const [k,v] of Object.entries(buildVisitReportingFields())) assert.deepEqual(visit[k],v,k);
  assert.deepEqual(await read(),{...result,replayed:true});
  assert.deepEqual(await save(f),{...result,replayed:true});
  assert.deepEqual(Object.values(await counts()),[1,1,1,1,1]);
});

scenario('S4 score thresholds and conversion floor preserve the pure helpers',async()=>{
  for(const score of [0,79.9,80,89.9,90,100]) {
    const result=await save(s4Fields({compliance_score:score,draft_presence_score:99}),{request:request(Math.round(score*10)+2)});
    assert.equal(result.artifacts.compliance_audit.status,buildAuditFields({coverageScore:score}).status);
    assert.equal(result.artifacts.note_conversion.compliance_improvement,Math.max(0,score-99));
  }
});
scenario('S4 four-role matrix denies unassigned and foreign patients before first write and replay',async()=>{
  for(const [actor,agency,patient] of [[1,'agency-a','patient-a1'],[2,'agency-a','patient-a1'],[4,'agency-b','patient-b1']]) {
    await login(actor); const result=await save(s4Fields(),{agency,patient}); assert.equal(result.context.auth_user_id,uid(actor));
    assert.deepEqual(await read({agency,patient}),{...result,replayed:true});
  }
  for(const [actor,agency,patient] of [[1,'agency-a','patient-b1'],[2,'agency-a','patient-a2'],[2,'agency-a','patient-b1'],[3,'agency-a','patient-a1'],[3,'agency-a','patient-a2'],[3,'agency-a','patient-b1'],[4,'agency-b','patient-a1'],[4,'agency-a','patient-a1']]) {
    await login(actor); for(const id of [1,2]) {
      await denied(()=>save(s4Fields(),{agency,patient,request:request(id)}));
      await denied(()=>read({agency,patient,request:request(id)}));
    }
  }
  assert.deepEqual(Object.values(await counts()),[3,3,3,3,3]);
});
scenario('S4 receipt lookup is actor-bound even for another currently authorized administrator',async()=>{
  await login(2); await save(); await login(1);
  await denied(()=>read(),'PENNSYNC_S4_RECEIPT_DENIED');
});
scenario('S4 retry binds the entire original request, including cleared vitals and otherwise equivalent text',async()=>{
  await save();
  for(const f of [s4Fields({nurse_notes:'Different'}),s4Fields({vital_signs:{heart_rate:72}}),s4Fields({draft_presence_score:69}),s4Fields({homebound_status_verified:true})])
    await denied(()=>save(f),'PENNSYNC_S4_IDEMPOTENCY_CONFLICT');
  await denied(()=>save(s4Fields(),{patient:'patient-a2'}),'PENNSYNC_S4_IDEMPOTENCY_CONFLICT');
  assert.deepEqual(Object.values(await counts()),[1,1,1,1,1]);
});
scenario('S4 unknown fields and unsupported workflows/findings never produce partial clinical records',async()=>{
  for(const change of [{forged:true},{created_by:'owner@example.invalid'},{patient_id:'patient-b1'},{visit_type:'physical_therapy'},{status:'pending_review'},
    {grounding_pending:true},{documentation_source:'audio'},{diagnosis:'unverified diagnosis'},{acknowledgment:{acknowledged:true}},
    ...['compliance_issues','ai_tags','chart_findings','denial_findings','sustained_trends','rule_versions'].map(k=>({[k]:['unsupported']}))])
    await denied(()=>save(s4Fields(change)),'PENNSYNC_S4_UNSUPPORTED');
  const missing=s4Fields(); delete missing.chart_findings; await denied(()=>save(missing),'PENNSYNC_S4_UNSUPPORTED_FIELDS');
  assert.deepEqual(Object.values(await counts()),[0,0,0,0,0]);
});
scenario('S4 text/date/boolean/numeric/vital boundaries fail closed without coercion',async()=>{
  for(const change of [{nurse_notes:null},{nurse_notes:''},{nurse_notes:' \n\t'},{nurse_notes:'x'.repeat(250001)},
    {raw_transcription:'🩺'.repeat(125001)},{homebound_justification:'x'.repeat(20001)},{compliance_score:101},{compliance_score:-1},
    {draft_presence_score:'80'},{homebound_status_verified:'true'},{skilled_intervention_documented:null},
    {visit_date:'2026-02-30'},{visit_date:'2026-9-18'},{vital_signs:[]},{vital_signs:{unknown:1}},
    {vital_signs:{heart_rate:'72'}},{vital_signs:{heart_rate:1000001}}]) await denied(()=>save(s4Fields(change)));
  const accepted=await save(s4Fields({nurse_notes:'🩺'.repeat(125000),vital_signs:{heart_rate:1000000,weight:null}}));
  assert.equal(accepted.artifacts.note_conversion.enhanced_len,250000);
  assert.deepEqual(accepted.artifacts.visit.vital_signs,{heart_rate:1000000});
});
scenario('S4 native session deletion and stale signed session deny fresh save, receipt and retry',async()=>{
  await login(2); await save();
  await privileged('delete from auth.sessions where id=$1',[sid(2)]);
  for(const id of [1,2]) { await denied(()=>save(s4Fields(),{request:request(id)}),'PENNSYNC_SESSION_INACTIVE'); await denied(()=>read({request:request(id)}),'PENNSYNC_SESSION_INACTIVE'); }
  assert.deepEqual(Object.values(await counts()),[1,1,1,1,1]);
});
scenario('S4 assignment removal and membership revocation deny fresh save, receipt and retry',async()=>{
  await login(2); await save(); await login(1);
  await rpc('assignment',[app,'agency-a','patient-a1','membership-2','revoke',1,1,1,request(20)]);
  await login(2); for(const id of [1,2]) {
    await denied(()=>save(s4Fields(),{request:request(id)}),'PENNSYNC_PATIENT_DENIED'); await denied(()=>read({request:request(id)}),'PENNSYNC_PATIENT_DENIED');
  }
  await login(1); await rpc('revoke_membership',[app,'agency-a','membership-2',1,1,request(21)]);
  await login(2); for(const id of [1,2]) {
    await denied(()=>save(s4Fields(),{request:request(id)}),'PENNSYNC_TENANT_DENIED'); await denied(()=>read({request:request(id)}),'PENNSYNC_TENANT_DENIED');
  }
});
scenario('S4 current membership/patient revisions and active status remain mandatory for receipts',async()=>{
  await save();
  await privileged("update pennsync_private.membership set version=2 where id='membership-1'");
  await denied(()=>save(),'PENNSYNC_ACTOR_VERSION_CHANGED'); await denied(()=>read(),'PENNSYNC_ACTOR_VERSION_CHANGED');
  await denied(()=>save(s4Fields(),{actorVersion:2}),'PENNSYNC_S4_IDEMPOTENCY_CONFLICT');
  await denied(()=>read({actorVersion:2}),'PENNSYNC_S4_REPLAY_STATE_CHANGED');
  await privileged("update pennsync_private.membership set version=1 where id='membership-1'");
  await privileged("update pennsync_private.patient set version=2 where id='patient-a1'");
  await denied(()=>save(),'PENNSYNC_PATIENT_VERSION_CHANGED'); await denied(()=>read(),'PENNSYNC_PATIENT_VERSION_CHANGED');
  await denied(()=>read({patientVersion:2}),'PENNSYNC_S4_REPLAY_STATE_CHANGED');
  await privileged("update pennsync_private.patient set status='inactive' where id='patient-a1'");
  await denied(()=>save(s4Fields(),{patientVersion:2,request:request(2)}),'PENNSYNC_PATIENT_DENIED');
  await denied(()=>read({patientVersion:2}),'PENNSYNC_PATIENT_DENIED');
});
scenario('S4 immutable artifacts reject updates, and privileged corruption fails exact receipt verification',async()=>{
  await save();
  await denied(()=>privileged("update pennsync_private.s4_visit set data=data||'{\"nurse_notes\":\"changed\"}'"),'PENNSYNC_S4_IMMUTABLE');
  for(const table of s4Tables.slice(0,4)) {
    await db.exec('savepoint corrupt');
    await privileged(`alter table pennsync_private.${table} disable trigger immutable`);
    await privileged(`update pennsync_private.${table} set data=data||'{"tampered":true}'`);
    await denied(()=>read(),'PENNSYNC_S4_ARTIFACTS_CHANGED'); await denied(()=>save(),'PENNSYNC_S4_ARTIFACTS_CHANGED');
    await db.exec('rollback to savepoint corrupt');
  }
});
scenario('S4 failure at any artifact or receipt insert rolls back the complete transaction',async()=>{
  await privileged("create function pennsync_private.s4_test_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'INJECTED_S4_FAILURE'; end $$");
  for(const table of s4Tables) {
    await db.exec('savepoint inject');
    await privileged(`create trigger injected before insert on pennsync_private.${table} for each row execute function pennsync_private.s4_test_failure()`);
    await denied(()=>save(),'INJECTED_S4_FAILURE'); assert.deepEqual(Object.values(await counts()),[0,0,0,0,0]);
    await db.exec('rollback to savepoint inject');
  }
});
scenario('S4 table grants cannot bypass RLS and internal helpers are not browser executable',async()=>{
  await save();
  for(const table of s4Tables) {
    await denied(()=>db.query(`select * from pennsync_private.${table}`),'permission denied');
    await privileged(`grant select,insert,update,delete on pennsync_private.${table} to authenticated`);
    assert.deepEqual((await db.query(`select * from pennsync_private.${table}`)).rows,[]);
  }
  await denied(()=>db.query('select pennsync_private.s4_fields($1)',[JSON.stringify(s4Fields())]),'permission denied');
  for(const role of ['anon','service_role']) { await db.exec(`set local role ${role}`); await denied(()=>save(),'permission denied'); }
});
