#!/usr/bin/env node
/**
 * Pin a fresh authority store to the app it will serve, then migrate it.
 *
 * D11 makes the deployment pin a generated IMMUTABLE constant read by both
 * containment layers, which is what stops one deployment holding another's
 * PHI. The cost of that design is that the pin is decided once, before the
 * first migration runs, and cannot be edited afterwards: a mis-pinned database
 * is replaced, not corrected. Done by hand that is a single irreversible step
 * with no second chance, so this does it as a checked sequence instead.
 *
 * The order is the whole point:
 *
 *   1. refuse an app that is not one a deployment may serve, before anything
 *      is created;
 *   2. refuse a database that already holds `pennsync_private`, so a second
 *      run cannot half-migrate a live store;
 *   3. set `pennsync.deployment_app_id`;
 *   4. read it back FROM A NEW SESSION and refuse if it did not stick — an
 *      `alter database ... set` only reaches sessions opened after it, so a
 *      tool that trusts its own write would migrate against the default;
 *   5. only then apply the migrations, in name order;
 *   6. prove the store came out pinned where it was asked to be.
 *
 * Step 4 is the one that earns the tool. Skipping it is how a database gets
 * silently pinned to staging — the restrictive default — and is discovered
 * only when production writes start failing.
 *
 * It provisions; it does not create a hosted project, hold a credential, or
 * write a row. No identity is enrolled here: that is `tools-pennsync-enroll.mjs`,
 * and it requires the people to have accepted their invitations first.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PROVISION_CONTRACT = 'cm.pennsync.provision.v1';
export const MIGRATION_DIRECTORY = join('services', 'authority-store', 'supabase', 'migrations');
/**
 * The record store, applied after the authority store it asks about. It is a
 * separate directory because it is a separate store with its own owner, and
 * because the authority harnesses apply their directory wholesale and have no
 * use for 156 record tables. Provisioning a deployment needs both.
 */
export const RECORD_MIGRATION_DIRECTORY =
  join('services', 'authority-store', 'supabase', 'record-migrations');
/** The setting the migration reads once, to generate the pin from. */
export const PIN_SETTING = 'pennsync.deployment_app_id';
/**
 * The apps a deployment may be pinned to, and the label each one carries.
 * The legacy PennSync app is deliberately absent: it is retired, and no
 * deployment may be pointed at it even on purpose. This mirrors
 * `pennsync_private.known_app`, and a test fails if the two disagree.
 */
export const KNOWN_APPS = Object.freeze({
  '6a9881683dc68a0bd54f1ef7': 'staging',
  '694ec16e72e01b60d22f7cbf': 'production',
});
export const RETIRED_APP = '68ee80d98929370f9e8f2932';
const APP_ID = /^[a-f0-9]{24}$/;

export class ProvisionError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}
const refuse = (code, detail) => { throw new ProvisionError(code, detail); };

/** The label a requested app will carry, or a refusal naming why it cannot. */
export function planProvision(requestedApp) {
  if (typeof requestedApp !== 'string' || !APP_ID.test(requestedApp)) refuse('PROVISION_APP_MALFORMED');
  if (requestedApp === RETIRED_APP) refuse('PROVISION_APP_RETIRED');
  const label = KNOWN_APPS[requestedApp];
  if (!label) refuse('PROVISION_APP_UNKNOWN');
  return Object.freeze({ contract: PROVISION_CONTRACT, app_id: requestedApp, label });
}

/**
 * One migration's text, with Windows line endings undone.
 *
 * The bytes of a migration are not formatting. Postgres stores a function's
 * body verbatim and the hosted comparison reads `md5(prosrc)`, so a store built
 * from a checkout carrying CRLF differs from one built here in every function
 * it created — while the ledger, which keys on the file NAME, records both as
 * having run the same migration. That is D88's shape arriving through the line
 * ending, and it happened: four migrations applied from a Windows checkout on
 * 2026-09-23 wrote `\r\n` into eight function bodies, and the hosted job
 * reported 20 of 21 with nothing in the ledger to explain the one.
 *
 * `.gitattributes` now pins `eol=lf`, which protects a checkout made after it
 * lands and none made before, so the reader undoes it here as well. This is
 * where it belongs rather than in the migrate tool, because `applyProvision`
 * reads through the same function and a FRESH store built on Windows would
 * otherwise carry the difference in from its first migration.
 *
 * A carriage return that is not part of a line ending is REFUSED rather than
 * stripped. `core.autocrlf` only ever writes `\r\n`, so a lone one is a real
 * difference in the file, and quietly removing it is how a store comes to hold
 * something nobody wrote. No committed migration contains one; a test asserts
 * that, so this refusal names a working tree that has been edited rather than
 * checked out.
 */
function readMigrationSql(path) {
  const sql = readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
  if (sql.includes('\r')) refuse('PROVISION_MIGRATION_CARRIAGE_RETURN', path);
  return sql;
}

/** The migrations, in the order the store expects them applied. */
export function readMigrations(repository) {
  const read = relative => {
    const directory = join(resolve(repository), relative);
    return readdirSync(directory).filter(name => name.endsWith('.sql')).sort()
      // `from` names the directory, so the order can be checked as the two
      // sequences it actually is. It stopped being one sorted list the moment
      // an authority migration was dated after a record one, which is a
      // perfectly ordinary thing to need and had been true only by accident.
      .map(name => ({ name, from: relative, sql: readMigrationSql(join(directory, name)) }));
  };
  // Authority first: every record policy is written in terms of
  // `pennsync_private`, and the record store refuses a database without it.
  const migrations = [...read(MIGRATION_DIRECTORY), ...read(RECORD_MIGRATION_DIRECTORY)];
  if (!migrations.length) refuse('PROVISION_MIGRATIONS_MISSING');
  return migrations;
}

