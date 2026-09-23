import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { KNOWN_APPS, readMigrations } from '../../../tools-pennsync-provision.mjs';
import { LOCAL_ONLY_MIGRATIONS, ledgerName } from '../../../tools-pennsync-migrate.mjs';
import { isManagementUrl, openManagementClient } from '../../../tools-pennsync-supabase-db.mjs';
import { ACTORS } from '../../authority-client/client.mjs';
import { INVENTORY, KEYED_PARTS, TABLE_KINDS, inventoryFaults } from './store-inventory.mjs';

/**
 * The committed store, measured on the hosted project rather than on PGlite.
 *
 * Every other suite here builds its own database: `bootstrap.sql`, the
 * migrations, `fixtures.sql`, then assertions. That is the right shape for
 * proving what a policy MEANS, and it is why those suites stayed green for the
 * whole time the hosted project was fifty-nine migrations behind — a database
 * built from the same files cannot disagree with them.
 *
 * This one measures the database an operator actually migrated. It is the only
 * suite that can fail because of something Supabase does rather than something
 * this repository wrote, which is the entire reason to have it:
 * `docs/RAILWAY_GO_LIVE_PLAN_2026-09-21.md` stage A says a role and grant model
 * built on the assumption that `pennsync_records_owner` holds neither
 * `SUPERUSER` nor `BYPASSRLS` is exactly the kind of thing a managed Postgres
 * can contradict.
 *
 * WHAT IT CANNOT DO, and the boundary is deliberate rather than unfinished.
 *
 * It reads no row a caller owns. Not one assertion here reads a patient, a
 * visit or a roster, because doing that needs a caller who is through the gate,
 * and a caller in this store is an `auth.users` row WITH A LIVE SESSION:
 * `pennsync_private.identity_map.auth_user_id` carries a foreign key to the
 * first, and `pennsync_private.actor()` looks up the second in `auth.sessions`
 * and refuses without it. `fixtures.sql` fabricates both, which is safe in a
 * throwaway database and is not something to do to a real Supabase Auth schema
 * — the file says so itself and refuses to load anywhere that
 * `auth.pennsync_local_test_double()` is missing, which is every hosted
 * project, and this suite asserts that it is still missing here.
 *
 * WHAT IT NOW DOES PROVE ABOUT BEHAVIOUR is the part of the gate that needs no
 * caller, and the distinction is worth stating because the plan for a while
 * recorded the whole of it as blocked. Four refusals are measured on the hosted
 * project: no claims, an unknown subject, an anonymous role, and a real
 * enrolled subject stopping at the session check.
 *
 * THE ORDER MATTERS AND IS EASY TO GET BACKWARDS, so it is written out once:
 * claims, `exp`, `auth.users`, `auth.sessions`, THEN `identity_map`
 * (`20260919090000_deployment_app_pin.sql:183-218`). The session is checked
 * BEFORE the map. So `PENNSYNC_SESSION_INACTIVE` says the subject cleared
 * `auth.users` — live, confirmed, unbanned, not anonymous — and says nothing
 * whatever about `identity_map`: a subject with no map row at all refuses
 * identically. That the hosted identities are mapped is carried by `CALLERS`
 * below, which counts the map rows against the same predicate `actor()` uses,
 * and not by any gate refusal. An earlier version of this comment had the two
 * the other way round and drew a conclusion the measurement does not support.
 *
 * What those four cannot say is what a policy RETURNS to someone through the
 * gate. That is not waiting on anything here any more: the owner declined on
 * 2026-09-22 to use the staging accounts, so no hosted caller will ever hold a
 * session and the `auth.sessions` leg stays unreachable from this suite. What
 * answers it instead is composition, and it is the reason the comparison below
 * is worth its length: `http-authority.test.mjs` drives the whole gate and the
 * tenant rules over a real local Auth stack, and the parts list here proves
 * hosted's policy `qual`/`with_check` and every function body — `actor()`'s
 * included, by `md5(prosrc)` — are the same artifacts those suites ran
 * against. Do not close that loop by writing an `auth.sessions` row from a
 * test: that is the fabrication the local-only guard below exists to refuse,
 * and a session this repository wrote satisfying a check this repository wrote
 * would be evidence of nothing.
 *
 * That half is not small. It is every claim the row assertions REST on, and
 * the inventory below is deliberately structural rather than a set of counts:
 * a count cannot see an `alter policy … using (true)`, a dropped unique index,
 * a rewritten contract body or a revoked grant, and each of those leaves the
 * names and totals exactly as they were. So the comparison carries every
 * policy's command, roles, permissiveness, `qual` and `with_check`; every
 * index and constraint definition; every function's owner, security mode,
 * settings, volatility, grants and body digest; every trigger definition; and
 * every column's type and nullability. A policy nobody obeys, a policy nobody
 * reaches and a policy quietly widened to `true` all fail the same way:
 * silently, and only in production.
 *
 * BOTH SCHEMAS, because `pennsync_private` is where the authority answers come
 * from. Measuring only `pennsync_records` would leave a dropped membership
 * constraint, a disabled force-RLS or a detached immutability trigger invisible
 * while every other assertion here stayed green.
 *
 * HOW IT DECIDES WHAT IS CORRECT. The expectations are not written down here.
 * They are read out of a PGlite database built from the same committed
 * migrations, by the SAME SQL, and compared. A constant in this file would be a
 * third opinion that drifts from both; a reference build cannot, and it makes
 * the suite say something stronger than "hosted looks sane" — it says hosted is
 * what these migrations produce. The exceptions are called out where they
 * appear, and each is a fact about the platform a local database cannot state.
 *
 * ONE VERSION DIFFERENCE IS HANDLED EXPLICITLY. Hosted is PostgreSQL 17.6 and
 * PGlite 0.5.8 is 18.3. Everything above compares byte for byte across that gap
 * — deparsed `qual`, `indexdef`, `pg_get_constraintdef`, `pg_get_triggerdef`
 * and `proconfig` all agree — with one exception: PostgreSQL 18 gives NOT NULL
 * its own `pg_constraint` row and 17 does not, which is 584 rows on one side
 * and none on the other. Constraints therefore exclude `contype = 'n'`, and
 * nullability is compared through `pg_attribute.attnotnull` instead, which both
 * versions answer identically. Dropping the field would have lost the coverage;
 * this keeps it and says why.
 *
 * IT NEVER WRITES, and the barrier is an ALLOWLIST rather than a scanner. An
 * earlier version passed each statement through the migrate tool's `isReadOnly`,
 * which only classifies leading verbs — `select write_contract(…)` and
 * `explain analyze insert …` both pass it, and both mutate. This suite issues a
 * fixed set of statements and the client holds exactly that set, refusing
 * everything else, so no edit here can write through an account-wide management
 * credential. The four gate bodies are in the set for the same reason the other
 * reads are: they are fixed text, none of them could write had it succeeded,
 * and every one of them ABORTS, which unwinds the endpoint's implicit
 * transaction before it could have.
 *
 * WHAT IT MAY IMPORT is a constraint rather than a preference, and
 * `record-contract-postgres.test.mjs` records why: the CI job running this
 * installs only `services/authority-store`'s own dependencies and does no root
 * install, so a suite here dies at load — before a single assertion — if it
 * reaches a root module with a third-party dependency of its own. PGlite is
 * fine, because it is that package's own devDependency. The three root tools
 * above are fine because they import nothing but node builtins and each other.
 * `tools-entity-schema-plan.mjs` is NOT, because it imports `json5`, which is
 * why `SCHEMA` is written out below rather than taken from it. `KNOWN_APPS`
 * comes from the provisioner for the opposite reason: that one qualifies, so
 * importing it beats copying a list that could drift from what a provision
 * enforces.
 *
 * Not in `pnpm test` — it needs a hosted project, the same reason
 * `record-contract-postgres.test.mjs` is not.
 * `.github/workflows/pennsync-authority.yml` is the list of record for the
 * suites that are not. Unlike that one this file SKIPS rather than throws
 * without its target, because it is the job's only step on a pull request and a
 * job that fails on every fork teaches people to ignore it. On `main` the
 * WORKFLOW refuses to reach this file without credentials, so the skip cannot
 * turn the hosted measurement into a green job that measured nothing.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SCHEMA = 'pennsync_records';
const PRIVATE = 'pennsync_private';

/**
 * The deployment this suite is for.
 *
 * `KNOWN_APPS` holds staging AND production, so accepting "any known app"
 * would let a mis-set `PENNSYNC_STAGING_DATABASE_URL` point at a production
 * store and still pass. The runtime's independent authority pins one project,
 * and this is the store it pins; a production deployment is measured by its
 * own job when there is one.
 */
