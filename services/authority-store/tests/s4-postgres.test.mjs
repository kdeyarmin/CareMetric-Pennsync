import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { s4Fields, s4Tables } from './s4-fixture.mjs';

const raw=process.env.PENNSYNC_TEST_PG_URL;
if(!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base=new URL(raw);
if(!['postgres:','postgresql:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)
  ||base.pathname!=='/postgres'||base.search||base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const app='6a9881683dc68a0bd54f1ef7';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`50000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function lab(run){
  const name=`pennsync_s4_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name,/^pennsync_s4_test_[0-9]+_[a-f0-9]{10}$/);
  const admin=new pg.Client({connectionString:base.toString()}); await admin.connect();
  const clients=[];
  try {
    await admin.query(`create database "${name}"`);
    const target=new URL(base); target.pathname=`/${name}`;
    const connect=async()=>{ const c=new pg.Client({connectionString:target.toString()}); await c.connect();
      await c.query("set statement_timeout='10s'"); clients.push(c); return c; };
    const setup=await connect();
    await setup.query(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for(const f of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await setup.query(await readFile(new URL(f,dir),'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql',import.meta.url),'utf8'));
    await run({connect,setup});
  } finally {
    for(const c of clients) { try { await c.query('rollback'); } catch { /* already closed */ } await c.end(); }
    await admin.query(`drop database if exists "${name}"`); await admin.end();
  }
}
async function begin(c,n){
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})]);
  await c.query('set local role authenticated');
}
async function rpc(c,name,args){ return (await c.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; }
const save=(c,fields=s4Fields(),id=1)=>rpc(c,'s4_create',[app,'agency-a','patient-a1',1,1,request(id),JSON.stringify(fields)]);
const read=c=>rpc(c,'s4_read',[app,'agency-a','patient-a1',1,1,request(1)]);
const revoke=c=>rpc(c,'revoke_membership',[app,'agency-a','membership-2',1,1,request(10)]);
const tracked=p=>p.then(value=>({ok:true,value}),error=>({ok:false,error}));
async function waiting(monitor,client,event='advisory'){
  const end=Date.now()+3000;
  while(Date.now()<end){
    const r=await monitor.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[client.processID]);
    if(r.rows[0]?.wait_event_type==='Lock'&&(!event||r.rows[0].wait_event===event))return;
    await delay(10);
  }
  assert.fail('Expected an observed PostgreSQL lock wait');
}
async function counts(c){ return Object.values((await c.query(`select ${s4Tables.map(t=>`(select count(*)::int from pennsync_private.${t}) ${t}`).join(',')}`)).rows[0]); }

test('PostgreSQL S4 concurrent same-request save has one artifact set and exact replay',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,2); await begin(b,2);
  const first=await save(a); const pending=tracked(save(b)); await waiting(setup,b);
  await a.query('commit'); const second=await pending;
  assert.equal(second.ok,true); assert.deepEqual(second.value,{...first,replayed:true}); await b.query('commit');
  assert.deepEqual(await counts(setup),[1,1,1,1,1]);
}));
test('PostgreSQL S4 concurrent mismatched retry conflicts without a second artifact set',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,2); await begin(b,2);
  await save(a); const pending=tracked(save(b,s4Fields({nurse_notes:'Changed synthetic note'}))); await waiting(setup,b);
  await a.query('commit'); const second=await pending;
  assert.equal(second.ok,false); assert.equal(second.error.code,'PT409'); assert.match(second.error.message,/IDEMPOTENCY_CONFLICT/);
  await b.query('rollback'); assert.deepEqual(await counts(setup),[1,1,1,1,1]);
}));
test('PostgreSQL S4 membership revoke committed first denies blocked initial save',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,1); await begin(b,2);
  await revoke(a); const pending=tracked(save(b)); await waiting(setup,b); await a.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.match(result.error.message,/TENANT_DENIED/);
  await b.query('rollback'); assert.deepEqual(await counts(setup),[0,0,0,0,0]);
}));
test('PostgreSQL S4 save committed first preserves all artifacts and subsequent revoke denies retry/read',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,2); await begin(b,1);
  await save(a); const pending=tracked(revoke(b)); await waiting(setup,b); await a.query('commit');
  assert.equal((await pending).ok,true); await b.query('commit');
  for(const operation of [save,read]) {
    await begin(a,2); await assert.rejects(()=>operation(a),/TENANT_DENIED/); await a.query('rollback');
  }
  assert.deepEqual(await counts(setup),[1,1,1,1,1]);
}));
test('PostgreSQL S4 native logout committed first rejects a waiting still-signed session',()=>lab(async({connect,setup})=>{
  const logout=await connect(),writer=await connect(); await logout.query('begin');
  await logout.query('delete from auth.sessions where id=$1',[sid(2)]); await begin(writer,2);
  const pending=tracked(save(writer)); await waiting(setup,writer,null); await logout.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.match(result.error.message,/SESSION_INACTIVE/);
  await writer.query('rollback'); assert.deepEqual(await counts(setup),[0,0,0,0,0]);
}));
test('PostgreSQL S4 save fences native logout until commit and old-session replay then fails',()=>lab(async({connect,setup})=>{
  const writer=await connect(),logout=await connect(); await begin(writer,2); await save(writer);
  await logout.query('begin'); const pending=tracked(logout.query('delete from auth.sessions where id=$1',[sid(2)]));
  await waiting(setup,logout,null); await writer.query('commit'); assert.equal((await pending).ok,true); await logout.query('commit');
  for(const operation of [save,read]) {
    await begin(writer,2); await assert.rejects(()=>operation(writer),/SESSION_INACTIVE/); await writer.query('rollback');
  }
  assert.deepEqual(await counts(setup),[1,1,1,1,1]);
}));
test('PostgreSQL S4 patient deactivation committed first denies waiting save',()=>lab(async({connect,setup})=>{
  const deactivate=await connect(),writer=await connect(); await deactivate.query('begin');
  await deactivate.query("update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'");
  await begin(writer,2); const pending=tracked(save(writer)); await waiting(setup,writer,null);
  await deactivate.query('commit'); const result=await pending; assert.equal(result.ok,false); assert.match(result.error.message,/PATIENT_DENIED/);
  await writer.query('rollback'); assert.deepEqual(await counts(setup),[0,0,0,0,0]);
}));
test('PostgreSQL S4 each artifact/receipt failure rolls back every earlier insert',()=>lab(async({connect,setup})=>{
  await setup.query("create function pennsync_private.s4_test_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'INJECTED_S4_FAILURE'; end $$");
  const c=await connect();
  for(const table of s4Tables) {
    await setup.query(`create trigger injected before insert on pennsync_private.${table} for each row execute function pennsync_private.s4_test_failure()`);
    await begin(c,2); await assert.rejects(()=>save(c),/INJECTED_S4_FAILURE/); await c.query('rollback');
    assert.deepEqual(await counts(setup),[0,0,0,0,0]);
    await setup.query(`drop trigger injected on pennsync_private.${table}`);
  }
}));
