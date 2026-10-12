import test from 'node:test';
import assert from 'node:assert/strict';
import { competencyGate } from './competencyGate.js';

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
