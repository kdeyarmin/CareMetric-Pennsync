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
// The installed readback below is evidence of what the hosted project held on
// 2026-09-18, and it has run 001-005. A forward migration is therefore applied
// only where a case asks for it: comparing 006's additions against that
// evidence would assert something about a deployment nobody has measured.
const files = (await readdir(migrations)).filter(name => /^00[1-5]_.+\.sql$/.test(name)).sort();
assert.equal(files.length, 5);
const FORWARD = (await readdir(migrations)).filter(name => /^00[6-9]_.+\.sql$/.test(name)).sort();
assert.deepEqual(FORWARD, ['006_record_owned_files.sql', '007_provider_credential.sql', '008_telecom_operations.sql']);
const installed = JSON.parse(await readFile(new URL('./installed-definition-metadata.json', import.meta.url), 'utf8'));
const app = '6a9881683dc68a0bd54f1ef7';
const subject = 'a'.repeat(64);
const hash = 'b'.repeat(64);
const normalize = text => text.replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();

async function lab(run, { forward = false } = {}) {
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
    if (forward) for (const file of FORWARD) await db.query(await readFile(new URL(file, migrations), 'utf8'));
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

/*
 * Migration 006: record-owned objects.
 *
 * The cases below are against the real cluster rather than against the
 * runtime's store double, because the SQL predicate in
 * `cm_integration_file_get_authorized` IS the first layer of the
 * authorization — the runtime's own comparisons are the second. A suite that
 * proved only the double would prove neither.
 */
const owned = (db, values) => rpc(db, 'file_record_owned', values);
const authorized = (db, values) => rpc(db, 'file_get_authorized', values);
const AGENCY = 'agency-one';
const OTHER_AGENCY = 'agency-two';
const COLLEAGUE = 'e'.repeat(64);

test('006 leaves every existing row uploader-owned and its reads unchanged', () => lab(async ({ db }) => {
  await role(db);
  const id = randomUUID();
  // Minted through the ORIGINAL function, exactly as an applied caller does.
  assert.equal(await rpc(db, 'file_record', [id, app, subject, `${app}/${subject}/${id}`, 'text/plain', 10, hash]), true);
  await reset(db);
  const row = (await db.query('select owner_kind,agency_id from public.cm_integration_files where id=$1', [id])).rows[0];
  await role(db);
  // The backfill is the default: no data step, and nothing existing moves.
  assert.deepEqual(row, { owner_kind: 'subject', agency_id: null });
  assert.equal((await rpc(db, 'file_get', [id, app, subject])).id, id);
  assert.equal(await rpc(db, 'file_get', [id, app, COLLEAGUE]), null);
  // And through the new getter: still the uploader's alone, whatever tenant the
  // caller holds.
  assert.equal((await authorized(db, [id, app, subject, null])).id, id);
  assert.equal((await authorized(db, [id, app, subject, AGENCY])).id, id);
  assert.equal(await authorized(db, [id, app, COLLEAGUE, AGENCY]), null);
  assert.equal(await authorized(db, [id, app, COLLEAGUE, null]), null);
}, { forward: true }));

test('a record-owned object opens for the agency and for nobody outside it', () => lab(async ({ db }) => {
  await role(db);
  const id = randomUUID();
  assert.equal(await owned(db, [id, app, subject, AGENCY, `${app}/record/${AGENCY}/${id}`, 'application/pdf', 10, hash]), true);
  await reset(db);
  const row = (await db.query('select owner_kind,agency_id,subject from public.cm_integration_files where id=$1', [id])).rows[0];
  await role(db);
  assert.deepEqual(row, { owner_kind: 'record', agency_id: AGENCY, subject });

  // A colleague who did not mint it, in the same agency: admitted. This is the
  // whole capability — a document one nurse generates, read by the care team.
  assert.equal((await authorized(db, [id, app, COLLEAGUE, AGENCY])).id, id);
  // Holding the handle buys nothing outside the tenant, and the minter is no
  // exception once they are acting in a different agency.
  assert.equal(await authorized(db, [id, app, COLLEAGUE, OTHER_AGENCY]), null);
  assert.equal(await authorized(db, [id, app, subject, OTHER_AGENCY]), null);
  // A caller with no tenant at all — a platform owner outside an agency scope —
  // matches no record-owned row, including its own minter.
  assert.equal(await authorized(db, [id, app, COLLEAGUE, null]), null);
  assert.equal(await authorized(db, [id, app, subject, null]), null);
  // The wrong app never matches, as it never did.
  assert.equal(await authorized(db, [id, '694ec16e72e01b60d22f7cbf', COLLEAGUE, AGENCY]), null);
}, { forward: true }));

test('the uploader getter narrows rather than widening: it never returns a record-owned row', () => lab(async ({ db }) => {
  await role(db);
  const id = randomUUID();
  assert.equal(await owned(db, [id, app, subject, AGENCY, `${app}/record/${AGENCY}/${id}`, 'text/csv', 10, hash]), true);
  // `subject` on a record-owned row is provenance. Without this narrowing the
  // minter would match the old getter and reach their own object through the
  // uploader path, whose caller then checks a path that cannot hold.
  assert.equal(await rpc(db, 'file_get', [id, app, subject]), null);
}, { forward: true }));

test('a record-owned row must address its own agency, and the two columns move together', () => lab(async ({ db }) => {
  await role(db);
  const id = randomUUID();
  // The path binding is the same control the uploader-owned mint has, over the
  // agency instead of the subject.
  for (const path of [`${app}/${subject}/${id}`, `${app}/record/${OTHER_AGENCY}/${id}`,
    `${app}/record/${AGENCY}/${randomUUID()}`, `${app}/record/${AGENCY}`]) {
    await assert.rejects(owned(db, [id, app, subject, AGENCY, path, 'text/plain', 10, hash]),
      error => /Invalid file binding/.test(error.message));
  }
  await assert.rejects(owned(db, [id, app, subject, 'not a tenant id', `${app}/record/not a tenant id/${id}`, 'text/plain', 10, hash]),
    error => /Invalid file binding/.test(error.message));
  await reset(db);
  // And the pairing constraint, reached directly: neither kind can carry the
  // other's tenancy, so a row readable by nobody cannot be written.
  for (const [kind, agency] of [['record', null], ['subject', AGENCY]]) {
    await assert.rejects(db.query(`insert into public.cm_integration_files
      (id,app_id,subject,agency_id,owner_kind,object_path,content_type,size_bytes,sha256)
      values($1,$2,$3,$4,$5,$6,'text/plain',10,$7)`,
    [randomUUID(), app, subject, agency, kind, `${app}/synthetic/${randomUUID()}`, hash]),
    error => error.code === '23514');
  }
}, { forward: true }));

test('006 grants the browser nothing, exactly as the functions beside it', () => lab(async ({ db }) => {
  for (const browser of ['anon', 'authenticated']) {
    await role(db, browser);
    await assert.rejects(authorized(db, [randomUUID(), app, subject, AGENCY]), error => error.code === '42501');
    await assert.rejects(owned(db, [randomUUID(), app, subject, AGENCY, `${app}/record/${AGENCY}/${randomUUID()}`, 'text/plain', 10, hash]),
      error => error.code === '42501');
    await reset(db);
  }
  // Service-only, as every other definer here: the privilege list is the same
  // one the installed comparison asserts for 001's functions.
  assert.deepEqual((await db.query(`select p.proname as name,has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role, p.prosecdef as definer
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'
    and p.proname in ('cm_integration_file_get_authorized','cm_integration_file_record_owned') order by p.proname`)).rows,
  [{ name: 'cm_integration_file_get_authorized', anon: false, authenticated: false, service_role: true, definer: true },
    { name: 'cm_integration_file_record_owned', anon: false, authenticated: false, service_role: true, definer: true }]);
}, { forward: true }));

/*
 * Copilot found this on #372 and it was real. Every operation is reserved
 * before its provider runs, `cm_integration_reserve` inserts `operation` into
 * `cm_integration_jobs`, and that column's CHECK in `001` names seven
 * operations. `006` added an eighth to the service and did not extend the
 * constraint, so `UploadRecordFile` could never reach the mint at all — the
 * reserve died on the constraint first.
 *
 * Nothing caught it because every suite that exercises this operation drives a
 * store DOUBLE, which has no constraint to violate. This is the third time in
 * this change that the thing answering in a check's place was not in the file
 * under test, so the test belongs HERE, against a real cluster, and not beside
 * the code that calls the double.
 */
test('every released operation can actually reserve, the new one included', () => lab(async ({ db }) => {
  await role(db);
  // Read the names out of the constraint rather than retyping them: a list
  // here would be a second copy of the thing under test.
  // By NAME, which is the thing the forward migration depends on: it drops
  // this constraint by that name, so if PostgreSQL's auto-generated name ever
  // differed the migration would fail loudly and so would this. A pattern over
  // the definition is the wrong instrument — the table's UNIQUE constraint also
  // names the column, and `state` has the same `= ANY (ARRAY[...])` shape.
  const constraint = (await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint
    where conrelid = 'public.cm_integration_jobs'::regclass and contype = 'c'
      and conname = 'cm_integration_jobs_operation_check'`)).rows;
  assert.equal(constraint.length, 1);
  const operations = [...constraint[0].def.matchAll(/'([A-Za-z]+)'/g)].map(match => match[1]);
  assert.ok(operations.includes('UploadRecordFile'),
    'the forward migration must extend the job constraint, or the operation cannot be reserved');

  // The function carries its OWN copy of the list, and an operation missing
  // from either cannot run. Asserted to agree rather than assumed: extending
  // one and not the other is the defect this test exists for.
  const body = (await db.query(`select pg_get_functiondef(
    'public.cm_integration_reserve(text,text,text,text,text,uuid,integer)'::regprocedure) as def`)).rows[0].def;
  for (const operation of operations) {
    assert.ok(body.includes(`'${operation}'`),
      `${operation} is in the table constraint and not in the reserve function's own guard`);
  }

  for (const operation of operations) {
    const answer = await rpc(db, 'reserve',
      [app, subject, operation, `request-${operation}`, hash, randomUUID(), 100]);
    assert.equal(answer.outcome, 'owned', `${operation} must be reservable`);
  }
  // Deliberately NOT read back with a select: the table has RLS enabled and no
  // policy, so a direct read as `service_role` matches zero rows by design
  // (D32's shape). `outcome: 'owned'` is returned from the function's own
  // `insert ... returning`, so it already attests the row landed.
}, { forward: true }));

/*
 * 007's credential store, against a real cluster.
 *
 * The module-level suite beside the service code asserts the SQL as TEXT —
 * that the grants name `service_role` alone, that no policy exists, that the
 * status function's projection leaves the sealed column out. None of that is
 * behaviour. A trigger that deparses correctly can still fire on nothing, and
 * a partial unique index is a claim about two concurrent writers that one
 * connection cannot make. So the refusals are proved here.
 */
const credential = (db, args) => rpc(db, 'credential_put', args);
const CRED = app;
// The public key is a synthetic raw 32-byte Ed25519 key in base64, the only
// shape putCredential admits (this SQL path is below that check).
const putArgs = (sealed = 'sealed-blob', last = '9911', by = 'operator@example.test') =>
  [randomUUID(), CRED, 'telnyx', sealed, last, 'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=', 'mp-1', 'vc-1', 'fc-1', by];

test('a credential rotation appends a version and retires the previous one', () => lab(async ({ db }) => {
  await role(db);
  assert.equal(await credential(db, putArgs('blob-one', '1111')), '1');
  assert.equal(await credential(db, putArgs('blob-two', '2222')), '2');
  const active = await rpc(db, 'credential_active', [CRED, 'telnyx']);
  assert.equal(active.version, 2);
  assert.equal(active.api_key_sealed, 'blob-two');
  assert.equal(active.api_key_last_four, '2222');
  // The retired version is kept, and is not what the senders get.
  await reset(db);
  const rows = (await db.query('select version, is_active, deactivated_at from public.cm_integration_credential order by version')).rows;
  assert.deepEqual(rows.map(row => [Number(row.version), row.is_active]), [[1, false], [2, true]]);
  assert.notEqual(rows[0].deactivated_at, null);
  assert.equal(rows[1].deactivated_at, null);
}, { forward: true }));

test('the status projection cannot return the sealed key, and says nothing about an absent one', () => lab(async ({ db }) => {
  await role(db);
  assert.equal(await rpc(db, 'credential_status', [CRED, 'telnyx']), null);
  await credential(db, putArgs('blob-one', '9911'));
  const status = await rpc(db, 'credential_status', [CRED, 'telnyx']);
  assert.equal(Object.hasOwn(status, 'api_key_sealed'), false);
  assert.equal(JSON.stringify(status).includes('blob-one'), false);
  assert.equal(status.api_key_last_four, '9911');
  assert.deepEqual(
    [status.public_key_configured, status.messaging_profile_configured,
      status.voice_connection_configured, status.fax_connection_configured],
    [true, true, true, true]);
  // Another provider's status is another row, and there is none.
  assert.equal(await rpc(db, 'credential_active', [CRED, 'other']), null);
}, { forward: true }));

test('the credential table refuses every edit, delete and reactivation', () => lab(async ({ db }) => {
  await role(db);
  await credential(db, putArgs('blob-one', '1111'));
  await credential(db, putArgs('blob-two', '2222'));
  await reset(db);
  const refuses = async (sql, expected) => {
    await assert.rejects(() => db.query(sql), error => {
      assert.match(error.message, expected);
      return true;
    }, `expected a refusal from: ${sql}`);
    // A failed statement poisons the implicit transaction state on some paths;
    // keep the connection usable for the next case.
    await db.query('select 1').catch(() => {});
  };
  await refuses("update public.cm_integration_credential set api_key_sealed = 'swapped' where is_active",
    /Credential rotation records a new version/);
  await refuses("update public.cm_integration_credential set api_key_last_four = '0000' where is_active",
    /Credential rotation records a new version/);
  await refuses("update public.cm_integration_credential set updated_by = 'someone@else.test' where is_active",
    /Credential rotation records a new version/);
  await refuses('delete from public.cm_integration_credential where version = 1',
    /Credential history is append-only/);
  await refuses('update public.cm_integration_credential set is_active = true, deactivated_at = null where version = 1',
    /A retired credential cannot be reactivated/);
  // And the rows are as they were.
  const rows = (await db.query('select version, is_active, api_key_sealed from public.cm_integration_credential order by version')).rows;
  assert.deepEqual(rows.map(row => [Number(row.version), row.is_active, row.api_key_sealed]),
    [[1, false, 'blob-one'], [2, true, 'blob-two']]);
}, { forward: true }));

test('two concurrent rotations of one provider cannot both become active', () => lab(async ({ db, connect }) => {
  await role(db);
  await credential(db, putArgs('blob-one', '1111'));
  // Two real connections. The lock the function takes is on the ACTIVE row, so
  // this is the case `select ... for update` can actually serialize; the first
  // rotation had no active row to lock and is bounded by the partial unique
  // index instead, which is why both halves are in the migration.
  const [a, b] = [await connect(), await connect()];
  for (const client of [a, b]) await client.query('set role service_role');
  await a.query('begin'); await b.query('begin');
  const first = a.query(
    'select public.cm_integration_credential_put($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as v',
    putArgs('blob-a', 'aaaa'));
  await first;
  let settled = false;
  const second = b.query(
    'select public.cm_integration_credential_put($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) as v',
    putArgs('blob-b', 'bbbb')).then(result => { settled = true; return result; });
  await delay(300);
  assert.equal(settled, false, 'the second rotation must block on the first, not race it');
  await a.query('commit');
  const answer = await second;
  await b.query('commit');
  // The loser takes the next version rather than colliding on it.
  assert.equal(Number(answer.rows[0].v), 3);
  // Read back as the owner: `service_role` holds the functions and still
  // cannot read the table, which the last case in this group proves.
  await reset(db);
  const rows = (await db.query('select version, is_active from public.cm_integration_credential order by version')).rows;
  assert.deepEqual(rows.map(row => [Number(row.version), row.is_active]),
    [[1, false], [2, false], [3, true]]);
}, { forward: true }));

test('no browser role may reach the credential, through the table or the functions', () => lab(async ({ db }) => {
  await role(db);
  await credential(db, putArgs('blob-one', '1111'));
  for (const name of ['anon', 'authenticated']) {
    await reset(db);
    await db.query(`set role ${name}`);
    for (const statement of [
      'select * from public.cm_integration_credential',
      `select public.cm_integration_credential_active('${CRED}','telnyx')`,
      `select public.cm_integration_credential_status('${CRED}','telnyx')`,
    ]) {
      await assert.rejects(() => db.query(statement), /permission denied/,
        `${name} must be refused: ${statement}`);
      await db.query('select 1').catch(() => {});
    }
  }
  await reset(db);
  // And `service_role`, which holds the functions, still cannot read the table
  // directly: forced RLS with no policy admits nobody, so the definer
  // functions are the only way in.
  await role(db);
  await assert.rejects(() => db.query('select * from public.cm_integration_credential'), /permission denied/);
  // The guard is the directory's only trigger function, so it is the only one
  // that would keep PostgreSQL's default EXECUTE to PUBLIC. It arrived that
  // way and the restore ratchet is what noticed. Firing a trigger checks no
  // privilege -- only `create trigger` does, which is why the revoke sits
  // after it -- so this costs the guard nothing and the asymmetry is gone.
  await reset(db);
  assert.deepEqual((await db.query(`select p.proname as name,
    has_function_privilege('anon',p.oid,'EXECUTE') as anon,
    has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated,
    has_function_privilege('service_role',p.oid,'EXECUTE') as service_role
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'cm_integration_%'
      and p.prorettype = 'pg_catalog.trigger'::regtype order by p.proname`)).rows,
  [{ name: 'cm_integration_credential_guard', anon: false, authenticated: false, service_role: false }]);
}, { forward: true }));
