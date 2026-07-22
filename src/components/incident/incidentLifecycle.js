import { canTransitionRecordLifecycle, createLifecycleAuditEvent } from '../../lib/recordLifecycle.js';

export const INCIDENT_STATUS_TO_LIFECYCLE = Object.freeze({
  reported: 'submitted',
  under_review: 'in_review',
  corrective_action: 'correction_requested',
  resolved: 'final',
  archived: 'archived',
});

export function canTransitionIncidentStatus(fromStatus, toStatus) {
  if (fromStatus === 'corrective_action' && toStatus === 'resolved') return true;
  const from = INCIDENT_STATUS_TO_LIFECYCLE[fromStatus || 'reported'];
  const to = INCIDENT_STATUS_TO_LIFECYCLE[toStatus];
  return !!from && !!to && canTransitionRecordLifecycle(from, to);
}

export function createIncidentReviewEvent({ incidentId, fromStatus = 'reported', toStatus, actorEmail, reason, at } = {}) {
  if (!canTransitionIncidentStatus(fromStatus, toStatus)) {
    throw new Error(`Invalid incident status transition: ${fromStatus || '(blank)'} -> ${toStatus || '(blank)'}`);
  }
  return createLifecycleAuditEvent({
    recordType: 'Incident',
    recordId: incidentId,
    fromStatus: INCIDENT_STATUS_TO_LIFECYCLE[fromStatus || 'reported'],
    toStatus: INCIDENT_STATUS_TO_LIFECYCLE[toStatus],
    actorEmail,
    reason,
    at,
    metadata: { incident_from_status: fromStatus || 'reported', incident_to_status: toStatus },
  });
}

export function incidentNeedsCorrectiveAction(incident = {}) {
  return incident.state_reportable === true || ['high', 'critical'].includes(String(incident.severity || '').toLowerCase());
}
