import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDisableOrEnableUserPayload, buildOffboardInvokeArgs } from './runUserOffboard.js';

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

test('buildOffboardInvokeArgs builds offboard body', () => {
  const args = buildOffboardInvokeArgs({
    targetUser: { id: 'u1', email: 'nurse@example.com' },
    currentUser: { email: 'admin@example.com', role: 'admin' },
    enabling: false,
    reason: 'Left agency',
  });
  assert.equal(args.user_id, 'u1');
  assert.equal(args.reason, 'Left agency');
  assert.equal(args.action, undefined);
});

test('buildOffboardInvokeArgs builds reactivate body', () => {
  const args = buildOffboardInvokeArgs({
    targetUser: { id: 'u1', email: 'nurse@example.com' },
    currentUser: { email: 'admin@example.com', role: 'admin' },
    enabling: true,
  });
  assert.deepEqual(args, { action: 'reactivate', user_id: 'u1' });
});

test('buildOffboardInvokeArgs blocks self-offboard', () => {
  assert.throws(
    () => buildOffboardInvokeArgs({
      targetUser: { id: '1', email: 'admin@example.com' },
      currentUser: { email: 'admin@example.com', role: 'admin' },
      enabling: false,
    }),
    /permission/i
  );
});
