import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUserOffboardingPatch, canOffboardUser } from './userOffboarding.js';

test('canOffboardUser allows admins but blocks self-offboarding and non-admins', () => {
  assert.equal(canOffboardUser({ currentUserEmail: 'admin@example.com', targetUserEmail: 'nurse@example.com', currentUserRole: 'admin' }), true);
  assert.equal(canOffboardUser({ currentUserEmail: 'admin@example.com', targetUserEmail: 'admin@example.com', currentUserRole: 'admin' }), false);
  assert.equal(canOffboardUser({ currentUserEmail: 'nurse@example.com', targetUserEmail: 'other@example.com', currentUserRole: 'user' }), false);
});

test('buildUserOffboardingPatch deactivates without deleting audit history', () => {
  const patch = buildUserOffboardingPatch({
    targetUser: { email: 'nurse@example.com' },
    actorEmail: 'admin@example.com',
    reason: 'Employment ended',
    at: '2026-07-22T00:00:00.000Z',
  });
  assert.deepEqual(patch, {
    is_active: false,
    duty_status: 'off_duty',
    // Routing fields are cleared so a deactivated user's record can never bridge
    // an incoming/masked call to their personal cell.
    personal_cell_e164: '',
    scheduled_off_duty_start: '',
    scheduled_off_duty_end: '',
    offboarded_at: '2026-07-22T00:00:00.000Z',
    offboarded_by: 'admin@example.com',
    offboarding_reason: 'Employment ended',
  });
  assert.throws(() => buildUserOffboardingPatch({ targetUser: { email: 'x@y.z' }, actorEmail: 'admin@example.com' }), /offboarding reason/);
});