/**
 * `db` is anything with `query(sql, params)` and `session()`, where `session`
 * yields a connection opened after the statements so far. The pin is read back
 * through one of those, never through the connection that wrote it.
 */
export async function applyProvision({ db, requestedApp, repository, log = () => {} }) {
  const plan = planProvision(requestedApp);
  const migrations = readMigrations(repository);

  const { rows: existing } = await db.query(
    "select count(*)::int as count from pg_namespace where nspname = 'pennsync_private'");
  if (existing[0].count !== 0) {
    // Each migration commits on its own, so a run that died part-way leaves
    // the schema behind and this refusal is all the operator sees. Say which
    // it is, because a complete store must never be re-provisioned while a
    // half-written one cannot be repaired in place — under D11 the pin is
    // already generated, so that database is replaced, not continued.
    const { rows: pinned } = await db.query(`select count(*)::int as count from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'pennsync_private' and p.proname = 'deployment_app_id'`);
    refuse(pinned[0].count === 1 ? 'PROVISION_STORE_ALREADY_PRESENT' : 'PROVISION_STORE_PARTIALLY_PRESENT');
  }

  // `alter database ... set` is a utility statement: PostgreSQL does not
  // accept a bind parameter for the value, so this is a literal. It is safe
  // to interpolate because planProvision has already required the app id to
  // match /^[a-f0-9]{24}$/ AND to be one of the two known apps — a value that
  // could carry a quote never reaches here.
  await db.query(`alter database ${await currentDatabase(db)} set ${PIN_SETTING} = '${plan.app_id}'`);

  // A new session, because `alter database ... set` does not reach this one.
  const confirmed = await db.session(async session => {
    const { rows } = await session.query(`select current_setting($1, true) as value`, [PIN_SETTING]);
    return rows[0]?.value ?? null;
  });
  if (confirmed !== plan.app_id) refuse('PROVISION_PIN_DID_NOT_STICK', { wanted: plan.app_id, read: confirmed });
  log(`pin set and confirmed: ${plan.app_id} (${plan.label})`);

  for (const migration of migrations) {
    await db.session(session => session.exec(migration.sql));
    log(`applied ${migration.name}`);
  }

  const { rows: settled } = await db.query(`select
      pennsync_private.deployment_app_id() as app_id,
      pennsync_private.deployment_label() as label,
      (select source from pennsync_private.deployment) as source`);
  const got = settled[0];
  if (got.app_id !== plan.app_id || got.label !== plan.label) {
    refuse('PROVISION_PIN_MISMATCH', { wanted: plan, got });
  }
  // `default` here would mean the setting was not visible when the migration
  // read it, so the store is pinned to staging whatever was asked for.
  if (got.source !== 'setting') refuse('PROVISION_PIN_DEFAULTED', { got });

  return Object.freeze({ ...plan, migrations: migrations.map(migration => migration.name), source: got.source });
}

async function currentDatabase(db) {
  const { rows } = await db.query('select current_database() as name');
  const name = rows[0]?.name;
  // Interpolated into DDL, so it is checked rather than trusted.
  if (typeof name !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(name)) refuse('PROVISION_DATABASE_NAME_UNUSABLE');
  return `"${name}"`;
}

/**
 * The operator entry point.
 *
 * `session` opens a genuinely new connection each time, which is the only way
 * the pin read-back means anything: `alter database ... set` reaches sessions
 * opened after it, so asking the connection that wrote it would always agree
 * with itself.
 */
export async function runProvisionCli({ env = process.env, write = console.log, error = console.error,
  connect = null, repository = resolve(dirname(fileURLToPath(import.meta.url))) } = {}) {
  const open = connect ?? (async url => {
    const require = createRequire(new URL('./services/authority-store/package.json', import.meta.url));
    const { Client } = require('pg');
    const client = new Client({ connectionString: url });
    await client.connect();
    return client;
  });
  let primary = null;
  try {
    const url = env.PENNSYNC_PROVISION_DATABASE_URL;
    const requestedApp = env.PENNSYNC_PROVISION_APP_ID;
    if (typeof url !== 'string' || !url) refuse('PROVISION_TARGET_REQUIRED');
    // Checked before a connection is opened, so an unusable app id costs
    // nothing and cannot reach a database at all.
    const plan = planProvision(requestedApp);
    primary = await open(url);
    const result = await applyProvision({
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
      requestedApp: plan.app_id,
      repository,
      log: message => write(message),
    });
    write(JSON.stringify(result, null, 2));
    return 0;
  } catch (failure) {
    // Codes only: a diagnostic here must not carry a connection string.
    error(JSON.stringify({ error: failure?.code ?? 'PROVISION_FAILED', detail: failure?.detail ?? null }));
    return 1;
  } finally { await primary?.end?.(); }
}

// Direct-invocation check through pathToFileURL: a hand-built `file://`
// string never matches a Windows backslash path or a percent-encoded one,
// and the CLI then exits 0 having silently done nothing.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runProvisionCli();
}
