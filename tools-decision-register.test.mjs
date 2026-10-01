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
  DOCUMENT_PATH, EXPECTED_NEW, compareHeadingSets, headingNumbers,
} from './tools-decision-register.mjs';

// `git show <ref>:<path>` from a registered root tools test is an established
// shape here: `tools-app-store-migration.test.mjs` does the same, and
// `ci.yml` checks out at `fetch-depth: 0`.
const BASE_REF = process.env.PENNSYNC_REGISTER_BASE_REF || 'origin/main';
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });

const doc = numbers => `# Register\n\nPreamble.\n\n${numbers
  .map(n => `## D${n} — Entry ${n}\n\nBody of ${n}.\n`).join('\n')}`;

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

test('the committed register holds exactly the headings it should', t => {
  let baseText;
  try {
    baseText = git('show', `${BASE_REF}:${DOCUMENT_PATH}`);
  } catch {
    const why = `${BASE_REF}:${DOCUMENT_PATH} is not resolvable in this checkout, so the `
      + 'comparison against the committed register did not run. Set '
      + 'PENNSYNC_REGISTER_BASE_REF, or fetch the base branch. The sabotage '
      + 'cases above ran and are unaffected.';
    // A test that cannot tell "no differences" from "no base" is the artefact
    // this file exists to stop, so the two outcomes are never the same colour.
    // Locally a skip is right: a worktree or a shallow clone without
    // `origin/main` should not go red for a reason unrelated to the change. In
    // CI the base is GUARANTEED (`ci.yml` checks out at `fetch-depth: 0`), so a
    // missing base there is a CI change that silently removed this test's
    // coverage, and it fails. `tools-app-store-migration.test.mjs` takes the
    // harder line everywhere — it lets the git failure throw — and this is
    // softer only off CI, deliberately.
    if (process.env.CI) assert.fail(`${why} This ran under CI, where the base is guaranteed.`);
    t.skip(why);
    return;
  }
  const headText = readFileSync(DOCUMENT_PATH, 'utf8');
  const result = compareHeadingSets(baseText, headText);
  for (const note of result.notes) console.log(`  note      ${note}`);
  assert.deepEqual(result.problems, [],
    `headings=${result.headings} base=${result.base} expected=${result.expected}. `
    + 'A number filed without being added to EXPECTED_NEW reports as '
    + 'HEADING_UNEXPECTED and is corrected there, not by deriving the list.');
  assert.ok(EXPECTED_NEW.length >= 0);
});
