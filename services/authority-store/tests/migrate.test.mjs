import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  MIGRATION_DIRECTORY, PIN_SETTING, RECORD_MIGRATION_DIRECTORY, applyProvision,
} from '../../../tools-pennsync-provision.mjs';
import {
  LOCAL_ONLY_MIGRATIONS, MigrateError, applyMigrations, ledgerName, migrationWithLedgerRow,
} from '../../../tools-pennsync-migrate.mjs';

/**
 * The database half of bringing an existing store forward.
 *
 * The offline refusals are in `tools-pennsync-migrate.test.mjs`. What needs a
 * real database is the thing the hosted staging project is actually going to
 * do: a store built when the repository had ten migrations, carrying a pin
 * that must survive, having fifty-four record migrations applied to it in one
 * run — against the committed SQL rather than a fixture of it.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const STAGING = '6a9881683dc68a0bd54f1ef7';

/**
 * The provisioner's own harness: `alter database ... set` runs for real, and a
 * "new session" is modelled by reading what the statement persisted rather
 * than by being told the answer. PGlite is one connection, so a session that
 * trusted itself would agree with itself and prove nothing.
 */
async function persistedPin(db) {
  const { rows } = await db.query(`select s.setconfig from pg_db_role_setting s
    join pg_database d on d.oid = s.setdatabase where d.datname = current_database()`);
  const entry = (rows[0]?.setconfig ?? []).find(item => item.startsWith(`${PIN_SETTING}=`));
  return entry ? entry.slice(PIN_SETTING.length + 1) : null;
}

function harness(db) {
  return {
    query: (sql, params = []) => db.query(sql, params),
    session: async run => {
      const pinned = await persistedPin(db);
      return run({
        query: async (sql, params = []) => (/current_setting/.test(sql) && params[0] === PIN_SETTING
          ? { rows: [{ value: pinned }] }
          : db.query(sql, params)),
        exec: async sql => db.exec(pinned ? `set ${PIN_SETTING} = '${pinned}';\n${sql}` : sql),
      });
    },
  };
}

async function fresh() {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  return db;
}

/**
 * A repository holding only the authority migrations a hosted deployment
 * would have — the local-only one excluded, exactly as the hosted staging
 * project was built — and an empty record directory. Provisioning from this
 * produces the shape the real project is in today.
 */
async function deploymentShapedRepository() {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-migrate-'));
  const authority = join(root, MIGRATION_DIRECTORY);
  await mkdir(authority, { recursive: true });
  await mkdir(join(root, RECORD_MIGRATION_DIRECTORY), { recursive: true });
  const carried = readdirSync(join(repository, MIGRATION_DIRECTORY))
    .filter(file => file.endsWith('.sql') && !LOCAL_ONLY_MIGRATIONS[file])
    .sort();
  for (const file of carried) {
    await writeFile(join(authority, file), await readFile(join(repository, MIGRATION_DIRECTORY, file), 'utf8'));
  }
  return { root, carried };
}

/** The ledger the Supabase CLI keeps, seeded with what this store already ran. */
async function seedLedger(db, names) {
  await db.exec('create schema if not exists supabase_migrations;'
    + ' create table if not exists supabase_migrations.schema_migrations'
    + ' (version text primary key, statements text[], name text);');
  for (const [index, name] of names.entries()) {
    await db.query('insert into supabase_migrations.schema_migrations (version, name) values ($1, $2)',
      // Deliberately NOT the repository's own prefixes: the hosted project's
      // versions were stamped by the CLI at push time and do not match the
      // file names, which is the whole reason the tool matches on name.
      [`2026091807${String(index).padStart(4, '0')}`, name]);
  }
}

