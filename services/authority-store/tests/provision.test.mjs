import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  KNOWN_APPS, PIN_SETTING, ProvisionError, RETIRED_APP,
  applyProvision, planProvision, readMigrations, runProvisionCli,
} from '../../../tools-pennsync-provision.mjs';
import { RECORD_MIGRATION_FILE } from '../../../tools-entity-schema-plan.mjs';
import { BROKER_MIGRATION_FILE } from '../../../tools-record-brokers.mjs';

/**
 * D11 makes the pin unchangeable once the first migration has run, so a
 * mis-pinned database is replaced rather than corrected. Every case here is
 * about the sequence refusing before it reaches that point.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PRODUCTION = '694ec16e72e01b60d22f7cbf';
const STAGING = '6a9881683dc68a0bd54f1ef7';

/**
 * The `alter database ... set` runs for real, because that statement is a
 * utility statement that does not accept a bind parameter and an earlier
 * version of this harness intercepted it — so the test passed while the
 * production path would have failed at `$1`.
 *
 * PGlite is a single connection, and `alter database ... set` only reaches
 * sessions opened after it, so `session` models a new one by reading what the
 * statement actually persisted in `pg_db_role_setting` — which is exactly what
 * a fresh connection would inherit — rather than by being told the answer.
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
        // A new session would already carry the database default.
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
const rejects = (promise, code) => assert.rejects(promise,
  error => error instanceof ProvisionError && error.code === code, `expected ${code}`);

test('only an app a deployment may serve is planned, and the retired one never is', () => {
  assert.deepEqual(planProvision(PRODUCTION), { contract: 'cm.pennsync.provision.v1', app_id: PRODUCTION, label: 'production' });
  assert.equal(planProvision(STAGING).label, 'staging');
  assert.throws(() => planProvision(RETIRED_APP), error => error.code === 'PROVISION_APP_RETIRED');
  assert.throws(() => planProvision('a'.repeat(24)), error => error.code === 'PROVISION_APP_UNKNOWN');
  for (const bad of ['', 'not-hex', PRODUCTION.toUpperCase(), null, undefined]) {
    assert.throws(() => planProvision(bad), error => error.code === 'PROVISION_APP_MALFORMED', `${bad}`);
  }
});

test('the known apps agree with the ones the store itself admits', async () => {
  // Drift here would let this tool pin a database the migration then refuses,
  // or refuse one it would have accepted.
  const sql = await readFile(
    new URL('../supabase/migrations/20260919090000_deployment_app_pin.sql', import.meta.url), 'utf8');
  const declared = [...sql.matchAll(/\('([a-f0-9]{24})',\s*'(staging|production)'\)/g)]
    .map(([, app, label]) => [app, label]);
  assert.deepEqual(Object.fromEntries(declared), KNOWN_APPS);
  // The migration names the retired app in a comment, to record that leaving
  // it out is deliberate. What must not happen is it appearing as a value.
  assert.ok(!declared.some(([app]) => app === RETIRED_APP),
    'the retired app must not be admittable by the store either');
  assert.ok(sql.includes(RETIRED_APP), 'and the migration should still say why it is absent');
});

test('a production pin survives the migrations and is recorded as chosen, not defaulted', async () => {
  const db = await fresh();
  try {
    const result = await applyProvision({ db: harness(db), requestedApp: PRODUCTION, repository });
    assert.equal(result.label, 'production');
    assert.equal(result.source, 'setting');
    assert.ok(result.migrations.length >= 12);

    const { rows } = await db.query(`select pennsync_private.deployment_app_id() as app,
      pennsync_private.deployment_label() as label`);
    assert.deepEqual(rows[0], { app: PRODUCTION, label: 'production' });
    // The containment that pin exists for: the other app is refused outright.
    const { rows: admitted } = await db.query(
      `select pennsync_private.app_admitted($1) as production, pennsync_private.app_admitted($2) as staging`,
      [PRODUCTION, STAGING]);
    assert.deepEqual(admitted[0], { production: true, staging: false });
  } finally { await db.close(); }
});

test('the pin statement is one a real PostgreSQL accepts, not one the harness swallowed', async () => {
  const db = await fresh();
  try {
    // `alter database ... set` takes no bind parameter. Running it for real is
    // the only way this test can tell a working statement from a broken one.
    await applyProvision({ db: harness(db), requestedApp: STAGING, repository });
    assert.equal(await persistedPin(db), STAGING, 'the setting must actually be persisted on the database');
  } finally { await db.close(); }
});

test('a half-provisioned store is named as such rather than looking finished', async () => {
  const db = await fresh();
  try {
    // A run that died after the first migration: the schema exists, the pin
    // function does not. Under D11 that database is replaced, not continued,
    // so the refusal has to say which case it is.
    await db.exec('create schema pennsync_private');
    await rejects(applyProvision({ db: harness(db), requestedApp: STAGING, repository }),
      'PROVISION_STORE_PARTIALLY_PRESENT');
  } finally { await db.close(); }
});

test('a pin that did not stick stops the run before a single migration is applied', async () => {
  const db = await fresh();
  try {
    const broken = harness(db);
    // A database whose setting silently does not take: the exact failure the
    // read-back exists to catch, and the one that would otherwise produce a
    // store pinned to staging while its operator believed it was production.
    broken.session = async run => run({
      query: async () => ({ rows: [{ value: null }] }),
      exec: async () => assert.fail('no migration may run once the pin is unconfirmed'),
    });
    await rejects(applyProvision({ db: broken, requestedApp: PRODUCTION, repository }), 'PROVISION_PIN_DID_NOT_STICK');
    const { rows } = await db.query("select count(*)::int as count from pg_namespace where nspname = 'pennsync_private'");
    assert.equal(rows[0].count, 0, 'nothing may be created when the pin is unconfirmed');
  } finally { await db.close(); }
});

test('an already provisioned store is refused rather than migrated twice', async () => {
  const db = await fresh();
  try {
    await applyProvision({ db: harness(db), requestedApp: STAGING, repository });
    await rejects(applyProvision({ db: harness(db), requestedApp: STAGING, repository }), 'PROVISION_STORE_ALREADY_PRESENT');
    // And a second run cannot repoint a live store at the other app.
    await rejects(applyProvision({ db: harness(db), requestedApp: PRODUCTION, repository }), 'PROVISION_STORE_ALREADY_PRESENT');
  } finally { await db.close(); }
});

test('the migrations are read in the order the store expects', () => {
  const migrations = readMigrations(repository);
  const names = migrations.map(migration => migration.name);
  // Two sequences, not one: the authority store's directory then the record
  // store's, each in name order. It read as one sorted list until an authority
  // migration was dated after a record one — which is an ordinary thing to
  // need, and which the old assertion would have read as a reordering.
  const directories = [...new Set(migrations.map(migration => migration.from))];
  assert.equal(directories.length, 2, 'the two directories are applied in sequence');
  for (const directory of directories) {
    const within = migrations.filter(migration => migration.from === directory).map(migration => migration.name);
    assert.deepEqual(within, [...within].sort(), `${directory} is applied in name order`);
  }
  const boundary = migrations.findIndex(migration => migration.from === directories[1]);
  assert.ok(migrations.slice(boundary).every(migration => migration.from === directories[1]),
    'every authority migration precedes every record migration');
  assert.ok(names[0].startsWith('20260918015112'), 'the authority schema comes first');
  assert.ok(names.includes('20260919090000_deployment_app_pin.sql'));
  // The record store lives in its own directory, so nothing discovers it by
  // walking the authority migrations. Provisioning is what gives a real
  // deployment all three, and the order between them is not cosmetic: every
  // record policy is written in terms of `pennsync_private` and the record
  // migration refuses a database without it, while the broker migration
  // refuses a database with no record schema and no owner to act as. Asserted
  // as a relation rather than a fixed tail, so adding a fourth does not need
  // this line rewritten — only kept true.
  const record = RECORD_MIGRATION_FILE.split('/').pop();
  const brokers = BROKER_MIGRATION_FILE.split('/').pop();
  for (const name of [record, brokers]) assert.equal(names.filter(entry => entry === name).length, 1);
  assert.ok(names.indexOf(record) > names.indexOf('20260919090000_deployment_app_pin.sql'),
    'the record store is applied after the authority store');
  assert.ok(names.indexOf(brokers) > names.indexOf(record),
    'the brokers are applied after the tables they broker');
  // Everything else in the directory comes after the generated store it
  // extends: each one refuses a database without `caller_tenant_role`, so the
  // order is enforced by the migrations themselves and asserted here so a
  // reordering is caught before a deployment discovers it. Stated as "every
  // other file" rather than as a list of prefixes, because a migration added
  // under a name nobody thought to pattern-match would otherwise be the one
  // case this does not check.
  const inRecordDirectory = migrations
    .filter(migration => migration.from === directories[1]).map(migration => migration.name);
  assert.ok(inRecordDirectory.includes(record), 'the record store is in the record directory');
  for (const name of inRecordDirectory.filter(entry => entry !== record)) {
    assert.ok(names.indexOf(name) > names.indexOf(record), `${name} must follow the record store`);
  }
});

test('the command line refuses before it opens a connection, and reports codes only', async () => {
  const said = [];
  const never = () => assert.fail('no database may be opened');

  assert.equal(await runProvisionCli({ env: {}, error: m => said.push(m), write: () => {}, connect: never }), 1);
  assert.equal(await runProvisionCli({
    env: { PENNSYNC_PROVISION_DATABASE_URL: 'postgres://secret:hunter2@host/db' },
    error: m => said.push(m), write: () => {}, connect: never,
  }), 1);
  // An unusable app id is caught before a connection is opened, so a typo
  // never reaches a database.
  assert.equal(await runProvisionCli({
    env: { PENNSYNC_PROVISION_DATABASE_URL: 'postgres://host/db', PENNSYNC_PROVISION_APP_ID: RETIRED_APP },
    error: m => said.push(m), write: () => {}, connect: never,
  }), 1);

  assert.deepEqual(said.map(line => JSON.parse(line).error),
    ['PROVISION_TARGET_REQUIRED', 'PROVISION_APP_MALFORMED', 'PROVISION_APP_RETIRED']);
  // A connection string must never reach a diagnostic.
  assert.ok(!said.join(' ').includes('hunter2'), 'no credential may appear in output');
});

test('the command line provisions a real database end to end', async () => {
  const db = await fresh();
  const written = [];
  try {
    // `session` must open a NEW connection; PGlite has one, so the adapter is
    // handed the same handle and the pin is read back the way the harness
    // above models a fresh connection.
    const code = await runProvisionCli({
      env: { PENNSYNC_PROVISION_DATABASE_URL: 'pglite://test', PENNSYNC_PROVISION_APP_ID: PRODUCTION },
      write: line => written.push(line),
      error: line => assert.fail(`unexpected failure: ${line}`),
      connect: async () => harnessClient(db),
      repository,
    });
    assert.equal(code, 0);
    const receipt = JSON.parse(written.at(-1));
    assert.equal(receipt.label, 'production');
    assert.equal(receipt.source, 'setting');
    const { rows } = await db.query('select pennsync_private.deployment_label() as label');
    assert.equal(rows[0].label, 'production');
  } finally { await db.close(); }
});

/** A client-shaped façade over PGlite for the CLI adapter. */
function harnessClient(db) {
  return {
    query: async (sql, params = []) => {
      if (/current_setting/.test(sql) && params[0] === PIN_SETTING) {
        return { rows: [{ value: await persistedPin(db) }] };
      }
      // A migration body is many statements, which the extended protocol
      // cannot carry; only a single read goes through `query`.
      const first = sql.replace(/^(\s|--[^\n]*\n)+/, '').slice(0, 6).toLowerCase();
      if (params.length || first.startsWith('select')) return db.query(sql, params);
      // PGlite is one session, so the database default set moments ago is not
      // visible to it. A real new connection would inherit it. Without this the
      // tool correctly refuses with PROVISION_PIN_MISMATCH and source 'default'
      // — the exact failure it exists to catch, which is reassuring to have
      // seen — so the compensation is the harness's, not the tool's.
      const pinned = await persistedPin(db);
      await db.exec(pinned ? `set ${PIN_SETTING} = '${pinned}';\n${sql}` : sql);
      return { rows: [] };
    },
    end: async () => {},
  };
}
