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
import { readFileSync } from 'node:fs';
import process from 'node:process';
import {
  DOCUMENT_PATH, EXPECTED_NEW, EXPECTED_DOCUMENT, BASE_NUMBERS as REAL_BASE_NUMBERS,
  compareHeadingSets, headingNumbers,
} from './tools-decision-register.mjs';

// `git show <ref>:<path>` from a registered root tools test is an established
// shape here: `tools-app-store-migration.test.mjs` does the same, and
// `ci.yml` checks out at `fetch-depth: 0`.
const BASE_REF = process.env.PENNSYNC_REGISTER_BASE_REF || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

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
  } catch {
    t.skip(`${BASE_REF}:${DOCUMENT_PATH} is not resolvable in this checkout, so whether `
      + 'the typed BASE_NUMBERS still matches the real base was NOT checked. Membership '
      + 'was: the test above needs no ref. Set PENNSYNC_REGISTER_BASE_REF, or fetch the '
      + 'base branch, to check the typed list too.');
    return;
  }
  const real = headingNumbers(baseText);
  assert.deepEqual(real, [...REAL_BASE_NUMBERS],
    'BASE_NUMBERS no longer describes the base document. Re-derive it and say in the '
    + 'same change what moved on the base branch.');
  // And the differential that makes the membership test non-vacuous: the same
  // comparison must FAIL against the base document, or it is proving only that
  // it ran.
  assert.notDeepEqual(compareHeadingSets('', baseText, EXPECTED_DOCUMENT).problems, [],
    'the membership comparison passes on the BASE document too, so it is not '
    + 'distinguishing this collection from its absence');
});
