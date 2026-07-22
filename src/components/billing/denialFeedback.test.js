import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyDenialFeedback, normalizeDenialFeedbackRow, summarizeDenialFeedback } from './denialFeedback.js';

test('denial feedback maps reason text to affected workflows', () => {
  assert.equal(classifyDenialFeedback({ reason: 'Missing homebound documentation' }).category, 'documentation');
  assert.equal(classifyDenialFeedback({ reason: 'Primary ICD coding unsupported' }).category, 'coding');
});

test('normalizeDenialFeedbackRow preserves links and coerces amount', () => {
  const row = normalizeDenialFeedbackRow({ claim: 'c1', patient_id: 'p1', oasis_assessment_id: 'o1', denial_reason: 'OASIS functional mismatch', amount: '125.50' });
  assert.equal(row.claim_id, 'c1');
  assert.equal(row.category, 'oasis');
  assert.equal(row.amount_denied, 125.5);
  assert.ok(row.affected_modules.includes('OASISCenter'));
});

test('summarizeDenialFeedback totals categories and dollars', () => {
  const summary = summarizeDenialFeedback([
    { reason: 'authorization missing', amount_denied: 10 },
    { reason: 'diagnosis coding issue', amount_denied: 20 },
  ]);
  assert.equal(summary.totalRows, 2);
  assert.equal(summary.totalAmountDenied, 30);
  assert.equal(summary.byCategory.authorization, 1);
  assert.equal(summary.byCategory.coding, 1);
});
