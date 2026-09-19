import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import {
  KNOWN_APPS, PIN_SETTING, ProvisionError, RETIRED_APP,
  applyProvision, planProvision, readMigrations,
} from '../../../tools-pennsync-provision.mjs';

/**
 * D11 makes the pin unchangeable once the first migration has run, so a
 * mis-pinned database is replaced rather than corrected. Every case here is
 * about the sequence refusing before it reaches that point.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const PRODUCTION = '694ec16e72e01b60d22f7cbf';
const STAGING = '6a9881683dc68a0bd54f1ef7';

/** PGlite is one connection, so `session` models a new one by re-reading the
 *  database-level setting the way a fresh connection would see it. */
function harness(db) {
  let pinned = null;
  return {
    query: async (sql, params = []) => {
      if (/alter database .* set /i.test(sql)) { pinned = params[0]; return { rows: [] }; }
      return db.query(sql, params);
    },
    session: async run => run({
      query: async (sql, params = []) => (/current_setting/.test(sql) && params[0] === PIN_SETTING
        ? { rows: [{ value: pinned }] }
        : db.query(sql, params)),
      exec: async sql => db.exec(
        // The migration reads the setting once; a new session would have it.
        pinned ? `set ${PIN_SETTING} = '${pinned}';\n${sql}` : sql),
    }),
    get pinned() { return pinned; },
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
  const names = readMigrations(repository).map(migration => migration.name);
  assert.deepEqual(names, [...names].sort(), 'name order is the apply order');
  assert.ok(names[0].startsWith('20260918015112'), 'the authority schema comes first');
  assert.ok(names.includes('20260919090000_deployment_app_pin.sql'));
});
