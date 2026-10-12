import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCoreWorkQueues, formatQueueCount, showsWorkQueueStrip } from './coreWorkQueues.js';

test('buildCoreWorkQueues gives nurses task and note queues only', () => {
  const queues = buildCoreWorkQueues({
    role: 'nurse',
    tasks: [{ status: 'pending' }, { status: 'completed' }],
    notes: [{ status: 'pending_review' }],
    referrals: [{ status: 'awaiting_info' }],
  });
  assert.deepEqual(queues.map((q) => q.id), ['notes-pending-review', 'my-open-tasks']);
});

test('buildCoreWorkQueues gives admins referral, incident, credential, task, and note queues', () => {
  const queues = buildCoreWorkQueues({
    role: 'facility_admin',
    referrals: [{ status: 'awaiting_info' }, { requires_manual_review: true }, { status: 'ready_for_admission' }],
    incidents: [{ status: 'reported' }, { status: 'resolved' }],
    credentials: [{ status: 'pending_approval' }, { status: 'approved' }],
    tasks: [{ status: 'pending' }],
    notes: [{ status: 'submitted' }],
  });
  assert.deepEqual(queues.map((q) => q.id), [
    'referrals-awaiting-info',
    'incidents-open-review',
    'notes-pending-review',
    'credentials-pending',
    'my-open-tasks',
  ]);
  assert.equal(queues[0].count, 2);
});

test('buildCoreWorkQueues gives managers the referral queue but not admin review queues', () => {
  const queues = buildCoreWorkQueues({
    role: 'manager',
    referrals: [{ status: 'awaiting_info' }],
    incidents: [{ status: 'reported' }],
    credentials: [{ status: 'pending_approval' }],
    notes: [{ status: 'submitted' }],
  });
  assert.deepEqual(queues.map((q) => q.id), ['notes-pending-review', 'referrals-awaiting-info']);
  assert.equal(queues.find((q) => q.id === 'referrals-awaiting-info').route, '/ReferralIntake');
  assert.equal(queues.some((q) => q.route === '/IncidentReview' || q.route === '/CredentialCompliance'), false);
});

test('buildCoreWorkQueues omits empty queues', () => {
  assert.deepEqual(buildCoreWorkQueues({ role: 'admin' }), []);
});

test('a full referral page is not shown as an exact count', () => {
  assert.equal(formatQueueCount(200, true), '200+');
  assert.equal(formatQueueCount(3, false), '3');
});

test('a manager sees the work-queue strip without a nursing discipline', () => {
  assert.equal(showsWorkQueueStrip('manager', false), true);
  assert.equal(showsWorkQueueStrip('facility_admin', false), true);
  assert.equal(showsWorkQueueStrip('nurse', false), false);
  assert.equal(showsWorkQueueStrip('nurse', true), true);
});