test('a store with no ledger is refused rather than migrated blind', async () => {
  const { root } = await deploymentShapedRepository();
  const db = await fresh();
  try {
    await applyProvision({ db: harness(db), requestedApp: STAGING, repository: root });
    await assert.rejects(() => applyMigrations({ db: harness(db), repository }), error => {
      assert.ok(error instanceof MigrateError);
      // The migrations create schemas and tables; they are not re-runnable,
      // so "no ledger" has to stop the run rather than start it over.
      assert.equal(error.code, 'MIGRATE_LEDGER_MISSING');
      return true;
    });
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
});

test('an empty database is sent to the provisioner', async () => {
  const db = await fresh();
  try {
    await assert.rejects(() => applyMigrations({ db: harness(db), repository }), error => {
      assert.equal(error.code, 'MIGRATE_STORE_ABSENT');
      return true;
    });
  } finally { await db.close(); }
});

test('the hosted gap is applied in one run, the pin survives it, and a second run is a no-op', async () => {
  const { root, carried } = await deploymentShapedRepository();
  const db = await fresh();
  try {
    await applyProvision({ db: harness(db), requestedApp: STAGING, repository: root });
    await seedLedger(db, carried.map(ledgerName));

    const before = await db.query('select pennsync_private.deployment_app_id() as app_id');

    const planned = await applyMigrations({ db: harness(db), repository });
    assert.equal(planned.mutated, false, 'the default must touch nothing');
    assert.ok(planned.pending.length >= 54, `expected the record store pending, got ${planned.pending.length}`);
    assert.equal(planned.deployment.app_id, STAGING);

    const run = await applyMigrations({ db: harness(db), repository, apply: true });
    assert.equal(run.mutated, true);
    assert.deepEqual(run.applied, planned.pending, 'applied exactly what the plan named, in that order');

    // The property the tool exists to protect: nothing above may move the pin,
    // because the pin is what keeps one deployment's rows out of another's
    // database. `applyMigrations` checks it too; this proves it independently.
    const after = await db.query('select pennsync_private.deployment_app_id() as app_id');
    assert.equal(after.rows[0].app_id, before.rows[0].app_id);
    assert.equal(after.rows[0].app_id, STAGING);

    // The store really is there, not merely reported as applied.
    const { rows: tables } = await db.query(
      "select count(*)::int as count from pg_tables where schemaname = 'pennsync_records'");
    assert.ok(tables[0].count > 100, `expected the record store, got ${tables[0].count} tables`);

    const again = await applyMigrations({ db: harness(db), repository });
    assert.deepEqual(again.pending, [], 'a second run must find nothing pending');
    assert.equal(again.mutated, false);
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
});

test('the local-only migration is never applied to a deployment, even by the full run', async () => {
  const { root, carried } = await deploymentShapedRepository();
  const db = await fresh();
  try {
    await applyProvision({ db: harness(db), requestedApp: STAGING, repository: root });
    await seedLedger(db, carried.map(ledgerName));
    const run = await applyMigrations({ db: harness(db), repository, apply: true });

    for (const file of Object.keys(LOCAL_ONLY_MIGRATIONS)) {
      assert.ok(!run.applied.includes(file), `${file} must not reach a deployment`);
      assert.ok(run.skipped.some(entry => entry.name === file), `${file} must be reported, not dropped`);
    }
    // Its table is the observable consequence: present locally, absent here.
    const { rows } = await db.query(`select count(*)::int as count from pg_tables
      where schemaname = 'pennsync_private' and tablename = 'archive_patient_import_receipt'`);
    assert.equal(rows[0].count, 0, 'the local-only receipt table must not exist on a deployment');
  } finally { await db.close(); await rm(root, { recursive: true, force: true }); }
});

test('a migration that fails leaves neither its objects nor its ledger row', async () => {
  // The property the separate ledger insert did not have. With two statements,
  // a failure between them left the migration applied and unrecorded, and the
  // next run re-executed a file that creates schemas and tables — the ledger
  // reads as a SUFFIX in that state, so the order check never fired.
  const db = await fresh();
  try {
    await db.exec('create schema supabase_migrations;'
      + ' create table supabase_migrations.schema_migrations'
      + ' (version text primary key, statements text[], name text);');
    const sql = migrationWithLedgerRow({
      name: '20260101000000_doomed.sql',
      from: MIGRATION_DIRECTORY,
      // Creates a table, then fails BEFORE the ledger row and the commit.
      sql: 'begin;\ncreate table public.doomed (id int);\nselect 1 / 0;\ncommit;\n',
    });
    await assert.rejects(() => db.exec(sql));
    // The failed statement left the transaction open and aborted, because the
    // trailing `commit;` was skipped with it. The tool is unaffected — it
    // opens a session per migration and closes it in a `finally`, so the
    // aborted transaction dies with the connection — but this harness reuses
    // one connection, so it has to end the block before it can read anything.
    await db.exec('rollback;');

    const { rows: recorded } = await db.query(
      "select count(*)::int as count from supabase_migrations.schema_migrations where name = 'doomed'");
    const { rows: created } = await db.query(
      "select count(*)::int as count from pg_tables where tablename = 'doomed'");
    // Both halves rolled back together, which is the whole point: the next run
    // sees it as pending and re-running it is safe, because nothing landed.
    assert.equal(recorded[0].count, 0, 'the ledger must not record a migration that failed');
    assert.equal(created[0].count, 0, 'the migration must not leave objects behind');
  } finally { await db.close(); }
});

/**
 * The hosted staging project as it actually is: the first nine authority
 * migrations applied directly, no deployment pin, and a ledger naming them.
 *
 * `deploymentShapedRepository` provisions through `applyProvision`, which sets
 * the pin and applies every authority migration — a store more convenient than
 * the real one, and the reason the suites did not notice that `applyMigrations`
 * refused its own target. This builds the real shape instead, so the rehearsal
 * below is the run Stage A will actually perform.
 */
const HOSTED_STAGING = ['independent_staging_authority', 'synthetic_s4_create_subset',
  'synthetic_s3_manual_referral', 's4_ecmascript_blank_note', 'current_visit_documentation',
  'current_patient_context', 'current_visit_schedule', 'referral_patient_selection',
  'current_referral_list'];

async function legacyStore(db) {
  const files = readdirSync(join(repository, MIGRATION_DIRECTORY)).sort()
    .filter(file => HOSTED_STAGING.includes(ledgerName(file)));
  assert.equal(files.length, HOSTED_STAGING.length, 'the hosted set must resolve to real files');
  for (const file of files) {
    await db.exec(await readFile(join(repository, MIGRATION_DIRECTORY, file), 'utf8'));
  }
  await seedLedger(db, files.map(ledgerName));
}

test('the real hosted shape is accepted and migrated end to end, pin and all', async () => {
  const db = await fresh();
  try {
    await legacyStore(db);
    // No pin exists yet: `deployment_app_pin` is the first thing pending.
    const { rows: absent } = await db.query(`select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pennsync_private' and p.proname = 'deployment_app_id'`);
    assert.equal(absent[0].count, 0);

    const planned = await applyMigrations({ db: harness(db), repository });
    assert.equal(planned.deployment, null, 'there is no pin to report yet');
    assert.equal(planned.deployment_pin_pending, true);
    assert.equal(ledgerName(planned.pending[0]), 'deployment_app_pin');

    const run = await applyMigrations({ db: harness(db), repository, apply: true });
    assert.equal(run.mutated, true);
    assert.deepEqual(run.applied, planned.pending);

    // An unset setting defaults to staging, the restrictive outcome, and the
    // run reports the pin it created rather than the null it started with.
    assert.equal(run.deployment.app_id, STAGING);
    assert.equal(run.deployment.source, 'default');

    const { rows: tables } = await db.query(
      "select count(*)::int as count from pg_tables where schemaname = 'pennsync_records'");
    assert.ok(tables[0].count > 100, `expected the record store, got ${tables[0].count} tables`);

    // Both colliding version pairs are in this run, so a prefix-keyed ledger
    // would have aborted it at `contract_assignment`.
    const { rows: ledger } = await db.query(
      'select count(*)::int as count from supabase_migrations.schema_migrations');
    assert.equal(ledger[0].count, HOSTED_STAGING.length + run.applied.length);

    const again = await applyMigrations({ db: harness(db), repository });
    assert.deepEqual(again.pending, []);
  } finally { await db.close(); }
});
