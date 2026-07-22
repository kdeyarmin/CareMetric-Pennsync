import test from 'node:test';
import assert from 'node:assert/strict';
import { METRIC_DICTIONARY, metricById, validateMetricDefinition } from './metricDictionary.js';

test('metric dictionary entries expose owner, formula, source, refresh, and export metadata', () => {
  assert.ok(METRIC_DICTIONARY.length >= 6);
  for (const metric of METRIC_DICTIONARY) {
    assert.equal(validateMetricDefinition(metric).valid, true, metric.id);
  }
});

test('metric ids are unique and discoverable', () => {
  const ids = METRIC_DICTIONARY.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(metricById('open_incident_review_count')?.owner, 'Compliance');
  assert.equal(metricById('missing_metric'), null);
});

test('invalid metric definitions report exact missing fields', () => {
  const result = validateMetricDefinition({ id: 'bad', sourceEntities: [] });
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('owner'));
  assert.ok(result.missing.includes('sourceEntities'));
});
