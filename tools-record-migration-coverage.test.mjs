// Proof that the record-migration coverage closure bites, and that the
// paragraph it replaces cannot come back.
//
// Two halves, for `tools-decision-register.test.mjs`'s reason. The sabotage
// cases run over SYNTHETIC suite directories, so the predicate is proved
// unconditionally in any checkout with no real tree involved. The real tree is
// asserted separately, and what it asserts is MEMBERSHIP — the two suites that
// only read the SQL as text, the one applier that names the directory nowhere,
// and that all three application routes are populated — rather than any count.
// A count here would be the figure the prose is forbidden to carry, moved one
// file sideways.
//
// WIRED IN `test:utils`. `src/testRegistryContract.test.js:58-63` enumerates
// root `tools-*.test.{js,mjs}` and orphans anything absent from the `test:*`
// script bodies, while its workflow-step fallback is in the SECOND test and
// scoped to `services/` — so for a file here a workflow step is not a home.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  SUITE_DIRECTORY, RECORD_DIRECTORY, classifySuites, coverageProblems, coverageLine,
} from './tools-record-migration-coverage.mjs';

const codes = problems => problems.map(p => p.split(/[:\s]/, 1)[0]).sort();

// The synthetic tree carries one suite of each kind the real one has, named for
// the route rather than for a capability, so a failure says which shape broke.
const FIXTURE = {
  // Route `helper`: 57 of the real suites look like this.
  'helper.test.mjs':
    "import { applyRecordMigrations } from './record-migrations.mjs';\n"
    + 'const db = new PGlite();\nawait applyRecordMigrations(db);\n',
  // Route `inline_pair`: four of them iterate the two directories themselves.
  'inline.test.mjs':
    'const db = new PGlite();\n'
    + "for (const dir of ['../supabase/migrations/', '../supabase/record-migrations/']) {\n"
    + '  await load(db, dir);\n}\n',
  // Text only: names the directory and executes nothing.
  'text.test.mjs':
    "const sql = readFileSync('../supabase/record-migrations/20260919170000_record_store.sql', 'utf8');\n"
    + "assert.match(sql, /create table/);\n",
  // Route `transitive`, and the whole reason the closure is not a subset count:
  // it applies the directory and mentions it nowhere in its own source.
  'transitive.test.mjs':
    "import { buildStore } from './store-helper.mjs';\nconst db = await buildStore();\n",
  'store-helper.mjs':
    "import { applyRecordMigrations } from './record-migrations.mjs';\n"
    + 'export const buildStore = async () => {\n  const db = new PGlite();\n'
    + '  await applyRecordMigrations(db);\n  return db;\n};\n',
  // Present so the sibling walk has the module the two helpers import.
  'record-migrations.mjs': 'export const applyRecordMigrations = async () => {};\n',
};

const plant = (extra = {}) => {
  const root = mkdtempSync(join(tmpdir(), 'record-coverage-'));
  const dir = join(root, SUITE_DIRECTORY);
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries({ ...FIXTURE, ...extra })) {
    writeFileSync(join(dir, name), text);
  }
  return root;
};

// The control. Without it every refusal below could be refusing for a reason
// that has nothing to do with the sabotage — the fixture failing to classify at
// all would read exactly like a working check.
test('the synthetic tree is the shape the real one is, and passes clean', () => {
  const result = classifySuites(plant());
  assert.deepEqual(result.suites, ['helper.test.mjs', 'inline.test.mjs', 'text.test.mjs', 'transitive.test.mjs']);
  assert.deepEqual(result.namers, ['helper.test.mjs', 'inline.test.mjs', 'text.test.mjs']);
  assert.deepEqual(result.appliers, ['helper.test.mjs', 'inline.test.mjs', 'transitive.test.mjs']);
  assert.deepEqual(result.textReaders, ['text.test.mjs']);
  assert.deepEqual(result.byRoute, {
    helper: ['helper.test.mjs'],
    inline_pair: ['inline.test.mjs'],
    transitive: ['transitive.test.mjs'],
  });
  assert.deepEqual(result.unclassified, []);
  assert.deepEqual(coverageProblems(result), []);
});

test('it refuses: a namer that applies the directory by an unknown route', () => {
  // The case the closure exists for. This suite names the directory, builds a
  // store and reaches neither the shared helper nor the literal pair, so the
  // classifier can place it in neither bucket — which is exactly what a new way
  // of applying the migrations would look like.
  const rogue = {
    'rogue.test.mjs':
      "const files = readdirSync('../supabase/record-migrations');\n"
      + 'const db = new PGlite();\nfor (const f of files) await db.exec(read(f));\n',
  };
  const clean = classifySuites(plant());
  const result = classifySuites(plant(rogue));
  assert.notDeepEqual(result.unclassified, clean.unclassified,
    'the planted suite changed nothing in the classification, so this case proves nothing');
  assert.deepEqual(result.unclassified, ['rogue.test.mjs']);
  assert.deepEqual(codes(coverageProblems(result)), ['CLOSURE_BROKEN', 'UNCLASSIFIED_NAMER']);
});

