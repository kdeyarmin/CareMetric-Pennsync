// The register's heading membership, and proof that the check bites.
//
// Two halves on purpose. The sabotage cases run over SYNTHETIC documents so
// the predicate is proved unconditionally, in any checkout, with no git and no
// real file. The comparison against the committed register is attempted
// separately and says why when it cannot run, because a check whose coverage
// depends on the environment and does not say so is the defect this file
// exists to stop.
//
// WIRED IN `test:utils`, AND THAT IS THE ONLY HOME IT CAN HAVE. `package.json`
// takes no comments, so the note belongs here:
// `src/testRegistryContract.test.js:58-63` enumerates root
// `tools-*.test.{js,mjs}` and orphans anything absent from the `test:*` script
// bodies, while the workflow-step fallback is in its SECOND test and scoped to
// `services/`. So for a file HERE a workflow step is not a home: it would
// leave this unbound while looking wired. That is the more plausible mistake,
// because a workflow step is the obvious workaround for an awkward suite.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import {
  DOCUMENT_PATH, EXPECTED_NEW, EXPECTED_DOCUMENT, BASE_NUMBERS as REAL_BASE_NUMBERS,
  compareHeadingSets, headingNumbers,
} from './tools-decision-register.mjs';

// `git show <ref>:<path>` from a registered root tools test is an established
// shape here: `tools-app-store-migration.test.mjs` does the same, and
// `ci.yml` checks out at `fetch-depth: 0`.
const BASE_REF = process.env.PENNSYNC_REGISTER_BASE_REF || 'origin/main';
// `git show` of a tracked file is bounded by the repository, but execFileSync's
// default maxBuffer is 1 MiB and this register crossed that at `296a2205` on
// 2026-10-01, so every read of the base document died with ENOBUFS. Measured
// rather than recalled: the placeholder this replaces read `2026-09-__`, and the
// September was already wrong when it was typed — the first commit over
// 1,048,576 bytes is in October. The bound stays finite and generous; what makes
// it safe is that overflowing it now FAILS rather than being read as an absent
// ref — see the catch below.
const GIT_MAX_BUFFER = 64 * 1024 * 1024;
const git = (...args) =>
  execFileSync('git', args, { encoding: 'utf8', maxBuffer: GIT_MAX_BUFFER });

// Git exits 128, with its reason on stderr, when a ref or a path inside one
// cannot be resolved. Anything else — ENOBUFS, a missing git (ENOENT), a
// signal — is a failure of the harness rather than an absent base, and a bare
// catch reports all of them as "fetch the base branch", which is advice that
// cannot work. Measured: an unknown ref gives status 128 and code undefined; a
// buffer overflow gives code ENOBUFS and status null.
const isUnresolvableRef = error => error?.status === 128;

const doc = numbers => `# Register\n\nPreamble.\n\n${numbers
  .map(n => `## D${n} — Entry ${n}\n\nBody of ${n}.\n`).join('\n')}`;

// Synthetic, and deliberately NOT the module's `BASE_NUMBERS` — that one is the
// real base, imported above as REAL_BASE_NUMBERS after the two collided here.
const BASE_NUMBERS = [1, 2, 3, 5];
const NEW_NUMBERS = [6, 8];
const base = doc(BASE_NUMBERS);
const head = doc([...BASE_NUMBERS, ...NEW_NUMBERS]);
const check = text => compareHeadingSets(base, text, NEW_NUMBERS);
const codes = text => check(text).problems.map(p => p.split(':')[0]);

test('a clean collection passes, and the fixtures are the shape claimed', () => {
  assert.deepEqual(headingNumbers(base), BASE_NUMBERS);
  assert.deepEqual(headingNumbers(head), [...BASE_NUMBERS, ...NEW_NUMBERS].sort((a, b) => a - b));
  assert.deepEqual(check(head).problems, []);
});

// Each case asserts its sabotage LANDED before its verdict is believed: a
// mutation that silently failed to apply looks exactly like a blind assertion.
const drop = (text, n) => text.replace(new RegExp(`^##[ \\t]+D${n}\\b.*\\n`, 'm'), '');

