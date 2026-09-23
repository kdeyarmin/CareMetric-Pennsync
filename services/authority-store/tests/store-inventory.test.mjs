import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../../../tools-pennsync-provision.mjs';
import { LOCAL_ONLY_MIGRATIONS } from '../../../tools-pennsync-migrate.mjs';
import { INVENTORY, KEYED_PARTS, WHOLE_PARTS, inventoryFaults } from './store-inventory.mjs';

/**
 * What `hosted-store.test.mjs` can SEE, proved by planting drift rather than by
 * reading its SQL.
 *
 * That suite is this project's answer to "do the prerequisites hold": every
 * deployment question routes to it, and its green reading is taken as proof
 * that the committed migrations and the hosted store are the same artifact. So
 * its blind spots are the project's blind spots, and until this file existed
 * nothing measured them — the only way to find one was for it to cost
 * something first.
 *
 * WHY THIS IS A SEPARATE SUITE AND NOT A HOSTED ASSERTION. Nothing here needs
 * a credential, a hosted project or a network. It builds the committed store
 * twice in PGlite, damages one copy, and asks the SAME `INVENTORY` statement
 * and the SAME `inventoryFaults` differencer the hosted suite sends whether
 * the damage shows up. That makes the hosted check's coverage a thing that
 * runs in `pnpm test` on every pull request, rather than a property somebody
 * has to re-derive by reading 200 lines of catalog SQL.
 *
 * THE DAMAGES ARE NOT A WISH LIST. Each one was BLIND when this file was
 * written, measured that way in a scratch build before the inventory was
 * widened (D95), and each is a real change to what the store does:
 *
 *   a view beside a record table   reads every tenant's rows past every policy
 *   a column default dropped       D33's `granted_at`; every pre-existing
 *                                  writer inserts without naming it
 *   a generated column made plain  D34's `membership_key`, which replaces a
 *                                  forty-line `validateMemberships`
 *   a trigger disabled             every immutability and provenance guard in
 *                                  this store is a trigger
 *   an index left invalid          a unique index that enforces nothing, which
 *                                  is what four contracts catch by name (D78)
 *   an argument default removed    PostgREST resolves an RPC by the names of
 *                                  the body's keys, so the defaults decide
 *                                  which call shapes exist at all
 *   STRICT or LEAKPROOF changed    both live outside `prosrc`, so the body
 *                                  digest cannot see either
 *   CREATE granted on a schema     `usage` was asked and `create` was not
 *
 * The last three cases are the CONTROLS, and they are here for a reason rather
 * than for symmetry: a foreign key's ON DELETE action, a policy widened to
 * `true` and a rewritten function body were all covered already, and the first
 * of those READ as a blind spot for twenty minutes because the scratch harness
 * that "proved" it had quietly dropped `constraints` from its own copy of the
 * inventory. A suite that only ever asserts the gaps it just closed cannot
 * tell a real gap from a hole in itself.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/**
 * The committed store, in the provisioner's own order, minus what a deployment
 * never gets — the same build the hosted suite compares against.
 */
async function build() {
  const db = new PGlite();
  await db.exec(readFileSync(
    resolve(repository, 'services/authority-store/tests/bootstrap.sql'), 'utf8'));
  let applied = 0;
  for (const migration of readMigrations(repository)) {
    if (LOCAL_ONLY_MIGRATIONS[migration.name]) continue;
    await db.exec(migration.sql);
    applied += 1;
  }
  return { db, applied };
}

const read = async db => {
  const [row] = (await db.query(INVENTORY)).rows;
  const value = Object.values(row)[0];
  return typeof value === 'string' ? JSON.parse(value) : value;
};

/**
 * One damaged build carrying every case, rather than one build per case.
 *
 * Twelve reference builds is ninety seconds of `pnpm test` for a property that
 * needs two, and the faults are asserted INDIVIDUALLY below, so a damage that
 * masked another would fail on the masked one's own assertion rather than pass
 * on a count.
 *
 * Two of them poke the catalog directly because PostgreSQL offers no DDL for
 * what they simulate: an argument default can only be changed by replacing the
 * function, and an index is left invalid by a `create index concurrently` that
 * failed, which cannot happen inside a transaction. The hosted store gets into
 * both states through a migration that differs or a build that broke; a
 * throwaway PGlite database is the only place to stand in for either.
 */
