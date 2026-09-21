#!/usr/bin/env node
/**
 * Apply the migrations a store that already exists has not had yet.
 *
 * `tools-pennsync-provision.mjs` builds a store from nothing: it pins the
 * deployment, then applies every migration in order. It deliberately REFUSES a
 * database that already holds `pennsync_private`
 * (`PROVISION_STORE_ALREADY_PRESENT`), because re-provisioning a live store
 * would try to re-pin it, and under D11 the pin is a generated IMMUTABLE
 * constant that cannot be edited.
 *
 * That refusal left the ordinary case with no tool at all. The hosted staging
 * project was built when the store had ten migrations and the repository now
 * carries sixty-nine; bringing it forward is neither provisioning nor a
 * schema edit, and doing it by hand means an operator deciding which of
 * sixty-nine files have already run.
 *
 * What this does, and the order is again the point:
 *
 *   1. refuse a database with NO store — that is the provisioner's job, and it
 *      pins first, which this must never do;
 *   2. read which migrations have run, BY NAME, and refuse if that cannot be
 *      established rather than guessing;
 *   3. plan the pending set, refusing a sequence with a hole in it and any two
 *      migrations that would claim one ledger row;
 *   4. only NOW judge the pin, because whether its absence is a fault depends
 *      on the plan: pending means the ordinary legacy store, already applied
 *      means a provision that died part-way, which D11 replaces rather than
 *      continues;
 *   5. apply, in the same two-sequence order the provisioner uses, each
 *      migration recording itself inside its own transaction;
 *   6. re-read the pin and refuse if one that existed has moved.
 *
 * Step 4's ORDER is the correction that matters. Judging the pin first — before
 * the ledger — refused the one database this tool was written for: hosted
 * staging holds nine authority migrations and no pin, because the pin is
 * created by the first thing PENDING there.
 *
 * Step 6 is what earns the tool. Nothing here is supposed to move a pin that
 * already existed, which is exactly why it is worth proving after the fact: a
 * migration that quietly re-generated `deployment_app_id()` would move a store
 * between deployments, and that is the one failure this design says is
 * impossible.
 *
 * It plans by default and applies only when asked, because the dangerous verb
 * should be the one you have to type.
 *
 * It migrates; it does not create a hosted project, hold a credential, enroll
 * an identity or write a business row.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MIGRATION_DIRECTORY,
  RECORD_MIGRATION_DIRECTORY,
  readMigrations,
} from './tools-pennsync-provision.mjs';

export const MIGRATE_CONTRACT = 'cm.pennsync.migrate.v1';

/** The migration that creates the deployment pin every later read depends on. */
export const PIN_MIGRATION = 'deployment_app_pin';

/**
 * Migrations that exist in the repository and are deliberately NOT applied to
 * a hosted deployment, with the reason each one is held back.
 *
 * This was prose in `docs/BASE44_TO_RAILWAY_TRANSITION_PLAN_2026-09-19.md`
 * and nothing in code: the hosted staging project was built without
 * `synthetic_archive_patient_import` on purpose, and the only record of that
 * was one sentence in a document. A tool that applied "everything pending"
 * would have installed it on the next run and nothing would have complained,
 * which is how a deliberate omission becomes an accident.
 *
 * An entry here is a decision, so adding one means saying why. It is keyed on
 * the repository file name rather than the ledger name because that is what an
 * operator reads in the directory.
 */
export const LOCAL_ONLY_MIGRATIONS = Object.freeze({
  '20260918064953_synthetic_archive_patient_import.sql':
    'Local synthetic archive import provenance. Its own header records that it '
    + 'has no source export, Auth enrollment, membership grant or production '
    + 'import path; it exists to give `tools-pennsync-archive-import.mjs` a '
    + 'receipt table in a local database. The hosted staging project was built '
    + 'without it deliberately and no deployment needs it.',
});

export class MigrateError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new MigrateError(code, detail); };

/**
 * The name a migration carries in the ledger.
 *
 * The Supabase CLI records `name` without the timestamp the file name starts
 * with, and — this is the part worth knowing — WITHOUT the timestamp matching.
 * The hosted staging project holds `independent_staging_authority` at version
 * `20260918070751` while the repository file is
 * `20260918015112_independent_staging_authority.sql`: the CLI stamped its own
 * version when the migration was pushed. So the version is not an identity and
 * matching on it would report every applied migration as pending. The name is
 * the only stable key the two sides share.
 */
