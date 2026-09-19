import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BASELINE_FILE, FORMAT, FORMAT_VERSION, METRICS,
  compareSurface, main, measureSurface, parseBaseline,
} from './tools-base44-surface.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)));
const baseline = (patch = {}) => ({
  format: FORMAT, version: FORMAT_VERSION,
  maximum: Object.fromEntries(METRICS.map(metric => [metric, 10])), ...patch,
});
const measured = (patch = {}) => ({
  counts: { ...Object.fromEntries(METRICS.map(metric => [metric, 10])), ...patch }, entity_types: [],
});

test('the frontend stays within its committed Base44 coupling baseline', () => {
  const report = compareSurface(measureSurface(repository), parseBaseline(readFileSync(resolve(repository, BASELINE_FILE), 'utf8')));
  assert.deepEqual(report.regressions, [], 'Base44 coupling grew. Migrate the new consumer or justify the change.');
  assert.equal(report.within_baseline, true);
});

test('the measurement reflects the real repository and is not yet zero', () => {
  const { counts, entity_types: entityTypes } = measureSurface(repository);
  assert.ok(counts.entity_call_sites > 0);
  assert.ok(counts.client_importers > 0);
  assert.equal(counts.entity_types, entityTypes.length);
  assert.ok(entityTypes.length > 40);
  // Every directly accessed type is a real schema, so a typo or a match on
  // unrelated code cannot inflate the count.
  const schemas = new Set(readdirSync(resolve(repository, 'base44/entities'))
    .filter(name => /\.jsonc?$/.test(name)).map(name => name.replace(/\.jsonc?$/, '')));
  assert.deepEqual(entityTypes.filter(name => !schemas.has(name)), []);
  // Patient is already broker-only in production source; direct access to it
  // would be a migration regression.
  assert.equal(entityTypes.includes('Patient'), false);
  // An honest report: the exit is not finished.
  assert.equal(compareSurface(measureSurface(repository), baseline({
    maximum: Object.fromEntries(METRICS.map(metric => [metric, 100000])),
  })).base44_free, false);
});

test('a count above its baseline is a regression and a count below it is an improvement', () => {
  const grown = compareSurface(measured({ entity_call_sites: 11 }), baseline());
  assert.deepEqual(grown.regressions, [{ metric: 'entity_call_sites', actual: 11, allowed: 10 }]);
  assert.equal(grown.within_baseline, false);
  const shrunk = compareSurface(measured({ entity_call_sites: 4 }), baseline());
  assert.deepEqual(shrunk.regressions, []);
  assert.deepEqual(shrunk.improvements, [{ metric: 'entity_call_sites', actual: 4, allowed: 10 }]);
  assert.equal(shrunk.within_baseline, true);
});

test('base44_free is claimed only when every measured count is zero', () => {
  assert.equal(compareSurface(measured(), baseline()).base44_free, false);
  const empty = { counts: Object.fromEntries(METRICS.map(metric => [metric, 0])), entity_types: [] };
  assert.equal(compareSurface(empty, baseline()).base44_free, true);
});

for (const [name, raw] of Object.entries({
  malformed: '{',
  array: '[]',
  wrongFormat: JSON.stringify(baseline({ format: 'other' })),
  wrongVersion: JSON.stringify(baseline({ version: 2 })),
  missingMetric: JSON.stringify({ format: FORMAT, version: FORMAT_VERSION, maximum: { client_importers: 1 } }),
  negativeMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, entity_types: -1 } })),
  fractionalMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, entity_types: 1.5 } })),
  extraMetric: JSON.stringify(baseline({ maximum: { ...baseline().maximum, invented: 1 } })),
})) {
  test(`baseline rejects ${name}`, () => assert.throws(() => parseBaseline(raw)));
}

test('updating the baseline is explicit and writes only the measured counts', () => {
  let written = null;
  const code = main(['--update'], { repository, log: () => {}, write: (path, body) => { written = { path, body }; } });
  assert.equal(code, 0);
  assert.ok(written.path.endsWith(BASELINE_FILE));
  const parsed = parseBaseline(written.body);
  assert.deepEqual(parsed.maximum, measureSurface(repository).counts);
});

test('the command line refuses unknown arguments and an unavailable baseline', () => {
  const lines = [];
  assert.equal(main(['--fix'], { repository, log: value => lines.push(value) }), 2);
  assert.equal(JSON.parse(lines[0]).error, 'INVALID_ARGUMENTS');
  lines.length = 0;
  assert.equal(main([], { repository: resolve(repository, 'src'), log: value => lines.push(value) }), 2);
  assert.ok(JSON.parse(lines[0]).error);
});
