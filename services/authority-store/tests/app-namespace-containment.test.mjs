import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

/**
 * What keeps one deployment of this store from holding another app's rows.
 *
 * The store pins its app id in two independent places, and both are
 * load-bearing. Storage side: every app-scoped column is typed
 * `pennsync_private.deployment_app`, a domain whose CHECK admits exactly the app
 * this database serves, so a row for another app cannot be written even by a
 * caller that bypassed every RPC. Entry side: `pennsync_private.actor()` refuses
 * any other app id before it reads anything, and every read path calls it.
 *
 * Until `20260919090000_deployment_app_pin.sql` both layers were the staging app
 * id written as a literal, which meant nothing could be enrolled for production
 * without editing the schema, and widening the literal into a set would have let
 * one database hold both. So the literal became a pin: `pennsync_private.
 * deployment` names the single app this database serves, written once from
 * `pennsync.deployment_app_id` and immutable afterwards, and both layers read it.
 * The migration text is now identical in every deployment; what differs is one
 * row that cannot be edited.
 *
 * That makes the containment a property of the pin rather than of the file, so
 * it is proved here against two databases built from the same migrations: one
 * defaulted to staging, one pinned to production. Each must admit its own app
 * and refuse the other's, at both layers.
 *
 * This widening opened enrollment, not PHI. The synthetic-shape constraints are
 * untouched and are asserted below to still refuse real names in a
 * production-pinned database; relaxing those is a separate migration.
 */
const STAGING_APP = '6a9881683dc68a0bd54f1ef7';
const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
/** Retired, and deliberately not in the known-app registry, so unpinnable. */
const LEGACY_APP = '68ee80d98929370f9e8f2932';
/** Excluded from the identity map by its own check: setup and recovery only. */
const PLATFORM_OWNER = '6a98816d3dc68a0bd54f1ef8';

/**
 * Builds a database the way a deployment does: bootstrap, then every migration
 * in order, with the deployment pin supplied (or not) beforehand.
 */
async function deploy(requestedApp) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  if (requestedApp !== undefined) {
    await db.query('select set_config($1,$2,false)', ['pennsync.deployment_app_id', requestedApp]);
  }
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
  return db;
}

let staging, production;

before(async () => {
  // No setting at all: the default path every environment takes today.
  staging = await deploy();
  production = await deploy(PRODUCTION_APP);
});
after(async () => { await staging?.close(); await production?.close(); });

const admits = async (db, value) => {
  try {
    await db.query('select $1::text::pennsync_private.deployment_app', [value]);
    return true;
  } catch { return false; }
};

test('each deployment records the one app it serves, and says how it was chosen', async () => {
  assert.deepEqual((await staging.query('select app_id, source from pennsync_private.deployment')).rows,
    [{ app_id: STAGING_APP, source: 'default' }],
    'an unset pin must default to staging: the restrictive outcome, not production');
  assert.deepEqual((await production.query('select app_id, source from pennsync_private.deployment')).rows,
    [{ app_id: PRODUCTION_APP, source: 'setting' }]);
  // The registry is what may be pinned. The legacy app is absent on purpose, so
  // no deployment can be pointed at it even deliberately.
  const known = await staging.query('select app_id, label from pennsync_private.known_app order by label');
  assert.deepEqual(known.rows, [{ app_id: PRODUCTION_APP, label: 'production' }, { app_id: STAGING_APP, label: 'staging' }]);
});

test('an unrecognised pin fails the migration instead of producing an uncontained store', async () => {
  for (const value of [LEGACY_APP, PLATFORM_OWNER, 'not-an-app', STAGING_APP.toUpperCase(), `${STAGING_APP}x`]) {
    await assert.rejects(deploy(value), /PENNSYNC_UNKNOWN_DEPLOYMENT_APP/,
      `${JSON.stringify(value)} must not be pinnable`);
  }
});

test('the app domain admits the pinned app and nothing else, in either deployment', async () => {
  assert.equal(await admits(staging, STAGING_APP), true);
  assert.equal(await admits(staging, PRODUCTION_APP), false, 'production must not be storable in staging');
  assert.equal(await admits(production, PRODUCTION_APP), true, 'the widening must actually admit production');
  assert.equal(await admits(production, STAGING_APP), false, 'staging must not be storable in production');
  for (const db of [staging, production]) {
    for (const value of ['', ' ', LEGACY_APP, PLATFORM_OWNER, STAGING_APP.toUpperCase(),
      `${STAGING_APP} `, `${STAGING_APP}x`, STAGING_APP.slice(0, -1)]) {
      assert.equal(await admits(db, value), false, `${JSON.stringify(value)} must not be admitted`);
    }
  }
});

