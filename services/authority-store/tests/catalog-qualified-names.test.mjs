import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { readMigrations } from '../../../tools-pennsync-provision.mjs';
import { LOCAL_ONLY_MIGRATIONS } from '../../../tools-pennsync-migrate.mjs';

/**
 * Every `pg_catalog.<name>(` a BUILT store will execute names something real.
 *
 * `LEAST`, `GREATEST`, `COALESCE` and `NULLIF` are SQL CONSTRUCTS, not
 * catalogued functions, so they cannot be schema-qualified at all:
 * `pg_catalog.least(a, b)` raises `function pg_catalog.least(...) does not
 * exist` the first time the body runs. `pennsync_records.operational_limit`
 * shipped with exactly that, and because a plpgsql body does not resolve names
 * at creation, the migration applied cleanly and seven list capabilities died
 * on any non-null limit -- which the route seam always sends.
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
 * WHY A GUARD AND NOT A FIX. The store holds hundreds of qualified calls over
 * forty-odd distinct names, and all but one worked ONLY because they happen to
 * be real functions. Nothing distinguishes the two kinds by reading:
 * `pg_catalog.coalesce(...)` is consistent with every neighbour, identical in
 * shape to `pg_catalog.lower(...)` beside it, and dead on first call. So the
 * question is not whether the one instance is fixed -- it is whether the next
 * one can reach a store. D126: a name that RESOLVES and a name that PARSES are
 * not the same kind; resolve every instance, never generalise from the ones
 * that work.
 *
 * WHY IT READS `pg_proc` AND NOT THE MIGRATION TEXT, which is D135 and was
 * learned here the hard way. The first version scanned the SQL files. That
 * answers "was a broken qualification ever written", where the question worth
 * gating is "will a broken qualification ever RUN" -- and after D88 those two
 * permanently diverge. An applied migration is frozen, so the repair is a
 * forward `create or replace`, so the broken text stays in the tree for good
 * with a correct definition layered over it. A file scan is red on that line
 * forever, and the only way to quiet it is to break D88. Worse, the forward
 * migration's own header explains the bug it fixes, in prose, quoting the
 * broken call -- so the fix made a file scan MORE red, in two files at once.
 *
 * Building the store and reading `prosrc` answers the question that matters. A
 * superseded definition is not in `pg_proc`; a header comment is not in a body;
 * what is there is exactly what a caller will execute. It is the same
 * correction batch C made to a different instrument on the same night: text
 * chunked on create-function boundaries said eight callers, `pg_proc` said
 * seven, and the difference was a `revoke` block belonging to no body (D132).
 *
 * WHICH MIGRATIONS. `readMigrations` less `LOCAL_ONLY_MIGRATIONS`, the same
 * build the hosted comparison uses -- so this is the store a deployment gets,
 * rather than a directory chosen here. Picking a directory would be the error
 * the defect is an instance of: the constructs are a fact about SQL, and a
 * directory is not a domain.
 *
 * THE CHARACTER CLASS INCLUDES DIGITS, and that is a measurement rather than
 * care. A first draft matched `[a-z_]+`, which does not fail on `md5` -- it
 * matches nothing at all, because the `5` is neither whitespace nor `(`. So the
 * scan went silently BLIND over `pg_catalog.md5(` and `pg_catalog.sha256(`,
 * both of which this store uses. It found the right answer for the wrong
 * population, which is the failure this whole guard is about, arriving inside
 * the guard. The control below pins both names as SCANNED, so narrowing the
 * class again fails here rather than going quiet.
 *
 * COMMENTS INSIDE A BODY ARE NOT STRIPPED, deliberately, and reading `prosrc`
 * is what makes that affordable. A comment stripper must respect single quotes
 * and dollar-quoting, and one that gets a `$fn$` body wrong goes BLIND over
 * everything inside it -- a blind spot in the guard being far worse than a loud
 * false positive that four deleted characters fix. The surface is a function
 * body now rather than a whole file, and no body in the store carries such a
 * comment.
 */
const repository = resolve(fileURLToPath(new URL('../../../', import.meta.url)));

