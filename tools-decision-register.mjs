// Membership of the decision register's `## D<n>` headings.
//
// The register is what every other claim in this project is checked against,
// and four programs write or verify it with different scopes: the collector
// that splices entries, the amender that applies addenda, the per-entry
// verifier, and (until this file) an untracked harness nobody ran. Between
// them they guard the order and adjacent duplication of the collector's own
// output (`collect-decisions.mjs:121`, which tests `<=`), distinctness of the
// base (`:51`), and the heading COUNT across an amendment
// (`amend-entry.mjs:60`). None of them asks WHICH numbers the document holds.
// That is what this asserts.
//
// It replaces `max - |absent| == |headings|`, which could not fail: `absent`
// is derived as `range(1, max) - set(headings)`, so both sides move together
// on every input and the equation reduces to a distinctness check. It fired on
// one sabotage of seven — the duplicate, the trial anybody reaches for — which
// is worse than firing on none, because a column of `true` teaches its reader
// that a case is covered.
export const DOCUMENT_PATH = 'docs/BASE44_EXIT_DECISIONS_2026-09-19.md';

// The numbers a collection adds. AUTHORED, and it must stay authored.
//
// **The guard on this list is that a human typed it, and there is no
// mechanical one.** Any check that derives the expected set from something
// reintroduces the defect above one level up, so there is nothing to add here
// that would help. A first draft took it as `set(head) - set(base)` and was
// blind to exactly the sabotage it was written for, both sides falling by one.
// `READ_ONLY` in `services/authority-store/tests/record-brokers.test.mjs:47`
// is the same discipline for the same reason — typed in, so the thing under
// test cannot supply its own expectation.
//
// The owed `D<n>.md` working directory is the natural thing to dry this up
// against and is the one thing not to reach for: files arrive there as entries
// are written and are tidied away once filed, so wiring the expectation to it
// would make coverage drift with its contents, and an entry would stop being
// protected at the moment its working file was cleaned up, with nothing
// failing. Measured: it held two of this collection's entries, so a check
// wired to it would have reported the other thirty-three as unexpected.
//
// **It is PER-COLLECTION and goes inert rather than wrong.** Once a collection
// merges, the base holds those numbers too, `base | EXPECTED_NEW` equals the
// base, and the check carries on guarding membership across EVERY entry rather
// than these. Inert is not spent: rewrite the list for the next collection,
// and do not delete it because it has become a subset — that reading is the
// plausible wrong move and this paragraph is the whole defence against it.
//
// **This paragraph governs THIS list only.** `BASE_NUMBERS` below is typed too
// and runs on a different clock: the collection list goes inert when this
// collection merges, the base list goes stale when `main`'s own copy of the
// document changes, and a reader who carries "inert, not wrong" across to it
// gets the wrong answer. A base that has moved is wrong rather than inert, and
// the corroboration test is what says so.
export const EXPECTED_NEW = Object.freeze([
  181, 182, 183, 185, 186, 189, 190, 191, 192, 193, 194, 195, 197, 198, 199,
  201, 202, 203, 204, 205, 206, 207, 208, 210, 211, 212, 213, 215, 217, 218,
  220, 221, 222, 223, 224,
]);

// The base's own numbers, TYPED like the list above and for the same reason.
//
// The first version of this check read them out of `origin/main` with
// `git show`, on the stated ground that `ci.yml` checks out at
// `fetch-depth: 0` so the base is guaranteed. **CI refuted that on the first
// run**: depth is not the same as having the ref. `actions/checkout` creates a
// remote-tracking ref for the branch it checks out and `origin/main` was not
// resolvable, so the one test that compared against the real document failed
// with its own diagnostic. The reasoning was sound and the premise was a
// setting read for something it does not say — which is the defect this whole
// file exists to record, arriving in the file.
//
// So the base is data here and git is corroboration. Typed as a RANGE minus
// the absent numbers because 168 of them in a row is unreadable, and the
// subtraction is over this typed list rather than over the document, so it is
// not the tautology this check replaced.
//
// The two numbers are checked against each other below, and an earlier version
// of this comment SAID they were while nothing did it — a comment naming a check
// that is not there, in the file whose write-up is about reading a setting for
// something it does not say. Main-watch found it by looking for the assertion.
// So what the check catches is stated rather than implied: `179 - 11 = 168`
// holds automatically unless an absent number is outside `1..179` or repeated,
// and those are the two typos that would silently shrink the base.
const BASE_HIGHEST = 179;
const BASE_ABSENT = Object.freeze([101, 107, 111, 152, 153, 154, 161, 162, 164, 175, 177]);
for (const absent of BASE_ABSENT) {
  if (!Number.isInteger(absent) || absent < 1 || absent > BASE_HIGHEST) {
    throw new Error(`BASE_ABSENT holds ${absent}, which is outside 1..${BASE_HIGHEST}, `
      + 'so it removes nothing and the base is one number larger than it reads');
  }
}
if (new Set(BASE_ABSENT).size !== BASE_ABSENT.length) {
  throw new Error('BASE_ABSENT repeats a number, so the base is larger than it reads');
}
export const BASE_NUMBERS = Object.freeze(
  Array.from({ length: BASE_HIGHEST }, (unused, index) => index + 1)
    .filter(n => !BASE_ABSENT.includes(n)),
);
if (BASE_NUMBERS.length !== BASE_HIGHEST - BASE_ABSENT.length) {
  throw new Error(`BASE_NUMBERS is ${BASE_NUMBERS.length} and ${BASE_HIGHEST} - `
    + `${BASE_ABSENT.length} is ${BASE_HIGHEST - BASE_ABSENT.length}`);
}

