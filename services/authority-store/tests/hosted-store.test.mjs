import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { KNOWN_APPS, readMigrations } from '../../../tools-pennsync-provision.mjs';
import { LOCAL_ONLY_MIGRATIONS, ledgerName } from '../../../tools-pennsync-migrate.mjs';
import { isReadOnly } from '../../../tools-pennsync-migrate-shape.mjs';
import { isManagementUrl, openManagementClient } from '../../../tools-pennsync-supabase-db.mjs';

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
 * It proves no row behaviour. Not one assertion here reads a patient, a visit
 * or a roster, because doing that needs seeded callers and a caller in this
 * store is an `auth.users` row: `pennsync_private.identity_map.auth_user_id`
 * carries a foreign key to it. `fixtures.sql` fabricates those rows, which is
 * safe in a throwaway database and is not something to do to a real Supabase
 * Auth schema — the file says so itself and refuses to load anywhere that
 * `auth.pennsync_local_test_double()` is missing, which is every hosted
 * project. Seeding real identities is stage C: ten invitations, each accepted
 * by its own person and verified out of band, and the enrollment tool
 * deliberately cannot create an account. So the hosted proof of isolation
 * waits for stage C, and until then this file proves the half that does not
 * need a caller.
 *
 * That half is not small. It is every claim the row assertions REST on: that
 * the tables are owned by a role whose policies bind, that row level security
 * is not merely enabled but forced, that all 591 policies survived the trip,
 * that the caller helpers are unreachable by the callers they describe, that
 * the contract surface is the committed one, and that nothing holds a direct
 * grant on a record table. A policy nobody obeys and a policy nobody reaches
 * fail in exactly the same way: silently, and only in production.
 *
 * HOW IT DECIDES WHAT IS CORRECT. The expectations are not written down here.
 * They are read out of a PGlite database built from the same committed
 * migrations, by the SAME SQL, and compared. A constant in this file would be a
 * third opinion that drifts from both; a reference build cannot, and it makes
 * the suite say something stronger than "hosted looks sane" — it says hosted is
 * what these migrations produce. The two exceptions are called out where they
 * appear, and both are facts about the platform that a local database has no
 * way to express.
 *
 * IT NEVER WRITES. Every statement is checked with the migrate tool's own
 * `isReadOnly`, which fails closed, before it is sent. A read-only suite that
 * merely intends to be read-only is one careless edit from seeding the hosted
 * project, and this one runs in CI.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const SCHEMA = 'pennsync_records';
const PRIVATE = 'pennsync_private';

/**
 * Roles that must hold no way past a policy. `service_role` is deliberately
 * absent: it holds `BYPASSRLS` on every hosted project and is contained by the
 * grant model instead, which is its own test below.
 *
 * Every import above is a root module that pulls in nothing but node builtins,
 * and that is a constraint rather than a preference — `record-contract-postgres.test.mjs`
 * records why: this suite runs in a CI job that installs only
 * `services/authority-store`'s dependencies, so anything reaching
 * `tools-entity-schema-plan.mjs` fails at load, because that one imports `json5`.
 * The provisioner and the migrate tool qualify, so `KNOWN_APPS` is imported
 * rather than copied and cannot drift from the list a provision enforces.
 */
const UNPRIVILEGED_ROLES = ['pennsync_records_owner', 'anon', 'authenticated'];

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
 * One statement, asked of both databases, so the two sides cannot be measured
 * differently. Everything is aggregated into a single `jsonb` document because
 * each hosted read is an HTTPS round trip, and because `jsonb` sidesteps the
 * bigint-as-string difference between the two drivers.
 */
