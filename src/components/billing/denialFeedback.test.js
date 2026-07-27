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

test('currency-formatted denial amounts parse instead of collapsing to 0', () => {
  // Regression: Number("$1,250.00") is NaN → the dashboard under-reported
  // denial dollars as fact.
  assert.equal(normalizeDenialFeedbackRow({ amount_denied: '$1,250.00' }).amount_denied, 1250);
  assert.equal(normalizeDenialFeedbackRow({ amount_denied: '1,250.00' }).amount_denied, 1250);
  assert.equal(normalizeDenialFeedbackRow({ amount_denied: 1250.5 }).amount_denied, 1250.5);
  const summary = summarizeDenialFeedback([{ amount_denied: '$1,250.00' }, { amount_denied: '2,000' }]);
  assert.equal(summary.totalAmountDenied, 3250);
});

test('classification matches on word starts, not raw substrings', () => {
  // Regressions: 'order' inside "disORDER"/"BORDERline" routed to
  // authorization; 'm0' inside "CM0234" routed to oasis.
  assert.equal(classifyDenialFeedback({ reason: 'Panic disorder noted during visit' }).category, 'other');
  assert.equal(classifyDenialFeedback({ reason: 'Borderline medical necessity' }).category, 'other');
  assert.equal(classifyDenialFeedback({ reason: 'Claim CM0234 rejected' }).category, 'other');
  // Real term hits still classify.
  assert.equal(classifyDenialFeedback({ reason: 'Physician order missing' }).category, 'authorization');
  assert.equal(classifyDenialFeedback({ reason: 'M0102 date discrepancy' }).category, 'oasis');
});
