// Native PostgreSQL concurrency proof; only fresh, owned, literal-loopback databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function lab(run) {
  const name = `pennsync_intake_read_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_intake_read_test_[0-9]+_[a-f0-9]{10}$/);
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect(); const clients = []; let owned = false;
  try {
    const roles = await admin.query("select rolname from pg_catalog.pg_roles where rolname=any($1::text[]) order by rolname", [['anon', 'authenticated', 'service_role']]);
    assert.deepEqual(roles.rows.map(row => row.rolname), ['anon', 'authenticated', 'service_role']);
    await admin.query(`create database "${name}"`); owned = true;
    const target = new URL(base); target.pathname = `/${name}`;
    const connect = async () => {
      const c = new pg.Client({ connectionString: target.toString(), statement_timeout: 10000 });
      await c.connect(); clients.push(c); return c;
    };
    const setup = await connect();
    const bootstrap = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
    // Required roles pre-exist. Never issue cluster role DDL, even conditional DDL.
    const schema = bootstrap.slice(bootstrap.indexOf('create schema auth;'));
    assert.ok(schema.startsWith('create schema auth;'));
    await setup.query(schema);
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(f => f.endsWith('.sql')).sort()) await setup.query(await readFile(new URL(file, dir), 'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
    await run({ setup, connect });
  } finally {
    for (const c of clients) { try { await c.query('rollback'); } catch { /* already closed */ } await c.end(); }
    try { if (owned) await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  }
}
async function begin(c, n = 1) {
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })]);
  await c.query('set local role authenticated');
}
async function rpc(c, name, args) {
  return (await c.query(`select public.pennsync_staging_${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) result`, args)).rows[0].result;
}
const tracked = p => p.then(value => ({ ok: true, value }), error => ({ ok: false, error }));
async function waiting(monitor, client, event = 'advisory') {
  const end = Date.now() + 3000;
  while (Date.now() < end) {
    const result = await monitor.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [client.processID]);
    if (result.rows[0]?.wait_event_type === 'Lock' && (!event || result.rows[0].wait_event === event)) return;
    await delay(10);
  }
  assert.fail('Expected an observed PostgreSQL lock wait');
}
const list=(c,after=null,limit=1,agency='agency-a')=>rpc(c,'referral_patients',[APP,agency,limit,after]);
const patient=(c,id='patient-a1',agency='agency-a')=>rpc(c,'referral_patient',[APP,agency,id]);
async function intakeRoles(setup) {
 await setup.query("update pennsync_private.membership set tenant_role='office_staff' where id='membership-2'");
 await setup.query("update pennsync_private.membership set tenant_role='manager' where id='membership-3'");
}
async function refusal(c,call,pattern=/DENIED|INVALID_PAGE/) {
 await c.query('savepoint negative');try {await assert.rejects(call,e=>pattern.test(e.message));}finally{await c.query('rollback to savepoint negative');}
}
test('intake roles receive exact names and versions with bounded patient selection',()=>lab(async({setup,connect})=>{
 await intakeRoles(setup);const c=await connect();
 for (const actor of [1,2,3]) {
  await begin(c,actor);let after=null;const ids=[];
  do {const page=await list(c,after);assert.equal(page.items.length,1);const p=page.items[0];
   assert.deepEqual(Object.keys(p).sort(),['agency_id','display_name','id','synthetic','version']);
   assert.equal(p.agency_id,'agency-a');assert.equal(p.synthetic,true);assert.equal(p.version,1);
   assert.deepEqual((await patient(c,p.id)).patient,p);ids.push(p.id);after=page.next_cursor;
  }while(after);
  assert.deepEqual(ids,actor===2?['patient-a1']:['patient-a1','patient-a2']);
  await refusal(c,()=>patient(c,'patient-b1'));await refusal(c,()=>list(c,null,1,'agency-b'),/TENANT_DENIED/);
  for(const cursor of ['patient-b1','missing','bad id'])await refusal(c,()=>list(c,cursor));
  for(const limit of [0,101,null])await refusal(c,()=>list(c,null,limit));
  await c.query('rollback');
 }
}));
test('office staff cannot enumerate or select unassigned patients',()=>lab(async({setup,connect})=>{
 await intakeRoles(setup);await setup.query("update pennsync_private.membership set tenant_role='office_staff' where id='membership-3'");
 const c=await connect();await begin(c,3);assert.deepEqual((await list(c)).items,[]);await refusal(c,()=>patient(c));await c.query('rollback');
 await begin(c,2);await refusal(c,()=>patient(c,'patient-a2'));await refusal(c,()=>list(c,'patient-a2'));await c.query('rollback');
}));
test('clinical roles cannot use intake selection and private helper execution is denied',()=>lab(async({setup,connect})=>{
 const c=await connect();
 for(const role of ['clinician','social_worker','spiritual_care']) {
  await setup.query("update pennsync_private.membership set tenant_role=$1 where id='membership-2'",[role]);
  await begin(c,2);await refusal(c,()=>list(c));await refusal(c,()=>patient(c));
  await refusal(c,()=>c.query("select pennsync_private.referral_patient_value($1,'agency-a','patient-a1','{\"tenant_role\":\"agency_admin\"}')",[APP]),/permission denied/);
  await c.query('rollback');
 }
 for(const role of ['anon','service_role']) {
  await c.query('begin');await c.query(`set local role ${role}`);
  await refusal(c,()=>list(c),/permission denied/);await refusal(c,()=>patient(c),/permission denied/);await c.query('rollback');
 }
 assert.equal((await setup.query("select count(*)::int n from information_schema.role_table_grants where table_schema='pennsync_private' and grantee in ('anon','authenticated','service_role') and privilege_type in ('SELECT','INSERT','UPDATE','DELETE')")).rows[0].n,0);
}));
test('inactive patients are not selectable, and the clinical roster policy remains unchanged',()=>lab(async({setup,connect})=>{
 await intakeRoles(setup);await setup.query("update pennsync_private.patient set status='inactive',version=2 where id='patient-a1'");
 const c=await connect();await begin(c,2);assert.deepEqual((await list(c)).items,[]);await refusal(c,()=>patient(c));await c.query('rollback');
 await begin(c,3);assert.deepEqual((await list(c)).items.map(p=>p.id),['patient-a2']);
 await refusal(c,()=>rpc(c,'patients',[APP,'agency-a',50,null]),/ROSTER_ROLE_DENIED/);await c.query('rollback');
}));
for(const [name,sql,pattern] of [
 ['assignment',"update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2'",/REFERRAL_PATIENT_DENIED/],
 ['patient',"update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'",/REFERRAL_PATIENT_DENIED/],
 ['native logout',`delete from auth.sessions where id='${sid(2)}'`,/SESSION_INACTIVE/],
 ['membership',"update pennsync_private.membership set status='revoked',version=version+1,revoked_at=clock_timestamp(),revoked_by='10000000-0000-4000-8000-000000000001' where id='membership-2'",/TENANT_DENIED/],
])for(const readFirst of [true,false])test(`${name}: ${readFirst?'selection finishes before revocation':'revocation prevents selection'}`,()=>lab(async({setup,connect})=>{
 await intakeRoles(setup);const reader=await connect(),writer=await connect();await begin(reader,2);await writer.query('begin');
 if(readFirst){await patient(reader);const pending=tracked(writer.query(sql));await waiting(setup,writer,null);await reader.query('commit');assert.equal((await pending).ok,true);await writer.query('commit');}
 else {await writer.query(sql);const pending=tracked(patient(reader));await waiting(setup,reader,null);await writer.query('commit');const outcome=await pending;assert.equal(outcome.ok,false);assert.match(outcome.error.message,pattern);await reader.query('rollback');}
 await begin(reader,2);await assert.rejects(()=>patient(reader),e=>pattern.test(e.message));await reader.query('rollback');
}));
