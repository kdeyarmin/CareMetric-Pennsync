// Native PostgreSQL concurrency proof; only fresh, owned, literal-loopback databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { s4Fields } from './s4-fixture.mjs';

const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const visitKeys = ['id','patient_id','visit_date','visit_type','status','updated_date'];
async function lab(run) {
  const name = `pennsync_visit_list_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_visit_list_test_[0-9]+_[a-f0-9]{10}$/);
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
const read = (c, patient='patient-a1', cursor=null, size=2, agency='agency-a', status=null) => rpc(c, 'visits_schedule', [APP,agency,patient,status,size,cursor===null?null:JSON.stringify(cursor)]);
async function seed(c, fields = s4Fields()) {
  await begin(c, 1);
  const result = await rpc(c, 's4_create', [APP, 'agency-a', 'patient-a1', 1, 1, randomUUID(), JSON.stringify(fields)]);
  await c.query('commit'); return result;
}
const count = async c => (await c.query('select count(*)::int n from pennsync_private.visit_list_disclosure_audit')).rows[0].n;
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
const revoke = c => rpc(c, 'revoke_membership', [APP, 'agency-a', 'membership-2', 1, 1, randomUUID()]);


test('current admin and assigned clinician discover exact saved metadata with immutable audits', () => lab(async ({setup,connect})=>{
 const c=await connect(), saved=[]; for(let n=0;n<5;n++) saved.push((await seed(c)).artifacts.visit);
 saved.sort((a,b)=>a.id.localeCompare(b.id));
 for(const actor of [1,2]) {
  let cursor=null; const found=[];
  do { await begin(c,actor); const result=await read(c,'patient-a1',cursor); await c.query('commit');
   assert.equal(result.purpose,'schedule');assert.equal(result.scope.membership_id,`membership-${actor}`);
   assert.equal(result.page.after_id,cursor?.after_id??null);found.push(...result.visits);cursor=result.page.next_cursor;
   assert.equal(result.page.has_more,cursor!==null);
  } while(cursor);
  assert.deepEqual(found,saved.map(v=>Object.fromEntries(visitKeys.map(k=>[k,v[k]]))));
 }
 assert.equal(await count(setup),6);
 await assert.rejects(setup.query('delete from pennsync_private.visit_list_disclosure_audit'),/IMMUTABLE/);
}));
test('authorized empty page commits an empty disclosure and unsupported patients do not',()=>lab(async({setup,connect})=>{
 const c=await connect();await begin(c);const result=await read(c,'patient-a2');await c.query('commit');
 assert.deepEqual(result.visits,[]);assert.equal(result.page.has_more,false);assert.equal(await count(setup),1);
 for(const [actor,patient,agency] of [[3,'patient-a1','agency-a'],[2,'patient-a2','agency-a'],[4,'patient-a1','agency-b'],[1,'missing','agency-a'],[4,'patient-a1','agency-a']]) {
  await begin(c,actor);await assert.rejects(read(c,patient,null,2,agency));await c.query('rollback');
 } assert.equal(await count(setup),1);
}));
test('cursor is exact current scope, filter, page size and existing anchor rather than an authority grant',()=>lab(async({setup,connect})=>{
 const c=await connect();for(let n=0;n<3;n++)await seed(c);
 await begin(c);const first=await read(c,'patient-a1',null,1);await c.query('commit');const cursor=first.page.next_cursor;
 for(const change of [{extra:true},{membership_version:2},{subject_user_id:'other'},{patient_id:'patient-a2'},
  {status:'completed'},{page_size:2},{after_id:randomUUID()},{after_id:cursor.after_id.toUpperCase()},{assignment_id:randomUUID()}]) {
  await begin(c);await assert.rejects(read(c,'patient-a1',{...cursor,...change},1),/CURSOR_CHANGED/);await c.query('rollback');
 }
 await begin(c,2);await assert.rejects(read(c,'patient-a1',cursor,1),/CURSOR_CHANGED/);await c.query('rollback');
 assert.equal(await count(setup),1);
}));
test('invalid request bounds and roles fail closed without a disclosure',()=>lab(async({setup,connect})=>{
 const c=await connect();
 for(const [size,status,cursor] of [[0,null,null],[51,null,null],[null,null,null],[1,'scheduled',null],[1,null,{}],[1,null,[]]]) {
  await begin(c);await assert.rejects(read(c,'patient-a1',cursor,size,'agency-a',status));await c.query('rollback');
 } assert.equal(await count(setup),0);
}));
test('artifact corruption and audit failure withhold the whole page',()=>lab(async({setup,connect})=>{
 const c=await connect();await seed(c);
 await setup.query(`create function pennsync_private.fail_list_audit() returns trigger language plpgsql as $$ begin raise exception 'test unavailable';end $$;
 create trigger fail_list before insert on pennsync_private.visit_list_disclosure_audit for each row execute function pennsync_private.fail_list_audit()`);
 await begin(c);await assert.rejects(read(c),/VISIT_LIST_AUDIT_UNAVAILABLE/);await c.query('rollback');assert.equal(await count(setup),0);
 await setup.query('drop trigger fail_list on pennsync_private.visit_list_disclosure_audit');
 await setup.query("alter table pennsync_private.s4_note_history disable trigger user; update pennsync_private.s4_note_history set data=jsonb_set(data,'{note}','\"tampered\"'); alter table pennsync_private.s4_note_history enable trigger user");
 await begin(c);await assert.rejects(read(c),/S4_ARTIFACTS_CHANGED/);await c.query('rollback');assert.equal(await count(setup),0);
}));
test('anonymous and service roles cannot read tables or execute the list entry',()=>lab(async({setup,connect})=>{
 const c=await connect();for(const role of ['anon','authenticated','service_role']) {
  await c.query(`begin;set local role ${role}`);await assert.rejects(c.query('select * from pennsync_private.visit_list_disclosure_audit'));await c.query('rollback');
  if(role!=='authenticated'){await c.query(`begin;set local role ${role}`);await assert.rejects(read(c));await c.query('rollback');}
 } assert.equal(await count(setup),0);
}));
for (const readFirst of [false, true]) test(`membership revoke/read lock ordering: ${readFirst ? 'read commits first' : 'revocation commits first'}`, () => lab(async ({ setup, connect }) => {
  const reader = await connect(), revoker = await connect(); await seed(reader);
  await begin(reader, 2); await begin(revoker);
  if (readFirst) {
    await read(reader, 'patient-a1'); const pending = tracked(revoke(revoker));
    await waiting(setup, revoker); await reader.query('commit'); assert.equal((await pending).ok, true); await revoker.query('commit');
  } else {
    await revoke(revoker); const pending = tracked(read(reader, 'patient-a1'));
    await waiting(setup, reader); await revoker.query('commit'); const outcome = await pending;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, /TENANT_DENIED/); await reader.query('rollback');
  }
  await begin(reader, 2); await assert.rejects(() => read(reader, 'patient-a1'), /TENANT_DENIED/); await reader.query('rollback');
  assert.equal(await count(setup), readFirst ? 1 : 0);
}));

for (const [name, sql, denied] of [
  ['native logout', `delete from auth.sessions where id='${sid(2)}'`, /SESSION_INACTIVE/],
  ['patient deactivation', "update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'", /VISIT_LIST_DENIED/],
  ['assignment revocation', "update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2'", /VISIT_LIST_DENIED/],
]) for (const readFirst of [false, true]) test(`${name} row lock ordering: ${readFirst ? 'read commits first' : 'revocation commits first'}`, () => lab(async ({ setup, connect }) => {
  const reader = await connect(), writer = await connect(); await seed(reader);
  await begin(reader, 2); await writer.query('begin');
  if (readFirst) {
    await read(reader, 'patient-a1'); const pending = tracked(writer.query(sql));
    await waiting(setup, writer, null); await reader.query('commit'); assert.equal((await pending).ok, true); await writer.query('commit');
  } else {
    await writer.query(sql); const pending = tracked(read(reader, 'patient-a1'));
    await waiting(setup, reader, null); await writer.query('commit'); const outcome = await pending;
    assert.equal(outcome.ok, false); assert.match(outcome.error.message, denied); await reader.query('rollback');
  }
  await begin(reader, 2); await assert.rejects(() => read(reader, 'patient-a1'), denied); await reader.query('rollback');
  assert.equal(await count(setup), readFirst ? 1 : 0);
}));

test('read-only transactions cannot return unaudited documentation', () => lab(async ({ setup, connect }) => {
  const c = await connect(); await seed(c);
  await begin(c, 2); await c.query('set transaction read only');
  await assert.rejects(() => read(c, 'patient-a1'), error => error.code === '25006' || error.code === 'PT503');
  await c.query('rollback'); assert.equal(await count(setup), 0);
}));