/** The qualified form. The digits are load-bearing; see the docblock. */
const QUALIFIED = /pg_catalog\.([a-z0-9_]+)\s*\(/g;

/** The correct form, used only to prove the scan does NOT see it. */
const BARE = /(^|[^.a-z0-9_])(least|greatest)\s*\(/;

/** The migration holding the original, superseded definition. */
const SUPERSEDED = '20260920580000_contract_operational_tables.sql';

/** The committed store as a deployment gets it, in the provisioner's order. */
async function build() {
  const db = new PGlite();
  await db.exec(readFileSync(
    resolve(repository, 'services/authority-store/tests/bootstrap.sql'), 'utf8'));
  for (const migration of readMigrations(repository)) {
    if (LOCAL_ONLY_MIGRATIONS[migration.name]) continue;
    await db.exec(migration.sql);
  }
  return db;
}

/**
 * Every function body the store ended up with, by qualified name.
 *
 * `create or replace` leaves one row, so this is each function's FINAL
 * definition and never a superseded one. System schemas are excluded because
 * PostgreSQL's own catalog is not this store's to answer for.
 */
async function bodies(db) {
  const { rows } = await db.query(
    "select ns.nspname || '.' || p.proname as name, p.prosrc as src"
    + ' from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace'
    + " where ns.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')"
    + ' and p.prosrc is not null');
  return rows;
}

/** name -> the store functions whose bodies qualify it. */
function qualifiedNames(rows) {
  const found = new Map();
  for (const { name, src } of rows) {
    for (const [, qualified] of String(src).matchAll(QUALIFIED)) {
      if (!found.has(qualified)) found.set(qualified, new Set());
      found.get(qualified).add(name);
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

test('every pg_catalog name a built store will execute is a real function', async () => {
  const db = await build();
  try {
    const rows = await bodies(db);
    assert.ok(rows.length > 0, 'the build produced no function bodies to read');
    const found = qualifiedNames(rows);
    assert.ok(found.size > 0, 'expected the store to qualify some pg_catalog names');

    const unresolved = [];
    for (const [name, holders] of [...found].sort()) {
      if (!await resolves(db, name)) {
        unresolved.push(`${name} (${[...holders].sort().join(', ')})`);
      }
    }
    assert.deepEqual(unresolved, [],
      'pg_catalog holds no function of this name. If it is a construct -- least,'
      + ' greatest, coalesce, nullif -- DROP the prefix: it is not a schema object,'
      + ' so it resolves under an empty search_path unqualified and loses nothing.'
      + ' Otherwise the name itself is misspelt, and that is what to fix. Either'
      + ' way the repair is a FORWARD create-or-replace, never an edit to the'
      + ' migration that already applied (D88)');
  } finally {
    await db.close();
  }
});

/**
 * The probe proved to report ABSENCE as well as presence, and the scan proved
 * to reach the names it claims to.
 *
 * Without this the test above is one silent `resolves` away from passing on
 * every store ever -- a query that returned a row for everything, or a regex
 * that matched nothing, reads exactly like a clean build. `lower` is what makes
 * its speech mean something and `pennsync_no_such_function` is what makes its
 * silence mean something.
 *
 * The four constructs are here because they are the guard's actual subject. Any
 * of them could be typed tomorrow, all four read as house style, and asserting
 * them ABSENT states the fact the guard rests on rather than leaving it in a
 * comment. If PostgreSQL ever catalogues one, this fails loudly and the guard's
 * reasoning gets re-read, which is the right outcome.
 */
test('the resolver reports absence, and the four constructs are absent', async () => {
  const db = await build();
  try {
    // The scan reaches names with a digit in them. Both are real functions, so
    // neither can ever fail the test above -- which is exactly why their
    // absence from the scanned set would say nothing, and has to be asserted.
    const scanned = qualifiedNames(await bodies(db));
    for (const digits of ['md5', 'sha256']) {
      assert.ok(scanned.has(digits),
        `${digits} is qualified in this store's function bodies; if the scan no`
        + ' longer sees it, the character class has gone blind over every name'
        + ' containing a digit');
    }

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
 * `least` and `greatest` are used unqualified across the store, which is the
 * right way to write them and is what this defect's fix turned the broken call
 * into. A guard that fired on those would be worse than no guard: it would read
 * as a rule against using the constructs at all, and the obvious way to quiet
 * it is to put the prefix back.
 *
 * Silence is not evidence by itself -- a pattern that matched nothing would be
 * just as quiet -- so this plants both forms and asserts the pattern separates
 * them, then asserts the store really does hold the correct form, so the
 * silence is about something that is there. The two halves fail for different
 * reasons: widen the pattern and the first goes; lose the last unqualified call
 * and the second goes, which is a signal worth having either way.
 */
test('the scan sees the qualified form and not the correct one', async () => {
  const planted = 'select pg_catalog.least(a, b), least(c, d), greatest(e, f);';
  const seen = [...planted.matchAll(QUALIFIED)].map(([, name]) => name);
  assert.deepEqual(seen, ['least'],
    'the pattern must match the qualified call and neither bare construct;'
    + ' a guard that fires on `least(a, b)` invites the prefix back');

  const db = await build();
  try {
    const correct = (await bodies(db)).filter(({ src }) => BARE.test(String(src)));
    assert.ok(correct.length > 0,
      'no function in the built store calls least or greatest unqualified any'
      + " more, so this test's silence proves nothing; find where the correct"
      + ' form went');
  } finally {
    await db.close();
  }
});

/**
 * Why this reads the catalog and not the files, asserted rather than described.
 *
 * The migration that shipped the defect still contains `pg_catalog.least`,
 * because D88 forbids editing a migration that has already applied and the
 * repair shipped as a forward `create or replace`. A file scan is therefore red
 * on this tree for good, and the quiet way to make one green is exactly the
 * edit D88 exists to prevent -- so if somebody ever "fixes" the guard that way,
 * this fails and says which rule they broke.
 *
 * It asserts the FILE still holds it and the STORE does not. Either half alone
 * is satisfied by the wrong world: the first by a store nobody repaired, the
 * second by a tree somebody edited.
 */
test('the superseded text survives in the file and not in the store', async () => {
  const original = readMigrations(repository).find(m => m.name === SUPERSEDED);
  assert.ok(original, `${SUPERSEDED} is gone from the migration set`);
  assert.match(original.sql, /pg_catalog\.least\s*\(/,
    'the applied migration no longer carries the original call. If it was edited'
    + ' to quiet a scan, that is the D88 violation this asserts against; if the'
    + ' migration was legitimately removed, delete this test with a note saying'
    + ' so');

  const db = await build();
  try {
    const [row] = (await db.query(
      "select prosrc from pg_proc where proname = 'operational_limit'")).rows;
    assert.ok(row, 'operational_limit is not in the built store at all');
    assert.doesNotMatch(String(row.prosrc), /pg_catalog\.least\s*\(/,
      'the forward migration did not take effect; the store still executes the'
      + ' broken call');
  } finally {
    await db.close();
  }
});