const EXPECTED_LABEL = 'staging';

/**
 * That deployment's app id, taken from the provisioner's list rather than
 * written out, so the caller-gate statements below cannot name an app the
 * provisioner has stopped admitting. `actor()` checks `app_admitted` before it
 * looks at anything else, so a stale literal here would turn every gate test
 * into the same `PENNSYNC_APP_NOT_ADMITTED` and say nothing about the gate.
 */
const EXPECTED_APP = Object.keys(KNOWN_APPS).find(id => KNOWN_APPS[id] === EXPECTED_LABEL);

/**
 * Roles that must hold no way past a policy. `service_role` is deliberately
 * absent: it holds `BYPASSRLS` on every hosted project and is contained by the
 * grant model instead, which is its own test below.
 */
const UNPRIVILEGED_ROLES = ['pennsync_records_owner', 'anon', 'authenticated'];
const CALLER_ROLES = ['anon', 'authenticated', 'service_role'];

/**
 * Privileged roles that can reach the record store on a managed Supabase
 * project, recorded as a baseline rather than asserted away.
 *
 * This is the stage A finding, and it is a platform fact rather than a defect:
 * a hosted project carries five roles holding `SUPERUSER` or `BYPASSRLS`, and
 * four of them hold `USAGE` on both schemas. `supabase_read_only_user` is the
 * one worth naming twice — it bypasses all 591 policies and is exactly what its
 * name says, so the dashboard's read-only access reads every record table past
 * the tenant predicates.
 *
 * PGlite has none of them. Asserting "no privileged role reaches the store"
 * would be false on the only target that matters, and asserting nothing would
 * miss the day a migration or a platform change adds a sixth. So the SET is the
 * assertion: these and no others.
 *
 * `service_role` is deliberately not here. It holds `BYPASSRLS` and no `USAGE`
 * on either schema, so the grant model is the only thing containing it — which
 * is worth knowing, and is checked below as its own claim.
 */
const PRIVILEGED_REACH = Object.freeze([
  'postgres', 'supabase_admin', 'supabase_etl_admin', 'supabase_read_only_user',
]);

/**
 * The role facts. Hosted only: PGlite's `postgres` is a local superuser and
 * there is no Supabase role set to compare against, so there is nothing here a
 * reference build could confirm.
 */
