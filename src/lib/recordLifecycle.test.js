import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RECORD_LIFECYCLE_STATUS,
  assertRecordLifecycleTransition,
  canTransitionRecordLifecycle,
  createLifecycleAuditEvent,
  isFinalRecordStatus,
  normalizeLifecycleStatus,
} from './recordLifecycle.js';

test('normalizeLifecycleStatus canonicalizes user-facing spellings', () => {
  assert.equal(normalizeLifecycleStatus('In Review'), RECORD_LIFECYCLE_STATUS.IN_REVIEW);
  assert.equal(normalizeLifecycleStatus('correction-requested'), RECORD_LIFECYCLE_STATUS.CORRECTION_REQUESTED);
  assert.equal(normalizeLifecycleStatus('unknown'), null);
});

test('canTransitionRecordLifecycle allows reviewed lifecycle paths', () => {
  assert.equal(canTransitionRecordLifecycle('draft', 'submitted'), true);
  assert.equal(canTransitionRecordLifecycle('submitted', 'final'), true);
  assert.equal(canTransitionRecordLifecycle('final', 'correction_requested'), true);
  assert.equal(canTransitionRecordLifecycle('correction_requested', 'corrected'), true);
  assert.equal(canTransitionRecordLifecycle('correction_requested', 'final'), true);
  assert.equal(canTransitionRecordLifecycle('corrected', 'final'), true);
  assert.equal(canTransitionRecordLifecycle('final', 'archived'), true);
});

test('canTransitionRecordLifecycle blocks silent rewrites of terminal states', () => {
  assert.equal(canTransitionRecordLifecycle('final', 'draft'), false);
  assert.equal(canTransitionRecordLifecycle('voided', 'submitted'), false);
  assert.equal(canTransitionRecordLifecycle('archived', 'in_review'), false);
});

test('isFinalRecordStatus identifies records that require correction/audit flow', () => {
  assert.equal(isFinalRecordStatus('final'), true);
  assert.equal(isFinalRecordStatus('corrected'), true);
  assert.equal(isFinalRecordStatus('draft'), false);
});

test('createLifecycleAuditEvent validates transition and required audit fields', () => {
  const event = createLifecycleAuditEvent({
    recordType: 'Visit',
    recordId: 'visit-1',
    fromStatus: 'submitted',
    toStatus: 'final',
    actorEmail: 'qa@example.com',
    reason: 'QA approved',
    at: '2026-07-22T00:00:00.000Z',
    metadata: { reviewer_role: 'qa' },
  });
  assert.deepEqual(event, {
    record_type: 'Visit',
    record_id: 'visit-1',
    from_status: 'submitted',
    to_status: 'final',
    actor_email: 'qa@example.com',
    reason: 'QA approved',
    occurred_at: '2026-07-22T00:00:00.000Z',
    metadata: { reviewer_role: 'qa' },
  });
  assert.throws(() => assertRecordLifecycleTransition('final', 'draft'), /Invalid record lifecycle transition/);
  assert.throws(() => createLifecycleAuditEvent({ fromStatus: 'draft', toStatus: 'submitted' }), /recordType, recordId, and actorEmail/);
});
