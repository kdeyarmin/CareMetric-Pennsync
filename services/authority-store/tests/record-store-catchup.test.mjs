import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE } from '../../../tools-entity-schema-plan.mjs';
import {
  CATCHUP_MIGRATION, DEFAULTS_CATCHUP_MIGRATION, DISTRIBUTION_INDEX,
  INDEX_CATCHUP_MIGRATION, SCHEMA_ONLY_TABLES, SCHEMA_ONLY_WAVES,
  assertWaveSizes, assertWavesDisjoint,
  assertSkippedDefaultsAreCarried, readColumnDefaults, readDistributionIndex,
  idempotentTableIndex, idempotentTables,
  readProfileBlock, readTableBlock, readTableIndexes, readTablePolicies,
  renderCatchup, renderDefaultsCatchup, renderIndexCatchup, renderTablesCatchup,
} from '../../../tools-pennsync-record-catchup.mjs';
import { assertNewestRecordMigration, recordMigrationNames } from './record-migrations.mjs';

/**
 * The forward migration that carries a regenerated record store into a
 * deployment that already applied it (D88).
 *
 * The defect this exists for is not a wrong policy; it is a policy that never
 * arrived. `20260919170000_record_store.sql` is generated and was regenerated
 * for D82, the ledger keys on the migration's NAME with no content hash, and
 * so the four objects reached every fresh build and no existing store. Every
 * suite in this directory passed throughout, because every suite in this
 * directory builds from nothing — which is precisely the case that cannot see
 * it.
 *
 * So the test that matters here is the second one: it builds a store from the
 * record migration as it stood BEFORE the block was added, which is what the
 * hosted project is running, and proves the catch-up closes the gap. Asserting
 * that the catch-up "creates a policy" against a database that already has one
 * would pass with the file empty.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const catchup = () => readFileSync(resolve(repository, CATCHUP_MIGRATION), 'utf8');
const recordStore = () => readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');

/**
 * What the four D82 objects look like to the hosted comparison.
 *
 * The same columns `hosted-store.test.mjs` reads — `md5(prosrc)` for the body,
 * the owner, the trigger's own definition, the policy's two expressions —
 * because a catch-up that produced an EQUIVALENT store rather than the same
 * one would close this test and leave that one red.
 */
const SHAPE = `select jsonb_build_object(
  'function', (select jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner), 'cfg', coalesce(p.proconfig::text, ''),
      'body', md5(p.prosrc), 'public_execute', has_function_privilege('public', p.oid, 'execute')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_records' and p.proname = 'user_self_write_guard'),
  'trigger', (select jsonb_agg(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_records' and c.relname = 'user' and not t.tgisinternal),
  'policy', (select jsonb_agg(jsonb_build_object(
      'name', policyname, 'cmd', cmd, 'qual', qual, 'with_check', with_check) order by policyname)
    from pg_policies where schemaname = 'pennsync_records' and tablename = 'user')
) as shape`;

const shapeOf = async db => (await db.query(SHAPE)).rows[0].shape;

/** The authority store the record migration is applied on top of. */
async function authority(target) {
  await target.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await target.exec(await readFile(new URL(name, dir), 'utf8'));
  }
}

let beforeD82 = {};
let afterCatchup = {};
let fresh = {};
let freshThenCatchup = {};

before(async () => {
  // The hosted case: the record migration as it was when that store applied
  // it. Cut by removing the exact block the catch-up carries, so the two
  // cannot describe different changes.
  const stale = recordStore().replace(readProfileBlock(repository), '');
  assert.notEqual(stale, recordStore(), 'the D82 block was not found to remove');
  const existing = new PGlite();
  await authority(existing);
  await existing.exec(stale);
  beforeD82 = await shapeOf(existing);
  await existing.exec(catchup());
  afterCatchup = await shapeOf(existing);
  await existing.close();

  // The fresh case: the generated migration in full, then the catch-up after
  // it, which is the order a provision runs them in.
  const provisioned = new PGlite();
  await authority(provisioned);
  await provisioned.exec(recordStore());
  fresh = await shapeOf(provisioned);
  await provisioned.exec(catchup());
  freshThenCatchup = await shapeOf(provisioned);
  await provisioned.close();
});

