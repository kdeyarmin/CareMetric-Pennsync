import test from 'node:test';
import assert from 'node:assert/strict';
import { filterAiProvenanceEntries, toAiProvenanceExportRow, validateAiProvenanceEntry } from './aiProvenanceRegistry.js';

test('AI provenance entries normalize aliases and validate required audit fields', () => {
  const result = validateAiProvenanceEntry({ request_id: 'r1', workflow: 'SmartNote', model_name: 'gpt-test', output_hash: 'abc', createdAt: '2026-07-22T00:00:00Z', status: 'accepted' });
  assert.equal(result.valid, true);
  assert.equal(result.entry.id, 'r1');
  assert.equal(result.entry.feature, 'SmartNote');
});

test('AI provenance validation fails without hashes and required metadata', () => {
  const result = validateAiProvenanceEntry({ feature: 'Training' });
  assert.equal(result.valid, false);
  assert.ok(result.missing.includes('model'));
  assert.ok(result.missing.includes('prompt_hash or output_hash'));
});

test('AI provenance filters and export rows omit raw prompt/response text', () => {
  const rows = filterAiProvenanceEntries([
    { id: '1', feature: 'SmartNote', model: 'm', output_hash: 'h1', patient_id: 'p1', created_at: '2026-07-22T02:00:00Z', prompt: 'raw prompt' },
    { id: '2', feature: 'Training', model: 'm', output_hash: 'h2', patient_id: 'p2', created_at: '2026-07-21T02:00:00Z' },
  ], { patientId: 'p1' });
  assert.equal(rows.length, 1);
  const exportRow = toAiProvenanceExportRow(rows[0]);
  assert.equal(exportRow.id, '1');
  assert.equal('prompt' in exportRow, false);
  assert.equal('response' in exportRow, false);
});