export function ledgerName(fileName) {
  return fileName.replace(/\.sql$/, '').replace(/^\d+_/, '');
}

/**
 * The version this tool records for a migration it applies.
 *
 * The file's WHOLE stem, not its timestamp prefix, because the prefix is not
 * unique and `version` is the ledger's primary key. Two pairs collide today —
 * `20260920180000_chart_assignment_lifecycle` with
 * `20260920180000_contract_assignment`, and the two `20260920200000_*` files —
 * one from each migration directory, which is an ordinary thing for two
 * sequences dated the same day. Recording the prefix made the second of each
 * pair raise `unique_violation`; now that the row commits inside the
 * migration's transaction that would roll the whole migration back and abort
 * the run partway, on the real hosted target, at `contract_assignment`.
 *
 * The stem stays sortable and stays readable, and the ledger's own uniqueness
 * check is what the tool relies on.
 */
export function ledgerVersion(fileName) {
  if (!/^\d+_/.test(fileName)) refuse('MIGRATE_MIGRATION_UNVERSIONED', { file: fileName });
  return fileName.replace(/\.sql$/, '');
}

/**
 * What would be applied, given every migration and the names that have run.
 *
 * Pure, so the interesting refusals are provable without a database. `applied`
 * is ledger names; `migrations` is the provisioner's own ordered list, so the
 * two sequences cannot drift from the order a provision uses.
 */
export function planMigration({ migrations, applied }) {
  if (!Array.isArray(migrations) || !migrations.length) refuse('MIGRATE_MIGRATIONS_MISSING');
  const have = new Set(applied);

  // A ledger name has to identify one migration, or "has this run" has no
  // answer. Nothing collides today; this fails the day something does, rather
  // than silently treating one file as proof the other ran.
  const byLedgerName = new Map();
  for (const migration of migrations) {
    const name = ledgerName(migration.name);
    const seen = byLedgerName.get(name);
    if (seen) refuse('MIGRATE_NAME_COLLISION', { name, files: [seen.name, migration.name] });
    byLedgerName.set(name, migration);
  }

  // `version` is the ledger's primary key, so two migrations sharing one abort
  // the run at the second. Checked here, before anything is applied, rather
  // than discovered as a `unique_violation` half way through a deployment.
  const byVersion = new Map();
  for (const migration of migrations) {
    const version = ledgerVersion(migration.name);
    const seen = byVersion.get(version);
    if (seen) refuse('MIGRATE_VERSION_COLLISION', { version, files: [seen, migration.name] });
    byVersion.set(version, migration.name);
  }

  const pending = [];
  const skipped = [];
  const already = [];
  // Per directory, because these are two sequences rather than one sorted
  // list — an authority migration dated after a record one is ordinary, and
  // the provisioner's own comment says so.
  for (const directory of [MIGRATION_DIRECTORY, RECORD_MIGRATION_DIRECTORY]) {
    let firstPending = null;
    for (const migration of migrations.filter(candidate => candidate.from === directory)) {
      const reason = LOCAL_ONLY_MIGRATIONS[migration.name];
      if (reason) { skipped.push({ name: migration.name, reason }); continue; }
      const name = ledgerName(migration.name);
      if (have.has(name)) {
        // An applied migration sitting AFTER an unapplied one means the
        // sequence has a hole: applying the earlier file now would run it
        // against a schema the later one has already changed. That is not
        // something to repair by guessing.
        if (firstPending) refuse('MIGRATE_OUT_OF_ORDER', { applied: migration.name, after: firstPending });
        already.push(migration.name);
        continue;
      }
      firstPending ??= migration.name;
      pending.push(migration);
    }
  }

  // A name the ledger knows and the repository does not means this database
  // was migrated from a different tree. Applying more to it is not safe.
  const unknown = [...have].filter(name => !byLedgerName.has(name));
  if (unknown.length) refuse('MIGRATE_LEDGER_UNKNOWN', { names: unknown.sort() });

  return Object.freeze({
    contract: MIGRATE_CONTRACT,
    pending: pending.map(migration => migration.name),
    applied: already,
    skipped,
    plan: pending,
  });
}