test('the catch-up is derived from the generated migration, not typed beside it', () => {
  // The whole point of the tool: change `PROFILE_SELF_WRITABLE` or the guard
  // and this fails until the catch-up moves with it. A hand-kept second copy
  // would drift in the one direction nothing else measures — a deployment
  // getting an older rule than a fresh build.
  // Line by line, because `assert.equal` over a 90-line file prints both
  // copies and names nothing — the failure a reader gets should be the line
  // that moved, which is the same reason `hosted-store.test.mjs` reports keys
  // rather than diffing arrays.
  assert.deepEqual(catchup().split('\n'), renderCatchup(repository).split('\n'),
    'run `node tools-pennsync-record-catchup.mjs --write`');
});

test('a store that applied the record migration before D82 was missing all four objects', () => {
  // The state the hosted comparison actually found, asserted rather than
  // assumed: if the cut did not remove them, the next test proves nothing.
  assert.equal(beforeD82.function, null, 'the guard function was already present');
  assert.equal(beforeD82.trigger, null, 'the guard trigger was already present');
  const names = (beforeD82.policy ?? []).map(entry => entry.name);
  assert.deepEqual(names, ['user_read'], `policies on user: ${names.join(', ')}`);
});

test('the catch-up gives that store exactly what a fresh build has', () => {
  // Field for field against the fresh build, not merely "a policy exists".
  // `md5(prosrc)` and `pg_get_triggerdef` are what the hosted comparison
  // reads, so equality here is the thing that turns that job green.
  assert.deepEqual(afterCatchup, fresh);
});

test('applying it to a store that already has them changes nothing', () => {
  // A provision runs the generated file and then this one, so the second
  // application has to be a no-op down to the function body's hash — the
  // reason each statement carries its idempotent form rather than a guard
  // around it.
  assert.deepEqual(freshThenCatchup, fresh);
});

test('the guard is still closed to public, which the rewrite could have dropped', () => {
  // `create or replace function` keeps an existing function's privileges and
  // gives a NEW one the default `execute to public`. The catch-up carries the
  // generated `revoke`, and this is the assertion that fails if a future
  // rewrite loses it on the path where the function is created rather than
  // replaced.
  assert.deepEqual(afterCatchup.function.map(entry => entry.public_execute), [false]);
});

/*
 * The SECOND derivation, and the first time D88's rule was applied on purpose
 * rather than after the fact.
 *
 * D89 adds `policy_acknowledgment_distribution_unique` to the generated
 * migration, which is a change to what a NEW store gets and reaches no
 * deployment that already ran the file. The index is the whole of
 * `contract_policy_distribute`'s idempotency — without it the contract's
 * `unique_violation` branch is unreachable and every redistribution writes a
 * duplicate assignment — so a store missing it does not fail, it silently
 * double-assigns.
 */
const indexCatchup = () =>
  readFileSync(resolve(repository, INDEX_CATCHUP_MIGRATION), 'utf8');

/** The index as the hosted comparison sees it: by name, with its definition. */
const INDEX_SHAPE = `select jsonb_build_object(
  'index', (select jsonb_agg(jsonb_build_object('name', indexname, 'def', indexdef)
      order by indexname)
    from pg_indexes where schemaname = 'pennsync_records'
      and tablename = 'policy_acknowledgment')
) as shape`;
const indexShapeOf = async db => (await db.query(INDEX_SHAPE)).rows[0].shape;

let beforeIndex = {};
let afterIndexCatchup = {};
let freshIndex = {};
let freshThenIndexCatchup = {};

before(async () => {
  const statement = readDistributionIndex(repository);
  const stale = recordStore().replace(statement, '');
  assert.notEqual(stale, recordStore(), 'the D89 index was not found to remove');
  const existing = new PGlite();
  await authority(existing);
  await existing.exec(stale);
  beforeIndex = await indexShapeOf(existing);
  await existing.exec(indexCatchup());
  afterIndexCatchup = await indexShapeOf(existing);
  await existing.close();

  const provisioned = new PGlite();
  await authority(provisioned);
  await provisioned.exec(recordStore());
  freshIndex = await indexShapeOf(provisioned);
  await provisioned.exec(indexCatchup());
  freshThenIndexCatchup = await indexShapeOf(provisioned);
  await provisioned.close();
});

test('the index catch-up is derived from the generated migration too', () => {
  assert.deepEqual(indexCatchup().split('\n'), renderIndexCatchup(repository).split('\n'),
    'run `node tools-pennsync-record-catchup.mjs --write`');
});

