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

/*
 * ---------------------------------------------------------------------------
 * The authenticated concurrency matrix.
 *
 * `managePatientCareTeamAssignment` is paused at source, and its pause names
 * three conditions. Two of them the owned store simply has — a unique index
 * and a transaction spanning membership, agency, chart and assignment. The
 * third is this: "Keep every assignment mutation unavailable until those
 * hosted guarantees and the authenticated concurrency matrix are proved."
 *
 * These four tests are that matrix. They are the reason the port is allowed to
 * re-enable the capability, so they must FAIL if the contract stops being
 * safe under interleaving, not merely pass while it is.
 */
const MANAGER_A = 1;
const SPARE = '6aac00000000000000000003';
const MOVE = 'select "public"."pennsync_contract_assignment_transition"($1,$2,$3,$4,$5,$6,$7) as result';
const move = (client, patient, action, request, version = null, reason = 'covering the weekend') =>
  client.query(MOVE, [A, patient, SPARE, action, request, reason, version])
    .then(result => result.rows[0].result);
/** A committed chart of record, made the way the product makes one. */
async function chart(connect, request) {
  const client = await connect();
  await begin(client, CLINICIAN_A);
  const made = await create(client, request);
  await client.query('commit');
  return made.patient.id;
}
/** Wait until `client` is blocked, on any lock rather than a named index. */
async function blocked(monitor, client, what) {
  const end = Date.now() + 5000;
  while (Date.now() < end) {
    const seen = await monitor.query(
      'select wait_event_type from pg_stat_activity where pid=$1', [client.processID]);
    if (seen.rows[0]?.wait_event_type === 'Lock') return;
    await delay(10);
  }
  assert.fail(`Expected ${what} to block`);
}

test('two concurrent grants seat the colleague once, and the loser is told why',
  () => lab(async ({ connect, setup }) => {
    const patient = await chart(connect, 'req-seat-1');
    const first = await connect(); const second = await connect();
    await begin(first, MANAGER_A); await begin(second, MANAGER_A);
    // Neither can see the other's uncommitted row, so both pass the lookup and
    // both reach the insert. This is the create-if-absent the pause said Base44
    // could not give it.
    const winner = await move(first, patient, 'grant', 'race-grant-a');
    assert.equal(winner.assignment.status, 'active');
    const pending = tracked(move(second, patient, 'grant', 'race-grant-b'));
    await blocked(setup, second, 'the second grant');
    await first.query('commit');
    const loser = await pending;
    // A NAMED refusal. A raw `duplicate key value violates unique constraint`
    // would mean the contract had leaked its storage to the caller, and the
    // http boundary could not classify it.
    assert.equal(loser.ok, false, 'the loser seated the colleague twice');
    assert.match(String(loser.error.message), /PENNSYNC_ASSIGNMENT_EXISTS/,
      `the loser refused with ${loser.error.message}`);
    await second.query('rollback');
    assert.equal((await setup.query(
      `select count(*)::int as n from pennsync_private.chart_assignment
       where patient_id = $1 and membership_id = 'membership-3'`, [patient])).rows[0].n, 1);
  }));

test('two concurrent transitions apply one, and the other is refused as stale',
  () => lab(async ({ connect, setup }) => {
    const patient = await chart(connect, 'req-seat-2');
    const opener = await connect();
    await begin(opener, MANAGER_A);
    await move(opener, patient, 'grant', 'seat-2');
    await opener.query('commit');

    const first = await connect(); const second = await connect();
    await begin(first, MANAGER_A); await begin(second, MANAGER_A);
    // Both managers read version 1 and both act on it. Exactly one may win:
    // without the compare-and-swap the second would overwrite a state it never
    // saw, which is how a reactivation undoes somebody else's suspension.
    const winner = await move(first, patient, 'suspend', 'race-move-a', 1);
    assert.equal(winner.assignment.version, 2);
    const pending = tracked(move(second, patient, 'revoke', 'race-move-b', 1));
    // Blocked on the row lock the contract takes, not on an index.
    await blocked(setup, second, 'the second transition');
    await first.query('commit');
    const loser = await pending;
    assert.equal(loser.ok, false, 'the loser applied a transition against a stale read');
    assert.match(String(loser.error.message), /PENNSYNC_ASSIGNMENT_STALE/,
      `the loser refused with ${loser.error.message}`);
    await second.query('rollback');
    const row = (await setup.query(
      `select status, version, last_action from pennsync_private.chart_assignment
       where patient_id = $1 and membership_id = 'membership-3'`, [patient])).rows[0];
    // `version` is a DOMAIN over integer, which node-pg has no parser for and
    // hands back as text.
    assert.deepEqual([row.status, Number(row.version), row.last_action],
      ['suspended', 2, 'suspend']);
  }));