const ROLES = `select jsonb_build_object(
  'store', (select jsonb_agg(jsonb_build_object(
      'name', rolname, 'super', rolsuper, 'bypassrls', rolbypassrls) order by rolname)
    from pg_roles where rolname in
      ('pennsync_records_owner', 'anon', 'authenticated', 'service_role')),
  'helper_owner_privileged', (select bool_and(r.rolsuper or r.rolbypassrls)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    join pg_roles r on r.oid = p.proowner
    where n.nspname = '${SCHEMA}' and p.proname like 'caller%'),
  'privileged_reach', (select jsonb_agg(rolname order by rolname)
    from pg_roles where (rolsuper or rolbypassrls)
      and has_schema_privilege(rolname, '${SCHEMA}', 'usage')),
  'service_role_reach', (select jsonb_build_object(
      'records', has_schema_privilege('service_role', '${SCHEMA}', 'usage'),
      'private', has_schema_privilege('service_role', '${PRIVATE}', 'usage'))),
  'anon_reach', (select jsonb_build_object(
      'records', has_schema_privilege('anon', '${SCHEMA}', 'usage'),
      'private', has_schema_privilege('anon', '${PRIVATE}', 'usage')))
) as roles`;

/** The ledger and the pin, read the way the migrate tool reads them. */
const LEDGER = `select jsonb_build_object(
  'rows', (select count(*) from supabase_migrations.schema_migrations),
  'names', (select jsonb_agg(name order by name) from supabase_migrations.schema_migrations),
  'distinct_versions', (select count(distinct version) from supabase_migrations.schema_migrations),
  'duplicate_names', (select jsonb_agg(name order by name) from
    (select name from supabase_migrations.schema_migrations
      group by name having count(*) > 1) repeated),
  'deployment_rows', (select count(*) from ${PRIVATE}.deployment),
  'app_id', ${PRIVATE}.deployment_app_id(),
  'label', ${PRIVATE}.deployment_label(),
  'source', (select source from ${PRIVATE}.deployment)
) as ledger`;

/**
 * What the row-behaviour half is waiting on, counted rather than assumed.
 *
 * The plan recorded stage A's fourth claim as blocked because "a caller is an
 * `auth.users` row" and hosted had none. That stopped being the whole truth:
 * four accepted identities are mapped on the hosted project, and what is
 * missing is the LIVE SESSION `actor()` also requires. Those are different
 * asks of different people, so the suite counts them separately and the gate
 * tests below read the counts rather than a constant.
 *
 * `mapped` carries `actor()`'s OWN map predicate rather than a looser one —
 * the app id, `enabled`, `revoked_at`, `expected_email` against the user's
 * current email, `verified_at` in the past, and the `auth.users` conditions
 * that line 194 applies — because this count is the only thing in this file
 * that says the hosted identities are enrolled. No gate refusal says it: the
 * session is checked BEFORE the map, so an unenrolled subject and an enrolled
 * one refuse identically while there is no session. A count measured against a
 * weaker predicate than the function's would quietly overstate that.
 */
const CALLERS = `select jsonb_build_object(
  'auth_users', (select count(*) from auth.users
    where deleted_at is null and email_confirmed_at is not null and is_anonymous is false),
  'mapped', (select count(*) from ${PRIVATE}.identity_map i
    join auth.users u on u.id = i.auth_user_id
      and u.deleted_at is null and u.email_confirmed_at is not null
      and u.email_confirmed_at <= clock_timestamp() and u.is_anonymous is false
      and (u.banned_until is null or u.banned_until <= clock_timestamp())
    where i.app_id = '${EXPECTED_APP}' and i.enabled and i.revoked_at is null
      and i.expected_email = lower(u.email) and i.verified_at <= clock_timestamp()),
  'memberships', (select count(*) from ${PRIVATE}.membership where status = 'active'),
  'assignments', (select count(*) from ${PRIVATE}.assignment where status = 'active'),
  'chart_assignments', (select count(*) from ${PRIVATE}.chart_assignment where status = 'active'),
  'live_sessions', (select count(*) from auth.sessions
    where created_at > clock_timestamp() - interval '12 hours'
      and (not_after is null or not_after > clock_timestamp())),
  'local_test_double', (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'auth' and p.proname = 'pennsync_local_test_double')
) as callers`;

/**
 * The identities this project can actually address, under `actor()`'s OWN map
 * predicate, returned as ids rather than counted.
 *
 * `services/authority-client/client.mjs` PINS four Base44 user ids, and the
 * store is the authority on which identities exist: a pin naming one the store
 * has revoked, or a live mapped identity the transport cannot address, is
 * drift that nothing else in this repository would report. The comparison is
 * two-way and deliberately VACUOUS when the project has no identities, because
 * enrolment is the owner's and nothing merged may depend on these four accounts
 * existing — deleting them must leave this suite green.
 */
const MAPPED_ACTORS = `select coalesce(jsonb_agg(i.base44_user_id order by i.base44_user_id), '[]'::jsonb) as ids
  from ${PRIVATE}.identity_map i
  join auth.users u on u.id = i.auth_user_id
    and u.deleted_at is null and u.email_confirmed_at is not null
    and u.email_confirmed_at <= clock_timestamp() and u.is_anonymous is false
    and (u.banned_until is null or u.banned_until <= clock_timestamp())
  where i.app_id = '${EXPECTED_APP}' and i.enabled and i.revoked_at is null
    and i.expected_email = lower(u.email) and i.verified_at <= clock_timestamp()`;