test('a store that applied the record migration before D89 has no distribution key', () => {
  // Asserted, not assumed, for the reason the D82 pair states: if the cut left
  // the index in place, the next test proves nothing.
  const names = (beforeIndex.index ?? []).map(entry => entry.name);
  assert.equal(names.includes(DISTRIBUTION_INDEX), false, names.join(', '));
});

test('the index catch-up gives that store exactly what a fresh build has', () => {
  // `indexdef` and not merely the name: an index over the right columns
  // without the partial predicate is a different constraint, and it is the
  // predicate that lets a row with no agency exist at all.
  assert.deepEqual(afterIndexCatchup, freshIndex);
});

test('applying the index catch-up to a store that already has it changes nothing', () => {
  // `if not exists` rather than a drop and recreate: dropping a unique index
  // on a live table opens exactly the window the index is there to close, and
  // on a big table the rebuild takes a lock nobody asked for.
  assert.deepEqual(freshThenIndexCatchup, freshIndex);
});

/**
 * The third catch-up: the entity schemas' column defaults (D88 again).
 *
 * `planEntity` never read a property's `default`, so the generated store
 * emitted none of the 425 the carried schemas declare, and a contract's INSERT
 * that omits such a column stored a null where the Base44 original stored the
 * schema's value. That is a wrong number rather than a missing object —
 * `timesheet.status` null instead of `draft`, and null payroll hours instead
 * of 0 — so nothing raises and nothing is missing to look for.
 *
 * The test that matters is the same one as above: a store built from the
 * migration as it stood WITHOUT the defaults, which is what the hosted project
 * is running. Asserting that the catch-up "sets a default" against a database
 * that already has one passes with the file empty.
 */
const defaultsCatchup = () =>
  readFileSync(resolve(repository, DEFAULTS_CATCHUP_MIGRATION), 'utf8');
/**
 * Every wave's committed file, concatenated in deployment order.
 *
 * D7's schema clause ships one forward migration per wave now, because a
 * forward migration is itself a committed file and re-rendering an earlier
 * wave with a later wave's tables in it is the edit D88 forbids. So what is
 * compared against the renderer is the whole set, in order, and a wave whose
 * file stopped being derived fails by name rather than by the join coming out
 * the wrong length.
 */
const tablesCatchup = () => SCHEMA_ONLY_WAVES
  .map(wave => readFileSync(resolve(repository, wave.migration), 'utf8')).join('');

/**
 * The eight schema-only tables as the store actually holds them: columns, the
 * two row-level-security flags, and every policy by name and command.
 *
 * The RLS flags are in the projection deliberately. `create table if not
 * exists` is the only idempotent form a table has, so an existing table of the
 * same name is a silent no-op — and the failure that would hide is a record
 * table whose forced RLS never got set, which is readable by every tenant. A
 * column list alone would not tell those apart.
 */
const TABLE_SHAPE = `select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname, 'rls', c.relrowsecurity, 'forced', c.relforcerowsecurity,
    'columns', (select jsonb_agg(a.attname order by a.attnum) from pg_attribute a
      where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('name', p.polname, 'cmd', p.polcmd)
      order by p.polname), '[]'::jsonb) from pg_policy p where p.polrelid = c.oid))
    order by c.relname), '[]'::jsonb) as shape
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'pennsync_records' and c.relkind = 'r'
    and c.relname = any($1)`;
const tableShapeOf = async db =>
  (await db.query(TABLE_SHAPE, [[...SCHEMA_ONLY_TABLES]])).rows[0].shape;

/** Every column default in the schema, by table and column. */
const DEFAULTS_SHAPE = `select coalesce(jsonb_agg(jsonb_build_object(
    'table', c.relname, 'column', a.attname,
    'default', pg_get_expr(d.adbin, d.adrelid)) order by c.relname, a.attname), '[]'::jsonb) as shape
  from pg_attrdef d join pg_class c on c.oid = d.adrelid
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
  where n.nspname = 'pennsync_records'`;
const defaultsShapeOf = async db => (await db.query(DEFAULTS_SHAPE)).rows[0].shape;

/**
 * One row inserted BEFORE the catch-up, to prove nothing backfills it.
 *
 * Planted as the suite's own role rather than the record owner: forced RLS
 * binds the owner too, so an insert as that role is refused with no policy to
 * admit it, and there is no caller identity here to give it one.
 */
