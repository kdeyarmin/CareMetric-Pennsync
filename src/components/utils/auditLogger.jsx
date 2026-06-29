import { base44 } from "@/api/base44Client";

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
  
  // Care Plan Actions
  CARE_PLAN_CREATED: 'care_plan_created',
  CARE_PLAN_UPDATED: 'care_plan_updated',
  CARE_PLAN_COMPLETED: 'care_plan_completed',
  
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
export async function logAudit({ 
  action, 
  details = {}, 
  entityType = null, 
  entityId = null,
  changes = null,
  severity = 'info' // info, warning, critical
}) {
  try {
    const user = await base44.auth.me();
    
    const auditData = {
      user_email: user?.email || 'system',
      user_name: user?.full_name || 'System',
      action,
      details: {
        ...details,
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent,
        page: window.location.pathname,
        // severity is not a top-level UserActivity field (it was silently dropped);
        // keep it inside the free-form details object so it is actually recorded.
        severity,
      },
      entity_type: entityType,
      entity_id: entityId,
    };

    // Add change tracking if provided
    if (changes) {
      auditData.details.changes = changes;
    }

    // Log to UserActivity entity
    await base44.entities.UserActivity.create(auditData);

    // Also log critical actions to SecurityLog
    if (severity === 'critical' || action.includes('delete') || action.includes('supervisor')) {
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: user?.email || 'system',
        user_role: user?.role || 'unknown',
        action,
        details: auditData.details,
        ip_address: '', // Would need server-side to get real IP
        user_agent: navigator.userAgent,
      });
    }

  } catch (error) {
    console.error('Audit logging failed:', error);
    // Don't throw - audit logging shouldn't break the app
  }
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

/**
 * Log patient record changes with field-level tracking
 */
export async function logPatientAction({
  action,
  patientId,
  patientName,
  changedFields = {},
  reason,
}) {
  return logAudit({
    action,
    entityType: 'Patient',
    entityId: patientId,
    details: {
      patient_name: patientName,
      changed_fields: Object.keys(changedFields),
      reason,
    },
    changes: changedFields,
    severity: action === AuditActions.PATIENT_DELETED ? 'critical' : 'info',
  });
}

/**
 * Log task actions
 */
export async function logTaskAction({
  action,
  taskId,
  taskTitle,
  patientId,
  assignedTo,
  completedBy,
  completionNotes,
}) {
  return logAudit({
    action,
    entityType: 'Task',
    entityId: taskId,
    details: {
      task_title: taskTitle,
      patient_id: patientId,
      assigned_to: assignedTo,
      completed_by: completedBy,
      completion_notes: completionNotes,
    },
  });
}

/**
 * Log incident actions
 */
export async function logIncidentAction({
  action,
  incidentId,
  patientId,
  incidentType,
  severity,
  details,
}) {
  return logAudit({
    action,
    entityType: 'Incident',
    entityId: incidentId,
    details: {
      patient_id: patientId,
      incident_type: incidentType,
      incident_severity: severity,
      ...details,
    },
    severity: severity === 'high' ? 'critical' : 'warning',
  });
}