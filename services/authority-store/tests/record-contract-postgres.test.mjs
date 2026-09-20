import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/**
 * Nothing from the repository root is imported here, and that is a constraint
 * rather than a preference: this suite runs in a CI job that installs ONLY
 * `services/authority-store`'s own dependencies, so a root tool that imports
 * `json5` fails at load before a single test runs. The first draft did exactly
 * that and the step failed in under a second.
 *
 * So the schema name is written out and then PROVED against the applied
 * database below, and the migrations are read from the directory rather than
 * through a generator constant.
 */
const SCHEMA = 'pennsync_records';

/**
 * What only two connections can show about a record contract.
 *
 * Everything else about `contract_patient_create` is proved on PGlite, which
 * is one connection and therefore cannot interleave two callers. The property
 * this file exists for is exactly the one that needs interleaving: a create is
 * a lookup followed by an insert, and until the record store carried
 * `patient_patient_creation_key_unique` a concurrent retry fitted between them
 * and made a SECOND chart that neither caller was told about. The entity
 * schema calls its own key "best-effort until Base44 exposes a datastore
 * uniqueness constraint"; this is the test that says it no longer is.
 *
 * Not in `pnpm test` — it needs a real PostgreSQL. `.github/workflows/pennsync-authority.yml`
 * is the list of record for the suites that are not.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const RECORD_MIGRATIONS = new URL('../supabase/record-migrations/', import.meta.url);
const raw = process.env.PENNSYNC_TEST_PG_URL;
if (!raw) throw new Error('PENNSYNC_TEST_PG_URL is required for real PostgreSQL tests');
const base = new URL(raw);
if (!['postgres:', 'postgresql:'].includes(base.protocol)
  || !['127.0.0.1', '[::1]'].includes(base.hostname)
  || base.pathname !== '/postgres' || base.search || base.hash) {
  throw new Error('Only a loopback PostgreSQL /postgres test administrator is allowed');
}
const APP = '6a9881683dc68a0bd54f1ef7';
const uid = n => `10000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const sid = n => `20000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const A = 'agency-a';
const CLINICIAN_A = 2;
const CREATE = 'select "public"."pennsync_contract_patient_create"($1,$2,$3) as result';

/** The record store on top of the authority store, in a database of its own. */
async function lab(run) {
  const name = `pennsync_record_test_${process.pid}_${randomBytes(5).toString('hex')}`;
  assert.match(name, /^pennsync_record_test_[0-9]+_[a-f0-9]{10}$/);
  const admin = new pg.Client({ connectionString: base.toString() });
  await admin.connect();
  const clients = [];
  try {
    await admin.query(`create database "${name}"`);
    const target = new URL(base); target.pathname = `/${name}`;
    const connect = async () => {
      const client = new pg.Client({ connectionString: target.toString() });
      await client.connect();
      await client.query("set statement_timeout='10s'");
      clients.push(client);
      return client;
    };
    const setup = await connect();
    await setup.query(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
    const dir = new URL('../supabase/migrations/', import.meta.url);
    for (const file of (await readdir(dir)).filter(x => x.endsWith('.sql')).sort()) {
      await setup.query(await readFile(new URL(file, dir), 'utf8'));
    }
    const records = new URL('../supabase/record-migrations/', import.meta.url);
    for (const file of (await readdir(records)).filter(x => x.endsWith('.sql')).sort()) {
      await setup.query(await readFile(new URL(file, records), 'utf8'));
    }
    await setup.query(await readFile(new URL('./fixtures.sql', import.meta.url), 'utf8'));
    await run({ connect, setup, admin });
  } finally {
    for (const client of clients) {
      try { await client.query('rollback'); } catch { /* may already have failed */ }
      await client.end();
    }
    // The identifier is generated above, never provided by a caller.
    await admin.query(`drop database if exists "${name}"`);
    await admin.end();
  }
}
async function begin(client, n) {
  await client.query('begin');
  await client.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({
    sub: uid(n), session_id: sid(n), role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600,
  })]);
  await client.query('set local role authenticated');
}
const create = (client, request, patient = {}) => client.query(CREATE, [A, request,
  JSON.stringify({ first_name: 'Ada', last_name: 'Lovelace', ...patient })])
  .then(result => result.rows[0].result);
