import { readFile, readdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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
 * one database hold both. So the literal became a pin: the migration reads
 * `pennsync.deployment_app_id` once and generates
 * `pennsync_private.deployment_app_id()`, an IMMUTABLE function returning that
 * one constant, which both layers ask. The migration text is identical in every
 * deployment; what differs is a generated function body.
 *
 * It is a function and not a row on purpose, and the reason is restore. A domain
 * CHECK that reads a table cannot survive `pg_restore`: table data is loaded
 * after the schema but in its own order, `agency` comes before `deployment`, and
 * every app-scoped row would be checked against a pin not yet loaded and
 * refused. That is not hypothetical — it is how the first version of this
 * migration failed, in the restore rehearsal. `pennsync_private.deployment`
 * survives as the dated record of the pin, constrained so it cannot disagree
 * with it.
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
 *
 * Both directories, because the assertion below names every app-scoped column
 * in the schema and a deployment applies both. It built only the authority
 * directory until D113, which is why the pin below read 20 while a deployment
 * that had applied everything carried 21: `pennsync_private.file_object` is
 * created from `record-migrations/` (D109), so it could not enter the
 * population this guard measures and the count agreed with itself forever.
 */
async function deploy(requestedApp, { directories = MIGRATION_DIRECTORIES } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  if (requestedApp !== undefined) {
    await db.query('select set_config($1,$2,false)', ['pennsync.deployment_app_id', requestedApp]);
  }
  for (const directory of directories) {
    const migrationDir = new URL(directory, import.meta.url);
    for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql')).sort()) {
      await db.exec(await readFile(new URL(name, migrationDir), 'utf8'));
    }
  }
  return db;
}
/** The order a deployment applies them: authority first, then the record store. */
const MIGRATION_DIRECTORIES = ['../supabase/migrations/', '../supabase/record-migrations/'];

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

test('the pin is a constant, so the domain CHECK survives a restore', async () => {
  // The two functions the CHECK reaches must be IMMUTABLE and must be constants.
  // A non-constant one would be read after the schema and before the data it
  // depends on, and every app-scoped COPY in a restore would be refused.
  const functions = await staging.query(`select p.proname as name, p.provolatile as volatility, p.prosrc as body
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_private'
      and p.proname in ('app_admitted','deployment_app_id','deployment_label') order by p.proname`);
  assert.equal(functions.rows.length, 3);
  for (const row of functions.rows) {
    assert.equal(row.volatility, 'i', `${row.name} must be IMMUTABLE`);
  }
  const constants = Object.fromEntries(functions.rows.map(row => [row.name, row.body.trim()]));
  assert.equal(constants.deployment_app_id, `select '${STAGING_APP}'::text`);
  assert.equal(constants.deployment_label, "select 'staging'::text");
  assert.match(constants.app_admitted, /pennsync_private\.deployment_app_id\(\)/);
  // And the domain reaches them: a CHECK that stopped calling this would be a
  // domain admitting whatever it liked.
  const constraint = await staging.query(`select pg_catalog.pg_get_constraintdef(c.oid) as definition
    from pg_catalog.pg_constraint c where c.contypid = 'pennsync_private.deployment_app'::regtype`);
  assert.equal(constraint.rows.length, 1);
  assert.match(constraint.rows[0].definition, /app_admitted\(VALUE\)/);
});