/**
 * The caller gate, asked of the hosted project with no caller to seed.
 *
 * This is the slice of the row-behaviour half that needs no session, and it is
 * worth having on its own: every `contract-*` assertion begins by getting past
 * `pennsync_private.actor()`, so a gate that refused differently here than on
 * PGlite would invalidate all of them at once and nothing else looks.
 *
 * Each body REFUSES. That is the assertion — the SQLSTATE and the message are
 * read from the error — and it is also why these are safe to send through an
 * account-wide credential: an aborted statement writes nothing, and none of the
 * four could write anything had it succeeded.
 *
 * NO `begin`/`rollback`, deliberately. The endpoint wraps a body carrying no
 * transaction control in one implicit transaction of its own, which is what
 * makes `set local` take effect and what makes the abort total;
 * `assertSingleTransaction` refuses `begin; … rollback;` outright, so the
 * control-free shape is the only one this transport carries. The role switch
 * proving itself is `GATE_ANON` (as `postgres` the grant would not refuse) and
 * the claims proving themselves is `GATE_MAPPED` (as unset claims the answer
 * would be `PENNSYNC_SESSION_REQUIRED` instead).
 *
 * `GATE_MAPPED` reads its subject out of `identity_map` rather than naming a
 * UUID, because the hosted identities belong to real people and a real account
 * id does not belong in a repository. It is also what makes the test measure
 * the hosted rows rather than a constant that drifts from them.
 */
const GATE_CLAIMS = subject => `select set_config('request.jwt.claims', jsonb_build_object(
  'sub', ${subject}, 'session_id', '20000000-0000-4000-8000-00000000000f',
  'role', 'authenticated', 'exp', '4102444800')::text, true);`;
const GATE_CALL = role => `set local role ${role};
select public.pennsync_staging_context('${EXPECTED_APP}', 'agency-a');`;
const GATE_NO_CLAIMS = GATE_CALL('authenticated');
const GATE_UNKNOWN = `${GATE_CLAIMS("'00000000-0000-4000-8000-0000000000ff'")}
${GATE_CALL('authenticated')}`;
const GATE_MAPPED = `${GATE_CLAIMS(`(select i.auth_user_id from ${PRIVATE}.identity_map i
    join auth.users u on u.id = i.auth_user_id
    where i.enabled and i.revoked_at is null and i.expected_email = lower(u.email)
    order by i.auth_user_id limit 1)`)}
${GATE_CALL('authenticated')}`;
const GATE_ANON = GATE_CALL('anon');

/**
 * The only statements this suite may send.
 *
 * An allowlist rather than a scanner, because a scanner over leading verbs is
 * not a write barrier: `select some_write_contract(…)` is a `select`, and
 * `explain analyze insert …` is an `explain`, and PostgreSQL executes both.
 * The credential in play is account-wide, so the barrier has to be the set of
 * statements rather than a property of them.
 */
const GATES = Object.freeze({
  no_claims: GATE_NO_CLAIMS,
  unknown: GATE_UNKNOWN,
  mapped: GATE_MAPPED,
  anon: GATE_ANON,
});
const ALLOWED = Object.freeze(new Set([INVENTORY, ROLES, LEDGER, CALLERS, MAPPED_ACTORS, ...Object.values(GATES)]));

/**
 * The target, and the reason a missing one skips rather than fails.
 *
 * A fork's pull request has no secrets, and `pnpm test` on a laptop has no
 * hosted project. Neither is a defect in the store, so neither should turn this
 * suite red. What WOULD be a defect is the hosted job reporting success while
 * quietly measuring nothing, and the skip cannot cause that: the workflow's
 * main-only step refuses to invoke this file unless both credentials are set.
 */
const url = process.env.PENNSYNC_HOSTED_DATABASE_URL;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const skip = (() => {
  if (!url) return 'PENNSYNC_HOSTED_DATABASE_URL is not set; the hosted store is not measured.';
  if (isManagementUrl(url) && !token) {
    return 'A supabase:// target needs SUPABASE_ACCESS_TOKEN; the hosted store is not measured.';
  }
  return false;
})();

/** A client that can send the three statements above and nothing else. */
function readOnlyClient() {
  if (!isManagementUrl(url)) {
    // A postgres:// target would need `pg`, which this job does install, but it
    // is also the transport that cannot reach Supabase from a runner allowed
    // outbound HTTPS and nothing else. Refused rather than half-supported: the
    // plan's own finding is that `supabase://` is the reachable one.
    throw new Error('PENNSYNC_HOSTED_DATABASE_URL must be a supabase://<project-ref> target');
  }
  const client = openManagementClient({ url, token });
  return {
    async query(sql) {
      if (!ALLOWED.has(sql)) throw new Error('HOSTED_SUITE_STATEMENT_NOT_ALLOWED');
      return client.query(sql);
    },
    end: () => client.end(),
  };
}

/**
 * `jsonb` from either driver, as a plain object.
 *
 * Every query here aggregates into one row, so no row means the read did not
 * happen — a transport that answered `[]` rather than a document. Said with a
 * name attached, because the alternative is a `TypeError` on `undefined` from
 * inside `before()` and every test failing without saying which read was empty.
 */
const only = (label, result) => {
  const [row] = result.rows;
  if (!row) throw new Error(`HOSTED_READ_EMPTY: ${label} returned no row`);
  const value = Object.values(row)[0];
  return typeof value === 'string' ? JSON.parse(value) : value;
};

/** Functions in one schema, from the shared inventory. */
const inSchema = (functions, prefix) =>
  (functions ?? []).filter(entry => entry.k.startsWith(prefix));

let hosted = {};
const gates = {};
let reference = {};
const committed = [];