async function waiting(monitor, client) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const seen = await monitor.query(
      'select wait_event_type from pg_stat_activity where pid=$1', [client.processID]);
    if (seen.rows[0]?.wait_event_type === 'Lock') return;
    await delay(10);
  }
  assert.fail('Expected the second create to block on the unique index');
}
const tracked = promise => promise.then(value => ({ ok: true, value }), error => ({ ok: false, error }));

test('two concurrent creates of one request make one chart, not two', () => lab(async ({ connect, setup }) => {
  const first = await connect(); const second = await connect();
  await begin(first, CLINICIAN_A); await begin(second, CLINICIAN_A);
  // Both pass the lookup: neither can see the other's uncommitted row. Before
  // the index this is where a second chart appeared.
  const winner = await create(first, 'req-race-1');
  assert.equal(winner.created, true);
  const pending = tracked(create(second, 'req-race-1'));
  // A real lock wait, not a sleep: the second insert is stopped by the unique
  // index until the first transaction settles.
  await waiting(setup, second);
  await first.query('commit');
  const loser = await pending;
  assert.equal(loser.ok, true, `the loser refused instead of answering: ${loser.error?.message}`);
  assert.equal(loser.value.created, false, 'the loser answers the chart the winner made');
  assert.equal(loser.value.patient.id, winner.patient.id);
  await second.query('commit');
  // One chart and one care-team seat, from two requests carrying one key.
  assert.equal((await setup.query(
    `select count(*)::int as n from ${SCHEMA}."patient" where "patient_creation_key" like $1`,
    [`${A}:%:req-race-1`])).rows[0].n, 1);
  assert.equal((await setup.query(
    'select count(*)::int as n from pennsync_private.chart_assignment where patient_id = $1',
    [winner.patient.id])).rows[0].n, 1, 'the loser\'s claim rolled back with its insert');
}));

test('the loser rolls back if the winner aborts, and the retry then wins', () => lab(async ({ connect, setup }) => {
  const first = await connect(); const second = await connect();
  await begin(first, CLINICIAN_A); await begin(second, CLINICIAN_A);
  const abandoned = await create(first, 'req-race-2');
  const pending = tracked(create(second, 'req-race-2'));
  await waiting(setup, second);
  await first.query('rollback');
  const survivor = await pending;
  assert.equal(survivor.ok, true, `the survivor refused: ${survivor.error?.message}`);
  assert.equal(survivor.value.created, true, 'nothing committed, so this one creates');
  assert.notEqual(survivor.value.patient.id, abandoned.patient.id,
    'the abandoned chart took its minted id with it');
  await second.query('commit');
  assert.equal((await setup.query(
    `select count(*)::int as n from ${SCHEMA}."patient"`)).rows[0].n, 1);
}));

test('the index is what holds, and it is the one the contract names', () => lab(async ({ setup }) => {
  // The schema name above is written out; this is where it is proved.
  assert.equal((await setup.query(
    'select 1 from information_schema.schemata where schema_name = $1', [SCHEMA])).rowCount, 1);
  // The contract catches `unique_violation` only for this constraint by name
  // and re-raises anything else, so the name is load-bearing rather than
  // cosmetic — a rename in the generator would silently turn the retry answer
  // into a raw database error.
  const named = readFileSync(resolve(repository,
    'services/authority-store/supabase/record-migrations/20260920120000_contract_patient_create.sql'), 'utf8')
    .match(/v_constraint is distinct from '([a-z_]+)'/);
  assert.ok(named, 'the contract names the constraint it catches');
  const live = await setup.query(
    'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
    [SCHEMA, named[1]]);
  assert.equal(live.rowCount, 1, `${named[1]} exists in the applied store`);
  assert.match(live.rows[0].indexdef, /CREATE UNIQUE INDEX/);
  // Partial, because an absent key is not a duplicate of another absent key.
  assert.match(live.rows[0].indexdef, /WHERE .*patient_creation_key IS NOT NULL/);
  // Every declared key the migrations emit is really there, not only this one.
  // Read from the directory that was applied rather than from a generator
  // constant, for the import reason at the top of this file.
  const migrations = (await readdir(RECORD_MIGRATIONS)).filter(file => file.endsWith('.sql')).sort();
  const sources = await Promise.all(migrations.map(file =>
    readFile(new URL(file, RECORD_MIGRATIONS), 'utf8')));
  const emitted = [...sources.join('\n')
    .matchAll(/create unique index "([a-z_]+)"/g)].map(match => match[1]).sort();
  assert.ok(emitted.length >= 6, `expected the declared unique keys, saw ${emitted.length}`);
  const present = (await setup.query(
    'select indexname from pg_indexes where schemaname = $1 and indexname = any($2)',
    [SCHEMA, emitted])).rows.map(row => row.indexname).sort();
  assert.deepEqual(present, emitted);
}));

