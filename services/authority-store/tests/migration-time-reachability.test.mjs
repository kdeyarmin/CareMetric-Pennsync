/**
 * D114. `MIGRATION_CODES` names the `PENNSYNC_*` codes a failing migration can
 * print, and D110 deliberately excludes a code raised inside a CREATE FUNCTION
 * body: that is a refusal answered to a caller at runtime, not a migration
 * failure. The exclusion is right, and it rests on a property nobody was
 * checking — that no such body can RUN while a migration applies. It held by
 * observation, and the way it would stop holding is silent: a constraint added
 * in a later migration is validated against the rows already present, so a
 * CHECK calling one of this store's own functions executes that function at
 * migration time, and its refusal would print with no name.
 *
 * So this asserts what is REACHABLE at migration time. Not "nothing is
 * invoked", which is false today and was the first form of this decision: the
 * deployment pin's two CHECK constraints really do call two of our functions.
 * Neither raises, which is the whole claim.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { readMigrationTimeCalls, reachableFrom } from './migration-time-calls.mjs';

const MIGRATION_DIRECTORIES = Object.freeze(['../supabase/migrations/', '../supabase/record-migrations/']);
const base = fileURLToPath(new URL('../supabase/.temp/', import.meta.url));

/** Every code a migration-time call can raise, following what each body calls. */
function reachableCodes({ called, declared }) {
  const reached = reachableFrom([...called.keys()], declared);
  const undeclared = [...reached].filter(name => !declared.has(name)).sort();
  const codes = new Set();
  for (const name of reached) for (const code of declared.get(name)?.codes || []) codes.add(code);
  return { reached, undeclared, codes: [...codes].sort() };
}

async function fixture(files, run) {
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(resolve(base, 'migration-time-'));
  // Checked where it is created, not where it is removed: a guard that throws
  // from `finally` would mask whatever the test was really failing on.
  if (!resolve(root).startsWith(resolve(base) + sep + 'migration-time-')) throw new Error('UNSAFE_TEST_FIXTURE');
  try {
    for (const [name, sql] of Object.entries(files)) await writeFile(resolve(root, name), sql);
    await run(await readMigrationTimeCalls([pathToFileURL(root + sep)]));
  } finally {
    await rm(root, { recursive: true });
  }
}

const raiser = (name, code) => `create function pennsync_private.${name}() returns boolean\n`
  + `language plpgsql as $$\nbegin\n  raise exception using errcode='42501',message='${code}';\n`
  + '  return true;\nend $$;\n';

test('the parser reads both migration directories, and can read every body it finds', async () => {
  for (const relative of MIGRATION_DIRECTORIES) {
    const one = await readMigrationTimeCalls([new URL(relative, import.meta.url)]);
    // Per directory rather than over the union: a renamed or moved directory
    // would otherwise scan nothing and ride on the other one's answer, which is
    // the defect D110 was written about arriving inside its follow-up.
    assert.ok(one.declared.size > 0, `expected ${relative} to declare functions`);
  }
  const store = await readMigrationTimeCalls(MIGRATION_DIRECTORIES.map(d => new URL(d, import.meta.url)));

  // Nothing unplaced. An unparsed shape is a failure somebody resolves, never a
  // quiet pass: tolerating one is the escape hatch that makes this vacuous.
  assert.deepEqual(store.unclassified.map(o => `${o.file}: ${o.name} in ${o.statement.trim().slice(0, 80)}`), [],
    'this could not say whether these run at migration time; classify the statement kind');

  // Controls on the parser itself, in the direction that fails silently: a body
  // it cannot name drops that function out of the raising set entirely.
  assert.ok(store.raising.size > 150, `only ${store.raising.size} raising bodies — the scan has stopped seeing them`);
  assert.ok(store.declared.size > 500, `only ${store.declared.size} declared bodies — the scan has stopped seeing them`);
});

