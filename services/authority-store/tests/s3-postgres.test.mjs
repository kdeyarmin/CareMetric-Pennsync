import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { s3Fields, s3Tables } from './s3-fixture.mjs';

const raw=process.env.PENNSYNC_TEST_PG_URL;
if(!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base=new URL(raw);
if(!['postgres:','postgresql:'].includes(base.protocol)||!['127.0.0.1','localhost','[::1]'].includes(base.hostname)
  ||base.pathname!=='/postgres'||base.search||base.hash) throw new Error('Only loopback PostgreSQL /postgres is allowed');
const app='6a9881683dc68a0bd54f1ef7';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`70000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function lab(run){
  const name=`pennsync_s3_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name,/^pennsync_s3_test_[0-9]+_[a-f0-9]{10}$/);
  const admin=new pg.Client({connectionString:base.toString()}); await admin.connect(); const clients=[]; let owned=false;
  try {
    const roles=await admin.query("select rolname from pg_catalog.pg_roles where rolname=any($1::text[]) order by rolname",[['anon','authenticated','service_role']]);
    assert.deepEqual(roles.rows.map(row=>row.rolname),['anon','authenticated','service_role'],'Existing local test roles are required; this harness does not provision cluster roles');
    await admin.query(`create database "${name}"`); owned=true; const target=new URL(base); target.pathname=`/${name}`;
    const connect=async()=>{ const c=new pg.Client({connectionString:target.toString()}); await c.connect();
      await c.query("set statement_timeout='10s'"); clients.push(c); return c; };
    const setup=await connect(); await setup.query(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for(const f of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort()) await setup.query(await readFile(new URL(f,dir),'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql',import.meta.url),'utf8')); await run({connect,setup});
  } finally {
    for(const c of clients) { try { await c.query('rollback'); } catch { /* already closed */ } await c.end(); }
    try { if(owned) await admin.query(`drop database "${name}"`); } finally { await admin.end(); }
  }
}
async function begin(c,n=1){
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})]);
  await c.query('set local role authenticated');
}
async function rpc(c,name,args){ return (await c.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args)).rows[0].result; }
const create=(c,fields=s3Fields(),id=1)=>rpc(c,'s3_create',[app,'agency-a','patient-a1',1,1,request(id),JSON.stringify(fields)]);
const confirm=(c,ref,id=2)=>rpc(c,'s3_confirm',[app,'agency-a','patient-a1',1,1,ref,1,request(id)]);
const read=(c,ref)=>rpc(c,'s3_read',[app,'agency-a','patient-a1',1,1,ref]);
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
async function counts(c){ return Object.values((await c.query(`select ${s3Tables.map(t=>`(select count(*)::int from pennsync_private.${t}) ${t}`).join(',')}`)).rows[0]); }
async function seed(c){await begin(c); const first=await create(c); await c.query('commit'); return first.referral.id;}
async function revoke(c){
  await c.query('begin'); await c.query('select pg_advisory_xact_lock(168344,20260918)');
  await c.query("update pennsync_private.membership set status='revoked',version=version+1,revoked_at=clock_timestamp(),revoked_by=$1 where id='membership-1'",[uid(4)]);
}