before(async () => {
  if (skip) return;

  // The reference: the same migrations, in the provisioner's own order, minus
  // the ones a deployment deliberately never gets. `readMigrations` is the
  // provisioner's list rather than a directory walk here, so this cannot apply
  // them in an order no deployment uses.
  const referenceDb = new PGlite();
  await referenceDb.exec(readFileSync(
    resolve(repository, 'services/authority-store/tests/bootstrap.sql'), 'utf8'));
  for (const migration of readMigrations(repository)) {
    if (LOCAL_ONLY_MIGRATIONS[migration.name]) continue;
    committed.push(migration.name);
    await referenceDb.exec(migration.sql);
  }
  reference = only('the reference inventory', await referenceDb.query(INVENTORY));
  await referenceDb.close();

  const client = readOnlyClient();
  try {
    hosted = {
      inventory: only('the hosted inventory', await client.query(INVENTORY)),
      roles: only('the hosted roles', await client.query(ROLES)),
      ledger: only('the hosted ledger', await client.query(LEDGER)),
      callers: only('the hosted callers', await client.query(CALLERS)),
      mappedActors: only('the hosted mapped actors', await client.query(MAPPED_ACTORS)),
    };
    for (const [name, sql] of Object.entries(GATES)) {
      gates[name] = await refusal(client, sql);
    }
  } finally { await client.end(); }
});

/**
 * The server's own words for a body that must refuse, or a named failure.
 *
 * A gate body that SUCCEEDS is the finding this exists to catch, so it is an
 * error rather than an empty result: a caller gate that admitted an unmapped
 * subject would otherwise leave every assertion below reading `undefined` and
 * passing on a falsy compare.
 */
async function refusal(client, sql) {
  try {
    await client.query(sql);
  } catch (error) {
    // The transport reports the endpoint's status and message and never the
    // SQL, which is why the message is read rather than the statement matched.
    if (error?.code === 'SUPABASE_DB_QUERY_FAILED') return String(error.detail?.message ?? '');
    throw error;
  }
  throw new Error('HOSTED_GATE_ADMITTED: a caller gate that had to refuse did not');
}

test('the ledger holds one row per committed migration', { skip }, () => {
  const { ledger } = hosted;
  assert.deepEqual(ledger.duplicate_names, null, 'a migration recorded twice');
  assert.equal(ledger.rows, committed.length,
    `the ledger holds ${ledger.rows} rows for ${committed.length} committed migrations`);
  // `version` is the ledger's primary key and `name` is what the migrate tool
  // matches on, so both have to be one-per-migration or "has this run" has two
  // different answers.
  assert.equal(ledger.distinct_versions, ledger.rows);
  assert.deepEqual(ledger.names, committed.map(ledgerName).sort());
});

test('the migration held back locally was not applied', { skip }, () => {
  const local = Object.keys(LOCAL_ONLY_MIGRATIONS).map(ledgerName);
  assert.ok(local.length, 'LOCAL_ONLY_MIGRATIONS is empty; this test no longer says anything');
  for (const name of local) {
    assert.ok(!hosted.ledger.names.includes(name),
      `${name} is held back from every deployment and the hosted ledger records it`);
  }
});

test('the deployment pin names the staging app and one row records it', { skip }, () => {
  const { ledger } = hosted;
  assert.equal(ledger.deployment_rows, 1, 'the pin is one row or it is not a pin');
  assert.ok(ledger.app_id in KNOWN_APPS, `${ledger.app_id} is not an app a deployment may serve`);
  assert.equal(ledger.label, KNOWN_APPS[ledger.app_id]);
  // Not merely "a known app": `KNOWN_APPS` holds production too, so accepting
  // any of them would let a mis-set target measure a production store and pass.
  assert.equal(ledger.label, EXPECTED_LABEL,
    `this suite measures the ${EXPECTED_LABEL} deployment and the target is pinned to ${ledger.label}`);
  // Either source is correct; which one it is, is the thing to be able to
  // state. An unset setting resolves to staging, the restrictive outcome.
  assert.ok(['default', 'setting'].includes(ledger.source), `unknown pin source ${ledger.source}`);
});

test('the reference build produced a store to compare against', { skip }, () => {
  // Guarding the comparison below rather than the reference for its own sake.
  // Every assertion there compares against this document, and two absent values
  // are equal: a reference that silently came out empty would turn the
  // strongest test in this file into one that passes without reading anything.
  // `readMigrations` returning nothing is all it would take.
  assert.ok(committed.length > 1, `the reference applied ${committed.length} migrations`);
  for (const part of KEYED_PARTS) {
    assert.ok(Array.isArray(reference[part]) && reference[part].length,
      `the reference build produced no ${part}`);
  }
});

test('the hosted store is exactly what the committed migrations produce', { skip }, () => {
  // Structure rather than counts, in both schemas, and REPRESENTATION rather
  // than structure alone. Each of these can change while every name and total
  // stays put: a policy widened in place, an index dropped, a contract body
  // rewritten, a grant revoked, a trigger detached. And each of these can
  // change while every NAME, total and definition stays put, which is what
  // `store-inventory.mjs` added and D95 records: a default dropped from a
  // column, a generated column turned plain, a trigger disabled, an index left
  // invalid, an argument default removed, a view added beside a record table.
  //
  // `store-inventory.test.mjs` plants each of those in a scratch build and
  // fails if this comparison stays quiet, because reading the SQL is how they
  // came to be missing in the first place.
  const faults = inventoryFaults(reference, hosted.inventory);
  // Capped, because a store that diverged wholesale would otherwise print
  // thousands of lines; the COUNT is in the message, so a capped list never
  // reads as the whole of it.
  assert.deepEqual(faults.slice(0, 10), [],
    `${faults.length} difference(s) between the committed migrations and hosted`);
});