const SEED = `insert into "pennsync_records"."timesheet"
  ("source_app_id", "id", "agency_id") values ('app', 'sheet-1', 'agency-a');`;
const STORED = `select "status" from "pennsync_records"."timesheet" where "id" = 'sheet-1'`;

/**
 * The record migration as a store that applied the ORIGINAL holds it: without
 * the eight D7 schema-only tables and without any column default.
 *
 * Both cuts, in that order, because the hosted store is missing both and a
 * "before" holding either would compare a store with itself. The tables are cut
 * through the same readers the tables catch-up uses, so the two cannot describe
 * different changes — and the defaults are cut AFTER, from what is left, so the
 * eight defaults that live inside those table blocks are gone with the blocks
 * rather than being looked for in text that no longer has them.
 */
function storeBeforeBothCatchups() {
  let stale = recordStore();
  for (const table of SCHEMA_ONLY_TABLES) {
    stale = stale.replace(readTableBlock(repository, table), '');
    for (const { sql: statement } of readTablePolicies(repository, table)) {
      stale = stale.replace(`${statement}\n`, '');
    }
  }
  for (const table of SCHEMA_ONLY_TABLES) {
    assert.equal(stale.includes(`"pennsync_records"."${table}"`), false, `${table} survived the cut`);
  }
  for (const { literal: value } of readColumnDefaults(repository)) {
    stale = stale.replace(` default ${value},\n`, ',\n');
  }
  assert.equal(/ default /.test(stale), false, 'a default survived the cut');
  assert.notEqual(stale, recordStore(), 'nothing was found to remove');
  return stale;
}

let beforeDefaults = {};
let afterDefaultsCatchup = {};
let freshDefaults = {};
let freshThenDefaultsCatchup = {};
let beforeTables = [];
let afterTablesCatchup = [];
let freshTables = [];
let freshThenTablesCatchup = [];
let storedBefore;
let storedAfter;
let insertedAfter;

before(async () => {
  // The ordering guard arrives HERE, because the LAST wave's migration is now
  // the newest pending record migration and the guard belongs to whichever file
  // that is. The last wave rather than a single constant: each new wave adds a
  // file with a higher prefix, so the guard moves within this suite as waves
  // arrive and the suite needs no edit for it. It left `contract-reference-writes.test.mjs` by that suite's file
  // being OVERTAKEN, which is the other direction of the same rule and the
  // reason the helper's own error text mentions renaming rather than merging.
  // The handover is per-base rather than once: four pending migrations between
  // 720000 and 745000 land ahead of this one, each taking and losing the guard
  // in turn, so a rebase onto a base where one of them holds it goes red naming
  // THAT suite, and the fix is to retire the call there rather than to doubt
  // this one. A red that names the predecessor is the handover working.
  //
  // It is passed the DIRECTORY listing and not an applied set, and the
  // difference is worth stating rather than glossing: every other holder has
  // applied the whole directory to one store and hands that result over, while
  // this suite deliberately builds cut-down stores and applies no such set. The
  // guard only reads the last name, so the listing is the honest argument — and
  // it is also the weaker one, since the whole-directory equality that gives the
  // other holders their teeth has no equivalent here. What this asserts is
  // exactly one thing: nothing in the directory sorts after this change's file.
  assertNewestRecordMigration(
    await recordMigrationNames(), SCHEMA_ONLY_WAVES.at(-1).migration.split('/').at(-1));
  // And the waves are in the order they claim to be, because the guard above
  // only looks at the last one: a wave list sorted wrongly would hand the guard
  // a file that is not the newest and the assertion would be about the wrong
  // name while still passing or failing for reasons of its own.
  const prefixes = SCHEMA_ONLY_WAVES.map(wave => wave.migration.split('/').at(-1).split('_')[0]);
  assert.deepEqual(prefixes, [...prefixes].sort(), 'wave migrations must ascend');

  const stale = storeBeforeBothCatchups();

  const existing = new PGlite();
  await authority(existing);
  await existing.exec(stale);
  beforeDefaults = await defaultsShapeOf(existing);
  // A row created by the old store, holding the null it was given.
  await existing.exec(SEED);
  storedBefore = (await existing.query(STORED)).rows[0].status;
  beforeTables = await tableShapeOf(existing);
  // BOTH catch-ups, in migration order, because that store is missing what both
  // of them carry. Applying only one and comparing against a fresh build would
  // fail for the other's reason and read as this one's.
  await existing.exec(defaultsCatchup());
  await existing.exec(tablesCatchup());
  afterTablesCatchup = await tableShapeOf(existing);
  afterDefaultsCatchup = await defaultsShapeOf(existing);
  storedAfter = (await existing.query(STORED)).rows[0].status;
  await existing.exec(`insert into "pennsync_records"."timesheet"
    ("source_app_id", "id", "agency_id") values ('app', 'sheet-2', 'agency-a');`);
  insertedAfter = (await existing.query(
    `select "status" from "pennsync_records"."timesheet" where "id" = 'sheet-2'`)).rows[0].status;
  await existing.close();

  const provisioned = new PGlite();
  await authority(provisioned);
  await provisioned.exec(recordStore());
  freshDefaults = await defaultsShapeOf(provisioned);
  freshTables = await tableShapeOf(provisioned);
  await provisioned.exec(defaultsCatchup());
  await provisioned.exec(tablesCatchup());
  freshThenDefaultsCatchup = await defaultsShapeOf(provisioned);
  freshThenTablesCatchup = await tableShapeOf(provisioned);
  await provisioned.close();
});

