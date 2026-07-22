import test from 'node:test';
import assert from 'node:assert/strict';
import { canTransitionIncidentStatus, createIncidentReviewEvent, incidentNeedsCorrectiveAction } from './incidentLifecycle.js';

test('canTransitionIncidentStatus maps incident statuses onto lifecycle transitions', () => {
  assert.equal(canTransitionIncidentStatus('reported', 'under_review'), true);
  assert.equal(canTransitionIncidentStatus('under_review', 'corrective_action'), true);
  assert.equal(canTransitionIncidentStatus('corrective_action', 'resolved'), true);
  assert.equal(canTransitionIncidentStatus('resolved', 'reported'), false);
});

test('createIncidentReviewEvent records incident-specific transition metadata', () => {
  const event = createIncidentReviewEvent({
    incidentId: 'inc-1',
    fromStatus: 'reported',
    toStatus: 'under_review',
    actorEmail: 'admin@example.com',
    reason: 'Assigned investigator',
    at: '2026-07-22T00:00:00.000Z',
  });
  assert.equal(event.record_type, 'Incident');
  assert.equal(event.to_status, 'in_review');
  assert.deepEqual(event.metadata, { incident_from_status: 'reported', incident_to_status: 'under_review' });
  const resolvedEvent = createIncidentReviewEvent({
    incidentId: 'inc-1',
    fromStatus: 'corrective_action',
    toStatus: 'resolved',
    actorEmail: 'admin@example.com',
  });
  assert.equal(resolvedEvent.from_status, 'correction_requested');
  assert.equal(resolvedEvent.to_status, 'final');
  assert.throws(() => createIncidentReviewEvent({ incidentId: 'inc-1', fromStatus: 'resolved', toStatus: 'reported', actorEmail: 'a@b.c' }), /Invalid incident status transition/);
});

test('incidentNeedsCorrectiveAction flags state-reportable and high-severity incidents', () => {
  assert.equal(incidentNeedsCorrectiveAction({ state_reportable: true, severity: 'low' }), true);
  assert.equal(incidentNeedsCorrectiveAction({ severity: 'high' }), true);
  assert.equal(incidentNeedsCorrectiveAction({ severity: 'medium' }), false);
});
