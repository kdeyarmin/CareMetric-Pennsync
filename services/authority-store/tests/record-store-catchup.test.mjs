import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { RECORD_MIGRATION_FILE } from '../../../tools-entity-schema-plan.mjs';
import {
  CATCHUP_MIGRATION, DISTRIBUTION_INDEX, INDEX_CATCHUP_MIGRATION,
  readDistributionIndex, readProfileBlock, renderCatchup, renderIndexCatchup,
} from '../../../tools-pennsync-record-catchup.mjs';

/**
 * The forward migration that carries a regenerated record store into a
 * deployment that already applied it (D88).
 *
 * The defect this exists for is not a wrong policy; it is a policy that never
 * arrived. `20260919170000_record_store.sql` is generated and was regenerated
 * for D82, the ledger keys on the migration's NAME with no content hash, and
 * so the four objects reached every fresh build and no existing store. Every
 * suite in this directory passed throughout, because every suite in this
 * directory builds from nothing — which is precisely the case that cannot see
 * it.
 *
 * So the test that matters here is the second one: it builds a store from the
 * record migration as it stood BEFORE the block was added, which is what the
 * hosted project is running, and proves the catch-up closes the gap. Asserting
 * that the catch-up "creates a policy" against a database that already has one
 * would pass with the file empty.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const catchup = () => readFileSync(resolve(repository, CATCHUP_MIGRATION), 'utf8');
const recordStore = () => readFileSync(resolve(repository, RECORD_MIGRATION_FILE), 'utf8');

/**
 * What the four D82 objects look like to the hosted comparison.
 *
 * The same columns `hosted-store.test.mjs` reads — `md5(prosrc)` for the body,
 * the owner, the trigger's own definition, the policy's two expressions —
 * because a catch-up that produced an EQUIVALENT store rather than the same
 * one would close this test and leave that one red.
 */
const SHAPE = `select jsonb_build_object(
  'function', (select jsonb_agg(jsonb_build_object(
      'owner', pg_get_userbyid(p.proowner), 'cfg', coalesce(p.proconfig::text, ''),
      'body', md5(p.prosrc), 'public_execute', has_function_privilege('public', p.oid, 'execute')))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'pennsync_records' and p.proname = 'user_self_write_guard'),
  'trigger', (select jsonb_agg(pg_get_triggerdef(t.oid))
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'pennsync_records' and c.relname = 'user' and not t.tgisinternal),
  'policy', (select jsonb_agg(jsonb_build_object(
      'name', policyname, 'cmd', cmd, 'qual', qual, 'with_check', with_check) order by policyname)
    from pg_policies where schemaname = 'pennsync_records' and tablename = 'user')
) as shape`;

const shapeOf = async db => (await db.query(SHAPE)).rows[0].shape;