const DAMAGE = [
  // A view over a record table, created by a privileged role and granted to
  // callers. Proved on a real PostgreSQL 16 cluster rather than assumed: as
  // `authenticated` the base table answers `permission denied` and the view
  // answers the row.
  `create view pennsync_records.patient_everything as select * from pennsync_records.patient`,
  `grant select on pennsync_records.patient_everything to authenticated`,
  `alter table pennsync_private.chart_assignment alter column granted_at drop default`,
  `alter table pennsync_private.membership alter column membership_key drop expression`,
  `alter table pennsync_private.chart_assignment disable trigger provenance_immutable`,
  `update pg_index set indisvalid = false
     where indexrelid = 'pennsync_private.chart_assignment_request_key'::regclass`,
  `update pg_proc set pronargdefaults = 0, proargdefaults = null
     where oid = 'public.pennsync_contract_roster_list(text,integer,text)'::regprocedure`,
  `alter function pennsync_private.s3_hash(jsonb) called on null input`,
  `alter function pennsync_private.s4_utf16_length(text) leakproof`,
  `grant create on schema pennsync_records to authenticated`,
  // The controls: three dimensions that were already covered.
  `alter table pennsync_private.identity_map drop constraint identity_map_auth_user_id_fkey`,
  `alter table pennsync_private.identity_map add constraint identity_map_auth_user_id_fkey
     foreign key (auth_user_id) references auth.users(id) on delete cascade`,
  `alter policy patient_read on pennsync_records.patient using (true)`,
  `create or replace function pennsync_records.caller_agencies() returns setof text
     language sql stable security definer set search_path = '' as $$ select 'x'::text $$`,
];

/**
 * Each damage, and the fault the comparison has to report for it.
 *
 * The expectation is a SUBSTRING of the fault line rather than a category, so a
 * case cannot be satisfied by some other damage failing in the same part.
 */
const EXPECTED = [
  ['a view over a record table',
    'tables: present on hosted only: pennsync_records.patient_everything'],
  ['a column default dropped',
    'columns: pennsync_private.chart_assignment.granted_at.default: committed "clock_timestamp()"'],
  ['a generated column made plain',
    'columns: pennsync_private.membership.membership_key.generated: committed "s"'],
  ['a trigger disabled',
    'triggers: pennsync_private.chart_assignment.provenance_immutable.enabled: committed "O" hosted "D"'],
  ['a unique index left invalid',
    'indexes: pennsync_private.chart_assignment.chart_assignment_request_key.valid: committed true'],
  ['an argument default removed',
    'functions: public.pennsync_contract_roster_list(p_agency text, p_limit integer, p_after text).args:'],
  ['STRICT dropped from a helper',
    'functions: pennsync_private.s3_hash(p_value jsonb).strict: committed true hosted false'],
  ['LEAKPROOF added to a helper',
    'functions: pennsync_private.s4_utf16_length(p_text text).leakproof: committed false hosted true'],
  ['CREATE granted on the record schema', 'schema_privileges: committed'],
  ['CONTROL a foreign key action changed',
    'constraints: pennsync_private.identity_map.identity_map_auth_user_id_fkey.def:'],
  ['CONTROL a policy widened to true',
    'policies: pennsync_records.patient.patient_read.qual:'],
  ['CONTROL a function body rewritten',
    'functions: pennsync_records.caller_agencies().body:'],
];

let reference;
let damaged;
let applied = 0;

before(async () => {
  const base = await build();
  applied = base.applied;
  reference = await read(base.db);
  await base.db.close();

  const target = await build();
  for (const sql of DAMAGE) await target.db.exec(sql);
  damaged = await read(target.db);
  await target.db.close();
}, { timeout: 180_000 });

test('the reference build produced a store worth comparing', () => {
  // The guard the hosted suite keeps for the same reason: two absent values are
  // equal, so a reference that came out empty would make every assertion below
  // pass without reading anything.
  assert.ok(applied > 1, `the reference applied ${applied} migrations`);
  for (const part of KEYED_PARTS) {
    assert.ok(Array.isArray(reference[part]) && reference[part].length,
      `the reference build produced no ${part}`);
  }
  for (const part of WHOLE_PARTS) {
    assert.ok(reference[part] !== undefined, `the reference build read no ${part}`);
  }
});

test('an undamaged build differs from itself in nothing', () => {
  // The other half of the guard, and the one that decides whether the
  // assertions below mean anything: a differencer that reported faults for
  // everything would satisfy all twelve of them and prove nothing.
  assert.deepEqual(inventoryFaults(reference, reference), []);
});

for (const [name, expected] of EXPECTED) {
  test(`the inventory reports ${name}`, () => {
    const faults = inventoryFaults(reference, damaged);
    assert.ok(faults.some(fault => fault.includes(expected)),
      `no fault named this drift.\n  expected a fault containing: ${expected}\n`
      + `  ${faults.length} fault(s) reported:\n    ${faults.slice(0, 20).join('\n    ')}`);
  });
}

test('the expectations are distinct and their number is pinned', () => {
  // What this does NOT do is count faults against damages. A first draft
  // asserted `faults.length >= EXPECTED.length` and passed with NINE of the
  // twelve cases blind, because one undetected view contributes seventy
  // column faults on its own — a number that looks like coverage and is
  // noise. The per-case assertions above are the whole of the guard; this one
  // only stops a case being added to `DAMAGE` without saying what it must
  // report, and stops two cases sharing an expectation that one of them
  // satisfies alone.
  assert.equal(EXPECTED.length, 12, 'a damage was added or removed without its expectation');
  assert.equal(new Set(EXPECTED.map(([, fault]) => fault)).size, EXPECTED.length,
    'two cases share an expected fault, so one of them proves nothing');
});