const INVENTORY = `select jsonb_build_object(
  'tables', (select jsonb_agg(jsonb_build_object(
      'name', c.relname,
      'owner', pg_get_userbyid(c.relowner),
      'rls', c.relrowsecurity,
      'forced', c.relforcerowsecurity) order by c.relname)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = '${SCHEMA}' and c.relkind = 'r'),
  'policies', (select jsonb_agg((tablename || '.' || policyname) order by tablename, policyname)
    from pg_policies where schemaname = '${SCHEMA}'),
  'contracts', (select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'secdef', p.prosecdef,
      'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'anon', has_function_privilege('anon', p.oid, 'execute'))
      order by p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname like 'pennsync_contract_%'),
  'helpers', (select jsonb_agg(jsonb_build_object(
      'name', p.proname,
      'args', pg_get_function_identity_arguments(p.oid),
      'secdef', p.prosecdef,
      'authenticated', has_function_privilege('authenticated', p.oid, 'execute'),
      'anon', has_function_privilege('anon', p.oid, 'execute'))
      order by p.proname, pg_get_function_identity_arguments(p.oid))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = '${SCHEMA}' and p.proname like 'caller%'),
  'functions', (select jsonb_agg(jsonb_build_object(
      'owner', owner, 'secdef', secdef, 'count', n) order by owner, secdef)
    from (select pg_get_userbyid(p.proowner) as owner, p.prosecdef as secdef, count(*) as n
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = '${SCHEMA}' group by 1, 2) grouped),
  'caller_table_grants', (select count(*) from information_schema.role_table_grants
    where table_schema in ('${SCHEMA}', '${PRIVATE}')
      and grantee in ('anon', 'authenticated', 'service_role'))
) as inventory`;

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
 * The target, and the reason a missing one skips rather than fails.
 *
 * A fork's pull request has no secrets, and `pnpm test` on a laptop has no
 * hosted project. Neither is a defect in the store, so neither should turn this
 * suite red; what would be a defect is CI reporting success while quietly
 * running nothing, so the skip says why.
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

/**
 * A client that cannot write, whatever is asked of it.
 *
 * `isReadOnly` is the migrate tool's own scanner and it fails closed: a
 * statement it cannot classify is a write. Wrapping the transport rather than
 * trusting the queries above means an edit to this file cannot reach the hosted
 * project with an `insert`, and means the direct-postgres transport is held to
 * the same rule as the management one.
 */
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
      if (!isReadOnly(sql)) throw new Error('HOSTED_SUITE_IS_READ_ONLY');
      return client.query(sql);
    },
    end: () => client.end(),
  };
}

/** `jsonb` from either driver, as a plain object. */
const only = result => {
  const value = Object.values(result.rows[0])[0];
  return typeof value === 'string' ? JSON.parse(value) : value;
};

let hosted = {};
let reference = {};
let committed = [];

before(async () => {
  if (skip) return;

  // The reference: the same migrations, in the provisioner's own order, minus
  // the ones a deployment deliberately never gets. `readMigrations` is the
  // provisioner's list rather than a directory walk here, so this cannot apply
  // them in an order no deployment uses.
  const reference_db = new PGlite();
  await reference_db.exec(readFileSync(
    resolve(repository, 'services/authority-store/tests/bootstrap.sql'), 'utf8'));
  for (const migration of readMigrations(repository)) {
    if (LOCAL_ONLY_MIGRATIONS[migration.name]) continue;
    committed.push(migration.name);
    await reference_db.exec(migration.sql);
  }
  reference = only(await reference_db.query(INVENTORY));
  await reference_db.close();

  const client = readOnlyClient();
  try {
    hosted = {
      inventory: only(await client.query(INVENTORY)),
      roles: only(await client.query(ROLES)),
      ledger: only(await client.query(LEDGER)),
    };
  } finally { await client.end(); }
});

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

test('the deployment pin names a known app and one row records it', { skip }, () => {
  const { ledger } = hosted;
  assert.equal(ledger.deployment_rows, 1, 'the pin is one row or it is not a pin');
  assert.ok(ledger.app_id in KNOWN_APPS, `${ledger.app_id} is not an app a deployment may serve`);
  assert.equal(ledger.label, KNOWN_APPS[ledger.app_id]);
  // Either is correct; which one it is, is the thing to be able to state. An
  // unset setting resolves to staging, the restrictive outcome.
  assert.ok(['default', 'setting'].includes(ledger.source), `unknown pin source ${ledger.source}`);
});