/**
 * A migration's own transaction, with its ledger row inside it.
 *
 * The first version applied the migration and then inserted the ledger row as
 * a second statement, and its comment claimed "the next run's order check is
 * what catches the difference". It does not. A migration that committed
 * without being recorded leaves the ledger reading `… N-1 applied, N
 * unapplied, N+1 unapplied` — a suffix, not a hole — so `MIGRATE_OUT_OF_ORDER`
 * never fires and the next run re-executes a migration that creates schemas
 * and tables. That is the one outcome this tool exists to prevent, and it was
 * reachable through any crash or dropped connection between the two writes.
 *
 * Every committed migration is exactly `begin; … commit;`, so the record of a
 * migration can commit in the same transaction as the migration. The shape is
 * CHECKED rather than assumed: one that does not have it is refused, because
 * appending to a file that manages its own transactions differently would put
 * the insert outside any of them and restore the bug silently.
 */
export function migrationWithLedgerRow(migration) {
  const version = ledgerVersion(migration.name);
  const name = ledgerName(migration.name);
  // Interpolated into SQL, so checked rather than trusted. Both come from a
  // committed file name, but a file name is not a promise.
  if (!/^[A-Za-z0-9_]+$/.test(version) || !/^[A-Za-z0-9_]+$/.test(name)) {
    refuse('MIGRATE_MIGRATION_NAME_UNUSABLE', { file: migration.name });
  }

  // The shape is read as STATEMENTS, not as the file's first and last
  // characters: every migration opens with a `--` header, so a check anchored
  // at the start refused all sixty-nine of them.
  const lines = migration.sql.split('\n');
  const code = lines
    .map((line, index) => ({ line, index }))
    .filter(entry => entry.line.trim() !== '' && !/^\s*--/.test(entry.line));
  const first = code.at(0), last = code.at(-1);
  if (!first || !/^\s*begin\s*;/i.test(first.line) || !/commit\s*;\s*$/i.test(last.line)) {
    refuse('MIGRATE_MIGRATION_NOT_TRANSACTIONAL', { file: migration.name });
  }

  // Inserted immediately before the closing `commit;` LINE, so the row lands
  // inside the migration's own transaction rather than after it.
  const ledger = `insert into supabase_migrations.schema_migrations (version, name)`
    + `\n  values ('${version}', '${name}');`;
  return [...lines.slice(0, last.index), ledger, ...lines.slice(last.index)].join('\n');
}

/** The ledger the Supabase CLI keeps, or a refusal naming why it cannot be read. */
export async function readAppliedNames(db) {
  const { rows: present } = await db.query(`select count(*)::int as count
    from information_schema.tables
    where table_schema = 'supabase_migrations' and table_name = 'schema_migrations'`);
  // Without it there is no way to know what has run, and the migrations are
  // not written to be re-runnable — they create schemas and tables. Guessing
  // here means applying a migration twice, so this refuses instead.
  if (present[0].count !== 1) refuse('MIGRATE_LEDGER_MISSING');

  const { rows } = await db.query('select version, name from supabase_migrations.schema_migrations');
  const unnamed = rows.filter(row => typeof row.name !== 'string' || !row.name);
  // An older CLI recorded only the version, and a version is not an identity
  // here (see `ledgerName`). Nothing can be matched, so nothing is assumed.
  if (unnamed.length) refuse('MIGRATE_LEDGER_UNNAMED', { versions: unnamed.map(row => row.version) });
  return rows.map(row => row.name);
}

/** The pin, read as the store's own two layers read it. */
async function readPin(db) {
  const { rows } = await db.query(`select
      pennsync_private.deployment_app_id() as app_id,
      pennsync_private.deployment_label() as label,
      (select source from pennsync_private.deployment) as source`);
  const pin = rows[0];
  if (!pin || typeof pin.app_id !== 'string') refuse('MIGRATE_PIN_UNREADABLE', { pin: pin ?? null });
  return Object.freeze({ app_id: pin.app_id, label: pin.label, source: pin.source });
}

/**
 * `db` is anything with `query(sql, params)` and `session()`, exactly as the
 * provisioner takes, so an operator wires one connection helper for both.
 *
 * `apply` defaults to false: the default answer to "what would this do" is a
 * plan that touches nothing.
 */
