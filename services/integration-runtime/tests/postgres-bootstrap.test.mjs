import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required; bootstrap verification never silently skips');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol) || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) throw new Error('Only an explicit loopback PostgreSQL test lab is allowed');
const migrations = new URL('../migrations/', import.meta.url);
const files = (await readdir(migrations)).filter(name => /^00[1-5]_.+\.sql$/.test(name)).sort();
assert.equal(files.length, 5);
const installed = JSON.parse(await readFile(new URL('./installed-definition-metadata.json', import.meta.url), 'utf8'));
const app = '6a9881683dc68a0bd54f1ef7';
const subject = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const normalize = text => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

async function lab(run) {
  const name = `pennsync_integration_bootstrap_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_integration_bootstrap_[0-9]+_[a-f0-9]{10}$/);
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  const clients = [];
  try {
    await admin.query(`create database "${name}"`);
    const target = new URL(base); target.pathname = `/${name}`;
    const connect = async () => {
      const client = new pg.Client({ connectionString: target.toString(), statement_timeout: 10000 });
      await client.connect(); clients.push(client); return client;
    };
    const db = await connect();
    await db.query(await readFile(new URL('./platform-double.sql', import.meta.url), 'utf8'));
    // Unrelated data tests that these migrations preserve other application namespaces.
    await db.query("create table public.unrelated_fixture(id integer primary key,note text); insert into public.unrelated_fixture values(1,'Synthetic sentinel')");
    for (const file of files) await db.query(await readFile(new URL(file, migrations), 'utf8'));
    await run({ db, connect });
    assert.deepEqual((await db.query('select * from public.unrelated_fixture')).rows, [{ id: 1, note: 'Synthetic sentinel' }]);
  } finally {
    for (const client of clients) { await client.query('rollback').catch(() => {}); await client.end(); }
    await admin.query(`drop database if exists "${name}"`); await admin.end();
  }
}
async function role(db, name = 'service_role') { await db.query(`set role ${name}`); }
async function reset(db) { await db.query('reset role'); }
async function rpc(db, name, args) {
  const result = await db.query(`select public.cm_integration_${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as result`, args);
  return result.rows[0].result;
}
const reserve = (db, request, claim = randomUUID(), payload = hash, limit = 100) =>
  rpc(db, 'reserve', [app, subject, 'InvokeLLM', request, payload, claim, limit]);
const finish = (db, id, claim, state, value = null) => rpc(db, 'finish', [id, claim, state, value]);

test('recovered 001 and 002 preserve exact authenticated migration-history SQL', async () => {
  const history = JSON.parse(await readFile(new URL('recovered-history.json', migrations), 'utf8'));
  for (const entry of history.recovered) {
    const text = (await readFile(new URL(entry.file, migrations), 'utf8')).replace(/\r\n/g, '\n').trimEnd() + '\n';
    assert.equal(createHash('sha256').update(text).digest('hex'), entry.canonical_lf_sha256);
  }
});

test('fresh PostgreSQL replays all five migrations and matches installed definitions', () => lab(async ({ db }) => {
  const columns = await db.query(`select c.relname as "table",a.attname as name,format_type(a.atttypid,a.atttypmod) as type,
    not a.attnotnull as nullable,pg_get_expr(d.adbin,d.adrelid) as "default",a.attnum as position
    from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace
    left join pg_attrdef d on d.adrelid=c.oid and d.adnum=a.attnum
    where n.nspname='public' and c.relname in ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget') and a.attnum>0 and not a.attisdropped order by c.relname,a.attnum`);
  assert.deepEqual(columns.rows, installed.columns.map(({ table, name, type, nullable, default: value, position }) =>
    ({ table, name, type, nullable, default: value, position })));
  const constraints = await db.query(`select c.relname as "table",con.conname as name,pg_get_constraintdef(con.oid,true) as definition
    from pg_constraint con join pg_class c on c.oid=con.conrelid join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget') order by c.relname,con.conname`);
  assert.deepEqual(constraints.rows, installed.constraints);
  const indexes = await db.query(`select tablename as "table",indexname as name,indexdef as definition from pg_indexes
    where schemaname='public' and tablename in ('cm_integration_jobs','cm_integration_files','cm_integration_daily_budget') order by tablename,indexname`);
  assert.deepEqual(indexes.rows, installed.indexes);
  for (const expected of installed.functions) {
    const actual = (await db.query(`select pg_get_functiondef(p.oid) as definition,p.prosecdef as definer,p.proconfig as config
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [expected.name])).rows;
    assert.equal(actual.length, 1); assert.equal(normalize(actual[0].definition), normalize(expected.definition));
    assert.equal(actual[0].definer, true); assert.deepEqual(actual[0].config, expected.config);
    assert.deepEqual((await db.query(`select has_function_privilege('anon',p.oid,'EXECUTE') as anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') as service_role
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1`, [expected.name])).rows,
    [{ anon: false, authenticated: false, service_role: true }]);
  }
  assert.deepEqual((await db.query('select id,name,public,file_size_limit::integer,allowed_mime_types from storage.buckets')).rows, installed.bucket);
  assert.deepEqual((await db.query('select jobname as name,schedule,command,active from cron.job')).rows, installed.retention_schedule);
  const tables = await db.query(`select relname as name,relrowsecurity as rls,relforcerowsecurity as force_rls from pg_class
    where oid in ('public.cm_integration_jobs'::regclass,'public.cm_integration_files'::regclass,'public.cm_integration_daily_budget'::regclass) order by relname`);
  assert.deepEqual(tables.rows, installed.table_security.map(({ name, rls, force_rls }) => ({ name, rls, force_rls })));
}));

test('browser table CRUD and RPCs stay denied; restrictive storage rule defeats broad permissive policy', () => lab(async ({ db }) => {
  for (const browser of ['anon', 'authenticated']) {
    await role(db, browser);
    for (const table of ['cm_integration_jobs', 'cm_integration_files', 'cm_integration_daily_budget']) {
      for (const query of [`select * from public.${table}`, `delete from public.${table}`,
        `insert into public.${table} default values`, `update public.${table} set app_id=app_id`])
        await assert.rejects(db.query(query), error => error.code === '42501');
    }
    await assert.rejects(reserve(db, 'browser'), error => error.code === '42501');
    await assert.rejects(rpc(db, 'file_get', [randomUUID(), app, subject]), error => error.code === '42501');
    await assert.rejects(rpc(db, 'expire_results', []), error => error.code === '42501');
    await reset(db);
  }
  await db.query("insert into storage.buckets values('unrelated','unrelated',false,1,array['text/plain'])");
  await db.query("insert into storage.objects(bucket_id,name) values('pennsync-external-integrations','Synthetic private file'),('unrelated','Synthetic unrelated file')");
  for (const browser of ['anon', 'authenticated']) {
    await role(db, browser);
    assert.deepEqual((await db.query('select bucket_id from storage.objects')).rows, [{ bucket_id: 'unrelated' }]);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('pennsync-external-integrations','Synthetic denied')"), error => error.code === '42501');
    assert.equal((await db.query("delete from storage.objects where bucket_id='pennsync-external-integrations'")).rowCount, 0);
    await reset(db);
  }
}));

test('durable outcomes, safe retries, claims and quotas survive fresh restoration', () => lab(async ({ db }) => {
  await role(db);
  let claim = randomUUID(); const first = await reserve(db, 'safe-retry', claim);
  assert.equal(first.outcome, 'owned');
  assert.equal((await reserve(db, 'safe-retry')).outcome, 'pending');
  assert.equal((await reserve(db, 'safe-retry', randomUUID(), 'c'.repeat(64))).outcome, 'conflict');
  assert.equal(await finish(db, first.id, randomUUID(), 'completed', 'Synthetic ciphertext'), false);
  assert.equal(await finish(db, first.id, claim, 'failed'), true);
  for (let attempt = 2; attempt <= 3; attempt++) {
    const previous = claim; claim = randomUUID();
    assert.deepEqual(await reserve(db, 'safe-retry', claim), { id: first.id, outcome: 'owned' });
    assert.equal(await finish(db, first.id, previous, 'completed', 'Synthetic ciphertext'), false);
    assert.equal(await finish(db, first.id, claim, 'failed'), true);
  }
  assert.equal((await reserve(db, 'safe-retry')).outcome, 'failed');
  assert.equal((await reserve(db, 'quota', randomUUID(), hash, 3)).outcome, 'quota');
  claim = randomUUID(); const done = await reserve(db, 'complete', claim);
  assert.equal(await finish(db, done.id, claim, 'completed', 'Synthetic ciphertext'), true);
  assert.deepEqual(await reserve(db, 'complete'), { id: done.id, outcome: 'completed', result: 'Synthetic ciphertext' });
  claim = randomUUID(); const uncertain = await reserve(db, 'uncertain', claim);
  assert.equal(await finish(db, uncertain.id, claim, 'uncertain'), true);
  assert.equal((await reserve(db, 'uncertain')).outcome, 'uncertain');
  await reset(db);
  assert.equal((await db.query('select attempts from public.cm_integration_daily_budget')).rows[0].attempts, 5);
}));

test('restored file receipts retain exact ownership, limits and unique object binding', () => lab(async ({ db }) => {
  const id = randomUUID(); const path = `${app}/${subject}/${id}`;
  await role(db);
  assert.equal(await rpc(db, 'file_record', [id, app, subject, path, 'text/plain', 12, hash]), true);
  const file = await rpc(db, 'file_get', [id, app, subject]);
  assert.equal(file.object_path, path); assert.equal(file.size_bytes, 12);
  assert.equal(await rpc(db, 'file_get', [id, app, 'd'.repeat(64)]), null);
  assert.equal(await rpc(db, 'file_get', [id, 'other-app', subject]), null);
  await assert.rejects(rpc(db, 'file_record', [id, app, subject, path, 'text/plain', 12, hash]), error => error.code === '23505');
  await assert.rejects(rpc(db, 'file_record', [randomUUID(), app, subject, 'wrong-path', 'text/plain', 12, hash]), /Invalid file binding/);
  const bad = randomUUID();
  await assert.rejects(rpc(db, 'file_record', [bad, app, subject, `${app}/${subject}/${bad}`, 'text/plain', 8388609, hash]), error => error.code === '23514');
  await reset(db);
}));

test('ciphertext cleanup is bounded and preserves unexpired results, tombstones and files', () => lab(async ({ db }) => {
  const fileId = randomUUID(); await role(db);
  await rpc(db, 'file_record', [fileId, app, subject, `${app}/${subject}/${fileId}`, 'text/plain', 12, hash]); await reset(db);
  await db.query(`insert into public.cm_integration_jobs(app_id,subject,operation,request_id,payload_hash,claim,state,result_encrypted,result_expires_at)
    select $1,$2,'InvokeLLM','expired-'||n,$3,gen_random_uuid(),'completed','Synthetic ciphertext',now()-interval '1 second' from generate_series(1,1001) n`, [app, subject, hash]);
  await db.query(`insert into public.cm_integration_jobs(app_id,subject,operation,request_id,payload_hash,claim,state,result_encrypted,result_expires_at)
    values($1,$2,'InvokeLLM','live',$3,gen_random_uuid(),'completed','Synthetic live',now()+interval '1 hour')`, [app, subject, hash]);
  await role(db); assert.equal(await rpc(db, 'expire_results', []), 1000); await reset(db);
  const state = (await db.query('select count(*)::integer as jobs,count(result_encrypted)::integer as ciphertext from public.cm_integration_jobs')).rows[0];
  assert.deepEqual(state, { jobs: 1002, ciphertext: 2 });
  await role(db); assert.equal(await rpc(db, 'expire_results', []), 1); assert.equal(await rpc(db, 'expire_results', []), 0); await reset(db);
  assert.equal((await db.query("select result_encrypted from public.cm_integration_jobs where request_id='live'")).rows[0].result_encrypted, 'Synthetic live');
  assert.equal((await db.query('select count(*)::integer as count from public.cm_integration_files where id=$1', [fileId])).rows[0].count, 1);
}));

test('concurrent restored reservations serialize and spend one durable budget unit', () => lab(async ({ db, connect }) => {
  const first = await connect(); const second = await connect();
  await first.query('begin'); await first.query('set local role service_role');
  const owned = await reserve(first, 'concurrent'); assert.equal(owned.outcome, 'owned');
  await role(second);
  const waiting = reserve(second, 'concurrent');
  let locked = false;
  for (let i = 0; i < 100; i++) {
    const activity = (await db.query('select wait_event_type,wait_event from pg_stat_activity where pid=$1', [second.processID])).rows[0];
    if (activity?.wait_event_type === 'Lock' && activity.wait_event === 'advisory') { locked = true; break; }
    await delay(10);
  }
  assert.equal(locked, true); await first.query('commit');
  const loser = await waiting; assert.equal(loser.id, owned.id); assert.equal(loser.outcome, 'pending');
  assert.equal((await db.query('select attempts from public.cm_integration_daily_budget')).rows[0].attempts, 1);
}));

test('replaying historical 001 fails without overwriting already existing resources', () => lab(async ({ db }) => {
  await role(db); const record = await reserve(db, 'preserve'); await reset(db);
  await assert.rejects(db.query(await readFile(new URL('001_integration_state.sql', migrations), 'utf8')), error => error.code === '42P07');
  await db.query('rollback');
  assert.equal((await db.query('select count(*)::integer as count from public.cm_integration_jobs where id=$1', [record.id])).rows[0].count, 1);
}));