test('the defaults catch-up is derived from the generated migration too', () => {
  assert.deepEqual(defaultsCatchup().split('\n'), renderDefaultsCatchup(repository).split('\n'),
    'run `node tools-pennsync-record-catchup.mjs --write`');
});

test('a store that applied the record migration before this has no column defaults', () => {
  // Asserted rather than assumed: if the cut left them in place, every test
  // below is comparing a store with itself.
  assert.deepEqual(beforeDefaults, []);
});

test('the catch-up gives that store exactly the defaults a fresh build has', () => {
  // The rendered EXPRESSION and not merely which columns have one: a default
  // of the wrong value is the defect this closes, not a default that is
  // absent, and only `pg_get_expr` can tell those apart.
  assert.deepEqual(afterDefaultsCatchup, freshDefaults);
  // 454, not 425: the D7 schema-only tables declare 29 defaults between them,
  // over two waves (8 in the OASIS wave, 21 in the fax and phone one). They are
  // NOT in this catch-up — it is already applied and an applied migration is
  // frozen, so re-emitting it with them would have shipped an edit no store
  // that ran it will ever see. They arrive inline in the table blocks instead,
  // which is what the cross-check below proves statement by statement.
  //
  // PINNED rather than derived, and the pin is the point: `readColumnDefaults`
  // returns 425 and the skipped reader returns 29, so deriving this as their
  // sum would assert 425 + 29 = 454 against a store built from the same two
  // readers and pass however many went missing. The identity is checked below;
  // what this line is for is that the TOTAL moved when somebody meant it to.
  assert.equal(freshDefaults.length, 454);
  assert.equal(readColumnDefaults(repository).length, 425);
});

test('applying it to a store that already has them changes nothing', () => {
  // `set default` is idempotent by nature, which is why there is no `if not
  // exists` here and no drop: a fresh provision runs the generated file and
  // then this one, and both orders have to end in the same store.
  assert.deepEqual(freshThenDefaultsCatchup, freshDefaults);
});

test('it backfills nothing: a row stored before the catch-up keeps its null', () => {
  // The property the other two catch-ups have no equivalent of. A default
  // decides what an INSERT that omits the column gets; writing today's value
  // into rows created without one would assert something nobody observed.
  // Both halves, because "unchanged" proves nothing if it was never null.
  assert.equal(storedBefore, null);
  assert.equal(storedAfter, null);
  assert.equal(insertedAfter, 'draft', 'the default did not take effect on a new row');
});

/**
 * D7's schema clause, carried forward (D88).
 *
 * The eight tables went into the GENERATED record store, which reaches a fresh
 * provision and no deployment that already applied it. The shape of the defect
 * is the one D82 had, and the reason every suite here would miss it is the same:
 * they all build from nothing, which is the one case it cannot appear in.
 *
 * What makes this catch-up different from the three above is that a table is
 * weaker to carry idempotently than a function, a policy or a default. `create
 * table if not exists` cannot correct a table that is already there and wrong,
 * so these tests check the row-level-security flags and the policies as well as
 * the columns — a table arriving without forced RLS is readable by every tenant,
 * and that is the failure worth an assertion rather than a comment.
 */