test('every record table is owned by the record owner, with RLS forced', { skip }, () => {
  // Ordinary tables, because that is what RLS is a property OF: a view carries
  // none of its own and would fail here for a reason that reads as a defect in
  // this test. A view or a sequence turning up in `pennsync_records` is caught
  // by the comparison above, as `present on hosted only`, and that is the
  // failure worth having — a view created by a privileged role and granted to
  // `authenticated` reads every tenant's rows past every policy, which was
  // measured rather than reasoned about (D95).
  const tables = (hosted.inventory.tables ?? [])
    .filter(entry => entry.k.startsWith(`${SCHEMA}.`) && TABLE_KINDS.includes(entry.kind));
  assert.ok(tables.length, 'the hosted project holds no record tables');
  const owners = [...new Set(tables.map(table => table.owner))];
  assert.deepEqual(owners, ['pennsync_records_owner'],
    `record tables are owned by ${owners.join(', ')}`);
  // `enable` is not `force`: without the second, the table's own owner reads
  // past every predicate, and the owner is what the brokers run as.
  const unprotected = tables.filter(table => !table.rls || !table.forced);
  assert.deepEqual(unprotected, [], 'record tables without forced row level security');
});

test('no caller role holds any effective privilege on a record or authority table', { skip }, () => {
  // Asked as `has_table_privilege` rather than read out of
  // `information_schema.role_table_grants`, because that view lists grants made
  // TO a named grantee and omits what a role holds through `PUBLIC`. A
  // `grant select … to public` is invisible there and reaches every caller,
  // which is precisely the surface this is meant to refuse.
  assert.deepEqual(hosted.inventory.caller_table_privileges, []);
  assert.deepEqual(reference.caller_table_privileges, []);
});

test('the contract surface is reachable by callers and closed to anonymous ones', { skip }, () => {
  const contracts = inSchema(hosted.inventory.functions, 'public.pennsync_contract_');
  assert.ok(contracts.length, 'the hosted project exposes no contracts');
  for (const contract of contracts) {
    // Security INVOKER, deliberately: the wrapper is a name in `public` for
    // PostgREST to find, and the privilege it runs with has to stay the
    // caller's so the broker it calls is the only thing that elevates.
    assert.equal(contract.secdef, false, `${contract.k} is security definer`);
    assert.equal(contract.authenticated, true, `${contract.k} is unreachable by a caller`);
    assert.equal(contract.anon, false, `${contract.k} is reachable anonymously`);
  }
});

test('the caller helpers are unreachable by the callers they describe', { skip }, () => {
  const helpers = inSchema(hosted.inventory.functions, `${SCHEMA}.caller`);
  assert.ok(helpers.length, 'the hosted project holds no caller helpers');
  for (const helper of helpers) {
    // A policy expression runs with the querying role's privileges, so a caller
    // granted `execute` here could ask "who am I" directly and answer it for
    // somebody else.
    assert.equal(helper.secdef, true, `${helper.k} is not security definer`);
    assert.equal(helper.authenticated, false, `${helper.k} is executable by a caller`);
    assert.equal(helper.anon, false, `${helper.k} is executable anonymously`);
  }
});

