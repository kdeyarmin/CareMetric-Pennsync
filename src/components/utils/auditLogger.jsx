import { base44 } from '@/api/base44Client';

/**
 * Centralized audit logging utility
 * Automatically logs sensitive data access and modifications
 */

export const AuditActions = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  EXPORT: 'export',
  PRINT: 'print',
  DOWNLOAD: 'download',
  SHARE: 'share',
  LOGIN: 'login',
  LOGOUT: 'logout',
  ACCESS_DENIED: 'access_denied',
  PASSWORD_RESET: 'password_reset',
  ROLE_CHANGE: 'role_change',
  BULK_OPERATION: 'bulk_operation',
  OASIS_UPLOAD: 'oasis_upload',
  OASIS_REVIEW: 'oasis_review',
  OASIS_COMPARE: 'oasis_compare',
  OASIS_EXPORT: 'oasis_export',
  OASIS_DELETE: 'oasis_delete'
};

export const logAudit = async ({
  action,
  entityType,
  entityId = null,
  affectedData = null,
  previousData = null,
  description = null
}) => {
  try {
    // Get user agent (IP will be captured server-side)
    const userAgent = navigator.userAgent;

    await base44.functions.invoke('logAuditEvent', {
      action,
      entity_type: entityType,
      entity_id: entityId,
      affected_data: affectedData,
      previous_data: previousData,
      user_agent: userAgent,
      description: description || `${action} ${entityType}`
    });
  } catch (error) {
    console.error('Audit logging failed:', error);
    // Don't throw - audit failures shouldn't break app functionality
  }
};

// Convenience methods for common audit events
export const auditLogger = {
  viewPatient: (patientId, patientName) => 
    logAudit({
      action: AuditActions.VIEW,
      entityType: 'Patient',
      entityId: patientId,
      description: `Viewed patient record: ${patientName}`
    }),

  viewVisit: (visitId, patientName) =>
    logAudit({
      action: AuditActions.VIEW,
      entityType: 'Visit',
      entityId: visitId,
      description: `Viewed visit for patient: ${patientName}`
    }),

  createPatient: (patientId, patientName, patientData) =>
    logAudit({
      action: AuditActions.CREATE,
      entityType: 'Patient',
      entityId: patientId,
      affectedData: patientData,
      description: `Created new patient record: ${patientName}`
    }),

  updatePatient: (patientId, patientName, previousData, updatedData) =>
    logAudit({
      action: AuditActions.UPDATE,
      entityType: 'Patient',
      entityId: patientId,
      previousData: previousData,
      affectedData: updatedData,
      description: `Updated patient record: ${patientName}`
    }),
  
  deletePatient: (patientId, patientName) =>
    logAudit({
      action: AuditActions.DELETE,
      entityType: 'Patient',
      entityId: patientId,
      description: `Deleted patient record: ${patientName}`
    }),

  exportData: (entityType, recordCount) =>
    logAudit({
      action: AuditActions.EXPORT,
      entityType: entityType,
      description: `Exported ${recordCount} ${entityType} records`
    }),

  printData: (entityType, entityId, description) =>
    logAudit({
      action: AuditActions.PRINT,
      entityType: entityType,
      entityId: entityId,
      description: description || `Printed ${entityType} record`
    }),
  
  downloadData: (entityType, entityId, description) =>
    logAudit({
      action: AuditActions.DOWNLOAD,
      entityType: entityType,
      entityId: entityId,
      description: description || `Downloaded ${entityType} data`
    }),

  shareData: (entityType, entityId, sharedWith, description) =>
    logAudit({
      action: AuditActions.SHARE,
      entityType: entityType,
      entityId: entityId,
      affectedData: { sharedWith },
      description: description || `Shared ${entityType} with ${sharedWith}`
    }),

  accessDenied: (resource) =>
    logAudit({
      action: AuditActions.ACCESS_DENIED,
      entityType: 'Security',
      description: `Access denied to: ${resource}`
    }),

  loginAttempt: (success) =>
    logAudit({
      action: success ? AuditActions.LOGIN : AuditActions.ACCESS_DENIED,
      entityType: 'User',
      description: success ? 'User logged in' : 'Failed login attempt'
    }),
  
  logout: () =>
    logAudit({
      action: AuditActions.LOGOUT,
      entityType: 'User',
      description: 'User logged out'
    }),

  passwordReset: (targetUserEmail, resetByEmail) =>
    logAudit({
      action: AuditActions.PASSWORD_RESET,
      entityType: 'User',
      affectedData: { targetUserEmail, resetByEmail },
      description: `Password reset for ${targetUserEmail}`
    }),

  roleChange: (userId, userEmail, oldRole, newRole) =>
    logAudit({
      action: AuditActions.ROLE_CHANGE,
      entityType: 'User',
      entityId: userId,
      previousData: { role: oldRole },
      affectedData: { role: newRole },
      description: `Changed role from ${oldRole} to ${newRole} for ${userEmail}`
    }),
  
  bulkOperation: (operationType, entityType, count, details) =>
    logAudit({
      action: AuditActions.BULK_OPERATION,
      entityType: entityType,
      affectedData: { operationType, count, details },
      description: `Bulk ${operationType} on ${count} ${entityType} records`
    }),

  oasisAction: (action, details = {}) =>
    logAudit({
      action: AuditActions[`OASIS_${action.toUpperCase()}`] || `OASIS_${action.toUpperCase()}`,
      entityType: 'OASIS',
      affectedData: details,
      description: `OASIS action: ${action}`
    })
};

// Export logOASISAction as standalone function for backwards compatibility
export const logOASISAction = auditLogger.oasisAction;

export default auditLogger;