test('every wave\'s catch-up is derived from the generated migration too', () => {
  for (const wave of SCHEMA_ONLY_WAVES) {
    assert.deepEqual(
      readFileSync(resolve(repository, wave.migration), 'utf8').split('\n'),
      renderTablesCatchup(repository, wave).split('\n'),
      `${wave.migration}: run \`node tools-pennsync-record-catchup.mjs --write\``);
  }
  // The join is what the cut-down store below is built against, so it has to
  // be every wave and nothing else.
  assert.equal(tablesCatchup(),
    SCHEMA_ONLY_WAVES.map(wave => renderTablesCatchup(repository, wave)).join(''));
});

test('a table belongs to exactly one wave, and each wave\'s size sentence is its file\'s own count', () => {
  // Raised from a synthetic pair rather than asserted of the real list: a check
  // that the real waves happen to be disjoint passes for the wrong reason, and
  // this one has to bite.
  assert.deepEqual(assertWavesDisjoint(), [...SCHEMA_ONLY_TABLES]);
  assert.throws(() => assertWavesDisjoint([
    { migration: 'a.sql', tables: ['oasis_upload'] },
    { migration: 'b.sql', tables: ['oasis_upload'] },
  ]), /CATCHUP_WAVE_TABLE_REPEATED:oasis_upload:a\.sql/);
  // A repeat WITHIN one wave is the same defect and is caught the same way.
  assert.throws(() => assertWavesDisjoint([{ migration: 'a.sql', tables: ['fax_log', 'fax_log'] }]),
    /CATCHUP_WAVE_TABLE_REPEATED:fax_log/);
  // The size sentences are bare numbers in committed prose, which is the thing
  // this project keeps finding wrong, so they are measured against the files
  // they describe.
  const measured = assertWaveSizes(repository);
  assert.equal(measured.length, SCHEMA_ONLY_WAVES.length);
  for (const [index, wave] of SCHEMA_ONLY_WAVES.entries()) {
    assert.equal(measured[index].says, wave.size, wave.migration);
    assert.ok(measured[index].columns > 0 && measured[index].policies > 0, wave.migration);
  }
  assert.throws(() => assertWaveSizes(repository,
    [{ ...SCHEMA_ONLY_WAVES[0], size: '1 columns and 1 policies' }]),
    /CATCHUP_WAVE_SIZE_WRONG/);
});

test('a wave carries its tables\' indexes, and the one that exists is in its file', () => {
  // The gap this closes was invisible when it was closed: no schema-only table
  // had an index, so the reader could not be wrong about anything and every
  // committed file rendered identically with or without it. One arrived in the
  // same change -- `FaxRetryConfig.active_agency`, the D78 key the retry-config
  // contract catches BY NAME -- and without the reader it would have reached a
  // fresh build and no store that had already applied the generated migration.
  // D88 one index at a time, and silently, because an absent unique index
  // refuses nothing and `select ... for update` locks nothing when the row does
  // not exist.
  //
  // So this asserts the WHOLE set rather than a count: a wave table gaining an
  // index has to show up here, in the diff, named.
  const byTable = new Map(SCHEMA_ONLY_TABLES.map(table =>
    [table, readTableIndexes(repository, table).map(entry => entry.name)]));
  assert.deepEqual([...byTable].filter(([, names]) => names.length), [
    ['fax_retry_config', ['fax_retry_config_active_agency_unique']],
  ]);
  // And it is in the wave's committed file, in the idempotent form, which is
  // the half that would have been missing.
  const wave = SCHEMA_ONLY_WAVES.find(entry => entry.tables.includes('fax_retry_config'));
  const committed = readFileSync(resolve(repository, wave.migration), 'utf8');
  assert.ok(committed.includes(
    'create unique index if not exists "fax_retry_config_active_agency_unique"'));
  // Proved against a second table too, one in no wave at all, so the carry is
  // shown to work rather than shown to agree with itself.
  const carried = idempotentTables(repository, ['timesheet']);
  const [index] = readTableIndexes(repository, 'timesheet');
  assert.equal(index.name, 'timesheet_period_unique');
  assert.ok(carried.includes(idempotentTableIndex(index.sql)));
  // `if not exists` rather than the drop-and-recreate the policies get:
  // dropping a unique index on a live table removes the constraint a contract
  // catches by name for as long as the rebuild takes.
  assert.ok(carried.includes('create unique index if not exists "timesheet_period_unique"'));
  assert.ok(!carried.includes('drop index'));
  // Both forms rewrite, since a non-unique index is representable here too.
  assert.equal(idempotentTableIndex('create index "i" on "pennsync_records"."t" ("a");'),
    'create index if not exists "i" on "pennsync_records"."t" ("a");');
  // And a statement the rewrite cannot reach refuses rather than passing
  // through unchanged, which is how a shape change in the generator surfaces
  // here instead of as a missing index on a hosted store.
  assert.throws(() => idempotentTableIndex('create table "pennsync_records"."t" ();'),
    /CATCHUP_TABLE_INDEX_REWRITE_MISSED/);
  // A duplicate name is refused, since taking the first of two would pick one
  // of two different predicates. Raised by making the pattern match the one
  // real statement twice, because there is no table in the store with two
  // indexes of one name to read -- and asserted on the exact error, not on
  // "it threw", which an invalid pattern would also satisfy.
  assert.throws(() => readTableIndexes(repository, 'timesheet"|"pennsync_records"."timesheet'),
    err => err.message.startsWith('CATCHUP_TABLE_INDEX_DUPLICATED:'));
});