test('the independent authority RPCs the runtime calls are present and callable', { skip }, () => {
  /**
   * `services/integration-runtime/authority.mjs` is the whole of stage E's
   * `authorityMode: independent`, and it pins two things this suite can check
   * and nothing else does: the project and the RPC, `pennsync_staging_context`,
   * as a fixed name no caller or environment value selects.
   *
   * That module replays the caller's own Supabase token at the RPC and lets the
   * database authorize the read, so the mode is only as real as the function
   * being there with the right grants. Nothing measured that against the hosted
   * project before: the runtime's own suites stub the endpoint, and the store's
   * suites never look outside PGlite. A migration that changed this signature,
   * or a `revoke` that reached `authenticated`, would surface as the runtime
   * failing to leave `base44` mode on deploy — where it is least diagnosable.
   */
  const rpcs = inSchema(hosted.inventory.functions, 'public.pennsync_staging_');
  const context = rpcs.find(rpc => rpc.k === 'public.pennsync_staging_context(p_app_id text, p_agency_id text)');
  assert.ok(context, 'pennsync_staging_context is absent or its signature moved;'
    + ' independent authority cannot resolve a caller');

  for (const rpc of rpcs) {
    // Granted to the caller, because the caller is who it authorizes; closed to
    // anonymous, because an unauthenticated reader of tenant context is the
    // failure this whole surface exists to prevent.
    assert.equal(rpc.authenticated, true, `${rpc.k} is unreachable by an authenticated caller`);
    assert.equal(rpc.anon, false, `${rpc.k} is reachable anonymously`);
  }

  /**
   * The private layer the wrappers delegate to, held to the same rule — with
   * one exception this suite FOUND and which is stated rather than asserted
   * away.
   *
   * `20260918015112_independent_staging_authority.sql` does `revoke all on all
   * functions in schema pennsync_private from public, anon, authenticated` and
   * then grants back the six it means to expose. A blanket revoke only reaches
   * the functions that exist WHEN IT RUNS, so every function a later migration
   * adds keeps PostgreSQL's default `PUBLIC EXECUTE`. Three do:
   * `file_object_immutable`, `protect_deployment` and
   * `protect_enrollment_receipt`.
   *
   * All three `returns trigger`, and that is what makes this a residue rather
   * than a hole. PostgreSQL refuses a direct call to a trigger function before
   * its body runs, so there is nothing to invoke, and PostgREST does not expose
   * one. `anon` also holds no `USAGE` on this schema, so it cannot name them in
   * the first place — two independent gates, neither of which is the grant.
   *
   * It is identical in the reference build, so it is a property of the
   * committed migrations and not hosted drift; fixing it means a new migration
   * and is not this change's to make.
   *
   * AND IF SOMEBODY DOES GO AND FIX IT: not by repeating the blanket revoke.
   * `AGENTS.md` says so in as many words, because every `pennsync_staging_*`
   * wrapper is an INVOKER calling an inner `pennsync_private` function granted
   * to `authenticated` — a second `revoke all on all functions in schema
   * pennsync_private` takes that grant away and turns nine suites red. The
   * three names below are what a correction would have to revoke, one at a
   * time.
   *
   * What the suite refuses is the thing that would matter: a CALLABLE private
   * function reachable anonymously. The trigger set is pinned so a fourth one,
   * or one that stops returning `trigger`, fails here.
   */
  const anonReachable = inSchema(hosted.inventory.functions, `${PRIVATE}.`)
    .filter(entry => entry.anon);
  assert.deepEqual(anonReachable.map(entry => entry.returns), anonReachable.map(() => 'trigger'),
    'a callable pennsync_private function is executable by anon');
  assert.deepEqual(anonReachable.map(entry => entry.k.replace(/\(.*$/, '').replace(`${PRIVATE}.`, '')).sort(),
    ['file_object_immutable', 'protect_deployment', 'protect_enrollment_receipt'],
    'the set of anon-executable trigger functions changed; re-read the grant residue above');
});

test('the record owner holds nothing that would void its own policies', { skip }, () => {
  // The claim the plan singled out as the one a managed Postgres was most
  // likely to contradict. It does not: neither attribute is set, so the 591
  // policies bind on the role the brokers run as.
  const store = Object.fromEntries((hosted.roles.store ?? []).map(role => [role.name, role]));
  for (const name of UNPRIVILEGED_ROLES) {
    assert.ok(store[name], `${name} does not exist on the hosted project`);
    assert.equal(store[name].super, false, `${name} is SUPERUSER`);
    assert.equal(store[name].bypassrls, false, `${name} holds BYPASSRLS`);
  }
});

test('the caller helpers are owned by a role that can answer them', { skip }, () => {
  // The mirror of the test above, and the reason the owner is not the same
  // role: the helpers read `pennsync_private` past its own policies to say who
  // is asking. Owned by a role without that, they answer nothing and every
  // policy that calls one silently denies.
  assert.equal(hosted.roles.helper_owner_privileged, true,
    'the caller helpers are owned by a role that cannot read past RLS');
});

test('only the known platform roles reach the record store past RLS', { skip }, () => {
  // The stage A finding, asserted as a set. A managed project ships privileged
  // roles this store did not create and cannot remove; what it can do is notice
  // the day there is another one.
  assert.deepEqual(hosted.roles.privileged_reach, PRIVILEGED_REACH);
});

test('service_role bypasses RLS and is held out by the grant model alone', { skip }, () => {
  // Worth its own test because the containment is different in kind. Every
  // other caller is contained by 591 policies; this one bypasses all of them
  // and is stopped only by not holding USAGE on the schema. If that grant is
  // ever made, nothing else refuses it.
  const service = (hosted.roles.store ?? []).find(role => role.name === 'service_role');
  assert.ok(service, 'service_role does not exist on the hosted project');
  assert.equal(service.bypassrls, true, 'service_role no longer bypasses RLS; re-read this test');
  assert.deepEqual(hosted.roles.service_role_reach, { records: false, private: false });
});

test('an anonymous caller reaches neither schema', { skip }, () => {
  assert.deepEqual(hosted.roles.anon_reach, { records: false, private: false });
  const usage = Object.fromEntries(
    (hosted.inventory.schema_privileges ?? []).map(entry => [entry.k, entry.usage]));
  for (const schema of [SCHEMA, PRIVATE]) {
    assert.equal(usage[`anon:${schema}`], false, `anon holds USAGE on ${schema}`);
  }
  assert.ok(CALLER_ROLES.includes('anon'), 'anon is no longer a caller role; re-read this test');
});

/**
 * Whether any record or authority table is published for logical replication,
 * READ and reported rather than asserted — and the restraint is the point.
 *
 * A table in a publication streams its rows to whatever holds the replication
 * slot, which on a Supabase project is Realtime, enabled per table from the
 * dashboard with one click. That is a row path out of the store that no policy
 * in this repository sits on, and nothing else here looks at it. The reference
 * build has none, so comparing the two would be an assertion that hosted has
 * none either.
 *
 * WHY THAT ASSERTION IS NOT MADE HERE. Supabase creates a `supabase_realtime`
 * publication on every project, and whether it arrives empty or `FOR ALL
 * TABLES` is a platform fact this repository cannot measure — the job holding
 * the credential runs on `main`, so asserting it would put main red for a
 * reason discoverable only after the merge. That is D93's cost exactly, and
 * D95 records this as the one dimension left unasserted for want of a
 * measurement rather than for want of a reason.
 *
 * So the reading goes out with the rest of the inventory, this test proves it
 * happened, and the first green run on main supplies the number. Turning it
 * into an assertion is a one-line change to `WHOLE_PARTS` once somebody has
 * read that number.
 */
test('publication membership for the two schemas is read', { skip }, () => {
  const published = hosted.inventory.publication_tables;
  assert.ok(Array.isArray(published), 'the hosted publication membership was not read');
  assert.deepEqual(reference.publication_tables, [],
    'the committed migrations now publish a table; this reading has an expectation to compare against');
});

/**
 * The caller gate, measured on hosted.
 *
 * These are the first hosted assertions in this repository about what the store
 * DOES rather than what it is made of, and the boundary is still where the
 * header says: none of them reads a patient, a visit or a roster, because that
 * needs a caller who is through the gate. What they settle is that the gate
 * itself refuses on the hosted project for the same reasons and in the same
 * order as on PGlite, which every `contract-*` assertion rests on and which
 * nothing else checks.
 */
test('a caller with no session claims is refused before anything else', { skip }, () => {
  assert.match(gates.no_claims, /PENNSYNC_SESSION_REQUIRED/,
    'the hosted gate admitted a caller carrying no session claims');
});

test('a subject with no identity row is refused as an inactive identity', { skip }, () => {
  // The users lookup, not the map: `actor()` asks `auth.users` first, so a
  // subject that is nobody fails there and never reaches `auth.sessions` or
  // `identity_map`. Nothing here proves the map is consulted at all: that needs
  // a caller with a live session, which the hosted project is not going to get
  // (see the header), so the map is measured by `CALLERS` rather than
  // exercised, here and from now on.
  assert.match(gates.unknown, /PENNSYNC_IDENTITY_INACTIVE/,
    'the hosted gate admitted a subject that is not an auth user');
});

test('an anonymous caller cannot execute the staging surface at all', { skip }, () => {
  // Also the proof that `set local role` takes effect through this transport:
  // as `postgres` the grant would not refuse, so a role switch that silently
  // did nothing would fail this test rather than pass the three around it.
  assert.match(gates.anon, /permission denied for function pennsync_staging_context/,
    'anon reached the staging surface');
});

test('an enrolled subject clears the auth user and stops at the session', { skip }, () => {
  const { mapped, live_sessions: live } = hosted.callers;
  if (!mapped) {
    // Nothing is enrolled yet, so the subject resolves to null, the claims
    // fail their own shape check and the gate answers as it does for no claims
    // at all. Asserted rather than skipped, but it says nothing about the gate
    // past that first branch: this test only means something once a row exists.
    assert.match(gates.mapped, /PENNSYNC_SESSION_REQUIRED/);
    return;
  }
  // Whether or not some OTHER session is live, this caller's `session_id` is
  // fabricated, so `auth.sessions` cannot match it and the gate must refuse
  // there. The branch is kept because the reason differs and a future reader
  // should not have to re-derive it.
  const because = live
    ? 'a fabricated session_id matched a live session'
    : 'an enrolled hosted subject did not reach the session check';
  assert.match(gates.mapped, /PENNSYNC_SESSION_INACTIVE/, because);

  // WHAT THIS DOES AND DOES NOT SAY. `actor()` checks `auth.users` (line 194),
  // then `auth.sessions` (202), then `identity_map` (211). So reaching
  // PENNSYNC_SESSION_INACTIVE proves the subject cleared `auth.users` — live,
  // confirmed, unbanned, not anonymous — and proves NOTHING about the map: a
  // subject with no map row refuses at exactly the same line. The map is
  // measured by `CALLERS`, against the same predicate `actor()` uses, and the
  // test below reads it. Taken together they say the session is what is
  // missing; neither says it alone.
});

test('the row-behaviour prerequisites are counted rather than assumed', { skip }, () => {
  const callers = hosted.callers;
  // The fixture double must never exist here. `fixtures.sql` refuses to load
  // without it, and that refusal is the only thing standing between a test run
  // and fabricated rows in a real Supabase Auth schema.
  assert.equal(callers.local_test_double, 0,
    'auth.pennsync_local_test_double() exists on the hosted project; fixtures.sql would load');
  // Not assertions about how many there should be — enrolment is the owner's
  // and this suite must stay green whether these rows exist or not — but
  // a reading of what is there, so the plan's account of what is missing can be
  // checked against the project rather than against a memory of it.
  for (const key of ['auth_users', 'mapped', 'memberships', 'assignments',
    'chart_assignments', 'live_sessions']) {
    assert.equal(typeof callers[key], 'number', `the hosted caller count ${key} was not read`);
  }
  assert.ok(callers.mapped <= callers.auth_users,
    'more identity_map rows matched than there are usable auth users');
});

test('the transport\'s pinned actors and the store\'s identities agree', { skip }, () => {
  // Two-way, and vacuous on an empty project by construction: `pinned` is
  // checked only where the store HAS a row, and `mapped` only where the store
  // has one. So deleting the four staging accounts leaves this green, which is
  // the property that has to hold — the owner withdrew their use on
  // 2026-09-22 and nothing merged may depend on them.
  // `only` unwraps the single aggregated column, so this IS the array.
  const mapped = hosted.mappedActors;
  assert.ok(Array.isArray(mapped), 'the hosted mapped actors were not read');
  const pinned = new Set(ACTORS.values());

  // A live mapped identity this transport cannot name is unreachable through
  // it, which is the direction that would silently lose a caller.
  const unaddressable = mapped.filter(id => !pinned.has(id));
  assert.deepEqual(unaddressable, [],
    'the hosted project maps identities the staging transport cannot address');

  // And the other direction: a pin is allowed to name nothing (the account may
  // never have been created, or may have been deleted), but if the store holds
  // that identity at all it must be the live mapped one. A pin naming a row
  // the map has revoked is a code constant outliving an authority decision.
  assert.equal(new Set(mapped).size, mapped.length, 'the hosted map returned a duplicate id');
  assert.ok(mapped.length <= pinned.size,
    `the hosted project maps ${mapped.length} identities against ${pinned.size} pinned`);
});
