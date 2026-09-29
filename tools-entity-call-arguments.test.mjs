import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  IDENTIFIER_POSITIONS, UNKNOWN_VALUE, argumentText, callArguments, evaluateArgument,
  isIdentifierPosition, limitConstants, splitArguments,
} from './tools-entity-call-arguments.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const constants = limitConstants(repository);

test('the named row limits are read from EVERY module that declares one', () => {
  assert.equal(constants.get('ALL_ROWS'), 5000);
  // The widening's own subject: this one is declared in `adrCaseRead.js`, and
  // while the reader took a single file the ADR Center's call read
  // INDETERMINATE and the site read unserved with its contract already built.
  assert.equal(constants.get('ADR_CASE_READ_LIMIT'), 200);
  assert.ok(constants.size >= 2, 'an empty table would make every call site unreadable');
});

/**
 * A planted tree, because the three refusals below cannot occur in this
 * repository today — which is exactly why they are refusals and not a sentence
 * in a comment. A guard that has only ever run against a correct input has not
 * been shown to bite, so each case is planted and watched to fail, and the
 * last one is the CONTROL: the same tree without the defect must pass.
 */
function plantedTree(files) {
  const root = mkdtempSync(join(tmpdir(), 'pennsync-limits-'));
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

const CANARY = { 'src/lib/queryLimits.js': 'export const ALL_ROWS = 5000;\n' };

test('a name two modules give DIFFERENT values is refused, never picked', () => {
  const root = plantedTree({
    ...CANARY,
    'src/components/a/limits.js': 'export const PAGE_ROWS = 100;\n',
    'src/components/b/limits.js': 'export const PAGE_ROWS = 250;\n',
  });
  assert.throws(() => limitConstants(root), /ENTITY_ROUTE_LIMIT_AMBIGUOUS:PAGE_ROWS:/);
  // The control: the same two modules AGREEING is not ambiguous, because the
  // name still identifies one number and no call site can mean another.
  const agreeing = plantedTree({
    ...CANARY,
    'src/components/a/limits.js': 'export const PAGE_ROWS = 100;\n',
    'src/components/b/limits.js': 'export const PAGE_ROWS = 100;\n',
  });
  assert.equal(limitConstants(agreeing).get('PAGE_ROWS'), 100);
});

test('a local const shadowing an exported limit is refused', () => {
  // This reader resolves a NAME and does not follow imports, so a module with
  // its own `ALL_ROWS` would otherwise be read with somebody else's 5000.
  const root = plantedTree({
    ...CANARY,
    'src/pages/Shadow.jsx': 'const ALL_ROWS = 50;\nexport default () => ALL_ROWS;\n',
  });
  assert.throws(() => limitConstants(root), /ENTITY_ROUTE_LIMIT_SHADOWED:ALL_ROWS:/);
  // The control: the same declaration EXPORTED is the ordinary case the
  // widening exists to read, and must not be mistaken for a shadow.
  const exported = plantedTree({
    ...CANARY,
    'src/pages/Shadow.jsx': 'export const OTHER_ROWS = 50;\n',
  });
  assert.equal(limitConstants(exported).get('OTHER_ROWS'), 50);
});

test('the canary still refuses an unreadable scan after the widening', () => {
  // Before the widening this fired when the table came back empty. With every
  // module in the population `found.size` can no longer reach zero, so the
  // guard would have retired itself silently — it reads the named file now.
  const root = plantedTree({
    'src/lib/queryLimits.js': 'export const NOT_A_LIMIT = "5000";\n',
    'src/components/a/limits.js': 'export const PAGE_ROWS = 100;\n',
  });
  assert.throws(() => limitConstants(root), /ENTITY_ROUTE_LIMITS_UNREADABLE:/);
});

/**
 * The scanner's whole job is the shapes a regular expression gets wrong, so
 * each of these is one of them.
 */
test('the argument text is the balanced call, not everything up to a bracket', () => {
  const cases = [
    ['.list()', ''],
    [".list('-created_date', 200)", "'-created_date', 200"],
    ['.filter({ a: f(1) }, 2)', '{ a: f(1) }, 2'],
    ['.filter({ a: ")" }, 2)', '{ a: ")" }, 2'],
    ['.filter(`a)b`)', '`a)b`'],
    ['.filter(/* ) */ 1)', '/* ) */ 1'],
    ['.list(\n  1,\n  2,\n)', '\n  1,\n  2,\n'],
  ];
  for (const [source, expected] of cases) {
    assert.equal(argumentText(source, source.indexOf('(')), expected, source);
  }
  // Unbalanced is null rather than "the rest of the file", which would then be
  // split into arguments that were never passed.
  assert.equal(argumentText(".list('a'", 5), null);
  assert.equal(argumentText('  notacall', 0), null);
});

test('arguments split on the commas that separate them and no others', () => {
  assert.deepEqual(splitArguments("{ a: 1, b: [2, 3] }, '-x', 5"), ['{ a: 1, b: [2, 3] }', "'-x'", '5']);
  assert.deepEqual(splitArguments("'a,b'"), ["'a,b'"]);
  assert.deepEqual(splitArguments(''), []);
  // A trailing comma is a trailing comma, not an extra argument.
  assert.deepEqual(splitArguments('1, 2,'), ['1', '2']);
});

test('a literal is read and anything else is not', () => {
  const reads = (source) => evaluateArgument(source, constants);
  assert.deepEqual(reads('200'), { known: true, value: 200 });
  assert.deepEqual(reads("'-created_date'"), { known: true, value: '-created_date' });
  assert.deepEqual(reads('"-severity"'), { known: true, value: '-severity' });
  assert.deepEqual(reads('undefined'), { known: true, value: undefined });
  assert.deepEqual(reads('ALL_ROWS'), { known: true, value: 5000 });
  assert.deepEqual(reads('{ is_active: true }'), { known: true, value: { is_active: true } });
  assert.deepEqual(reads("{ status: { $in: ['a', 'b'] } }"), { known: true, value: { status: { $in: ['a', 'b'] } } });
  // A whole argument the reader cannot resolve is indeterminate, which counts
  // as unserved. Nothing here guesses.
  assert.equal(reads('page * SIZE').known, false);
  assert.equal(reads('someVariable').known, false);
  assert.equal(reads('').known, false);
});

/**
 * The distinction the measurement turns on. A route decides on the SHAPE of a
 * query — which fields, which operator — and every one of those is written at
 * the call site even when the value beside it is computed. Refusing to read
 * `{ patient_id: patientId }` would make two thirds of the frontend
 * unmeasurable for no gain.
 */
test('a computed value inside a query stands in for itself, a computed argument does not', () => {
  const inside = evaluateArgument('{ patient_id: patientId }', constants);
  assert.deepEqual(inside, { known: true, value: { patient_id: UNKNOWN_VALUE } });
  // And it is a value no column holds, so a route that compared values would
  // refuse rather than match — the fail-closed direction.
  assert.equal(UNKNOWN_VALUE.startsWith('\u0000'), true);
  assert.equal(evaluateArgument('patientId', constants).known, false);
});

test('every call site the ratchet counts is read here too', async () => {
  const { measureDestinations } = await import('./tools-frontend-destination.mjs');
  const calls = callArguments(repository);
  const measured = measureDestinations(repository);
  assert.equal(calls.length, measured.sites.length,
    'the two scans share a walker and a matcher and must see one population');
  // Not everything is readable, and that is the honest state rather than a
  // failure: most writes pass a whole object built at run time.
  assert.ok(calls.some(call => call.arguments !== null));
  assert.ok(calls.some(call => call.arguments === null));
});

/**
 * The narrow exception to the rule above, and the reason it is narrow.
 *
 * `Entity.update(recordId, fields)` was wholly unreadable because of its first
 * argument, which hid the payload beside it — the route reads `fields`, and the
 * id is a value the store resolves. But the top-level arguments of a READ are a
 * sort and a limit, which are shape, so the exception is keyed on the operation
 * AND the position rather than on "a scalar".
 */
test('a row id stands in for itself; a sort or a limit still does not', () => {
  assert.equal(isIdentifierPosition('update', 0), true);
  assert.equal(isIdentifierPosition('update', 1), false, 'the payload is read, never assumed');
  assert.equal(isIdentifierPosition('delete', 0), true);
  assert.equal(isIdentifierPosition('get', 0), true);
  // The counter-case: nothing about a read is in the table, so `list(sortVar)`
  // and `filter(query, sortVar, limitVar)` stay unreadable.
  for (const operation of ['list', 'filter', 'create', 'bulkCreate']) {
    assert.deepEqual(IDENTIFIER_POSITIONS[operation], undefined, operation);
    assert.equal(isIdentifierPosition(operation, 0), false, operation);
  }
});

test('the id exception really is what makes those sites readable', () => {
  const calls = callArguments(repository);
  const updates = calls.filter(call => call.operation === 'update' && call.arguments !== null);
  assert.ok(updates.length > 0, 'no update is readable, so the exception did not fire');
  // Every readable update passes the placeholder as its id, which is the only
  // shape this change admits: a literal id at a call site would be a surprise.
  for (const call of updates) {
    assert.equal(call.arguments[0], UNKNOWN_VALUE, `${call.file} ${call.entity}.update`);
  }
  // And a read whose sort is computed is still unreadable, measured rather than
  // asserted from the table: `Timesheets.jsx` passes literals, so find a real
  // one instead of claiming none exists.
  assert.ok(calls.some(call => call.operation === 'filter' && call.arguments === null),
    'every filter is readable, which would mean the exception leaked into reads');
});