test('the record owner cannot rewrite a row its schema calls append-only', () => lab(async ({ setup }) => {
  // The load-bearing half of D32, and it needs the owner role to exist: every
  // contract is SECURITY DEFINER owned by `pennsync_records_owner`, so a
  // guarantee that binds only callers would bind nothing that matters.
  // `record-tenant-isolation.test.mjs` proves the caller half on PGlite, where
  // the migration's role wrapper is not applied.
  await setup.query(`insert into ${SCHEMA}.patient("source_app_id","id","agency_id")
    values ($1,'chart-append','agency-a')`, [APP]);
  await setup.query(`insert into ${SCHEMA}.patient_note_history_entry
    ("source_app_id","id","agency_id","patient_id","note")
    values ($1,'note-append','agency-a','chart-append','First revision')`, [APP]);
  await setup.query('begin');
  await setup.query('set local role "pennsync_records_owner"');
  const rewritten = await setup.query(
    `update ${SCHEMA}.patient_note_history_entry set "note" = 'owner rewrite' returning "id"`);
  const removed = await setup.query(
    `delete from ${SCHEMA}.patient_note_history_entry returning "id"`);
  await setup.query('rollback');
  // No policy for the command means no rows match rather than an error: the
  // statement succeeds, changes nothing, and does not disclose that the row is
  // there. The row is equally unchangeable either way.
  assert.equal(rewritten.rowCount, 0, 'the record owner cannot rewrite it');
  assert.equal(removed.rowCount, 0, 'the record owner cannot delete it');
  assert.equal((await setup.query(
    `select "note" from ${SCHEMA}.patient_note_history_entry where "id" = 'note-append'`))
    .rows[0].note, 'First revision');
  // The control is structural rather than another write, because a write as
  // the owner with no caller claims fails the TENANT predicate too and would
  // prove nothing: `patient` carries an update policy and this table carries
  // none, which is the difference the schemas asked for.
  const commands = async table => (await setup.query(
    `select p.polcmd from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = $1 and c.relname = $2 order by p.polcmd`, [SCHEMA, table]))
    .rows.map(row => row.polcmd);
  assert.deepEqual(await commands('patient_note_history_entry'), ['a', 'r']);
  assert.deepEqual(await commands('patient'), ['a', 'd', 'r', 'w']);
}));

test('a duplicate key cannot be written around the contract either', () => lab(async ({ setup }) => {
  // The constraint is the table's, not the capability's. A second writer — a
  // future ported handler, an import — meets the same refusal.
  const row = (id, key) => setup.query(`insert into ${SCHEMA}."patient"
    ("source_app_id","id","agency_id","patient_creation_key","status","is_sample","is_archived")
    values ($1,$2,$3,$4,'active',false,false)`, [APP, id, A, key]);
  await row('chart-1', 'agency-a:user-1:req-1');
  await assert.rejects(() => row('chart-2', 'agency-a:user-1:req-1'),
    error => /duplicate key value|unique constraint/.test(String(error?.message)));
  // An absent key is not a duplicate of another absent key, which is why the
  // index is partial: most rows in this table will never carry one.
  await row('chart-3', null);
  await row('chart-4', null);
  await row('chart-5', '');
  await row('chart-6', '');
  assert.equal((await setup.query(
    `select count(*)::int as n from ${SCHEMA}."patient"`)).rows[0].n, 5);
}));
