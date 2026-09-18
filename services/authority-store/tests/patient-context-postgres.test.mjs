import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { patientContexts, seedPatientContexts, PATIENT_CONTEXT_APP as APP } from './patient-context-fixture.mjs';
import { s4TrimWhitespace } from './s4-fixture.mjs';
const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function lab(run) {
  const name = `pennsync_context_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_context_test_[0-9]+_[a-f0-9]{10}$/);
  const admin = new pg.Client({ connectionString: base.toString() }); await admin.connect();
  const clients = []; let owned = false;
  try {
    assert.deepEqual((await admin.query("select rolname from pg_roles where rolname=any($1::text[]) order by rolname", [['anon','authenticated','service_role']])).rows.map(r => r.rolname), ['anon','authenticated','service_role']);
    await admin.query(`create database "${name}"`); owned = true;
    const target = new URL(base); target.pathname = `/${name}`;
    const connect = async () => { const c = new pg.Client({ connectionString: target.toString(), statement_timeout: 10000 }); await c.connect(); clients.push(c); return c; };
    const setup = await connect(), boot = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
    const schema = boot.slice(boot.indexOf('create schema auth;')); assert.ok(schema.startsWith('create schema auth;'));
    await setup.query(schema); // Never execute cluster role DDL.
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await setup.query(await readFile(new URL(file, dir), 'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
    const contexts = await seedPatientContexts(setup); await run({ setup, connect, contexts });
  } finally {
    for (const c of clients) { try { await c.query('rollback'); } catch { /* already closed */ } await c.end(); }
    try { if (owned) await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  }
}
async function begin(c, n = 1) {
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now()/1000)+3600 })]);
  await c.query('set local role authenticated');
}
async function rpc(c, name, args) { return (await c.query(`select public.pennsync_staging_${name}(${args.map((_, i) => `$${i+1}`).join(',')}) result`, args)).rows[0].result; }
const read = (c, purpose = 'smart_note_context', patient = 'patient-a1', agency = 'agency-a') => rpc(c, 'patient_context', [APP, agency, patient, purpose]);
const count = async c => (await c.query('select count(*)::int n from pennsync_private.patient_disclosure_audit')).rows[0].n;
const tracked = promise => promise.then(value => ({ ok:true,value }), error => ({ ok:false,error }));
async function waiting(monitor, client, event = null) {
  const end = Date.now()+3000;
  while (Date.now()<end) {
    const row = (await monitor.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[client.processID])).rows[0];
    if(row?.wait_event_type==='Lock' && (!event || row.wait_event===event)) return;
    await delay(10);
  }
  assert.fail('Expected an observed PostgreSQL lock wait');
}
test('exact purpose projections preserve explicit fictional fields and audit current reader/context/assignment', () => lab(async ({ setup, connect, contexts }) => {
  const c=await connect();
  for(const [n,index] of [[1,0],[2,0],[4,2]]) for(const purpose of ['display','smart_note_context']) {
    const f=patientContexts[index]; await begin(c,n); const result=await read(c,purpose,f.patientId,f.agencyId); await c.query('commit');
    const expected=purpose==='display'?Object.fromEntries(Object.entries(f.data).filter(([key])=>['id','first_name','middle_name','last_name'].includes(key))):f.data;
    assert.deepEqual(result.patient,expected); assert.equal(result.auth_user_id,uid(n)); assert.equal(result.purpose,purpose);
    assert.deepEqual(result.scope,{agency_id:f.agencyId,membership_id:`membership-${n}`,membership_version:1,tenant_role:n===2?'clinician':'agency_admin'});
  }
  assert.equal(await count(setup),6);
  const rows=(await setup.query('select * from pennsync_private.patient_disclosure_audit order by created_at')).rows;
  assert.deepEqual(rows.map(r=>r.actor_id),[uid(1),uid(1),uid(2),uid(2),uid(4),uid(4)]);
  assert.equal(rows[2].context_sha256,contexts[0].data_sha256);
  assert.equal(rows[2].assignment_id,(await setup.query('select id from pennsync_private.assignment')).rows[0].id);
  assert.equal(JSON.stringify(rows).includes(patientContexts[0].data.clinical_notes),false);
}));
test('display-only records stay minimal and cannot manufacture smart-note status, timestamp or history', () => lab(async ({ setup, connect }) => {
  const c=await connect(); await begin(c); assert.deepEqual((await read(c,'display','patient-a2')).patient,patientContexts[1].data); await c.query('commit');
  await begin(c); await assert.rejects(()=>read(c,'smart_note_context','patient-a2'),/CONTEXT_UNAVAILABLE/); await c.query('rollback');
  await begin(c,4); const b=(await read(c,'smart_note_context','patient-b1','agency-b')).patient; await c.query('commit');
  assert.equal(b.status,'hospitalized'); assert.equal(Object.hasOwn(b,'enhanced_notes_history'),false); assert.equal(Object.hasOwn(b,'clinical_notes'),false);
  assert.equal(await count(setup),2);
}));
test('foreign, unassigned, missing context, unsupported purpose/role and inactive patient all deny without audit', () => lab(async ({ setup, connect }) => {
  const c=await connect();
  await setup.query("insert into pennsync_private.patient(app_id,id,agency_id,display_name) values('6a9881683dc68a0bd54f1ef7','patient-a3','agency-a','Synthetic No Context')");
  for(const [n,purpose,patient,agency] of [[3,'display','patient-a1','agency-a'],[4,'display','patient-a1','agency-b'],[1,'display','patient-a3','agency-a'],[1,'selector','patient-a1','agency-a'],[1,null,'patient-a1','agency-a']]) {
    await begin(c,n); await assert.rejects(()=>read(c,purpose,patient,agency),/CONTEXT_(DENIED|UNAVAILABLE)/); await c.query('rollback');
  }
  await setup.query("update pennsync_private.membership set tenant_role='manager' where id='membership-1'");
  await begin(c); await assert.rejects(()=>read(c),/CONTEXT_DENIED/); await c.query('rollback');
  await setup.query("update pennsync_private.patient set status='inactive' where id='patient-a1'");
  await begin(c,2); await assert.rejects(()=>read(c),/CONTEXT_DENIED/); await c.query('rollback'); assert.equal(await count(setup),0);
}));
test('storage validates exact shapes, UTF16 names, calendar dates and finite canonical timestamps', () => lab(async ({ setup }) => {
  const base=structuredClone(patientContexts[0].data);
  const invalid=[null,[],{...base,extra:true},{...base,id:'foreign'},{...base,first_name:''},{...base,last_name:'😀'.repeat(101)},
    ...s4TrimWhitespace.map(s=>({...base,first_name:`${s}Name`})), ...s4TrimWhitespace.map(s=>({...base,last_name:`Name${s}`})),
    {...base,middle_name:null},{...base,status:'inactive'},{...base,care_type:'other'},{...base,date_of_birth:'1950-02-29'},
    {...base,date_of_birth:'0000-01-01'},{...base,updated_date:'2026-09-18T12:00:00Z'},{...base,updated_date:'2026-02-30T12:00:00.000Z'},
    {...base,secondary_diagnoses:[null]},{...base,past_medical_history:[{}]},{...base,current_medications:Array(501).fill({})},
    {...base,chronic_conditions:[null]},{...base,wounds:[[]]},{...base,enhanced_notes_history:Array(5001).fill({})},{...base,functional_status:[]},
    {...base,clinical_notes:'x'.repeat(900000)}];
  for(const data of invalid) assert.equal((await setup.query('select pennsync_private.patient_context_valid($1,$2::jsonb) valid',['patient-a1',JSON.stringify(data)])).rows[0].valid,false);
  for(const data of [{...base,first_name:'😀'.repeat(100)},{...base,first_name:'\u200bName\u200b'},{...base,date_of_birth:'2000-02-29'},
    {...base,enhanced_notes_history:[]},{...base,clinical_notes:'心'.repeat(200000)}]) {
    assert.equal((await setup.query('select pennsync_private.patient_context_valid($1,$2::jsonb) valid',['patient-a1',JSON.stringify(data)])).rows[0].valid,true);
  }
}));
test('context and audit are immutable, forced RLS and helper ACLs deny browser/service roles', () => lab(async ({ setup, connect }) => {
  const c=await connect(); await begin(c); await read(c); await c.query('commit');
  for(const table of ['patient_context','patient_disclosure_audit']) {
    for(const sql of [`delete from pennsync_private.${table}`,`update pennsync_private.${table} set patient_id=patient_id`]) await assert.rejects(()=>setup.query(sql),/CONTEXT_IMMUTABLE/);
    for(const role of ['anon','authenticated','service_role']) {
      await c.query('begin'); await c.query(`set local role ${role}`); await assert.rejects(()=>c.query(`select * from pennsync_private.${table}`),/permission denied/); await c.query('rollback');
    }
    await setup.query(`grant select,insert,update,delete on pennsync_private.${table} to authenticated`);
    await begin(c); assert.deepEqual((await c.query(`select * from pennsync_private.${table}`)).rows,[]); await c.query('rollback');
  }
  for(const role of ['anon','authenticated','service_role']) for(const helper of ['patient_context_valid(text,jsonb)','patient_context_immutable()']) {
    assert.equal((await setup.query('select has_function_privilege($1,$2,$3) allowed',[role,`pennsync_private.${helper}`,'EXECUTE'])).rows[0].allowed,false);
  }
}));
test('audit failure withholds both purpose responses and exposes only a fixed error', () => lab(async ({ setup, connect }) => {
  await setup.query("create function pennsync_private.context_test_failure() returns trigger language plpgsql as $$ begin raise exception 'sensitive synthetic diagnostic'; end $$; create trigger injected before insert on pennsync_private.patient_disclosure_audit for each row execute function pennsync_private.context_test_failure()");
  const c=await connect();
  for(const purpose of ['display','smart_note_context']) { await begin(c,2); await assert.rejects(()=>read(c,purpose),error=>{
    assert.equal(error.code,'PT503'); assert.equal(error.message,'PENNSYNC_PATIENT_AUDIT_UNAVAILABLE'); assert.equal(error.detail,undefined); return true;
  }); await c.query('rollback'); }
  assert.equal(await count(setup),0);
}));
test('corrupted stored digest and cross-agency context cannot be adopted', () => lab(async ({ setup, connect }) => {
  await setup.query("insert into pennsync_private.patient(app_id,id,agency_id,display_name) values('6a9881683dc68a0bd54f1ef7','patient-a3','agency-a','Synthetic Foreign Context Check')");
  await assert.rejects(()=>seedPatientContexts(setup,[{patientId:'patient-a3',agencyId:'agency-b',data:{...patientContexts[1].data,id:'patient-a3'}}]),error=>error.code==='23503');
  await setup.query("alter table pennsync_private.patient_context disable trigger immutable; alter table pennsync_private.patient_context drop constraint patient_context_data_sha256_check; update pennsync_private.patient_context set data_sha256=repeat('f',64) where patient_id='patient-a1'");
  const c=await connect(); await begin(c,2); await assert.rejects(()=>read(c),/CONTEXT_UNAVAILABLE/); await c.query('rollback'); assert.equal(await count(setup),0);
}));
for(const [name,mutation,errorPattern,usesApi] of [
  ['membership revoke',null,/TENANT_DENIED/,true],
  ['native logout',`delete from auth.sessions where id='${sid(2)}'`,/SESSION_INACTIVE/,false],
  ['patient deactivation',"update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'",/CONTEXT_DENIED/,false],
  ['assignment revoke',"update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2'",/CONTEXT_DENIED/,false],
]) for(const firstRead of [false,true]) test(`${name}: ${firstRead?'authorized disclosure commits first':'revocation commits first'}`,()=>lab(async({setup,connect})=>{
  const reader=await connect(),writer=await connect(); await begin(reader,2); if(usesApi)await begin(writer);else await writer.query('begin');
  const mutate=()=>usesApi?rpc(writer,'revoke_membership',[APP,'agency-a','membership-2',1,1,randomUUID()]):writer.query(mutation);
  if(firstRead) { await read(reader); const pending=tracked(mutate()); await waiting(setup,writer,usesApi?'advisory':null); await reader.query('commit'); assert.equal((await pending).ok,true); await writer.query('commit'); }
  else { await mutate(); const pending=tracked(read(reader)); await waiting(setup,reader,usesApi?'advisory':null); await writer.query('commit'); const outcome=await pending; assert.equal(outcome.ok,false); assert.match(outcome.error.message,errorPattern); await reader.query('rollback'); }
  await begin(reader,2); await assert.rejects(()=>read(reader),errorPattern); await reader.query('rollback'); assert.equal(await count(setup),firstRead?1:0);
}));
test('read-only transactions cannot return a patient without an audit',()=>lab(async({setup,connect})=>{
  const c=await connect(); await begin(c,2); await c.query('set transaction read only');
  await assert.rejects(()=>read(c),error=>['25006','PT503'].includes(error.code)); await c.query('rollback'); assert.equal(await count(setup),0);
}));
