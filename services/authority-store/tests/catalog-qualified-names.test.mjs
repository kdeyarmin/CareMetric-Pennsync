import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../../../tools-pennsync-provision.mjs';

/**
 * Every `pg_catalog.<name>(` in the migrations names something that exists.
 *
 * `LEAST`, `GREATEST`, `COALESCE` and `NULLIF` are SQL CONSTRUCTS, not
 * catalogued functions, so they cannot be schema-qualified at all:
 * `pg_catalog.least(a, b)` raises `function pg_catalog.least(...) does not
 * exist` the first time the body runs. `pennsync_records.operational_limit`
 * shipped with exactly that, and because a plpgsql body does not resolve names
 * at creation, the migration applied cleanly and eight capabilities died on any
 * non-null limit.
 *
 * WHERE THE HABIT COMES FROM, AND WHY DROPPING THE PREFIX IS SAFE. That
 * function is declared `immutable set search_path = ''`, which is why its body
 * reached for a qualification in the first place: under an empty search path a
 * real function MUST be qualified or it is not found, and every other qualified
 * call in this store is correct for that reason. A construct is not a schema
 * object, so it resolves under an empty search path with no qualification at
 * all, and removing the prefix adds no search-path exposure. That is why the
 * failure below says DROP the prefix -- sending the next author to find the
 * right schema for `least` sends them somewhere that does not exist.
 *
 * WHY A GUARD AND NOT A FIX. The tree holds hundreds of qualified calls over
 * forty-odd distinct names, and all but one work ONLY because they happen to be
 * real functions. Nothing distinguishes the two kinds by reading:
 * `pg_catalog.coalesce(...)` is consistent with every neighbour, identical in
 * shape to `pg_catalog.lower(...)` beside it, and dead on first call. So the
 * question is not whether the one instance is fixed — it is whether the next
 * one can reach a store. D126: a name that RESOLVES and a name that PARSES are
 * not the same kind; resolve every instance, never generalise from the ones
 * that work.
 *
 * WHICH DIRECTORIES. Both, and not by a choice made here: the population is
 * `readMigrations`, the same reader a provision uses, so this scans exactly
 * what a provision applies and cannot drift from it. Picking a directory would
 * be the error the defect is an instance of — the constructs are a fact about
 * SQL, and a directory is not a domain. #315 settled the same question the
 * same way for the two whole-store guards, with its own `MIGRATION_DIRECTORIES`
 * list; this takes the population from the reader instead, because a second
 * copy of a directory list is a thing that can disagree with the first.
 *
 * THE CHARACTER CLASS INCLUDES DIGITS, and that is a measurement rather than
 * care. A first draft matched `[a-z_]+`, which does not fail on `md5` — it
 * matches nothing at all, because the `5` is neither whitespace nor `(`. So the
 * scan went silently BLIND over `pg_catalog.md5(` and `pg_catalog.sha256(`,
 * both of which this store uses, and reported 45 names where there are 47. It
 * found the right answer for the wrong population, which is the failure this
 * whole guard is about, arriving inside the guard. The control below pins both
 * names as SCANNED, so narrowing the class again fails here rather than going
 * quiet.
 *
 * COMMENTS ARE NOT STRIPPED, deliberately. A qualified name written inside a
 * comment would fail this test although it executes nothing — a false positive,
 * loud, and fixed by deleting four characters. The alternative is a comment
 * stripper that has to respect single quotes and dollar-quoting, and one that
 * gets a `$fn$` body wrong goes BLIND over everything inside it. A blind spot
 * in the guard is the worse failure, and no match in the tree today sits in a
 * comment.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const QUALIFIED = /pg_catalog\.([a-z0-9_]+)\s*\(/g;

/** name -> the migrations that qualify it, so a failure says where to look. */
function qualifiedNames() {
  const found = new Map();
  for (const migration of readMigrations(repository)) {
    for (const [, name] of migration.sql.matchAll(QUALIFIED)) {
      if (!found.has(name)) found.set(name, new Set());
      found.get(name).add(join(migration.from, migration.name));
    }
  }
  return found;
}

/** Whether `pg_catalog` really holds a function of that name. */
async function resolves(db, name) {
  const { rows } = await db.query(
    'select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace'
    + " where ns.nspname = 'pg_catalog' and p.proname = $1 limit 1", [name]);
  return rows.length > 0;
}