test('PostgreSQL S3 concurrent identical creates leave one referral and one exact receipt',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a); await begin(b);
  const first=await create(a); const pending=tracked(create(b)); await waiting(setup,b); await a.query('commit');
  const next=await pending; assert.equal(next.ok,true); assert.deepEqual(next.value,{...first,replayed:true}); await b.query('commit');
  assert.deepEqual(await counts(setup),[1,1]);
}));
test('PostgreSQL S3 concurrent changed create payload returns a deterministic conflict',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a); await begin(b); await create(a);
  const pending=tracked(create(b,s3Fields({priority:'urgent'}))); await waiting(setup,b); await a.query('commit');
  const next=await pending; assert.equal(next.ok,false); assert.equal(next.error.code,'PT409'); await b.query('rollback');
  assert.deepEqual(await counts(setup),[1,1]);
}));
for(const sameRequest of [true,false]) test(`PostgreSQL S3 competing confirmations ${sameRequest?'replay one receipt':'reject a second request'}`,()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(),ref=await seed(a); await begin(a); await begin(b);
  const first=await confirm(a,ref); const pending=tracked(confirm(b,ref,sameRequest?2:3)); await waiting(setup,b); await a.query('commit');
  const next=await pending;
  if(sameRequest) {assert.equal(next.ok,true); assert.deepEqual(next.value,{...first,replayed:true}); await b.query('commit');}
  else {assert.equal(next.ok,false); assert.equal(next.error.code,'PT409'); await b.query('rollback');}
  assert.deepEqual(await counts(setup),[1,2]);
}));
test('PostgreSQL S3 membership revocation before confirmation leaves version one and one receipt',()=>lab(async({connect,setup})=>{
  const a=await connect(),r=await connect(),ref=await seed(a); await revoke(r); await begin(a);
  const pending=tracked(confirm(a,ref)); await waiting(setup,a); await r.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.equal(result.error.code,'42501'); await a.query('rollback');
  assert.deepEqual(await counts(setup),[1,1]); assert.equal((await setup.query('select version from pennsync_private.s3_referral')).rows[0].version,1);
}));
test('PostgreSQL S3 confirmation before revocation commits completely then recovery is denied',()=>lab(async({connect,setup})=>{
  const a=await connect(),r=await connect(),ref=await seed(a); await begin(a); await confirm(a,ref);
  const pending=tracked(revoke(r)); await waiting(setup,r); await a.query('commit'); assert.equal((await pending).ok,true); await r.query('commit');
  await begin(a); await assert.rejects(()=>confirm(a,ref),e=>e.code==='42501'); await a.query('rollback');
  await begin(a); await assert.rejects(()=>read(a,ref),e=>e.code==='42501'); await a.query('rollback'); assert.deepEqual(await counts(setup),[1,2]);
}));
test('PostgreSQL S3 native logout before confirmation rejects the unexpired session',()=>lab(async({connect,setup})=>{
  const a=await connect(),logout=await connect(),ref=await seed(a); await logout.query('begin');
  await logout.query('delete from auth.sessions where id=$1',[sid(1)]); await begin(a);
  const pending=tracked(confirm(a,ref)); await waiting(setup,a,null); await logout.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.equal(result.error.code,'28000'); await a.query('rollback'); assert.deepEqual(await counts(setup),[1,1]);
}));
test('PostgreSQL S3 confirmation fences native logout until both referral and receipt commit',()=>lab(async({connect,setup})=>{
  const a=await connect(),logout=await connect(),ref=await seed(a); await begin(a); await confirm(a,ref); await logout.query('begin');
  const pending=tracked(logout.query('delete from auth.sessions where id=$1',[sid(1)])); await waiting(setup,logout,null); await a.query('commit');
  assert.equal((await pending).ok,true); await logout.query('commit');
  await begin(a); await assert.rejects(()=>confirm(a,ref),e=>e.code==='28000'); await a.query('rollback'); assert.deepEqual(await counts(setup),[1,2]);
}));
test('PostgreSQL S3 patient deactivation before confirmation keeps the pending referral unchanged',()=>lab(async({connect,setup})=>{
  const a=await connect(),change=await connect(),ref=await seed(a); await change.query('begin');
  await change.query("update pennsync_private.patient set status='inactive',version=version+1 where id='patient-a1'"); await begin(a);
  const pending=tracked(confirm(a,ref)); await waiting(setup,a,null); await change.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.equal(result.error.code,'42501'); await a.query('rollback'); assert.deepEqual(await counts(setup),[1,1]);
}));
test('PostgreSQL S3 every failed write rolls back the referral and its receipt together',()=>lab(async({connect,setup})=>{
  const a=await connect();
  await setup.query("create function pennsync_private.s3_test_failure() returns trigger language plpgsql set search_path='' as $$ begin raise exception 'INJECTED_S3_FAILURE'; end $$");
  for(const table of s3Tables) {
    await setup.query(`create trigger injected before insert on pennsync_private.${table} for each row execute function pennsync_private.s3_test_failure()`);
    await begin(a); await assert.rejects(()=>create(a),/INJECTED_S3_FAILURE/); await a.query('rollback');
    assert.deepEqual(await counts(setup),[0,0]); await setup.query(`drop trigger injected on pennsync_private.${table}`);
  }
  const ref=await seed(a);
  for(const [table,event] of [['s3_referral','update'],['s3_receipt','insert']]) {
    await setup.query(`create trigger injected before ${event} on pennsync_private.${table} for each row execute function pennsync_private.s3_test_failure()`);
    await begin(a); await assert.rejects(()=>confirm(a,ref),/INJECTED_S3_FAILURE/); await a.query('rollback');
    assert.deepEqual(await counts(setup),[1,1]); assert.equal((await setup.query('select version from pennsync_private.s3_referral')).rows[0].version,1);
    await setup.query(`drop trigger injected on pennsync_private.${table}`);
  }
}));