test('the dated record of the pin cannot disagree with it, or be edited', async () => {
  // The table is documentation; the function is enforcement. They are tied
  // together so an auditor reading the row is reading the truth.
  const pinned = await staging.query(
    'select app_id = pennsync_private.deployment_app_id() as agrees from pennsync_private.deployment');
  assert.deepEqual(pinned.rows, [{ agrees: true }]);
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

/**
 * The containment assertion itself, over whatever database it is handed.
 *
 * It is a function so the sabotage below can raise it from a build the guard
 * never makes. `expected` is a parameter for the same reason and for no other:
 * the narrow control passes the count the authority-only scope used to see, so
 * that "the old scope would still have passed" is asserted rather than argued.
 */
async function assertAppScopedColumns(db, expected) {
  // A new table typing app_id as text would sit outside the containment
  // entirely, so the count is pinned: adding one is a deliberate act.
  const scoped = await db.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and domain_name = 'deployment_app' order by table_name, column_name`);
  assert.equal(scoped.rows.length, expected, 'the number of app-scoped columns changed');
  // Exactly one per table: no table carries a second, separately typed app id.
  assert.equal(new Set(scoped.rows.map(r => r.table_name)).size, scoped.rows.length);
  // Nothing else in the schema names an app id without going through the domain.
  // The two exceptions are the tables that *define* the namespace: they cannot be
  // typed by the domain whose admitted value they are.
  const loose = await db.query(`select table_name, column_name from information_schema.columns
    where table_schema = 'pennsync_private' and column_name like '%app_id%'
      and domain_name is distinct from 'deployment_app'
      and table_name not in ('known_app','deployment')`);
  assert.deepEqual(loose.rows, [], 'an app id column escaped the domain');
  return scoped.rows;
}

test('every app-scoped column carries the domain rather than plain text', async () => {
  // 21 since D113 widened the build, not since a column was added: 20 of these
  // come from the authority directory and `file_object` from the record one.
  const scoped = await assertAppScopedColumns(staging, 21);
  for (const name of ['identity_map', 'agency', 'membership', 'patient', 'assignment',
    // D24's production care team. It is a sibling of `assignment` rather than
    // the same table because `assignment` keys to `pennsync_private.patient`,
    // which holds synthetic rows only — and that key is load-bearing for the
    // archive import's rollback guard, so it could not simply come off.
    'chart_assignment',
    'patient_disclosure_audit', 'visit_disclosure_audit', 'visit_list_disclosure_audit',
    // D77's locator mapping, created from `record-migrations/`. Named here so
    // the widened build is what the assertion rests on rather than the count.
    'file_object',
    'enrollment_receipt']) {
    assert.ok(scoped.some(r => r.table_name === name), `${name} must stay app-scoped`);
  }
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
  for (const [db, other] of [[staging, PRODUCTION_APP], [production, STAGING_APP]]) {
    await db.exec('reset role');
    for (const app of [other, LEGACY_APP, '', 'not-an-app', null]) {
      await assert.rejects(db.query('select pennsync_private.actor($1, false)', [app]),
        /PENNSYNC_APP_NOT_ADMITTED/, `actor() must refuse ${JSON.stringify(app)}`);
    }
  }
  // In staging the pinned app reaches past both gates and fails on the caller
  // instead: no JWT is set here, so there is no identity to resolve.
  await assert.rejects(staging.query('select pennsync_private.actor($1, false)', [STAGING_APP]),
    /PENNSYNC_SESSION_REQUIRED/);
});

test('replacing the entry gate did not widen who may call it', async () => {
  // `20260919090000` re-creates `actor()` with CREATE OR REPLACE. That preserves
  // the function's ACL and its SECURITY DEFINER bit -- but nothing checked it,
  // and a replacement that dropped either would be invisible: the tests would
  // still pass because they drive it as the owner. A lost definer bit breaks
  // every read; a widened grant lets `authenticated` call the gate directly,
  // outside the public wrappers that are the reviewed surface.
  const gate = (await staging.query(`select p.prosecdef,
      pg_catalog.array_to_string(p.proconfig, ',') as config
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_private' and p.proname = 'actor'`)).rows;
  assert.equal(gate.length, 1);
  assert.equal(gate[0].prosecdef, true, 'actor() must stay SECURITY DEFINER');
  assert.equal(gate[0].config, 'search_path=""', 'actor() must keep an empty search_path');
  for (const role of ['authenticated', 'anon', 'service_role']) {
    assert.equal((await staging.query(
      `select has_function_privilege($1,'pennsync_private.actor(text,boolean)','EXECUTE') as granted`,
      [role])).rows[0].granted, false, `${role} must not be able to call actor() directly`);
  }

  // The pin's own functions carry the grants they were given and no more.
  // `app_admitted` and `deployment_app_id` are reachable by `authenticated`
  // only because a domain coercion is evaluated as the current user;
  // `deployment_label` is read solely by the definer and stays revoked.
  for (const [name, granted] of [['app_admitted(text)', true], ['deployment_app_id()', true],
    ['deployment_label()', false]]) {
    assert.equal((await staging.query(
      `select has_function_privilege('authenticated',$1,'EXECUTE') as granted`,
      [`pennsync_private.${name}`])).rows[0].granted, granted, `${name} grant changed`);
  }
});

test('the RPC surface stays staging-only, because its responses still say so', async () => {
  // Admitting production for storage did not port this surface. Every response
  // it builds asserts `staging: true` and `synthetic: true`, so serving a
  // production deployment would make each one a lie. `actor()` refuses instead,
  // and it is the first call on every read and mutation path, so one guard
  // covers all of them.
  await assert.rejects(production.query('select pennsync_private.actor($1, false)', [PRODUCTION_APP]),
    /PENNSYNC_STAGING_RPC_SURFACE_ONLY/, 'the production deployment must not serve the staging surface');
  await assert.rejects(production.query('select public.pennsync_staging_context($1,$2)', [PRODUCTION_APP, 'agency-a']),
    /PENNSYNC_STAGING_RPC_SURFACE_ONLY/, 'the public wrapper must not reach past it either');
  // The order matters: a caller supplying another app id learns only that the
  // app is not admitted, never which kind of deployment refused it.
  await assert.rejects(production.query('select public.pennsync_staging_context($1,$2)', [STAGING_APP, 'agency-a']),
    /PENNSYNC_APP_NOT_ADMITTED/);

  // And the premise the guard rests on is pinned, not assumed: if a response
  // contract stops saying `staging`, this fails and the guard has to be
  // revisited rather than quietly outliving its reason.
  const migrationDir = new URL('../supabase/migrations/', import.meta.url);
  const contracts = new Set();
  for (const name of (await readdir(migrationDir)).filter(n => n.endsWith('.sql'))) {
    const text = await readFile(new URL(name, migrationDir), 'utf8');
    for (const [, value] of text.matchAll(/'(cm\.pennsync\.[a-z0-9.-]+)'/g)) contracts.add(value);
  }
  assert.ok(contracts.size >= 4, 'the response contracts should have been found');
  for (const contract of contracts) {
    assert.match(contract, /\.staging\.v\d+$/,
      `${contract} is no longer a staging contract, so the staging-only guard needs revisiting`);
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
    'source_evidence_sha256', 'verified_at', 'enabled', 'version',
    // D99's second provenance kind. Required rather than nullable, because an
    // identity with no kind is one nothing can say how it was admitted.
    'provenance']) {
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

/**
 * D113's sabotage: prove the widened build is what catches an escape, and that
 * the narrow one could not have.
 *
 * The plant is a migration in the RECORD tier — an app-scoped column typed
 * plain `text`, which is exactly the shape `file_object` would have had if
 * nobody had typed it. It is written to a directory of its own rather than into
 * `record-migrations/`, because a file dropped in the real directory is read by
 * the other fifty-three suites that walk it.
 *
 * Both halves are the finding. The wide build must REFUSE it; the narrow build
 * must PASS, at the count the authority-only scope used to see, which is what
 * says the old scope could never have caught this rather than merely that the
 * new one does.
 */
test('a plain-text app id planted in the record tier is caught by the widened build and missed by the narrow one', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pennsync-d113-'));
  let wide; let narrow;
  try {
    await writeFile(join(root, '20260920990000_planted_escape.sql'), `
      create table pennsync_private.planted_escape (
        app_id text not null,
        id text primary key
      );
      alter table pennsync_private.planted_escape enable row level security;
      alter table pennsync_private.planted_escape force row level security;
    `);
    const planted = pathToFileURL(root + '/').href;
    wide = await deploy(STAGING_APP, { directories: [...MIGRATION_DIRECTORIES, planted] });
    // It escapes both ways: the domain count does not move, and the column is
    // loose. Either assertion alone would be satisfied by the other's absence.
    await assert.rejects(assertAppScopedColumns(wide, 21), /an app id column escaped the domain/);
    const loose = await wide.query(`select table_name from information_schema.columns
      where table_schema = 'pennsync_private' and column_name = 'app_id'
        and domain_name is distinct from 'deployment_app'
        and table_name not in ('known_app','deployment')`);
    assert.deepEqual(loose.rows, [{ table_name: 'planted_escape' }]);

    // The control. Authority directory only: the plant is a record migration,
    // so it is not applied at all, and the old pin of 20 still passes.
    narrow = await deploy(STAGING_APP, { directories: ['../supabase/migrations/'] });
    const narrowRows = await assertAppScopedColumns(narrow, 20);
    // And the exact set, derived rather than retyped: the twenty are the
    // twenty-one less the one column the record directory creates. A count
    // alone would stay green if one column left as another arrived.
    const wideRows = await deploy(STAGING_APP).then(async database => {
      try { return await assertAppScopedColumns(database, 21); } finally { await database.close(); }
    });
    assert.deepEqual(narrowRows.map(r => `${r.table_name}.${r.column_name}`),
      wideRows.map(r => `${r.table_name}.${r.column_name}`).filter(name => name !== 'file_object.app_id'));
  } finally {
    await wide?.close(); await narrow?.close();
    await rm(root, { recursive: true, force: true });
  }
});
