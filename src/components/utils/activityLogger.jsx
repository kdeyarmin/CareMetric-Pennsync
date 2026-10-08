import { base44 } from '@/api/base44Client';
import { loadCurrentCaller } from '@/lib/agencyRoster';

// Browser activity telemetry (owner decision 2026-10-08: record it again).
//
// What keeps this honest:
//   - the row's user_email is the signed-in caller's own address, and the
//     UserActivity RLS create rule requires exactly that, so a browser can only
//     ever append events about itself;
//   - UserActivity has no client update or delete rule, so the trail is
//     append-only; reads are the built-in admin's (RLS) or an agency
//     administrator's through getUserActivityLog;
//   - details are PHI-minimal: numbers and booleans under non-identifying keys,
//     and short strings only under a fixed set of operational keys. Names,
//     emails, phone numbers, patient ids, free text and file references are
//     dropped. An entity link travels only as entity_type + entity_id.
// It is still self-reported telemetry, not an attested audit ledger: purpose
// brokers on the server remain the record for anything that must be proven.
// Logging never blocks or fails the product action that called it.

const ACTION_PATTERN = /^[a-z0-9_]{1,64}$/;
const ENTITY_TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const ENTITY_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const SAFE_STRING_DETAIL_KEYS = new Set([
  'page', 'page_title', 'tab', 'section', 'feature', 'source', 'mode', 'format',
  'type', 'kind', 'status', 'user_role', 'staff_role', 'visit_type', 'old_role', 'new_role',
]);
const IDENTIFYING_DETAIL_KEY = /(patient|mrn|name|email|phone|e164|number|cell|thread|body|message|reason|note|query|filter|url|pdf|document|file|before|after|changes|address|dob|birth|ssn|_id$|^id$|data)/i;
const MAX_DETAIL_KEYS = 25;
const MAX_STRING_LENGTH = 80;

/** Keep only PHI-minimal, scalar detail fields. Exported for tests. */
export function minimizeActivityDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const out = {};
  for (const [key, value] of Object.entries(details).slice(0, 100)) {
    if (Object.keys(out).length >= MAX_DETAIL_KEYS) break;
    if (key === 'entity_type' || key === 'entity_id' || key === 'page') continue;
    if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) {
      if (!IDENTIFYING_DETAIL_KEY.test(key)) out[key] = value;
      continue;
    }
    if (typeof value === 'string' && SAFE_STRING_DETAIL_KEYS.has(key)
      && value.length <= MAX_STRING_LENGTH && !/@|\d{4,}/.test(value)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function deviceType() {
  try {
    const width = window.innerWidth || 0;
    if (width && width < 768) return 'mobile';
    if (width && width < 1024) return 'tablet';
    return 'desktop';
  } catch {
    return undefined;
  }
}

export const logActivity = async (action, details = {}) => {
  try {
    if (typeof action !== 'string' || !ACTION_PATTERN.test(action)) return undefined;
    const caller = await loadCurrentCaller();
    const email = typeof caller?.email === 'string' ? caller.email : '';
    if (!email) return undefined;
    const source = details && typeof details === 'object' && !Array.isArray(details) ? details : {};
    const entityType = typeof source.entity_type === 'string' && ENTITY_TYPE_PATTERN.test(source.entity_type)
      ? source.entity_type
      : undefined;
    const entityId = entityType && typeof source.entity_id === 'string' && ENTITY_ID_PATTERN.test(source.entity_id)
      ? source.entity_id
      : undefined;
    const page = typeof source.page === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(source.page)
      ? source.page
      : undefined;
    await base44.entities.UserActivity.create({
      user_email: email,
      user_name: typeof caller.full_name === 'string' ? caller.full_name.slice(0, 120) : undefined,
      action,
      page,
      entity_type: entityType,
      entity_id: entityId,
      details: minimizeActivityDetails(source),
      status: 'success',
      device_type: deviceType(),
    });
  } catch {
    // Telemetry must never fail the action that produced it.
  }
  return undefined;
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
