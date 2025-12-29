import { base44 } from "@/api/base44Client";

/**
 * Comprehensive audit logging for sensitive operations
 */
export async function logAuditTrail({
  actionType,
  actionDescription,
  targetEntityType = null,
  targetEntityId = null,
  targetIdentifier = null,
  beforeState = null,
  afterState = null,
  changeDetails = null,
  currentUser = null
}) {
  try {
    // Get current user if not provided
    const user = currentUser || await base44.auth.me();
    
    // Calculate what changed
    const changes = beforeState && afterState 
      ? calculateChanges(beforeState, afterState)
      : changeDetails;

    const auditEntry = {
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action_type: actionType,
      action_description: actionDescription,
      target_entity_type: targetEntityType,
      target_entity_id: targetEntityId,
      target_identifier: targetIdentifier,
      before_state: beforeState,
      after_state: afterState,
      change_details: changes,
      ip_address: await getClientIP(),
      user_agent: navigator.userAgent,
      session_id: getSessionId(),
      flagged_suspicious: false,
      reviewed: false
    };

    await base44.entities.AuditTrail.create(auditEntry);
  } catch (error) {
    console.error('Audit logging failed:', error);
    // Still throw to UserActivity as backup
    try {
      const user = currentUser || await base44.auth.me();
      await base44.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: actionType,
        details: { actionDescription, targetEntityType, targetEntityId }
      });
    } catch (backupError) {
      console.error('Backup logging failed:', backupError);
    }
  }
}

function calculateChanges(before, after) {
  const changes = {};
  
  // Compare all keys in both objects
  const allKeys = new Set([...Object.keys(before || {}), ...Object.keys(after || {})]);
  
  for (const key of allKeys) {
    if (JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key])) {
      changes[key] = {
        from: before?.[key],
        to: after?.[key]
      };
    }
  }
  
  return changes;
}

async function getClientIP() {
  try {
    const response = await fetch('https://api.ipify.org?format=json');
    const data = await response.json();
    return data.ip;
  } catch {
    return 'unknown';
  }
}

function getSessionId() {
  // Generate or retrieve session ID from localStorage
  let sessionId = localStorage.getItem('session_id');
  if (!sessionId) {
    sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    localStorage.setItem('session_id', sessionId);
  }
  return sessionId;
}

// Specific helpers for common operations
export async function logPasswordReset(targetUserEmail, resetByEmail) {
  await logAuditTrail({
    actionType: 'PASSWORD_RESET',
    actionDescription: `Password reset for ${targetUserEmail}`,
    targetEntityType: 'User',
    targetIdentifier: targetUserEmail,
    changeDetails: {
      reset_by: resetByEmail,
      reset_timestamp: new Date().toISOString()
    }
  });
}

export async function logRoleChange(userId, userEmail, oldRole, newRole, changedBy) {
  await logAuditTrail({
    actionType: 'ROLE_CHANGE',
    actionDescription: `Changed role from ${oldRole} to ${newRole} for ${userEmail}`,
    targetEntityType: 'User',
    targetEntityId: userId,
    targetIdentifier: userEmail,
    beforeState: { role: oldRole },
    afterState: { role: newRole },
    currentUser: changedBy
  });
}

export async function logPatientModification(action, patientId, patientName, beforeState, afterState) {
  await logAuditTrail({
    actionType: `PATIENT_${action.toUpperCase()}`,
    actionDescription: `${action} patient: ${patientName}`,
    targetEntityType: 'Patient',
    targetEntityId: patientId,
    targetIdentifier: patientName,
    beforeState,
    afterState
  });
}

export async function logBulkOperation(operationType, entityType, count, details) {
  await logAuditTrail({
    actionType: 'BULK_OPERATION',
    actionDescription: `Bulk ${operationType} on ${count} ${entityType} records`,
    targetEntityType: entityType,
    changeDetails: {
      operation: operationType,
      count,
      details
    }
  });
}

// OASIS specific logging helper
export const logOASISAction = async (action, details = {}) => {
  try {
    const user = await base44.auth.me();
    await logAuditTrail({
      actionType: 'OASIS_' + action.toUpperCase(),
      actionDescription: `OASIS action: ${action}`,
      targetEntityType: 'OASIS',
      changeDetails: details,
      currentUser: user
    });
  } catch (error) {
    console.error('OASIS audit logging failed:', error);
  }
};

// Audit action constants
export const AuditActions = {
  OASIS_UPLOAD: 'OASIS_UPLOAD',
  OASIS_REVIEW: 'OASIS_REVIEW',
  OASIS_COMPARE: 'OASIS_COMPARE',
  OASIS_EXPORT: 'OASIS_EXPORT',
  OASIS_DELETE: 'OASIS_DELETE'
};