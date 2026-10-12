import test from 'node:test';
import assert from 'node:assert/strict';
import { competencyGate, MAX_RETAKE_TIMER_MS, retakeTimerDelayMs, retakeWaitRemainingHours } from './competencyGate.js';

test('the displayed gate is at least as strict as the course', () => {
  const gate = competencyGate({
    assignment: { passing_score_required: 80, max_attempts: null, waiting_period_hours: 0 },
    course: {
      passing_score: 90,
      retake_settings_json: { max_attempts: 3, waiting_period_hours: 24 },
    },
  });
  assert.deepEqual(gate, { passingScore: 90, maxAttempts: 3, waitHours: 24 });
});

test('an assignment can only raise the bar', () => {
  const gate = competencyGate({
    assignment: { passing_score_required: 95, max_attempts: 1, waiting_period_hours: 48 },
    course: { passing_score: 80, retake_settings_json: { max_attempts: 3, waiting_period_hours: 24 } },
  });
  assert.deepEqual(gate, { passingScore: 95, maxAttempts: 1, waitHours: 48 });
});

test('a retake wait longer than the timer ceiling is scheduled in chunks', () => {
  const submittedAt = Date.parse('2026-10-12T12:00:00.000Z');
  const thirtyDayWaitMs = 30 * 24 * 3_600_000;
  assert.ok(thirtyDayWaitMs > MAX_RETAKE_TIMER_MS);
  assert.equal(retakeTimerDelayMs(30 * 24, submittedAt, submittedAt), MAX_RETAKE_TIMER_MS);
  assert.equal(retakeTimerDelayMs(1, submittedAt, submittedAt), 3_600_000);
  assert.equal(retakeTimerDelayMs(1, submittedAt, submittedAt + 3_600_000), 0);
});

test('a configured cooldown blocks an immediate retake and opens once it elapses', () => {
  const submittedAt = Date.parse('2026-10-12T12:00:00.000Z');
  assert.equal(retakeWaitRemainingHours(24, submittedAt, submittedAt), 24);
  assert.equal(retakeWaitRemainingHours(24, submittedAt, submittedAt + 23 * 3_600_000), 1);
  assert.equal(retakeWaitRemainingHours(24, submittedAt, submittedAt + 24 * 3_600_000), 0);
  assert.equal(retakeWaitRemainingHours(0, submittedAt, submittedAt), 0);
});
