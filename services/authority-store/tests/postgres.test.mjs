import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

// Only an explicit loopback PostgreSQL test lab is accepted. Each test creates
// and finally drops its own random database; no external database is reachable.
const raw=process.env.PENNSYNC_TEST_PG_URL;
if(!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base=new URL(raw);
if(!['postgres:','postgresql:'].includes(base.protocol)
  || !['127.0.0.1','[::1]'].includes(base.hostname)
  || base.pathname!=='/postgres' || base.search || base.hash) {
  throw new Error('Only a loopback PostgreSQL /postgres test administrator is allowed');
}
const app='6a9881683dc68a0bd54f1ef7';
const uid=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const sid=n=>`20000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const request=n=>`30000000-0000-4000-8000-${String(n).padStart(12,'0')}`;

async function lab(run){
  const name=`pennsync_authority_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name,/^pennsync_authority_test_[0-9]+_[a-f0-9]{10}$/);
  const admin=new pg.Client({connectionString:base.toString()}); await admin.connect();
  const clients=[];
  try {
    await admin.query(`create database "${name}"`);
    const target=new URL(base); target.pathname=`/${name}`;
    const connect=async()=>{
      const c=new pg.Client({connectionString:target.toString()}); await c.connect();
      await c.query("set statement_timeout='10s'"); clients.push(c); return c;
    };
    const setup=await connect();
    await setup.query(await readFile(new URL('./bootstrap.sql',import.meta.url),'utf8'));
    const dir=new URL('../supabase/migrations/',import.meta.url);
    for(const file of (await readdir(dir)).filter(x=>x.endsWith('.sql')).sort())
      await setup.query(await readFile(new URL(file,dir),'utf8'));
    await setup.query(await readFile(new URL('./fixtures.sql',import.meta.url),'utf8'));
    await run({connect,setup,admin});
  } finally {
    for(const c of clients) { try { await c.query('rollback'); } catch { /* connection may already have failed */ } await c.end(); }
    // The identifier is generated above, never provided by a caller.
    await admin.query(`drop database if exists "${name}"`); await admin.end();
  }
}
async function begin(c,n){
  await c.query('begin');
  await c.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:uid(n),session_id:sid(n),role:'authenticated',exp:Math.floor(Date.now()/1000)+3600})]);
  await c.query('set local role authenticated');
}
async function rpc(c,name,args){
  const r=await c.query(`select public.pennsync_staging_${name}(${args.map((_,i)=>`$${i+1}`).join(',')}) result`,args);
  return r.rows[0].result;
}
const grant=(c,id=1)=>rpc(c,'assignment',[app,'agency-a','patient-a2','membership-2','grant',1,1,0,request(id)]);
const revoke=(c,id=10)=>rpc(c,'revoke_membership',[app,'agency-a','membership-2',1,1,request(id)]);
async function waiting(monitor,client,event='advisory'){
  const end=Date.now()+3000;
  while(Date.now()<end){
    const r=await monitor.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1',[client.processID]);
    if(r.rows[0]?.wait_event_type==='Lock' && (!event||r.rows[0].wait_event===event))return;
    await delay(10);
  }
  assert.fail(`Expected a real ${event||'row'} lock wait`);
}
function tracked(promise){return promise.then(value=>({ok:true,value}),error=>({ok:false,error}));}

test('PostgreSQL concurrent duplicate assignment has one winner and one stale-version reject',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,1); await begin(b,1);
  assert.equal((await grant(a)).assignment_version,1);
  const pending=tracked(grant(b,2)); await waiting(setup,b);
  await a.query('commit'); const loser=await pending;
  assert.equal(loser.ok,false); assert.match(loser.error.message,/PENNSYNC_ASSIGNMENT_VERSION_CHANGED/);
  await b.query('rollback');
  const count=await setup.query("select count(*)::int count from pennsync_private.assignment where patient_id='patient-a2'");
  assert.equal(count.rows[0].count,1);
}));

test('PostgreSQL concurrent same idempotency request replays one committed result',()=>lab(async({connect,setup})=>{
  const a=await connect(),b=await connect(); await begin(a,1); await begin(b,1);
  await grant(a); const pending=tracked(grant(b)); await waiting(setup,b);
  await a.query('commit'); const replay=await pending;
  assert.equal(replay.ok,true); assert.equal(replay.value.replayed,true);
  await b.query('commit');
  assert.equal((await setup.query('select count(*)::int count from pennsync_private.mutation_receipt')).rows[0].count,1);
}));

