import { readFile, readdir } from 'node:fs/promises';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';

/**
 * What keeps this store from holding production identifiers.
 *
 * The store pins its app id in two independent places, and both are
 * load-bearing. Storage side: every app-scoped table types its `app_id` as
 * `pennsync_private.staging_app`, a domain whose CHECK admits exactly one
 * value, so a row for another app cannot be written even by a caller that
 * bypassed every RPC. Entry side: `pennsync_private.actor()` compares the
 * requested app id against the same literal and refuses anything else, and
 * every read path calls it. Neither was tested: nothing failed if a new table
 * typed its `app_id` as plain text, if the domain were widened, or if the two
 * layers drifted apart from each other.
 *
 * The transition plan calls generalizing this a "configurable app namespace",
 * which understates it. Admitting production means altering a domain that 18
 * columns across 18 tables depend on *and* the gate inside `actor()`, and it
 * must come with a per-deployment guard so the staging project keeps rejecting
 * production ids afterwards. Widening without that guard would let production
 * PHI land in the staging database, and nothing else would notice.
 *
 * So this pins the containment as it stands. When the production migration
 * lands, this test fails, and whoever writes it has to state the new permitted
 * set and the guard deliberately rather than discovering the widening later.
 */
const STAGING_APP = '6a9881683dc68a0bd54f1ef7';
/** Real, and deliberately not admitted today. */
const PRODUCTION_APP = '694ec16e72e01b60d22f7cbf';
const LEGACY_APP = '68ee80d98929370f9e8f2932';
/** Excluded from the identity map by its own check: setup and recovery only. */
const PLATFORM_OWNER = '6a98816d3dc68a0bd54f1ef8';

let db;

before(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
  }
});
after(async () => db?.close());

const admits = async value => {
  try {
    await db.query('select $1::text::pennsync_private.staging_app', [value]);
    return true;
  } catch { return false; }
};

test('the app domain admits the staging app and nothing else', async () => {
  assert.equal(await admits(STAGING_APP), true, 'the staging app must be admitted');
  // Each of these is a real Base44 app id. None may be stored here today.
  assert.equal(await admits(PRODUCTION_APP), false, 'production must not be storable in staging');
  assert.equal(await admits(LEGACY_APP), false, 'the legacy app must not be storable in staging');
  assert.equal(await admits(PLATFORM_OWNER), false);
  for (const value of ['', ' ', STAGING_APP.toUpperCase(), `${STAGING_APP} `, `${STAGING_APP}x`, STAGING_APP.slice(0, -1)]) {
    assert.equal(await admits(value), false, `${JSON.stringify(value)} must not be admitted`);
  }
});

test('every app-scoped column carries the domain rather than plain text', async () => {
  // A new table typing app_id as text would sit outside the containment
  // entirely, so the count is pinned: adding one is a deliberate act.
  const scoped = await db.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and domain_name = 'staging_app' order by table_name, column_name`);
  assert.equal(scoped.rows.length, 18, 'the number of app-scoped columns changed');
  // Exactly one per table: no table carries a second, separately typed app id.
  assert.equal(new Set(scoped.rows.map(r => r.table_name)).size, scoped.rows.length);
  for (const name of ['identity_map', 'agency', 'membership', 'patient', 'assignment',
    'patient_disclosure_audit', 'visit_disclosure_audit', 'visit_list_disclosure_audit']) {
    assert.ok(scoped.rows.some(r => r.table_name === name), `${name} must stay app-scoped`);
  }
  // Nothing in the schema names an app id without going through the domain.
  const loose = await db.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and column_name like '%app_id%' and domain_name is distinct from 'staging_app'`);
  assert.deepEqual(loose.rows, [], 'an app id column escaped the domain');
});

test('a production row is refused by the database, not by a caller', async () => {
  // The refusal must come from the store itself: a service that forgot to
  // check, or a compromised one, still cannot write a production identity.
  await assert.rejects(db.query(
    `insert into pennsync_private.identity_map
       (app_id, auth_user_id, base44_user_id, expected_email, source_evidence_sha256, verified_at)
     values ($1, gen_random_uuid(), $2, 'someone@example.test', repeat('a', 64), now())`,
    [PRODUCTION_APP, 'a'.repeat(24)],
  ));
  // And the platform owner is refused even under the admitted app id.
  await assert.rejects(db.query(
    `insert into pennsync_private.identity_map
       (app_id, auth_user_id, base44_user_id, expected_email, source_evidence_sha256, verified_at)
     values ($1, gen_random_uuid(), $2, 'owner@example.test', repeat('a', 64), now())`,
    [STAGING_APP, PLATFORM_OWNER],
  ));
});

test('the entry gate refuses another app before it reads anything', async () => {
  // `actor()` is the first call on every read path. It compares the requested
  // app id against the same literal the domain enforces, so a widening that
  // touched only the domain would leave every read still refused here — and
  // one that touched only this gate would leave writes still refused there.
  // Both layers must move together, which is why both are pinned.
  await db.exec('reset role');
  for (const app of [PRODUCTION_APP, LEGACY_APP, '', 'not-an-app']) {
    await assert.rejects(
      db.query('select pennsync_private.actor($1, false)', [app]),
      `actor() must refuse ${JSON.stringify(app)}`,
    );
  }
  // The admitted app reaches past the app check and fails on the caller
  // instead: no JWT is set here, so there is no identity to resolve.
  await assert.rejects(db.query('select pennsync_private.actor($1, false)', [STAGING_APP]));
});

test('an enrolled identity must carry its evidence hash and a coherent revocation', async () => {
  // The enrollment tool Phase 1 calls for writes these rows. Pinning the
  // column contract now means that tool is built against a known shape.
  const columns = await db.query(`select column_name, is_nullable from information_schema.columns
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
    return db.query(
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
