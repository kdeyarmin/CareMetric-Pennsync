// Native PostgreSQL concurrency proof; only fresh, owned, literal-loopback databases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { s3Fields } from './s3-fixture.mjs';

const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function lab(run) {
  const name = `pennsync_referral_list_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_referral_list_test_[0-9]+_[a-f0-9]{10}$/);
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
const request=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const create=(c,patientId='patient-a1',n=1,agency='agency-a')=>rpc(c,'s3_create',[APP,agency,patientId,1,1,request(n),JSON.stringify(s3Fields())]);
const list=(c,after=null,limit=1,patient='patient-a1',agency='agency-a',actorVersion=1)=>rpc(c,'s3_list',[APP,agency,patient,actorVersion,1,limit,after]);
const confirm=(c,id)=>rpc(c,'s3_confirm',[APP,'agency-a','patient-a1',1,1,id,1,request(20)]);
async function refusal(c,fn,pattern=/DENIED|REQUIRED|CHANGED|INVALID_PAGE/){await c.query('savepoint negative');try{await assert.rejects(fn,e=>pattern.test(e.message));}finally{await c.query('rollback to savepoint negative');}}
async function seed(connect){const c=await connect();await begin(c);const first=await create(c);const second=await create(c,'patient-a1',2);await confirm(c,first.referral.id);await c.query('commit');return [first.referral.id,second.referral.id].sort();}
test('saved referral pages disclose exact stored pending/confirmed records and current receipt hashes',()=>lab(async({connect})=>{
 const ids=await seed(connect),c=await connect();await begin(c);
 const first=await list(c);assert.equal(first.contract,'cm.pennsync.s3-referral-list.staging.v1');assert.equal(first.action,'list');assert.equal(first.items.length,1);assert.equal(first.next_cursor,ids[0]);
 const second=await list(c,first.next_cursor);assert.equal(second.next_cursor,null);assert.deepEqual([first.items[0].referral.id,second.items[0].referral.id],ids);
 for(const item of [...first.items,...second.items]){const exact=await rpc(c,'s3_read',[APP,'agency-a','patient-a1',1,1,item.referral.id]);assert.deepEqual(item,{referral:exact.referral,referral_sha256:exact.referral_sha256});}
 assert.deepEqual((await list(c,ids[1])).items,[]);await c.query('rollback');
}));
test('empty current patient, foreign/unknown cursors, bounds and stale revisions fail closed',()=>lab(async({connect})=>{
 const ids=await seed(connect),c=await connect();await begin(c);const foreign=await create(c,'patient-a2',3);
 assert.deepEqual((await list(c,null,1,'patient-a2')).items.map(x=>x.referral.id),[foreign.referral.id]);
 for(const cursor of [foreign.referral.id,request(999)])await refusal(c,()=>list(c,cursor));
 for(const limit of [0,51,null])await refusal(c,()=>list(c,null,limit));
 await refusal(c,()=>list(c,null,1,'patient-a1','agency-a',2));await c.query('rollback');
 await begin(c,4);assert.deepEqual((await list(c,null,1,'patient-b1','agency-b')).items,[]);await refusal(c,()=>list(c,ids[0],1,'patient-b1','agency-b'));await refusal(c,()=>list(c,null,1,'patient-a1','agency-a'));await c.query('rollback');
}));
test('manager and assigned office staff discover records; clinicians and unassigned office staff do not',()=>lab(async({setup,connect})=>{
 await seed(connect);const c=await connect();
 for(const role of ['manager','office_staff','clinician','social_worker','spiritual_care']){
  await setup.query("update pennsync_private.membership set tenant_role=$1 where id='membership-2'",[role]);await begin(c,2);
  if(['manager','office_staff'].includes(role))assert.equal((await list(c,null,50)).items.length,2);else await refusal(c,()=>list(c));await c.query('rollback');
 }
 await setup.query("update pennsync_private.membership set tenant_role='office_staff' where id='membership-3'");await begin(c,3);await refusal(c,()=>list(c));await c.query('rollback');
 for(const role of ['anon','service_role']){await c.query('begin');await c.query(`set local role ${role}`);await refusal(c,()=>list(c),/permission denied/);await c.query('rollback');}
}));
test('corrupt current receipt withholds the complete page',()=>lab(async({setup,connect})=>{
 await seed(connect);await setup.query("alter table pennsync_private.s3_receipt disable trigger user;update pennsync_private.s3_receipt set referral_sha256=repeat('0',64) where action='confirm';alter table pennsync_private.s3_receipt enable trigger user");
 const c=await connect();await begin(c);await refusal(c,()=>list(c,null,50),/RESULT_CHANGED/);await c.query('rollback');
}));
for(const [name,sql,pattern] of [
 ['assignment',"update pennsync_private.assignment set status='revoked',version=version+1 where membership_id='membership-2'",/REFERRAL_PATIENT_DENIED/],
 ['patient',"update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'",/PATIENT_DENIED/],
 ['native logout',`delete from auth.sessions where id='${sid(2)}'`,/SESSION_INACTIVE/],
])for(const readFirst of [true,false])test(`${name}: ${readFirst?'list finishes before revocation':'revocation prevents list'}`,()=>lab(async({setup,connect})=>{
 await seed(connect);await setup.query("update pennsync_private.membership set tenant_role='office_staff' where id='membership-2'");
 const reader=await connect(),writer=await connect();await begin(reader,2);await writer.query('begin');
 if(readFirst){assert.equal((await list(reader)).items.length,1);const pending=tracked(writer.query(sql));await waiting(setup,writer,null);await reader.query('commit');assert.equal((await pending).ok,true);await writer.query('commit');}
 else{await writer.query(sql);const pending=tracked(list(reader));await waiting(setup,reader,null);await writer.query('commit');const result=await pending;assert.equal(result.ok,false);assert.match(result.error.message,pattern);await reader.query('rollback');}
 await begin(reader,2);await assert.rejects(()=>list(reader),e=>pattern.test(e.message));await reader.query('rollback');
}));

for(const readFirst of [true,false])test(`confirmation and referral list serialize (${readFirst?'list first':'confirmation first'})`,()=>lab(async({setup,connect})=>{
 await seed(connect);const id=(await setup.query('select id from pennsync_private.s3_referral where version=1')).rows[0].id;
 const reader=await connect(),writer=await connect();await begin(reader);await begin(writer);
 const confirmPending=()=>rpc(writer,'s3_confirm',[APP,'agency-a','patient-a1',1,1,id,1,request(21)]);
 if(readFirst){const before=await list(reader,null,50);assert.equal(before.items.filter(x=>x.referral.version===1).length,1);const pending=tracked(confirmPending());await waiting(setup,writer,null);await reader.query('commit');assert.equal((await pending).ok,true);await writer.query('commit');}
 else{await confirmPending();const pending=tracked(list(reader,null,50));await waiting(setup,reader,null);await writer.query('commit');const after=await pending;assert.equal(after.ok,true);assert.equal(after.value.items.every(x=>x.referral.version===2),true);await reader.query('commit');}
 await begin(reader);assert.equal((await list(reader,null,50)).items.every(x=>x.referral.version===2),true);await reader.query('rollback');
}));