test('the pin is written once and cannot be edited, which is what makes the domain sound', async () => {
  // The domain CHECK calls a STABLE function that reads this row. That is only
  // safe because the answer can never change: a mutable pin would leave rows
  // already written under the old app id sitting in a database that now claims
  // another. Every route to changing it must be closed.
  for (const statement of [
    `update pennsync_private.deployment set app_id = '${PRODUCTION_APP}'`,
    'delete from pennsync_private.deployment',
    'truncate pennsync_private.deployment',
  ]) {
    await assert.rejects(staging.exec(statement), /PENNSYNC_IMMUTABLE_DEPLOYMENT/, statement);
  }
  // A second pin would make "the" pinned app ambiguous.
  await assert.rejects(staging.query(
    `insert into pennsync_private.deployment (app_id, source) values ($1,'setting')`, [PRODUCTION_APP]));
  // And removing the registry row the pin points at is refused by the reference.
  await assert.rejects(staging.query('delete from pennsync_private.known_app where app_id = $1', [STAGING_APP]));
});

test('every app-scoped column carries the domain rather than plain text', async () => {
  // A new table typing app_id as text would sit outside the containment
  // entirely, so the count is pinned: adding one is a deliberate act.
  const scoped = await staging.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and domain_name = 'deployment_app' order by table_name, column_name`);
  assert.equal(scoped.rows.length, 18, 'the number of app-scoped columns changed');
  // Exactly one per table: no table carries a second, separately typed app id.
  assert.equal(new Set(scoped.rows.map(r => r.table_name)).size, scoped.rows.length);
  for (const name of ['identity_map', 'agency', 'membership', 'patient', 'assignment',
    'patient_disclosure_audit', 'visit_disclosure_audit', 'visit_list_disclosure_audit']) {
    assert.ok(scoped.rows.some(r => r.table_name === name), `${name} must stay app-scoped`);
  }
  // Nothing else in the schema names an app id without going through the domain.
  // The two exceptions are the tables that *define* the namespace: they cannot be
  // typed by the domain whose admitted value they are.
  const loose = await staging.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and column_name like '%app_id%'
      and domain_name is distinct from 'deployment_app'
      and table_name not in ('known_app','deployment')`);
  assert.deepEqual(loose.rows, [], 'an app id column escaped the domain');
  const registry = await staging.query(`select table_name, data_type, domain_name from information_schema.columns
    where table_schema = 'pennsync_private' and column_name = 'app_id'
      and table_name in ('known_app','deployment') order by table_name`);
  assert.deepEqual(registry.rows, [
    { table_name: 'deployment', data_type: 'text', domain_name: null },
    { table_name: 'known_app', data_type: 'text', domain_name: null },
  ], 'the namespace definition must stay the only untyped app id, and stay narrow');
});

test('a row for the wrong app is refused by the database, not by a caller', async () => {
  // The refusal must come from the store itself: a service that forgot to
  // check, or a compromised one, still cannot write another app's identity.
  // The native user exists first, so the app id is the only thing left to
  // refuse on -- otherwise a rejection could just be the missing foreign key.
  const AUTH_USER = '11111111-2222-3333-4444-555555555555';
  for (const db of [staging, production]) {
    await db.query(`insert into auth.users (id, email, email_confirmed_at)
      values ($1, 'someone@example.test', now())`, [AUTH_USER]);
  }
  const enroll = (db, app, userId) => db.query(
    `insert into pennsync_private.identity_map
       (app_id, auth_user_id, base44_user_id, expected_email, source_evidence_sha256, verified_at)
     values ($1, $2, $3, 'someone@example.test', repeat('a', 64), now())`,
    [app, AUTH_USER, userId]);
  await assert.rejects(enroll(staging, PRODUCTION_APP, 'a'.repeat(24)));
  await assert.rejects(enroll(production, STAGING_APP, 'a'.repeat(24)));
  // And the platform owner stays refused under each deployment's own app id.
  await assert.rejects(enroll(staging, STAGING_APP, PLATFORM_OWNER));
  await assert.rejects(enroll(production, PRODUCTION_APP, PLATFORM_OWNER));
  // The pinned app reaches past the domain: production enrollment is what this
  // migration exists to allow, so it must actually succeed there. Nothing before
  // this change could write this row at all.
  await enroll(production, PRODUCTION_APP, 'a'.repeat(24));
  assert.equal((await production.query('select count(*)::int n from pennsync_private.identity_map')).rows[0].n, 1);
  assert.equal((await staging.query('select count(*)::int n from pennsync_private.identity_map')).rows[0].n, 0);
});