/** The authority store the record migration is applied on top of. */
async function authority(target) {
  await target.exec(await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8'));
  const dir = new URL('../supabase/migrations/', import.meta.url);
  for (const name of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
    await target.exec(await readFile(new URL(name, dir), 'utf8'));
  }
}

let beforeD82 = {};
let afterCatchup = {};
let fresh = {};
let freshThenCatchup = {};

before(async () => {
  // The hosted case: the record migration as it was when that store applied
  // it. Cut by removing the exact block the catch-up carries, so the two
  // cannot describe different changes.
  const stale = recordStore().replace(readProfileBlock(repository), '');
  assert.notEqual(stale, recordStore(), 'the D82 block was not found to remove');
  const existing = new PGlite();
  await authority(existing);
  await existing.exec(stale);
  beforeD82 = await shapeOf(existing);
  await existing.exec(catchup());
  afterCatchup = await shapeOf(existing);
  await existing.close();

  // The fresh case: the generated migration in full, then the catch-up after
  // it, which is the order a provision runs them in.
  const provisioned = new PGlite();
  await authority(provisioned);
  await provisioned.exec(recordStore());
  fresh = await shapeOf(provisioned);
  await provisioned.exec(catchup());
  freshThenCatchup = await shapeOf(provisioned);
  await provisioned.close();
});

test('the catch-up is derived from the generated migration, not typed beside it', () => {
  // The whole point of the tool: change `PROFILE_SELF_WRITABLE` or the guard
  // and this fails until the catch-up moves with it. A hand-kept second copy
  // would drift in the one direction nothing else measures — a deployment
  // getting an older rule than a fresh build.
  // Line by line, because `assert.equal` over a 90-line file prints both
  // copies and names nothing — the failure a reader gets should be the line
  // that moved, which is the same reason `hosted-store.test.mjs` reports keys
  // rather than diffing arrays.
  assert.deepEqual(catchup().split('\n'), renderCatchup(repository).split('\n'),
    'run `node tools-pennsync-record-catchup.mjs --write`');
});

test('a store that applied the record migration before D82 was missing all four objects', () => {
  // The state the hosted comparison actually found, asserted rather than
  // assumed: if the cut did not remove them, the next test proves nothing.
  assert.equal(beforeD82.function, null, 'the guard function was already present');
  assert.equal(beforeD82.trigger, null, 'the guard trigger was already present');
  const names = (beforeD82.policy ?? []).map(entry => entry.name);
  assert.deepEqual(names, ['user_read'], `policies on user: ${names.join(', ')}`);
});

test('the catch-up gives that store exactly what a fresh build has', () => {
  // Field for field against the fresh build, not merely "a policy exists".
  // `md5(prosrc)` and `pg_get_triggerdef` are what the hosted comparison
  // reads, so equality here is the thing that turns that job green.
  assert.deepEqual(afterCatchup, fresh);
});

test('applying it to a store that already has them changes nothing', () => {
  // A provision runs the generated file and then this one, so the second
  // application has to be a no-op down to the function body's hash — the
  // reason each statement carries its idempotent form rather than a guard
  // around it.
  assert.deepEqual(freshThenCatchup, fresh);
});

test('the guard is still closed to public, which the rewrite could have dropped', () => {
  // `create or replace function` keeps an existing function's privileges and
  // gives a NEW one the default `execute to public`. The catch-up carries the
  // generated `revoke`, and this is the assertion that fails if a future
  // rewrite loses it on the path where the function is created rather than
  // replaced.
  assert.deepEqual(afterCatchup.function.map(entry => entry.public_execute), [false]);
});

/*
 * The SECOND derivation, and the first time D88's rule was applied on purpose
 * rather than after the fact.
 *
 * D89 adds `policy_acknowledgment_distribution_unique` to the generated
 * migration, which is a change to what a NEW store gets and reaches no
 * deployment that already ran the file. The index is the whole of
 * `contract_policy_distribute`'s idempotency — without it the contract's
 * `unique_violation` branch is unreachable and every redistribution writes a
 * duplicate assignment — so a store missing it does not fail, it silently
 * double-assigns.
 */
const indexCatchup = () =>
  readFileSync(resolve(repository, INDEX_CATCHUP_MIGRATION), 'utf8');

/** The index as the hosted comparison sees it: by name, with its definition. */
const INDEX_SHAPE = `select jsonb_build_object(
  'index', (select jsonb_agg(jsonb_build_object('name', indexname, 'def', indexdef)
      order by indexname)
    from pg_indexes where schemaname = 'pennsync_records'
      and tablename = 'policy_acknowledgment')
) as shape`;
const indexShapeOf = async db => (await db.query(INDEX_SHAPE)).rows[0].shape;

let beforeIndex = {};
let afterIndexCatchup = {};
let freshIndex = {};
let freshThenIndexCatchup = {};

before(async () => {
  const statement = readDistributionIndex(repository);
  const stale = recordStore().replace(statement, '');
  assert.notEqual(stale, recordStore(), 'the D89 index was not found to remove');
  const existing = new PGlite();
  await authority(existing);
  await existing.exec(stale);
  beforeIndex = await indexShapeOf(existing);
  await existing.exec(indexCatchup());
  afterIndexCatchup = await indexShapeOf(existing);
  await existing.close();

  const provisioned = new PGlite();
  await authority(provisioned);
  await provisioned.exec(recordStore());
  freshIndex = await indexShapeOf(provisioned);
  await provisioned.exec(indexCatchup());
  freshThenIndexCatchup = await indexShapeOf(provisioned);
  await provisioned.close();
});

test('the index catch-up is derived from the generated migration too', () => {
  assert.deepEqual(indexCatchup().split('\n'), renderIndexCatchup(repository).split('\n'),
    'run `node tools-pennsync-record-catchup.mjs --write`');
});

test('a store that applied the record migration before D89 has no distribution key', () => {
  // Asserted, not assumed, for the reason the D82 pair states: if the cut left
  // the index in place, the next test proves nothing.
  const names = (beforeIndex.index ?? []).map(entry => entry.name);
  assert.equal(names.includes(DISTRIBUTION_INDEX), false, names.join(', '));
});

test('the index catch-up gives that store exactly what a fresh build has', () => {
  // `indexdef` and not merely the name: an index over the right columns
  // without the partial predicate is a different constraint, and it is the
  // predicate that lets a row with no agency exist at all.
  assert.deepEqual(afterIndexCatchup, freshIndex);
});

test('applying the index catch-up to a store that already has it changes nothing', () => {
  // `if not exists` rather than a drop and recreate: dropping a unique index
  // on a live table opens exactly the window the index is there to close, and
  // on a big table the rebuild takes a lock nobody asked for.
  assert.deepEqual(freshThenIndexCatchup, freshIndex);
});