test('every pg_catalog name the migrations qualify is a real function', async () => {
  const found = qualifiedNames();
  assert.ok(found.size > 0, 'expected the migrations to qualify some pg_catalog names');
  const db = await PGlite.create();
  try {
    const unresolved = [];
    for (const [name, files] of [...found].sort()) {
      if (!await resolves(db, name)) unresolved.push(`${name} (${[...files].sort().join(', ')})`);
    }
    assert.deepEqual(unresolved, [],
      'pg_catalog holds no function of this name. If it is a construct -- least, greatest,'
      + ' coalesce, nullif -- DROP the prefix: it is not a schema object, so it resolves'
      + " under an empty search_path unqualified and loses nothing. Otherwise the name"
      + ' itself is misspelt, and that is what to fix');
  } finally {
    await db.close();
  }
});

/**
 * The probe proved to report ABSENCE as well as presence.
 *
 * Without this the test above is one silent `resolves` away from passing on
 * every tree ever — a query that returned a row for everything, or a regex that
 * matched nothing, reads exactly like a clean store. `lower` is what makes its
 * speech mean something and `pennsync_no_such_function` is what makes its
 * silence mean something.
 *
 * The four constructs are here because they are the guard's actual subject. Any
 * of them could be typed tomorrow, all four read as house style, and asserting
 * them ABSENT states the fact the guard rests on rather than leaving it in a
 * comment. If PostgreSQL ever catalogues one, this fails loudly and the guard's
 * reasoning gets re-read, which is the right outcome.
 */
test('the resolver reports absence, and the four constructs are absent', async () => {
  // The scan reaches names with a digit in them. Both are real functions, so
  // neither can ever fail the test above -- which is exactly why their absence
  // from the scanned set would say nothing, and has to be asserted here.
  const scanned = qualifiedNames();
  for (const digits of ['md5', 'sha256']) {
    assert.ok(scanned.has(digits),
      `${digits} is qualified in this store; if the scan no longer sees it, the`
      + ' character class has gone blind over every name containing a digit');
  }

  const db = await PGlite.create();
  try {
    assert.equal(await resolves(db, 'lower'), true, 'pg_catalog.lower is a real function');
    assert.equal(await resolves(db, 'pennsync_no_such_function'), false,
      'the resolver must be able to report a name that is not there');
    for (const construct of ['least', 'greatest', 'coalesce', 'nullif']) {
      assert.equal(await resolves(db, construct), false,
        `${construct} is a SQL construct; if it is now catalogued, re-read this guard`);
    }
  } finally {
    await db.close();
  }
});

/**
 * The guard must stay SILENT on the correct form, and that is a real population
 * rather than a hypothetical one.
 *
 * `least` and `greatest` are used unqualified across the committed migrations,
 * which is the right way to write them and is what this defect's fix turns the
 * broken call into. A guard that fired on those would be worse than no guard:
 * it would read as a rule against using the constructs at all, and the obvious
 * way to quiet it is to put the prefix back.
 *
 * Silence is not evidence by itself -- a pattern that matched nothing would be
 * just as quiet -- so this plants both forms and asserts the pattern separates
 * them, and then asserts the store really does hold the correct form, so the
 * silence is about something that is there. The two halves fail for different
 * reasons: widen the pattern and the first goes; delete the last unqualified
 * call and the second goes, which is a signal worth having either way.
 */
test('the scan sees the qualified form and not the correct one', () => {
  const planted = 'select pg_catalog.least(a, b), least(c, d), greatest(e, f);';
  const seen = [...planted.matchAll(QUALIFIED)].map(([, name]) => name);
  assert.deepEqual(seen, ['least'],
    'the pattern must match the qualified call and neither bare construct;'
    + ' a guard that fires on `least(a, b)` invites the prefix back');

  const bare = /(^|[^.a-z0-9_])(least|greatest)\s*\(/;
  const correct = readMigrations(repository)
    .filter(migration => bare.test(migration.sql))
    .map(migration => join(migration.from, migration.name));
  assert.ok(correct.length > 0,
    'no committed migration calls least or greatest unqualified any more, so this'
    + " test's silence proves nothing; find where the correct form went");
});
