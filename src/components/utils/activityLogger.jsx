// Browser-reported telemetry cannot be treated as an attested audit ledger:
// callers can alter actions, identities, entity links, and free-form details.
// Keep this compatibility helper as an intentional no-op so product actions do
// not fail while purpose-specific server brokers replace meaningful events.
export const logActivity = async (_action, _details = {}) => undefined;

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

// Error objects routinely include clinical context and stack-local values. Do
// not ship them to the broad UserActivity surface from an untrusted browser.
export const logError = async (_errorMessage, _errorDetails = {}) => undefined;
