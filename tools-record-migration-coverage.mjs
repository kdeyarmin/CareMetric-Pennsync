// Which authority-store suites actually APPLY the record migration directory.
//
// `AGENTS.md` carried a sentence of the form "of the N suites that name that
// directory, exactly M apply it whole". That form cannot be measured on this
// tree, and the reason is not that N or M had drifted: it makes the appliers a
// SUBSET of the namers, and one applier names the directory nowhere —
// `public-wrapper-execution.test.mjs` reaches it through its own helper module.
// So the sentence was unmeasurable rather than merely stale, and no corrected
// pair of numbers fixes it.
//
// It was also wrong in the direction that INVENTS a hazard: it said a forward
// record migration's effect on any other contract is proved by none of the
// suites, when nearly all of them build a store from that directory. The reason
// is one fact about one file — `record-migrations.mjs` applies the WHOLE record
// directory in deployment order — so a suite reaching it through that helper
// applies every file, and the old description of a hand-listed build by constant
// is the shape that existed before the helper did. A reader acting on it would
// have written coverage that already exists.
//
// **So this file deliberately publishes no figure for a page to quote.** Five
// probe shapes across three hands produced five answers in one afternoon, three
// of them confidently, and a sixth shape would have produced a sixth. What is
// asserted instead is a CLOSURE over the real set:
//
//   every suite that names the directory either builds a store from it or only
//   reads its SQL as text, and there is no third kind.
//
// A suite that applies the directory by a route this classifier does not know
// is a namer in neither bucket, so the identity fails and names it. That is the
// property worth pinning, because it survives every new suite; a count does not.
//
// The residual gap is real and narrower than the page claimed, and the page now
// says the narrow version: applying a file is not asserting against it. What is
// closed by construction is the BUILD — a forward migration that cannot apply
// breaks 62 suites. What is only as good as each suite's own assertions is the
// BEHAVIOUR.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const SUITE_DIRECTORY = 'services/authority-store/tests';

/** The directory whose coverage is in question, as the suites spell it. */
export const RECORD_DIRECTORY = 'record-migrations';

