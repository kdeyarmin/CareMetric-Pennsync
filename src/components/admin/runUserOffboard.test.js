import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisableOrEnableUserPayload } from './runUserOffboard.js';

test('buildDisableOrEnableUserPayload re-enables without offboarding fields', () => {
  const payload = buildDisableOrEnableUserPayload({
    targetUser: { id: '1', email: 'nurse@example.com' },
    currentUser: { email: 'admin@example.com', role: 'admin' },
    enabling: true,
  });
  assert.equal(payload.is_active, true);
  assert.equal(payload.duty_status, 'available');
});

test('buildDisableOrEnableUserPayload offboards with audit fields', () => {
  const payload = buildDisableOrEnableUserPayload({
    targetUser: { id: '1', email: 'nurse@example.com' },
    currentUser: { email: 'admin@example.com', role: 'admin' },
    enabling: false,
    reason: 'Left agency',
  });
  assert.equal(payload.is_active, false);
  assert.equal(payload.offboarded_by, 'admin@example.com');
  assert.equal(payload.offboarding_reason, 'Left agency');
  assert.ok(payload.offboarded_at);
});

test('buildDisableOrEnableUserPayload blocks self-offboard', () => {
  assert.throws(
    () => buildDisableOrEnableUserPayload({
      targetUser: { id: '1', email: 'admin@example.com' },
      currentUser: { email: 'admin@example.com', role: 'admin' },
      enabling: false,
    }),
    /permission/i
  );
});
