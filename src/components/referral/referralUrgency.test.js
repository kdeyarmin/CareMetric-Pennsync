import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TRIAGE_URGENCY_LEVELS,
  normalizeTriageUrgency,
  triageUrgencyToReferralPriority,
  triageUrgencyToTaskPriority,
  toReferralPriority,
  maxReferralPriority,
} from './referralUrgency.js';

test('normalizeTriageUrgency uppercases known levels and rejects prose', () => {
  assert.deepEqual([...TRIAGE_URGENCY_LEVELS], ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']);
  assert.equal(normalizeTriageUrgency('critical'), 'CRITICAL');
  assert.equal(normalizeTriageUrgency('  High  '), 'HIGH');
  assert.equal(normalizeTriageUrgency('EXTREMELY URGENT'), 'UNKNOWN');
  assert.equal(normalizeTriageUrgency(null), 'UNKNOWN');
});

test('triage urgency maps onto Referral.priority and Task.priority', () => {
  assert.equal(triageUrgencyToReferralPriority('CRITICAL'), 'urgent');
  assert.equal(triageUrgencyToReferralPriority('high'), 'high');
  assert.equal(triageUrgencyToReferralPriority('MEDIUM'), 'normal');
  assert.equal(triageUrgencyToReferralPriority('low'), 'low');
  assert.equal(triageUrgencyToReferralPriority('nope'), 'normal');
  assert.equal(triageUrgencyToTaskPriority('CRITICAL'), 'high');
  assert.equal(triageUrgencyToTaskPriority('LOW'), 'medium');
});

test('toReferralPriority unifies analyzer, extraction, and heuristic dialects', () => {
  assert.equal(toReferralPriority('STAT'), 'urgent');
  assert.equal(toReferralPriority('High'), 'high');
  assert.equal(toReferralPriority('Medium'), 'normal');
  assert.equal(toReferralPriority('Low'), 'low');
  assert.equal(toReferralPriority('urgent'), 'urgent');
  assert.equal(toReferralPriority('routine'), 'normal');
  assert.equal(toReferralPriority('CRITICAL'), 'urgent');
  assert.equal(toReferralPriority(''), 'normal');
  assert.equal(toReferralPriority('gibberish', { fallback: null }), null);
});

test('maxReferralPriority never downgrades the higher of two answers', () => {
  assert.equal(maxReferralPriority('urgent', 'low'), 'urgent');
  assert.equal(maxReferralPriority('STAT', 'normal'), 'urgent');
  assert.equal(maxReferralPriority(null, 'high'), 'high');
  assert.equal(maxReferralPriority('routine', 'CRITICAL'), 'urgent');
  assert.equal(maxReferralPriority(undefined, undefined), 'normal');
});