test('a retry that races its own first attempt applies the transition once',
  () => lab(async ({ connect, setup }) => {
    const patient = await chart(connect, 'req-seat-3');
    const opener = await connect();
    await begin(opener, MANAGER_A);
    await move(opener, patient, 'grant', 'seat-3');
    await opener.query('commit');

    const first = await connect(); const second = await connect();
    await begin(first, MANAGER_A); await begin(second, MANAGER_A);
    // The client that never saw an answer and sent the same request again,
    // while the first was still in flight. Both carry the same request id and
    // the same version, so both are the SAME suspension.
    const winner = await move(first, patient, 'suspend', 'retry-me', 1);
    const pending = tracked(move(second, patient, 'suspend', 'retry-me', 1));
    await blocked(setup, second, 'the racing retry');
    await first.query('commit');
    const retry = await pending;
    // Answered, not refused as stale: the retry finds its own request key on
    // the row and returns what it already did.
    assert.equal(retry.ok, true, `the retry refused: ${retry.error?.message}`);
    assert.equal(retry.value.assignment.version, winner.assignment.version);
    assert.equal(retry.value.assignment.status, 'suspended');
    await second.query('commit');
    // One suspension, from two requests carrying one key.
    const row = (await setup.query(
      `select status, version from pennsync_private.chart_assignment
       where patient_id = $1 and membership_id = 'membership-3'`, [patient])).rows[0];
    assert.deepEqual([row.status, Number(row.version)], ['suspended', 2]);
  }));

test('the assignment lifecycle is held by constraints, not only by the contract',
  () => lab(async ({ setup }) => {
    // The request-key index the pause said Base44 had no equivalent of.
    const index = await setup.query(
      'select indexdef from pg_indexes where schemaname = $1 and indexname = $2',
      ['pennsync_private', 'chart_assignment_request_key']);
    assert.equal(index.rowCount, 1, 'the request-key index exists in the applied store');
    assert.match(index.rows[0].indexdef, /CREATE UNIQUE INDEX/);
    assert.match(index.rows[0].indexdef, /WHERE .*last_request_key IS NOT NULL/);
    // Every state the contract can reach is coherent, and every one it cannot
    // is refused by the table itself — so a future writer that skips the
    // contract cannot invent a suspended row at version 1.
    const patient = 'direct-write-probe';
    const insert = (status, version, action, extra = '') => setup.query(
      `insert into pennsync_private.chart_assignment
        (app_id, agency_id, patient_id, membership_id, status, version, changed_by,
         last_action, last_reason ${extra ? `, ${extra}` : ''})
       values ($1,$2,$3,'membership-3',$4,$5,$6,$7,'because'
         ${extra ? `, clock_timestamp()` : ''})`,
      [APP, A, `${patient}-${status}-${version}`, status, version, uid(1), action]);
    await assert.rejects(insert('suspended', 1, 'suspend', 'suspended_at'),
      /chart_assignment_lifecycle_coherent/);
    await assert.rejects(insert('active', 2, 'activate', 'suspended_at'),
      /chart_assignment_lifecycle_coherent/);
    await assert.rejects(insert('revoked', 1, 'revoke', 'revoked_at'),
      /chart_assignment_lifecycle_coherent/);
    await assert.rejects(insert('active', 1, 'suspend'),
      /chart_assignment_lifecycle_coherent/);
    // And the one shape a grant may have.
    await insert('active', 1, 'grant');
  }));

/*
 * ---------------------------------------------------------------------------
 * D78: the two contracts whose lookup was holding nothing.
 *
 * `select … for update` locks nothing when the row does not exist. This
 * repository wrote that down about `chart_assignment` — the paragraph above is
 * it — and then two later ports were written with exactly the shape it warns
 * about: look for a row, insert when there is none, and assume the lock made
 * that atomic. Neither could be caught by its own suite, because PGlite is one
 * connection and one connection cannot interleave.
 *
 * So these tests are not a formality either, and what they assert is the BLOCK
 * rather than the row count: with the index dropped the second caller does not
 * wait for the first, so `blocked` is what fails, several seconds before any
 * duplicate is counted. That is the more precise claim — the index is what
 * serializes them — and the row assertions after it are the second line rather
 * than the first. Both were watched failing with the two indexes commented out
 * of the generated migration, which is the only way to tell a test that works
 * from one that merely passes.
 */
const PERIOD = Object.freeze({ pay_period_start: '2026-06-14', pay_period_end: '2026-06-27' });
const submit = (client, sheet = {}) => client.query(
  'select "public"."pennsync_contract_timesheet_submit"($1,$2,$3) as result',
  [A, null, JSON.stringify({ ...PERIOD, ...sheet })]).then(result => result.rows[0].result);
const points = (client, config) => client.query(
  'select "public"."pennsync_contract_visit_points_save"($1,$2) as result',
  [A, JSON.stringify(config)]).then(result => result.rows[0].result);

