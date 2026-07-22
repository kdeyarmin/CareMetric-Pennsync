// Shared record-lifecycle helpers for clinical/legal/business records.
//
// This module is intentionally pure: Phase 0 establishes one canonical status
// vocabulary and transition validator without changing existing page behavior.
// Feature-specific integrations can adopt it incrementally after migration and
// product sign-off.

export const RECORD_LIFECYCLE_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  IN_REVIEW: 'in_review',
  FINAL: 'final',
  CORRECTION_REQUESTED: 'correction_requested',
  CORRECTED: 'corrected',
  VOIDED: 'voided',
  ARCHIVED: 'archived',
});

export const FINAL_RECORD_STATUSES = Object.freeze([
  RECORD_LIFECYCLE_STATUS.FINAL,
  RECORD_LIFECYCLE_STATUS.CORRECTED,
  RECORD_LIFECYCLE_STATUS.VOIDED,
  RECORD_LIFECYCLE_STATUS.ARCHIVED,
]);

const TRANSITIONS = Object.freeze({
  [RECORD_LIFECYCLE_STATUS.DRAFT]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.SUBMITTED,
    RECORD_LIFECYCLE_STATUS.VOIDED,
  ]),
  [RECORD_LIFECYCLE_STATUS.SUBMITTED]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.IN_REVIEW,
    RECORD_LIFECYCLE_STATUS.CORRECTION_REQUESTED,
    RECORD_LIFECYCLE_STATUS.FINAL,
    RECORD_LIFECYCLE_STATUS.VOIDED,
  ]),
  [RECORD_LIFECYCLE_STATUS.IN_REVIEW]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.CORRECTION_REQUESTED,
    RECORD_LIFECYCLE_STATUS.FINAL,
    RECORD_LIFECYCLE_STATUS.VOIDED,
  ]),
  [RECORD_LIFECYCLE_STATUS.CORRECTION_REQUESTED]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.CORRECTED,
    RECORD_LIFECYCLE_STATUS.FINAL,
    RECORD_LIFECYCLE_STATUS.VOIDED,
  ]),
  [RECORD_LIFECYCLE_STATUS.CORRECTED]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.IN_REVIEW,
    RECORD_LIFECYCLE_STATUS.FINAL,
    RECORD_LIFECYCLE_STATUS.VOIDED,
  ]),
  [RECORD_LIFECYCLE_STATUS.FINAL]: Object.freeze([
    RECORD_LIFECYCLE_STATUS.CORRECTION_REQUESTED,
    RECORD_LIFECYCLE_STATUS.ARCHIVED,
  ]),
  [RECORD_LIFECYCLE_STATUS.VOIDED]: Object.freeze([]),
  [RECORD_LIFECYCLE_STATUS.ARCHIVED]: Object.freeze([]),
});

export const RECORD_LIFECYCLE_TRANSITIONS = TRANSITIONS;

export function normalizeLifecycleStatus(status) {
  if (!status || typeof status !== 'string') return null;
  const normalized = status.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return Object.values(RECORD_LIFECYCLE_STATUS).includes(normalized) ? normalized : null;
}

export function isFinalRecordStatus(status) {
  const normalized = normalizeLifecycleStatus(status);
  return FINAL_RECORD_STATUSES.includes(normalized);
}

export function canTransitionRecordLifecycle(from, to) {
  const current = normalizeLifecycleStatus(from);
  const next = normalizeLifecycleStatus(to);
  if (!current || !next) return false;
  if (current === next) return true;
  return TRANSITIONS[current]?.includes(next) || false;
}

export function assertRecordLifecycleTransition(from, to) {
  if (canTransitionRecordLifecycle(from, to)) return normalizeLifecycleStatus(to);
  throw new Error(`Invalid record lifecycle transition: ${from || '(blank)'} -> ${to || '(blank)'}`);
}

export function createLifecycleAuditEvent({
  recordType,
  recordId,
  fromStatus,
  toStatus,
  actorEmail,
  reason,
  at = new Date().toISOString(),
  metadata = {},
} = {}) {
  const next = assertRecordLifecycleTransition(fromStatus, toStatus);
  const previous = normalizeLifecycleStatus(fromStatus);
  if (!recordType || !recordId || !actorEmail) {
    throw new Error('Lifecycle audit events require recordType, recordId, and actorEmail');
  }
  return {
    record_type: recordType,
    record_id: recordId,
    from_status: previous,
    to_status: next,
    actor_email: actorEmail,
    reason: reason || null,
    occurred_at: at,
    metadata: metadata && typeof metadata === 'object' ? metadata : {},
  };
}
