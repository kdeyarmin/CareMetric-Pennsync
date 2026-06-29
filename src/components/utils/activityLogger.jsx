import { base44 } from "@/api/base44Client";

export const logActivity = async (action, details = {}) => {
  try {
    const user = await base44.auth.me();
    if (!user) return;

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action,
      details,
      page: details.page || window.location.pathname,
      entity_type: details.entity_type || null,
      entity_id: details.entity_id || null,
      user_agent: navigator.userAgent
    });
  } catch (error) {
    console.error("Failed to log activity:", error);
  }
};

export const ActivityActions = {
  VIEW: 'view',
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  LOGIN: 'login',
  LOGOUT: 'logout',
  PAGE_VISIT: 'page_visit',
  EXPORT: 'export',
  GENERATE: 'generate',
  ERROR: 'error',
  OASIS_UPLOAD: 'oasis_upload',
  OASIS_ANALYZE: 'oasis_analyze',
  OASIS_SAVE: 'oasis_save',
  PATIENT_MATCH: 'patient_match',
  DISPUTE_MATCH: 'dispute_match',
  VISIT_DOCUMENT: 'visit_document',
  VISIT_START: 'visit_start',
  VISIT_COMPLETE: 'visit_complete',
  CARE_PLAN_CREATE: 'care_plan_create',
  CARE_PLAN_UPDATE: 'care_plan_update',
  TASK_CREATE: 'task_create',
  TASK_COMPLETE: 'task_complete',
  INCIDENT_REPORT: 'incident_report',
  TRAINING_COMPLETE: 'training_complete',
  NOTE_ENHANCED: 'note_enhanced',
  NOTE_AI_GENERATED: 'note_ai_generated',
  NOTE_COMPLIANCE_CHECK: 'note_compliance_check',
  ALERT_VIEWED: 'alert_viewed',
  ALERT_DISMISSED: 'alert_dismissed',
  AI_FEATURE_USED: 'ai_feature_used',
  SEARCH: 'search',
  FILTER_APPLIED: 'filter_applied',
  // User management actions
  USER_CREATED: 'user_created',
  USER_ROLE_CHANGED: 'user_role_changed',
  USER_ENABLED: 'user_enabled',
  USER_DISABLED: 'user_disabled',
  USER_PASSWORD_RESET: 'user_password_reset',
  USER_DELETED: 'user_deleted',
  INVITATION_SENT: 'invitation_sent',
  INVITATION_RESENT: 'invitation_resent',
  INVITATION_DELETED: 'invitation_deleted',
  // Document actions
  DOCUMENT_GENERATED: 'document_generated',
  DOCUMENT_SIGNED: 'document_signed',
  DOCUMENT_UPLOADED: 'document_uploaded',
  DOCUMENT_DELETED: 'document_deleted',
  // Admin actions
  SETTINGS_UPDATED: 'settings_updated',
  ROLE_PERMISSION_CHANGED: 'role_permission_changed',
  // Telnyx phone / messaging actions
  SMS_SENT: 'sms_sent',
  SMS_RECEIVED: 'sms_received',
  SMS_STATUS_UPDATED: 'sms_status_updated',
  SMS_OPT_OUT: 'sms_opt_out',
  CALL_INITIATED: 'call_initiated',
  INBOUND_CALL_RECEIVED: 'inbound_call_received',
  CALL_STATUS_UPDATED: 'call_status_updated',
  DUTY_STATUS_CHANGED: 'duty_status_changed',
  WORK_NUMBER_PROVISIONED: 'work_number_provisioned'
};

export const logError = async (errorMessage, errorDetails = {}) => {
  try {
    let user = null;
    try {
      user = await base44.auth.me();
    } catch {
      // User might not be logged in
    }

    await base44.entities.UserActivity.create({
      user_email: user?.email || 'unknown',
      user_name: user?.full_name || 'Unknown User',
      action: ActivityActions.ERROR,
      details: {
        error_message: errorMessage,
        error_stack: errorDetails.stack || null,
        component: errorDetails.component || null,
        context: errorDetails.context || null,
        ...errorDetails
      },
      page: errorDetails.page || window.location.pathname,
      entity_type: errorDetails.entity_type || null,
      entity_id: errorDetails.entity_id || null,
      user_agent: navigator.userAgent
    });
  } catch (error) {
    console.error("Failed to log error:", error);
  }
};