export async function applyMigrations({ db, repository, apply = false, log = () => {} }) {
  const { rows: store } = await db.query(
    "select count(*)::int as count from pg_namespace where nspname = 'pennsync_private'");
  // The mirror of the provisioner's refusal, and the reason both exist: that
  // tool refuses a database that HAS a store, this one refuses a database that
  // does not. Between them every database has exactly one right tool, and
  // neither can be talked into the other's job.
  if (store[0].count === 0) refuse('MIGRATE_STORE_ABSENT');

  const migrations = readMigrations(repository);
  const plan = planMigration({ migrations, applied: await readAppliedNames(db) });

  const { rows: pinned } = await db.query(`select count(*)::int as count from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_private' and p.proname = 'deployment_app_id'`);
  const pinPending = plan.pending.some(file => ledgerName(file) === PIN_MIGRATION);

  /**
   * An absent pin is only a broken store if the migration that CREATES it has
   * already run.
   *
   * The first version refused any store without `deployment_app_id` as
   * `MIGRATE_STORE_PARTIALLY_PROVISIONED`, before it had read the ledger. That
   * rejected the one database this tool was written for: hosted staging holds
   * the first nine authority migrations, and the pin is created by
   * `20260919090000_deployment_app_pin.sql`, which is the FIRST thing pending
   * there. So Stage A and the `hosted-gap` job could not run against their own
   * target, and the suites did not notice because the fixture provisioned with
   * every authority migration — a store more convenient than the real one.
   *
   * The ledger decides now. Pin missing and its migration pending is the
   * ordinary legacy store. Pin missing and its migration already applied is a
   * provision that died part-way, which D11 says is replaced rather than
   * continued.
   */
  if (pinned[0].count !== 1 && !pinPending) refuse('MIGRATE_STORE_PARTIALLY_PROVISIONED');
  const before = pinned[0].count === 1 ? await readPin(db) : null;

  const result = {
    contract: MIGRATE_CONTRACT,
    deployment: before,
    // Said plainly rather than left to be inferred from a null deployment.
    deployment_pin_pending: pinPending,
    pending: plan.pending,
    skipped: plan.skipped,
    already_applied: plan.applied.length,
    applied: [],
  };
  if (!apply || !plan.pending.length) {
    return Object.freeze({ ...result, mutated: false });
  }

  for (const migration of plan.plan) {
    // One statement, one transaction: the schema change and the record of it
    // commit together or neither does, so a crash between them cannot leave a
    // migration applied and unrecorded for the next run to repeat.
    await db.session(session => session.exec(migrationWithLedgerRow(migration)));
    result.applied.push(migration.name);
    log(`applied ${migration.name}`);
  }

  const after = await readPin(db);
  // Nothing above is supposed to be able to move a pin that already existed,
  // which is the reason to check: the pin is what keeps one deployment's PHI
  // out of another's database. Where there was none, the run just created it,
  // so what matters is that it came out pinned somewhere known — an unset
  // setting defaults to staging, the restrictive outcome.
  if (before && (after.app_id !== before.app_id || after.label !== before.label)) {
    refuse('MIGRATE_PIN_MOVED', { before, after });
  }
  return Object.freeze({ ...result, deployment: after, mutated: true });
}

/** The operator entry point. */
export async function runMigrateCli({ env = process.env, argv = process.argv.slice(2),
  write = console.log, error = console.error, connect = null,
  repository = resolve(dirname(fileURLToPath(import.meta.url))) } = {}) {
  const open = connect ?? (async url => {
    const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
    const { Client } = require('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  });
  let primary = null;
  try {
    const url = env.PENNSYNC_MIGRATE_DATABASE_URL;
    if (typeof url !== 'string' || !url) refuse('MIGRATE_TARGET_REQUIRED');
    const apply = argv.includes('--apply');
    primary = await open(url);
    const result = await applyMigrations({
      db: {
        query: (sql, params = []) => primary.query(sql, params),
        session: async run => {
          const session = await open(url);
          try {
            return await run({
              query: (sql, params = []) => session.query(sql, params),
              exec: sql => session.query(sql),
            });
          } finally { await session.end?.(); }
        },
      },
      repository,
      apply,
      log: message => write(message),
    });
    write(JSON.stringify(result, null, 2));
    return 0;
  } catch (failure) {
    // Codes only: a diagnostic here must not carry a connection string.
    error(JSON.stringify({ error: failure?.code ?? 'MIGRATE_FAILED', detail: failure?.detail ?? null }));
    return 1;
  } finally { await primary?.end?.(); }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runMigrateCli();
}