test('PostgreSQL revocation committed first denies blocked assignment and patient reader',()=>lab(async({connect,setup})=>{
  const revoker=await connect(),writer=await connect(),reader=await connect();
  await begin(revoker,1); await begin(writer,1); await begin(reader,2);
  await revoke(revoker);
  const writing=tracked(grant(writer)); const reading=tracked(rpc(reader,'patient',[app,'agency-a','patient-a1']));
  await waiting(setup,writer); await waiting(setup,reader);
  await revoker.query('commit');
  const rejected=await writing; assert.equal(rejected.ok,false); assert.match(rejected.error.message,/PENNSYNC_TARGET_VERSION_CHANGED/);
  await writer.query('rollback');
  const denied=await reading; assert.equal(denied.ok,false); assert.match(denied.error.message,/PENNSYNC_TENANT_DENIED/);
  await reader.query('rollback');
  assert.equal((await setup.query("select count(*)::int count from pennsync_private.assignment where status='active'")).rows[0].count,0);
}));

test('PostgreSQL assignment committed first is included in following atomic revocation',()=>lab(async({connect,setup})=>{
  const writer=await connect(),revoker=await connect(); await begin(writer,1); await begin(revoker,1);
  await grant(writer); const pending=tracked(revoke(revoker)); await waiting(setup,revoker);
  await writer.query('commit'); const result=await pending; assert.equal(result.ok,true); await revoker.query('commit');
  const states=await setup.query('select status,version from pennsync_private.assignment order by patient_id');
  assert.equal(states.rows.length,2); assert.equal(states.rows.every(x=>x.status==='revoked'&&x.version==='2'),true);
}));

test('PostgreSQL native session deletion waits for active transaction then invalidates next access',()=>lab(async({connect,setup})=>{
  const reader=await connect(),native=await connect(); await begin(reader,2);
  await rpc(reader,'patient',[app,'agency-a','patient-a1']);
  await native.query('begin'); const pending=tracked(native.query('delete from auth.sessions where id=$1',[sid(2)]));
  await waiting(setup,native,null); await reader.query('commit');
  assert.equal((await pending).ok,true); await native.query('commit');
  await begin(reader,2); const denied=await tracked(rpc(reader,'patient',[app,'agency-a','patient-a1']));
  assert.equal(denied.ok,false); assert.match(denied.error.message,/PENNSYNC_SESSION_INACTIVE/);
}));

test('PostgreSQL revoked administrator cannot replay a previously successful mutation',()=>lab(async({connect,setup})=>{
  const actor=await connect(); await begin(actor,1); await grant(actor); await actor.query('commit');
  await setup.query("update pennsync_private.membership set status='revoked',version=2,revoked_at=clock_timestamp(),revoked_by=$1 where id='membership-1'",[uid(1)]);
  await begin(actor,1); const result=await tracked(grant(actor));
  assert.equal(result.ok,false); assert.match(result.error.message,/PENNSYNC_TENANT_DENIED/);
}));

test('PostgreSQL target native ban waits for grant transaction then prevents replay',()=>lab(async({connect,setup})=>{
  const writer=await connect(),native=await connect(); await begin(writer,1); await grant(writer);
  await native.query('begin');
  const pending=tracked(native.query("update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=$1",[uid(2)]));
  await waiting(setup,native,null); await writer.query('commit');
  assert.equal((await pending).ok,true); await native.query('commit');
  await begin(writer,1); const result=await tracked(grant(writer));
  assert.equal(result.ok,false); assert.match(result.error.message,/PENNSYNC_TARGET_INACTIVE/);
}));

test('PostgreSQL target identity disable committed first rejects grant waiting on that row',()=>lab(async({connect,setup})=>{
  const controller=await connect(),writer=await connect(); await controller.query('begin');
  await controller.query('update pennsync_private.identity_map set enabled=false,revoked_at=clock_timestamp(),version=version+1 where auth_user_id=$1',[uid(2)]);
  await begin(writer,1); const pending=tracked(grant(writer));
  await waiting(setup,writer,null); await controller.query('commit');
  const result=await pending; assert.equal(result.ok,false); assert.match(result.error.message,/PENNSYNC_TARGET_INACTIVE/);
  await writer.query('rollback');
  assert.equal((await setup.query("select count(*)::int count from pennsync_private.assignment where patient_id='patient-a2'")).rows[0].count,0);
}));