test('two concurrent submissions of one pay period make one timesheet, not two',
  () => lab(async ({ connect, setup }) => {
    const first = await connect(); const second = await connect();
    await begin(first, CLINICIAN_A); await begin(second, CLINICIAN_A);
    // The employee whose client never saw an answer and sent the period again,
    // or who has the app open twice. Neither transaction can see the other's
    // uncommitted row, so both pass the duplicate-period lookup — which is
    // where the second timesheet used to appear, and the original's own comment
    // says what that costs: "Prevents a duplicate row from being
    // double-counted in payroll."
    const winner = await submit(first, { regular_hours: 40 });
    assert.equal(winner.success, true);
    const pending = tracked(submit(second, { regular_hours: 8 }));
    await blocked(setup, second, 'the second submission');
    await first.query('commit');
    const loser = await pending;
    // A NAMED refusal, and specifically the one the uncontended path gives for
    // the same state. A raw `duplicate key value violates unique constraint`
    // would mean the contract had leaked its storage to the caller.
    assert.equal(loser.ok, false, 'the loser submitted the period twice');
    assert.match(String(loser.error.message), /PENNSYNC_TIMESHEET_PERIOD_EXISTS/,
      `the loser refused with ${loser.error.message}`);
    // COMMIT rather than rollback, because that is what the boundary would do
    // and it is the stronger claim: the create path inserts a skeleton row
    // before the write that raises, and a caught exception rolls back only to
    // the start of its own block. An aborted transaction commits as a rollback,
    // so the skeleton goes with it — but only a commit here says so.
    await second.query('commit');
    const sheets = await setup.query(
      `select "id", "regular_hours" from ${SCHEMA}."timesheet"`);
    assert.equal(sheets.rowCount, 1, 'payroll sees one period, not two');
    assert.equal(sheets.rows[0].id, winner.timesheet.id);
    assert.equal(Number(sheets.rows[0].regular_hours), 40, 'the winner\'s hours stand');
  }));

test('two concurrent saves make one point schedule, and the loser lands on it',
  () => lab(async ({ connect, setup }) => {
    const first = await connect(); const second = await connect();
    await begin(first, MANAGER_A); await begin(second, MANAGER_A);
    // An agency setting its point schedule for the first time, from two
    // sessions. Both lookups find nothing, so both reach the insert.
    const winner = await points(first, { soc_points: 10 });
    assert.equal(winner.success, true);
    const pending = tracked(points(second, { soc_points: 25 }));
    await blocked(setup, second, 'the second save');
    await first.query('commit');
    const loser = await pending;
    // ANSWERED, not refused: unlike the timesheet, a second save of an
    // agency's own schedule is a legitimate request, and the retry is where it
    // lands on the row that now exists rather than beside it.
    assert.equal(loser.ok, true, `the loser refused: ${loser.error?.message}`);
    assert.equal(loser.value.config.id, winner.config.id, 'the same schedule, not a second');
    assert.equal(Number(loser.value.config.soc_points), 25, 'and it carries what this caller sent');
    await second.query('commit');
    const live = await setup.query(
      `select "id", "soc_points" from ${SCHEMA}."visit_point_config" where "active" is not false`);
    assert.equal(live.rowCount, 1, 'one active schedule, so no order by decides the pay');
    assert.equal(Number(live.rows[0].soc_points), 25);
  }));

test('the point schedule is held by the index, and history may still sit beside it',
  () => lab(async ({ setup }) => {
    // The constraint is the table's, not the capability's: a future writer —
    // an import, another ported handler — meets the same refusal.
    const row = (id, active) => setup.query(`insert into ${SCHEMA}."visit_point_config"
      ("source_app_id","id","agency_id","active") values ($1,$2,$3,$4)`, [APP, id, A, active]);
    await row('config-live', true);
    await assert.rejects(() => row('config-second', true),
      error => /duplicate key value|unique constraint/.test(String(error?.message)));
    // `null` is "not false" too, which is the predicate every reader uses.
    await assert.rejects(() => row('config-null', null),
      error => /duplicate key value|unique constraint/.test(String(error?.message)));
    // PARTIAL, and this is the part that is not incidental: a DEACTIVATED
    // schedule is history the entity keeps and no reader consults, so the
    // index constrains exactly what is relied on and nothing more.
    await row('config-retired', false);
    await row('config-retired-2', false);
    // And another agency's schedule is not this one's duplicate.
    await setup.query(`insert into ${SCHEMA}."visit_point_config"
      ("source_app_id","id","agency_id","active") values ($1,'config-b','agency-b',true)`, [APP]);
    assert.equal((await setup.query(
      `select count(*)::int as n from ${SCHEMA}."visit_point_config"`)).rows[0].n, 4);
  }));