test('it refuses: every applier naming the directory, which is the retracted form becoming measurable', () => {
  // Not a defect in the tree — a signal that the reason the page's sentence was
  // rejected has gone. If no applier is outside the namers, the subset form
  // "of the N that name it, M apply it" is measurable again, and the paragraph
  // needs re-reading rather than this check needing relaxing.
  const named = {
    'transitive.test.mjs':
      `// Applies record-migrations through its own helper.\n${FIXTURE['transitive.test.mjs']}`,
  };
  const clean = classifySuites(plant());
  const result = classifySuites(plant(named));
  assert.deepEqual(clean.namers.includes('transitive.test.mjs'), false);
  assert.deepEqual(result.namers.includes('transitive.test.mjs'), true,
    'the sabotage did not make the transitive applier a namer, so this case proves nothing');
  // The closure itself still holds, which is the point: this is the one problem
  // the identity cannot see, so it is asserted separately.
  assert.deepEqual(codes(coverageProblems(result)), ['NO_UNNAMED_APPLIER']);
});

test('the two predicates classifySuites cannot produce are proved on a crafted result, and that is why', () => {
  // `BUCKETS_OVERLAP` is unreachable from `classifySuites`, which appends to one
  // bucket or the other and never both, and a bare `CLOSURE_BROKEN` is too —
  // the rogue case above always raises `UNCLASSIFIED_NAMER` beside it. A guard
  // nothing can fire has not been shown to work, so they are driven through the
  // exported predicate directly rather than left asserted by their presence.
  // Each crafted result carries an applier outside the namers, so only the
  // predicate under test fires and the verdict is about that predicate.
  const overlap = {
    namers: ['a.test.mjs'], appliers: ['a.test.mjs', 'u.test.mjs'],
    textReaders: ['a.test.mjs'], unclassified: [],
  };
  assert.deepEqual(codes(coverageProblems(overlap)), ['BUCKETS_OVERLAP', 'CLOSURE_BROKEN']);

  const miscounted = {
    namers: ['a.test.mjs', 'b.test.mjs'], appliers: ['a.test.mjs', 'z.test.mjs'],
    textReaders: [], unclassified: [],
  };
  assert.deepEqual(codes(coverageProblems(miscounted)), ['CLOSURE_BROKEN']);
  assert.match(coverageProblems(miscounted)[0], /1\+0!=2/,
    'the failure must print both sides, because the two numbers are the finding');
});

test('the real tree closes, and the exceptions are named rather than counted', () => {
  const result = classifySuites();
  console.log(`  ${coverageLine(result)}`);
  assert.deepEqual(coverageProblems(result), []);

  // The two suites the residual-gap paragraph is about: they read the SQL as
  // text, so a forward migration applying cleanly says nothing about them.
  assert.deepEqual(result.textReaders,
    ['http-boundary.test.mjs', 'migration-time-reachability.test.mjs'],
    'the set of suites that only read the record SQL as text has moved. That set is what '
    + "AGENTS.md's residual-gap sentence is about, so read the paragraph before editing this.");

  // The applier outside the namers. One is enough to make the subset form
  // unmeasurable, and this is the one.
  assert.deepEqual(result.appliers.filter(suite => !result.namers.includes(suite)),
    ['public-wrapper-execution.test.mjs']);

  // Every route populated, so none of the three is dead code being carried.
  for (const [route, suites] of Object.entries(result.byRoute)) {
    assert.ok(suites.length > 0, `route ${route} matched nothing, so it is unproven here`);
  }
  // And the closure is not vacuous: there is something in each half.
  assert.ok(result.appliers.length > result.textReaders.length);
});

test('AGENTS.md does not reassert the form that cannot be measured', () => {
  const page = readFileSync(new URL('./AGENTS.md', import.meta.url), 'utf8');
  for (const claim of ['apply it whole', 'proved by none of them']) {
    assert.equal(page.includes(claim), false,
      `AGENTS.md carries "${claim}" again. The first is the subset form, which cannot be `
      + `measured on this tree because one applier names ${RECORD_DIRECTORY} nowhere; the `
      + 'second was false in the direction that invents a hazard, since most of the suites '
      + 'build a store from that directory. Run tools-record-migration-coverage.mjs and '
      + 'state the closure, not a pair of numbers.');
  }
});