// The three discriminators, each a property of the SOURCE rather than of a file
// name, and each named so a failure says which one answered.
//
// `BUILDS_STORE` is the load-bearing one and is why the two buckets cannot
// collapse into each other: a suite that reads the SQL as text to grep it is
// not covered by the migration applying, and a suite that executes it is.
// Defining the text-readers as "namers minus appliers" would make the identity
// below a tautology — the defect `tools-decision-register.mjs` records about
// `max - |absent| == |headings|`, which could not fail.
const BUILDS_STORE = /new PGlite\b|\bdb\.exec\(|new Pool\b/;

/**
 * Reaching it through the shared helper, which is how most of them do it.
 *
 * `applyRecordMigrations` ONLY, and the omission is the point: `recordMigrationNames`
 * merely ENUMERATES the directory, as does `assertNewestRecordMigration`, so matching
 * either would let a suite that lists filenames and builds a store for an unrelated
 * reason be counted as applying one. No suite in the tree has that shape today — every
 * file naming `recordMigrationNames` also names `applyRecordMigrations` — so this
 * narrowing changes no current classification and removes a way the count could become
 * wrong without anything failing.
 *
 * What this proves is bounded, and the bound is worth stating: the applying call appears
 * in the source of a suite that builds a store. Static source cannot prove the call was
 * reached at run time, and this does not claim to. Such a suite lands in `appliers`
 * rather than in the closure's text half, and the remaining way to be wrong is a call
 * that is present and dead.
 */
const HELPER_CALL = /\bapplyRecordMigrations\b/;

/**
 * Iterating the authority and record directories as a literal pair, which four
 * do inline. NOT sufficient on its own: `http-boundary.test.mjs` and
 * `migration-time-reachability.test.mjs` carry the same literal and execute
 * nothing, so this is only ever read together with `BUILDS_STORE`.
 */
const DIRECTORY_PAIR =
  /['"]\.\.\/supabase\/migrations\/['"]\s*,\s*['"]\.\.\/supabase\/record-migrations\/['"]/;

/**
 * Execing the text of a NAMED record migration, read through a path constant.
 *
 * The fourth route, and it was exposed rather than invented: `record-store-catchup.test.mjs`
 * builds a store by reading `RECORD_MIGRATION_FILE` and the catch-up files through the
 * generator's own exported path constants and `exec`ing the text, which is neither the
 * helper nor the inline pair. It had been landing in `transitive` for a reason that was
 * not true — it imported `./record-migrations.mjs` for the ordering guard alone, so
 * `applyRecordMigrations` appeared in its CLOSURE while nothing called it, which is the
 * "present and dead" failure this file's own `HELPER_CALL` docstring names. Retiring that
 * guard removed the import and the misclassification surfaced at once, which is the
 * closure working.
 *
 * Matched on the constants rather than on a path literal because the constants live in
 * `tools-pennsync-record-catchup.mjs` and `tools-entity-schema-plan.mjs`, which are not
 * siblings and so are outside the import closure this file walks. A suite naming one of
 * them is naming a record migration BY FILE, which is what the route is.
 */
const FILE_CONSTANT =
  /\b(RECORD_MIGRATION_FILE|SOURCE_MIGRATION|CATCHUP_MIGRATION|INDEX_CATCHUP_MIGRATION|DEFAULTS_CATCHUP_MIGRATION|TABLES_CATCHUP_MIGRATION)\b/;

/** A sibling module in the same directory, which may apply on a suite's behalf. */
const SIBLING_IMPORT = /from\s+['"]\.\/([A-Za-z0-9._-]+\.mjs)['"]/g;

const read = (dir, name) => readFileSync(join(dir, name), 'utf8');

/**
 * Every module a suite's own source reaches through sibling imports, transitively.
 * `public-wrapper-execution.test.mjs` is the whole reason this exists: it applies
 * the directory and mentions it nowhere.
 */
function reachable(dir, entry, sources) {
  const seen = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    const name = queue.pop();
    for (const match of (sources.get(name) ?? '').matchAll(SIBLING_IMPORT)) {
      const next = match[1];
      if (!sources.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return [...seen];
}

/**
 * @returns {{suites: string[], namers: string[], appliers: string[],
 *            textReaders: string[], byRoute: Record<string, string[]>,
 *            unclassified: string[]}}
 */
export function classifySuites(repository = '.') {
  const dir = join(repository, SUITE_DIRECTORY);
  const files = readdirSync(dir).filter(name => name.endsWith('.mjs')).sort();
  const sources = new Map(files.map(name => [name, read(dir, name)]));
  const suites = files.filter(name => name.endsWith('.test.mjs'));

  const namers = [];
  const appliers = [];
  const textReaders = [];
  const byRoute = { helper: [], inline_pair: [], transitive: [], file_constant: [] };

  for (const suite of suites) {
    const own = sources.get(suite);
    const closure = reachable(dir, suite, sources);
    const anywhere = closure.map(name => sources.get(name)).join('\n');

    const namesIt = own.includes(RECORD_DIRECTORY);
    if (namesIt) namers.push(suite);

    // A store built anywhere in the closure, by a route that reaches the
    // record directory anywhere in the closure.
    const store = BUILDS_STORE.test(anywhere);
    const route = !store ? null
      : HELPER_CALL.test(own) ? 'helper'
        : (DIRECTORY_PAIR.test(own) ? 'inline_pair'
          : HELPER_CALL.test(anywhere) || DIRECTORY_PAIR.test(anywhere) ? 'transitive'
            : FILE_CONSTANT.test(own) ? 'file_constant' : null);

    if (route) {
      appliers.push(suite);
      byRoute[route].push(suite);
    } else if (namesIt && !store) {
      textReaders.push(suite);
    }
  }

  // Named rather than counted: a namer the classifier placed in neither bucket
  // is a sixth expression of "applies it", and the point is to learn WHICH.
  const placed = new Set([...appliers, ...textReaders]);
  const unclassified = namers.filter(suite => !placed.has(suite));

  return { suites, namers, appliers, textReaders, byRoute, unclassified };
}

/**
 * The closure, as a list of problems. Empty is the passing state.
 *
 * Deliberately NOT a count comparison a page could quote. The first assertion
 * is the one that catches a new route; the second and third keep the two
 * buckets meaning what their names say.
 */
export function coverageProblems(result = classifySuites()) {
  const { namers, appliers, textReaders, unclassified } = result;
  const problems = [];

  if (unclassified.length) {
    problems.push(`UNCLASSIFIED_NAMER:${unclassified.join(',')} — names `
      + `${RECORD_DIRECTORY} but was read as neither applying it nor reading it as `
      + 'text. Either it applies it by a route this classifier does not know, in '
      + 'which case add the route here, or it is a third kind and this closure is '
      + 'the wrong shape.');
  }

  const both = appliers.filter(suite => textReaders.includes(suite));
  if (both.length) problems.push(`BUCKETS_OVERLAP:${both.join(',')}`);

  // The identity, stated so a failure prints both sides. Appliers are NOT a
  // subset of namers, so it is the INTERSECTION that closes against the
  // text-readers — which is exactly the arithmetic the page's sentence form
  // could not express.
  const namingAppliers = appliers.filter(suite => namers.includes(suite));
  if (namingAppliers.length + textReaders.length !== namers.length) {
    problems.push(`CLOSURE_BROKEN:${namingAppliers.length}+${textReaders.length}`
      + `!=${namers.length}`);
  }

  if (!appliers.some(suite => !namers.includes(suite))) {
    problems.push('NO_UNNAMED_APPLIER — every applier names the directory, so the '
      + "page's subset form would be measurable again and this closure is no longer "
      + 'the reason it was rejected. Re-read AGENTS.md before relaxing anything.');
  }

  return problems;
}

/** One line for a human, with the composition spelled out. */
export function coverageLine(result = classifySuites()) {
  const { suites, namers, appliers, textReaders, byRoute } = result;
  const unnamed = appliers.filter(suite => !namers.includes(suite));
  return `record migration coverage: ${suites.length} suites, ${namers.length} name the `
    + `directory, ${appliers.length} build a store from it `
    + `(helper=${byRoute.helper.length} inline-pair=${byRoute.inline_pair.length} `
    + `transitive=${byRoute.transitive.length} file-constant=${byRoute.file_constant.length}), `
    + `${textReaders.length} read it as text only, `
    + `${unnamed.length} applier(s) name it nowhere`;
}

if (process.argv[1] && process.argv[1].endsWith('tools-record-migration-coverage.mjs')) {
  const result = classifySuites();
  console.log(coverageLine(result));
  for (const suite of result.textReaders) console.log(`  text only: ${suite}`);
  for (const suite of result.appliers.filter(s => !result.namers.includes(s))) {
    console.log(`  applies without naming it: ${suite}`);
  }
  const problems = coverageProblems(result);
  for (const problem of problems) console.log(`  PROBLEM ${problem}`);
  process.exitCode = problems.length ? 1 : 0;
}
