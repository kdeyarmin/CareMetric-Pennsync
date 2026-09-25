import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  UNKNOWN_VALUE, argumentText, callArguments, evaluateArgument, limitConstants, splitArguments,
} from './tools-entity-call-arguments.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const constants = limitConstants(repository);

test('the named row limits are read from the module that declares them', () => {
  assert.equal(constants.get('ALL_ROWS'), 5000);
  assert.ok(constants.size >= 2, 'an empty table would make every call site unreadable');
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