test('a store that applied the record migration before this has none of the schema-only tables', () => {
  // Asserted rather than assumed: if the cut left them in place, the test below
  // is comparing a store with itself and would pass with the file empty.
  assert.deepEqual(beforeTables, []);
});

test('the catch-up gives that store exactly the tables a fresh build has', () => {
  assert.deepEqual(afterTablesCatchup, freshTables);
  assert.equal(freshTables.length, SCHEMA_ONLY_TABLES.length);
  // Every one of them, not just however many the aggregate happened to find.
  assert.deepEqual(freshTables.map(entry => entry.table), [...SCHEMA_ONLY_TABLES].sort());
  for (const entry of freshTables) {
    assert.equal(entry.rls, true, entry.table);
    assert.equal(entry.forced, true, entry.table);
    assert.ok(entry.policies.length > 0, entry.table);
    assert.ok(entry.policies.some(policy => policy.name === `${entry.table}_read`), entry.table);
  }
});

test('applying it to a store that already has them changes nothing', () => {
  // A fresh provision runs the generated file and then this one, so both orders
  // have to end in the same store. The policies are the half that could have
  // gone wrong: they are dropped and recreated rather than skipped.
  assert.deepEqual(freshThenTablesCatchup, freshTables);
});

test('the defaults the defaults catch-up stops reading are carried here instead', () => {
  // The exclusion in `readColumnDefaults` is only safe if what it stops reading
  // arrives somewhere. This reads those defaults out of the generated migration
  // a second time, on purpose rather than by reusing the first reader, and
  // checks each one is inside an emitted table block.
  // Across every wave: `assertSkippedDefaultsAreCarried` renders them all, so a
  // default living in a later wave's tables is carried rather than reported
  // missing. The count is derived from the reader rather than pinned, because
  // pinning it would have to move with every wave and the property being
  // checked is that each one is CARRIED, not how many there are.
  const skipped = assertSkippedDefaultsAreCarried(repository);
  assert.ok(skipped.length >= 8, `expected the exclusion to be doing work, found ${skipped.length}`);
  for (const row of skipped) assert.ok(SCHEMA_ONLY_TABLES.includes(row.table), row.table);
  // And the already-applied file is genuinely untouched by them.
  for (const row of skipped) {
    assert.equal(defaultsCatchup().includes(`"${row.table}" alter column`), false, row.table);
  }
});

test('a block read to the wrong end, or with its protection missing, is refused', () => {
  // Each refusal is raised rather than described. The unprotected case is the
  // one that matters: a block whose RLS lines had moved out of it would carry a
  // record table readable by every tenant, and nothing else here would notice.
  assert.throws(() => readTableBlock(repository, 'no_such_table'),
    /CATCHUP_TABLE_MISSING:no_such_table/);
  assert.throws(() => readTablePolicies(repository, 'no_such_table'),
    /CATCHUP_TABLE_NO_POLICY:no_such_table/);
  for (const table of SCHEMA_ONLY_TABLES) {
    const block = readTableBlock(repository, table);
    assert.ok(block.includes('enable row level security'), table);
    assert.ok(block.includes('force row level security'), table);
    assert.ok(block.includes(`revoke all on "pennsync_records"."${table}" from public;`), table);
  }
});