test('every record table is owned by the record owner, with RLS forced', { skip }, () => {
  const tables = hosted.inventory.tables ?? [];
  assert.ok(tables.length, 'the hosted project holds no record tables');
  const owners = [...new Set(tables.map(table => table.owner))];
  assert.deepEqual(owners, ['pennsync_records_owner'],
    `record tables are owned by ${owners.join(', ')}`);
  // `enable` is not `force`: without the second, the table's own owner reads
  // past every predicate, and the owner is what the brokers run as.
  const unprotected = tables.filter(table => !table.rls || !table.forced);
  assert.deepEqual(unprotected, [], 'record tables without forced row level security');
});

test('the reference build produced a store to compare against', { skip }, () => {
  // Guarding the comparison below rather than the reference for its own sake.
  // Every assertion there is a `deepEqual` against this document, and two
  // absent values are equal: a reference that silently came out empty would
  // turn the strongest test in this file into one that passes without reading
  // anything. `readMigrations` returning nothing is all it would take.
  assert.ok(committed.length > 1, `the reference applied ${committed.length} migrations`);
  for (const part of ['tables', 'policies', 'contracts', 'helpers', 'functions']) {
    assert.ok(Array.isArray(reference[part]) && reference[part].length,
      `the reference build produced no ${part}`);
  }
});

test('the hosted store is exactly what the committed migrations produce', { skip }, () => {
  // Compared as whole documents rather than as counts, so a table, a policy or
  // a contract that exists on one side and not the other names itself.
  assert.deepEqual(hosted.inventory.tables, reference.tables);
  assert.deepEqual(hosted.inventory.policies, reference.policies);
  assert.deepEqual(hosted.inventory.contracts, reference.contracts);
  assert.deepEqual(hosted.inventory.helpers, reference.helpers);
  assert.deepEqual(hosted.inventory.functions, reference.functions);
});

test('no caller role holds a direct grant on a record or authority table', { skip }, () => {
  // The whole surface is meant to be the brokers. A direct grant would let a
  // caller read the table itself, where the only thing between it and another
  // agency's rows is a policy that calls helpers it cannot execute.
  assert.equal(hosted.inventory.caller_table_grants, 0);
  assert.equal(reference.caller_table_grants, 0);
});

test('the contract surface is reachable by callers and closed to anonymous ones', { skip }, () => {
  const contracts = hosted.inventory.contracts ?? [];
  assert.ok(contracts.length, 'the hosted project exposes no contracts');
  for (const contract of contracts) {
    // Security INVOKER, deliberately: the wrapper is a name in `public` for
    // PostgREST to find, and the privilege it runs with has to stay the
    // caller's so the broker it calls is the only thing that elevates.
    assert.equal(contract.secdef, false, `${contract.name} is security definer`);
    assert.equal(contract.authenticated, true, `${contract.name} is unreachable by a caller`);
    assert.equal(contract.anon, false, `${contract.name} is reachable anonymously`);
  }
});

test('the caller helpers are unreachable by the callers they describe', { skip }, () => {
  const helpers = hosted.inventory.helpers ?? [];
  assert.ok(helpers.length, 'the hosted project holds no caller helpers');
  for (const helper of helpers) {
    // A policy expression runs with the querying role's privileges, so a caller
    // granted `execute` here could ask "who am I" directly and answer it for
    // somebody else.
    assert.equal(helper.secdef, true, `${helper.name} is not security definer`);
    assert.equal(helper.authenticated, false, `${helper.name} is executable by a caller`);
    assert.equal(helper.anon, false, `${helper.name} is executable anonymously`);
  }
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
});