test('the entry gate follows the same pin, so the two layers cannot drift', async () => {
  // `actor()` is the first call on every read path. It now asks the pin rather
  // than comparing a literal, so a widening that touched only the domain, or
  // only this gate, is no longer expressible: there is one source of truth.
  for (const [db, own, other] of [[staging, STAGING_APP, PRODUCTION_APP], [production, PRODUCTION_APP, STAGING_APP]]) {
    await db.exec('reset role');
    for (const app of [other, LEGACY_APP, '', 'not-an-app', null]) {
      await assert.rejects(db.query('select pennsync_private.actor($1, false)', [app]),
        /PENNSYNC_APP_NOT_ADMITTED/, `actor() must refuse ${JSON.stringify(app)}`);
    }
    // The pinned app reaches past the app check and fails on the caller
    // instead: no JWT is set here, so there is no identity to resolve.
    await assert.rejects(db.query('select pennsync_private.actor($1, false)', [own]),
      /PENNSYNC_SESSION_REQUIRED/);
  }
});

test('opening the namespace did not open the store to real names', async () => {
  // The synthetic-shape constraints are a separate containment control on a
  // separate schedule. Until their own migration lands, a production-pinned
  // database can enroll identities and still cannot hold a real agency or
  // patient name -- which is the honest limit of what this change unblocked.
  await assert.rejects(production.query(
    `insert into pennsync_private.agency (app_id, id, name, status) values ($1,'agency-real','Penn Home Health','active')`,
    [PRODUCTION_APP]), 'a real agency name must still be refused');
  await production.query(
    `insert into pennsync_private.agency (app_id, id, name, status) values ($1,'agency-a','Synthetic Agency A','active')`,
    [PRODUCTION_APP]);
  await assert.rejects(production.query(
    `insert into pennsync_private.patient (app_id, id, agency_id, display_name) values ($1,'patient-real','agency-a','Jane Doe')`,
    [PRODUCTION_APP]), 'a real patient name must still be refused');
});

test('an enrolled identity must carry its evidence hash and a coherent revocation', async () => {
  // The enrollment tool Phase 1 calls for writes these rows. Pinning the
  // column contract now means that tool is built against a known shape.
  const columns = await staging.query(`select column_name, is_nullable from information_schema.columns
    where table_schema = 'pennsync_private' and table_name = 'identity_map' order by column_name`);
  const required = Object.fromEntries(columns.rows.map(r => [r.column_name, r.is_nullable]));
  for (const name of ['app_id', 'auth_user_id', 'base44_user_id', 'expected_email',
    'source_evidence_sha256', 'verified_at', 'enabled', 'version']) {
    assert.equal(required[name], 'NO', `${name} must stay required`);
  }
  assert.equal(required.revoked_at, 'YES');
  // Evidence must be a real digest, and enabled/revoked cannot disagree.
  const insert = (patch = {}) => {
    const row = {
      app: STAGING_APP, uid: 'b'.repeat(24), email: 'enrolled@example.test',
      evidence: 'c'.repeat(64), enabled: true, revoked: null, ...patch,
    };
    return staging.query(
      `insert into pennsync_private.identity_map
         (app_id, auth_user_id, base44_user_id, expected_email, source_evidence_sha256, verified_at, enabled, revoked_at)
       values ($1, gen_random_uuid(), $2, $3, $4, now(), $5, $6)`,
      [row.app, row.uid, row.email, row.evidence, row.enabled, row.revoked],
    );
  };
  await assert.rejects(insert({ evidence: 'not-a-digest' }), 'a non-digest must be refused');
  await assert.rejects(insert({ email: 'Enrolled@Example.test' }), 'a non-normalized email must be refused');
  await assert.rejects(insert({ enabled: false }), 'disabled without a revocation time must be refused');
  await assert.rejects(insert({ revoked: new Date().toISOString() }), 'enabled with a revocation time must be refused');
});