const SABOTAGES = [
  ['a spliced heading dropped', t => drop(t, 8), ['HEADING_MISSING']],
  ['a pre-existing heading dropped', t => drop(t, 2), ['HEADING_MISSING']],
  // The case count-preservation cannot see by construction: `amend-entry.mjs:60`
  // asserts how many headings there are and this leaves that untouched.
  ['a one-for-one swap, in order', t => `${drop(t, 2)}\n## D9 — Planted in order\n\nBody.\n`,
    ['HEADING_MISSING', 'HEADING_UNEXPECTED']],
  ['a duplicate heading', t => t.replace('\n## D6', '\n## D6 — Entry 6\n\nBody.\n\n## D6', 1),
    ['DUPLICATE_HEADING', 'NOT_ASCENDING']],
  ['a heading malformed into a non-number', t => t.replace(/^##[ \t]+D6\b/m, '## D6x'),
    ['HEADING_MISSING']],
  ['the order scrambled', t => {
    const lines = t.split('\n');
    const i = lines.findIndex(l => /^##[ \t]+D3\b/.test(l));
    const j = lines.findIndex(l => /^##[ \t]+D6\b/.test(l));
    [lines[i], lines[j]] = [lines[j], lines[i]];
    return lines.join('\n');
  }, ['NOT_ASCENDING']],
  // The rule `amend-entry.mjs:41` keeps at its own door: an amendment title
  // opening on `## D<n>` parses as a second entry carrying that number. That
  // check reads the amendment being applied, so a heading arriving any other
  // way is unchecked; this one reads the committed document.
  ['an amendment heading opening on the parser key',
    t => t.replace('\n## D8', '\n## D8, amendment 1 — a title opening on prose\n\nBody.\n\n## D8', 1),
    ['DUPLICATE_HEADING', 'NOT_ASCENDING']],
];

for (const [name, mutate, expected] of SABOTAGES) {
  test(`it refuses: ${name}`, () => {
    const sabotaged = mutate(head);
    assert.notDeepEqual(headingNumbers(sabotaged), headingNumbers(head),
      'the sabotage did not change the heading reading, so this case proves nothing');
    assert.deepEqual(codes(sabotaged), expected);
  });
}

test('the arithmetic it replaces could not fail, which is why it is gone', () => {
  // `max - |absent| == |headings|` with `absent = range(1, max) - set(headings)`.
  const tautology = text => {
    const h = headingNumbers(text); const set = new Set(h); const max = Math.max(...h);
    const absent = [...Array(max).keys()].map(i => i + 1).filter(n => !set.has(n));
    return max - absent.length === h.length;
  };
  assert.equal(tautology(head), true);
  assert.equal(tautology(drop(head, 8)), true, 'a dropped heading leaves it true');
  assert.equal(tautology(drop(head, 2)), true, 'so does dropping a pre-existing one');
});

test('it reports what it does not look at, on a clean run too', () => {
  const { problems, notes } = check(head);
  assert.deepEqual(problems, []);
  assert.ok(notes.some(n => n.includes('BODY')), 'the body blindness must be stated');
  assert.ok(notes.some(n => n.includes('TYPED IN')), 'the typed list has a cost and must say so');
  assert.ok(notes.some(n => n.includes('four')), 'it is one program among four');
});

test('the committed register holds exactly the headings it should', () => {
  // No git. The expectation is typed (`BASE_NUMBERS` plus `EXPECTED_NEW`), so
  // this runs in every checkout rather than only where a base ref happens to
  // exist — which is the repair for the first version, whose one real-document
  // test failed in CI because `origin/main` was not resolvable there.
  const order = headingNumbers(readFileSync(DOCUMENT_PATH, 'utf8'));
  const { problems, notes } = compareHeadingSets('', readFileSync(DOCUMENT_PATH, 'utf8'), EXPECTED_DOCUMENT);
  for (const note of notes) console.log(`  note      ${note}`);
  assert.deepEqual(problems, [],
    `headings=${order.length} expected=${EXPECTED_DOCUMENT.length}. A number filed `
    + 'without being added to EXPECTED_NEW reports as HEADING_UNEXPECTED and is '
    + 'corrected there, not by deriving the list.');
  assert.equal(order.length, EXPECTED_DOCUMENT.length);
});

test('the typed base still describes the real base, where the base can be read', t => {
  // Corroboration rather than the assertion. If the typed `BASE_NUMBERS` ever
  // stops matching `main`'s document this fails and names the difference, so the
  // data above cannot go stale silently. When the ref is absent it SKIPS, and
  // that is safe here in a way it was not before: the test above covers
  // membership without git, so a skip costs coverage of the typed list's
  // freshness and nothing else. It says so rather than leaving a reader to work
  // out which.
  let baseText;
  try {
    baseText = git('show', `${BASE_REF}:${DOCUMENT_PATH}`);
  } catch (error) {
    // Only an absent ref or path is a skip. The first version caught
    // everything, so when this document crossed a megabyte and every read died
    // with ENOBUFS, the skip reported the ref as unresolvable and advised
    // fetching the base branch — advice that could not work, on a ref that
    // resolved fine. It had been standing down everywhere, CI included, for an
    // unknown number of runs while reading as a pass.
    if (!isUnresolvableRef(error)) throw error;
    t.skip(`${BASE_REF}:${DOCUMENT_PATH} is not resolvable in this checkout, so whether `
      + 'the typed BASE_NUMBERS still matches the real base was NOT checked. Membership '
      + 'was: the test above needs no ref. Set PENNSYNC_REGISTER_BASE_REF, or fetch the '
      + `base branch, to check the typed list too. git said: ${
        String(error.stderr || '').trim() || '(nothing)'}`);
    return;
  }
  const real = headingNumbers(baseText);
  assert.deepEqual(real, [...REAL_BASE_NUMBERS],
    'BASE_NUMBERS no longer describes the base document. Re-derive it and say in the '
    + 'same change what moved on the base branch.');
  // And the differential that makes the membership test non-vacuous: the same
  // comparison must FAIL against the base document, or it is proving only that
  // it ran.
  //
  // **It stands down when the collection merges, and that is the one thing
  // `EXPECTED_NEW`'s "inert rather than wrong" paragraph does not cover.** Inert
  // means the base holds every number in the list, so the base document itself
  // satisfies EXPECTED_DOCUMENT and a flat `notDeepEqual` turns the event the
  // design expects into a red. So branch on it, report which branch ran, and
  // assert the complement rather than nothing — a differential that silently
  // stops differentiating is this file's whole subject.
  const onBase = new Set(real);
  const pending = EXPECTED_NEW.filter(n => !onBase.has(n));
  if (pending.length === 0) {
    t.diagnostic(`EXPECTED_NEW is INERT: all ${EXPECTED_NEW.length} of its numbers are on `
      + `${BASE_REF} already, so the differential below cannot run and membership above is `
      + 'guarding every entry rather than this collection. Rewrite the list for the next '
      + 'collection; do not delete it for having become a subset.');
    assert.deepEqual(compareHeadingSets('', baseText, EXPECTED_DOCUMENT).problems, [],
      'EXPECTED_NEW is wholly on the base, so the base document must already satisfy '
      + 'EXPECTED_DOCUMENT. It does not, so the base moved in some way the typed list '
      + 'does not describe.');
    return;
  }
  assert.notDeepEqual(compareHeadingSets('', baseText, EXPECTED_DOCUMENT).problems, [],
    'the membership comparison passes on the BASE document too, so it is not '
    + `distinguishing this collection from its absence, although D${pending[0]} and `
    + `${pending.length - 1} others are not on the base`);
});

test('the git helper can carry this document, and a skip means an absent ref and nothing else', () => {
  // The regression, stated as the property rather than as the symptom: this
  // document is larger than execFileSync's 1 MiB default, so a helper without
  // maxBuffer cannot read it at all. Drop `maxBuffer` from `git` and this
  // fails, which is what the skip above was silently standing in for.
  const EXEC_DEFAULT_MAX_BUFFER = 1024 * 1024;
  // HEAD resolves in every checkout, shallow ones included, so this needs no
  // fetch — unlike the corroboration above, which is why that one may skip and
  // this one may not. The bound is measured on what GIT hands back rather than
  // on the file on disk: a first version asserted the two were equal in length
  // and failed on the very branch introducing it, where the working tree holds
  // edits that are not committed yet. Equality with the working tree was never
  // the property. The property is that a blob this size survives the helper.
  const viaGit = git('show', `HEAD:${DOCUMENT_PATH}`);
  assert.ok(viaGit.length > EXEC_DEFAULT_MAX_BUFFER,
    `this test is vacuous while the register is under ${EXEC_DEFAULT_MAX_BUFFER} bytes `
    + `(HEAD's copy is ${viaGit.length}). If the register is ever split, assert the size `
    + 'of whichever document the base read actually carries instead of deleting this.');

  // And the discriminator, both ways, because a skip that cannot be told from a
  // failure is how this went unnoticed. Measured rather than assumed: git exits
  // 128 with its reason on stderr for a ref or path it cannot resolve, while a
  // buffer overflow arrives as ENOBUFS with a null status.
  const thrown = fn => { try { fn(); } catch (error) { return error; } return null; };
  for (const args of [['show', `no/such/ref:${DOCUMENT_PATH}`],
    ['show', 'HEAD:docs/no-such-file-here.md']]) {
    const error = thrown(() => git(...args));
    assert.equal(isUnresolvableRef(error), true, `${args.join(' ')} should read as absent`);
  }
  const overflow = thrown(() => execFileSync('git', ['show', `HEAD:${DOCUMENT_PATH}`],
    { encoding: 'utf8', maxBuffer: EXEC_DEFAULT_MAX_BUFFER }));
  assert.equal(overflow?.code, 'ENOBUFS');
  assert.equal(isUnresolvableRef(overflow), false,
    'a buffer overflow must not read as an absent ref: that substitution is the '
    + 'defect this test exists for, and it reported as a pass');
});

// The module's own load-time guards, proved to bite. They exist because the
// comment above them claimed a check that was not there, and main-watch found
// it by looking for the assertion rather than by reading the sentence. A check
// believed because it is written down is this file's whole subject, so the
// guards get the same treatment as the predicate: sabotage, and watch it refuse.
//
// The arithmetic `226 - 22 = 204` cannot fail on its own — the base is DERIVED
// as the range minus the absent list — so what the guards catch is the two
// typos that would make the derivation quietly produce a larger base than the
// list reads: an absent number outside the range, which removes nothing, and a
// repeat, which removes one number twice.
test('the base refuses the two typos that would silently enlarge it', async () => {
  const source = readFileSync(new URL('./tools-decision-register.mjs', import.meta.url), 'utf8');
  const dir = mkdtempSync(join(tmpdir(), 'register-guard-'));
  const load = (name, text) => {
    const file = join(dir, `${name}.mjs`);
    writeFileSync(file, text);
    return import(pathToFileURL(file).href);
  };

  // The control first. If the copy did not load on its own the two refusals
  // below would be throwing for an unrelated reason and would read as a pass.
  const control = await load('control', source);
  assert.deepEqual([...control.BASE_NUMBERS], [...REAL_BASE_NUMBERS],
    'the unmutated copy does not load to the same base, so a refusal below proves nothing');

  const CASES = [
    ['outside-the-range', '225]', '325]', /outside 1\.\.226/],
    ['repeated', ', 216,', ', 214,', /repeats a number/],
  ];
  for (const [name, from, to, message] of CASES) {
    assert.equal(source.split(from).length - 1, 1,
      `the anchor ${from} is not unique in the module, so this sabotage may land elsewhere`);
    const mutated = source.replace(from, to);
    assert.notEqual(mutated, source, `the sabotage ${name} did not apply`);
    await assert.rejects(() => load(name, mutated), message, name);
  }
});

// The figures the lists hold, pinned so that moving a list has to be noticed.
//
// **What this pin is FOR changed in the same commit that re-derived the base,
// and the old reason is left here because it is the instructive half.** It read
// that the register's own write-up carried 168 and thirty-five, so a list moving
// would leave prose quietly wrong. Re-measured when #359 merged: the base figure
// is now in NO live sentence of the register, because the write-up's totals were
// removed rather than renumbered — a figure that was wrong within the night of
// being typed is not made safe by being corrected. So the base pin no longer
// guards prose. What it guards is the module's own dated paragraph and this
// file's sabotage range `1..226`: both say what the lists are, neither is
// derived from them, and a silent re-derivation makes all three disagree.
//
// The collection figure no longer guards a sentence describing the design, and
// that changed in the same pass as the list. Re-measured 2026-10-01 after the
// rewrite, and SCOPED, because the document is not the write-up: within this
// check's own write-up `thirty-five` survives at three places and all three
// report what #359's collection was, while the one sentence that carried it in
// the present tense — "the base's numbers are typed alongside the collection's
// thirty-five" — is the one the rewrite falsified and D226 repaired. Elsewhere
// the document carries the same word about three unrelated populations, which is
// why this is scoped: a first draft of this comment said "in the register" and
// was false by those three. So this pin guards the
// module's own rewrite note and D226, both of which attribute the figure to a
// pass, which is the whole of D226's ruling.
//
// **The third assertion is implied by the first AGAIN, and the round trip is the
// instructive part.** An older version of this comment kept it on the stated
// ground that "the two diverge again the moment the list is rewritten for the
// next collection". The list was rewritten for D226 and they diverged, exactly as
// predicted. Then #388 merged, the base grew to hold 226, and they converged
// again hours later. So this assertion is independent only while a collection is
// PENDING, which is a shorter window than "until the next rewrite" — the same
// oscillation `EXPECTED_NEW` makes between live and inert, read from the other
// side. Kept for the reason it always was: it diverges on the next collection,
// and it is the only one of the three that catches a union built as a
// concatenation. A review bot caught this paragraph still claiming the divergence
// after the assertion message below had been rewritten to say the opposite,
// which is the hazard of a comment that argues about figures it sits beside.
test('the figures quoted in prose are the figures the lists hold', () => {
  assert.equal(REAL_BASE_NUMBERS.length, 204,
    "the base figure is quoted in the module's dated paragraph and in this file's "
    + 'sabotage range, and in no live sentence of the register');
  assert.equal(EXPECTED_NEW.length, 1,
    'the collection figure: D226 alone, now wholly on the base, and the figure is quoted '
    + "in the module's rewrite note and in D226, each attributing it to a pass");
  assert.equal(EXPECTED_DOCUMENT.length, 204,
    'the union, which equals the base figure again now that the collection is inert — so '
    + 'this is implied by the first assertion once more, and is kept for the same stated '
    + 'reason as before: it diverges on the next collection. It still catches a union '
    + 'built as a concatenation, which neither other assertion would.');
});