test('exactly two functions are called while a migration applies, and neither raises', async () => {
  const store = await readMigrationTimeCalls(MIGRATION_DIRECTORIES.map(d => new URL(d, import.meta.url)));

  // The exact set, not membership. "No raiser appears among the invoked" is
  // satisfied by a correct answer AND by a parser that found nothing; an
  // equality is satisfied only by the first.
  assert.deepEqual([...store.called.keys()].sort(),
    ['pennsync_private.app_admitted', 'pennsync_private.deployment_app_id']);
  assert.deepEqual([...store.called].flatMap(([name, sites]) => sites.map(s => `${name} <- ${s.file} (${s.kind})`)).sort(), [
    'pennsync_private.app_admitted <- 20260919090000_deployment_app_pin.sql (alter_domain)',
    'pennsync_private.deployment_app_id <- 20260919090000_deployment_app_pin.sql (alter_table)',
  ], 'the pin migration adds `deployment_app_is_pinned` and `deployment_matches_pin`, both validated on apply');

  const { undeclared, codes } = reachableCodes(store);
  // Both are written by `execute format($fn$ create function … $fn$)` inside a
  // do-block. A segmenter that stripped generated SQL left the one function a
  // CHECK constraint actually calls with no readable body, and answered
  // correctly anyway because it raises nothing — so this names the gap rather
  // than relying on the answer.
  assert.deepEqual(undeclared, [], 'no body for these, so what they raise is unknown, not empty');
  assert.deepEqual(codes, [],
    'a code reachable at migration time prints with no name; D110 excludes function bodies on the premise that this stays empty');
});

test('a call from a CHECK constraint is caught, transitively', async () => {
  await fixture({
    '20260926000000_planted_reachable.sql': raiser('planted_raiser', 'PENNSYNC_PLANTED_REACHABLE')
      + 'alter table pennsync_private.planted\n'
      + '  add constraint planted_is_checked check (pennsync_private.planted_raiser());\n',
    '20260926000001_planted_transitive.sql': raiser('planted_inner', 'PENNSYNC_PLANTED_TRANSITIVE')
      + 'create function pennsync_private.planted_outer() returns boolean\n'
      + 'language sql as $fn$ select pennsync_private.planted_inner() $fn$;\n'
      + 'alter domain pennsync_private.planted_domain\n'
      + '  add constraint planted_domain_checked check (pennsync_private.planted_outer(value));\n',
  }, store => {
    assert.deepEqual([...store.called.keys()].sort(),
      ['pennsync_private.planted_outer', 'pennsync_private.planted_raiser']);
    const { reached, codes } = reachableCodes(store);
    // The transitive half is the one the real store only passes by coincidence:
    // its two functions are each named by a constraint of their own, so a
    // depth-one reading finds the pair and proves nothing about the link.
    assert.deepEqual([...reached].sort(), ['pennsync_private.planted_inner',
      'pennsync_private.planted_outer', 'pennsync_private.planted_raiser']);
    assert.deepEqual(codes, ['PENNSYNC_PLANTED_REACHABLE', 'PENNSYNC_PLANTED_TRANSITIVE']);
  });
});

test('naming a function without calling it stays invisible', async () => {
  await fixture({
    '20260926000002_planted_references.sql':
      'create function pennsync_private.planted_trigger_fn() returns trigger\n'
      + "language plpgsql as $$\nbegin\n  raise exception using errcode='42501',message='PENNSYNC_PLANTED_UNREACHABLE';\nend $$;\n"
      + 'create trigger planted_immutable before update on pennsync_private.planted\n'
      + '  for each row execute function pennsync_private.planted_trigger_fn();\n'
      + 'grant execute on function pennsync_private.planted_trigger_fn() to authenticated;\n'
      + 'revoke all on function pennsync_private.planted_trigger_fn() from public;\n'
      + "comment on function pennsync_private.planted_trigger_fn() is 'named, not called';\n"
      + 'create policy planted_read on pennsync_private.planted for select\n'
      + '  using (pennsync_private.planted_trigger_fn() is not null);\n',
  }, store => {
    // Over-approximating a reference set does not make this safely stricter:
    // the real preconditions hold 162 `to_regprocedure` lookups naming contract
    // functions, most of which raise. A ratchet that counted those would fail on
    // arrival and be deleted.
    assert.deepEqual([...store.called.keys()], []);
    assert.deepEqual(reachableCodes(store).codes, []);
    assert.deepEqual([...store.raising.keys()], ['pennsync_private.planted_trigger_fn'],
      'the body must still be read — invisible here means not CALLED, not not seen');
  });
});

test('a statement kind this cannot place is reported, not dropped', async () => {
  await fixture({
    '20260926000003_planted_unparsed.sql': 'call pennsync_private.planted_procedure();\n',
  }, store => {
    assert.deepEqual(store.unclassified.map(o => o.name), ['pennsync_private.planted_procedure']);
    assert.deepEqual([...store.called.keys()], [],
      'an unplaced occurrence must not be silently counted either way');
  });
});