// There is deliberately NO check that EXPECTED_NEW and BASE_NUMBERS are
// disjoint, and the absence is the point: once a collection merges, the base
// holds those numbers too and the overlap is total. That is the inert state the
// paragraph above describes, and a disjointness check would turn it into a
// failure on the one event the design expects.

// What the document must hold on this branch: the base plus what the
// collection adds. This is the whole assertion, and it needs no git, so it
// runs in every checkout rather than in the ones where a ref happens to exist.
export const EXPECTED_DOCUMENT = Object.freeze([...BASE_NUMBERS, ...EXPECTED_NEW]
  .sort((a, b) => a - b));

// Scoped to `## D<n>` and nothing else: the document is full of deeper
// headings and they move independently. `\b` makes a malformed `## D191x`
// invisible here while `grep -c '^## D'` counts it — a malformed heading that
// is an entry's ONLY one shows up below as a missing number, but one planted
// BESIDE a well-formed heading leaves this set correct while the raw count
// runs high, which is why a two-parser count check belongs beside this rather
// than folded into it. Measured, not assumed: a first version of this comment
// claimed the malformation for the wrong check and the harness disagreed.
const HEADING = /^##[ \t]+D(\d+)\b/gm;

export const headingNumbers = text =>
  [...text.matchAll(HEADING)].map(match => Number(match[1]));

/**
 * @returns {{problems: string[], notes: string[], headings: number,
 *            base: number, expected: number}}
 */
export function compareHeadingSets(baseText, headText, expectedNew = EXPECTED_NEW) {
  const order = headingNumbers(headText);
  const head = new Set(order);
  const base = new Set(headingNumbers(baseText));
  const want = new Set([...base, ...expectedNew]);
  const problems = [];

  // A set sees neither a repeat nor an ordering, so these are not subsumed by
  // the membership comparison below and are not redundant with it.
  const repeated = [...new Set(order.filter((n, i) => order.indexOf(n) !== i))];
  if (repeated.length) problems.push(`DUPLICATE_HEADING:${repeated.join(',')}`);
  const descent = order.findIndex((n, i) => i > 0 && n <= order[i - 1]);
  if (descent > 0) problems.push(`NOT_ASCENDING:D${order[descent - 1]}->D${order[descent]}`);

  const missing = [...want].filter(n => !head.has(n)).sort((a, b) => a - b);
  const unexpected = [...head].filter(n => !want.has(n)).sort((a, b) => a - b);
  // Named rather than counted: the failure guarded here is a heading going
  // without anybody knowing which, so a count would reproduce the defect.
  if (missing.length) problems.push(`HEADING_MISSING:${missing.map(n => `D${n}`).join(',')}`);
  if (unexpected.length) problems.push(`HEADING_UNEXPECTED:${unexpected.map(n => `D${n}`).join(',')}`);

  // What this does NOT look at, reported on every run including a clean one.
  // D96's pattern — where a check cannot answer a question its output looks
  // like it answered, say so where somebody will read it. The silent version is
  // how a printed entry count came to be read as a refusal for an hour.
  const notes = [
    'headings only: says nothing about any entry BODY, so an entry whose text '
    + 'was replaced under a correct heading passes. That is a larger hole than '
    + 'the one this closes.',
    'the expected set is TYPED IN, so a number filed without being added to it '
    + 'fails as HEADING_UNEXPECTED. That is the design, not a bug.',
    'one program among four that write this document; a clean run here says '
    + 'nothing about the other three.',
  ];

  return { problems, notes, headings: order.length, base: base.size, expected: want.size };
}
