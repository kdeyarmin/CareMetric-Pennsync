/**
 * Comprehensive audit logging utility for tracking all user actions
 */

export const AuditActions = {
  // OASIS Actions
  OASIS_SUGGESTION_APPROVED: 'oasis_suggestion_approved',
  OASIS_SUGGESTION_REJECTED: 'oasis_suggestion_rejected',
  OASIS_SUGGESTION_EDITED: 'oasis_suggestion_edited',
  OASIS_SUPERVISOR_APPROVED: 'oasis_supervisor_approved',
  OASIS_SUPERVISOR_REJECTED: 'oasis_supervisor_rejected',
  OASIS_UPLOADED: 'oasis_uploaded',
  
  // Patient Actions
  PATIENT_CREATED: 'patient_created',
  PATIENT_UPDATED: 'patient_updated',
  PATIENT_DELETED: 'patient_deleted',
  PATIENT_VIEWED: 'patient_viewed',
  PATIENT_MERGED: 'patient_merged',
  
  // Visit Actions
  VISIT_CREATED: 'visit_created',
  VISIT_UPDATED: 'visit_updated',
  VISIT_COMPLETED: 'visit_completed',
  VISIT_CANCELLED: 'visit_cancelled',

  // Task Actions
  TASK_CREATED: 'task_created',
  TASK_COMPLETED: 'task_completed',
  TASK_ASSIGNED: 'task_assigned',
  TASK_UPDATED: 'task_updated',
  
  // Incident Actions
  INCIDENT_REPORTED: 'incident_reported',
  INCIDENT_UPDATED: 'incident_updated',
  INCIDENT_RESOLVED: 'incident_resolved',
  
  // Alert Actions
  ALERT_ACKNOWLEDGED: 'alert_acknowledged',
  ALERT_DISMISSED: 'alert_dismissed',
  ALERT_ESCALATED: 'alert_escalated',
  
  // Training Actions
  TRAINING_COMPLETED: 'training_completed',
  TRAINING_ASSIGNED: 'training_assigned',
  
  // Note Actions
  NOTE_ENHANCED: 'note_enhanced',
  NOTE_SAVED: 'note_saved',
  
  // System Actions
  USER_LOGIN: 'user_login',
  USER_LOGOUT: 'user_logout',
  SETTINGS_CHANGED: 'settings_changed',
};

/**
 * Log an audit event
 * @param {string} action - Action type from AuditActions
 * @param {Object} details - Additional details about the action
 * @param {string} entityType - Type of entity affected (e.g., 'Patient', 'OASIS', 'Task')
 * @param {string} entityId - ID of the affected entity
 * @param {Object} changes - Before/after values for updates
 */
// A browser cannot attest actor, action, record state, or before/after values.
// Keep the API stable for existing callers, but only purpose-specific backend
// brokers may append compliance events.
export async function logAudit(_event) {
  return undefined;
}

/**
 * Log OASIS-specific actions with rich context
 */
export async function logOASISAction({
  action,
  patientId,
  oasisId,
  itemNumber,
  oldValue,
  newValue,
  confidence,
  notes,
  reviewedBy,
}) {
  return logAudit({
    action,
    entityType: 'OASISUpload',
    entityId: oasisId,
    details: {
      patient_id: patientId,
      item_number: itemNumber,
      old_value: oldValue,
      new_value: newValue,
      confidence,
      notes,
      reviewed_by: reviewedBy,
    },
    changes: oldValue && newValue ? { before: oldValue, after: newValue } : null,
    severity: action.includes('supervisor') ? 'critical' : 'info',
  });
}
