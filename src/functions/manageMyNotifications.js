import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const TYPES = new Set([
  'report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
  'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
  'training_due', 'system_update', 'message_received', 'sms_failed',
  'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
  'info', 'expiration_warning', 'credential_expiration',
  'admin_expiration_summary', 'care_plan_proposal', 'signature_request',
]);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const NOTIFICATION_KEYS = [
  'id', 'agency_id', 'title', 'message', 'type', 'priority', 'created_date',
  'is_read', 'read_at', 'dismissed', 'dismissed_at', 'action_url',
  'action_label', 'version',
];

function hasControl(value) {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$')
    && !hasControl(value);
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && expected.every((key, index) => actual[index] === key);
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function safeActionUrl(value) {
  return value === null || (
    typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && value.length <= 1_000
    && !hasControl(value)
  );
}

function validNotification(row, agencyId) {
  return exactKeys(row, NOTIFICATION_KEYS)
    && exactIdentifier(row.id)
    && row.agency_id === agencyId
    && typeof row.title === 'string'
    && row.title.length > 0
    && row.title.length <= 500
    && typeof row.message === 'string'
    && row.message.length > 0
    && row.message.length <= 5_000
    && TYPES.has(row.type)
    && PRIORITIES.has(row.priority)
    && validInstant(row.created_date)
    && typeof row.is_read === 'boolean'
    && (row.is_read ? validInstant(row.read_at) : row.read_at === null)
    && typeof row.dismissed === 'boolean'
    && (row.dismissed ? validInstant(row.dismissed_at) : row.dismissed_at === null)
    && safeActionUrl(row.action_url)
    && (row.action_label === null
      || (typeof row.action_label === 'string'
        && row.action_label.length > 0
        && row.action_label.length <= 200))
    && Number.isSafeInteger(row.version)
    && row.version >= 1;
}

function validateAgencyId(agencyId) {
  if (!exactIdentifier(agencyId)) throw new Error('Exact agencyId is required');
  return agencyId;
}

function validateMutationInput({ agencyId, notificationId, expectedVersion }) {
  const exactAgencyId = validateAgencyId(agencyId);
  if (!exactIdentifier(notificationId)) throw new Error('Exact notificationId is required');
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    throw new Error('A positive expectedVersion is required');
  }
  return { agencyId: exactAgencyId, notificationId, expectedVersion };
}

async function invoke(payload) {
  const response = await base44.functions.invoke('manageMyNotifications', payload);
  return response?.data ?? response;
}

export async function listMyNotifications({ agencyId } = {}) {
  const exactAgencyId = validateAgencyId(agencyId);
  const result = await invoke({ action: 'list', agency_id: exactAgencyId });
  if (
    !exactKeys(result, ['success', 'action', 'agency_id', 'notifications', 'complete'])
    || result.success !== true
    || result.action !== 'list'
    || result.agency_id !== exactAgencyId
    || typeof result.complete !== 'boolean'
    || !Array.isArray(result.notifications)
    || result.notifications.length > 100
    || result.notifications.some((row) => !validNotification(row, exactAgencyId) || row.dismissed)
  ) throw new Error(result?.error || 'Notification inbox failed integrity validation');
  return result.notifications.map((row) => ({ ...row }));
}

export async function markMyNotificationRead({
  agencyId,
  notificationId,
  expectedVersion,
} = {}) {
  const input = validateMutationInput({ agencyId, notificationId, expectedVersion });
  const result = await invoke({
    action: 'mark_read',
    agency_id: input.agencyId,
    notification_id: input.notificationId,
    expected_version: input.expectedVersion,
  });
  if (
    !exactKeys(result, ['success', 'action', 'agency_id', 'idempotent', 'notification'])
    || result.success !== true
    || result.action !== 'mark_read'
    || result.agency_id !== input.agencyId
    || typeof result.idempotent !== 'boolean'
    || !validNotification(result.notification, input.agencyId)
    || result.notification.id !== input.notificationId
    || !result.notification.is_read
  ) throw new Error(result?.error || 'Notification read transition failed integrity validation');
  return { ...result.notification };
}

export async function markAllMyNotificationsRead({ agencyId } = {}) {
  const exactAgencyId = validateAgencyId(agencyId);
  const result = await invoke({
    action: 'mark_all_read',
    agency_id: exactAgencyId,
  });
  if (
    !exactKeys(result, ['success', 'action', 'agency_id', 'marked', 'complete'])
    || result.success !== true
    || result.action !== 'mark_all_read'
    || result.agency_id !== exactAgencyId
    || typeof result.complete !== 'boolean'
    || !Number.isSafeInteger(result.marked)
    || result.marked < 0
    || result.marked > 100
  ) throw new Error(result?.error || 'Notification bulk read transition failed integrity validation');
  return { marked: result.marked, complete: result.complete };
}

export async function dismissMyNotification({
  agencyId,
  notificationId,
  expectedVersion,
} = {}) {
  const input = validateMutationInput({ agencyId, notificationId, expectedVersion });
  const result = await invoke({
    action: 'dismiss',
    agency_id: input.agencyId,
    notification_id: input.notificationId,
    expected_version: input.expectedVersion,
  });
  if (
    !exactKeys(result, ['success', 'action', 'agency_id', 'idempotent', 'notification'])
    || result.success !== true
    || result.action !== 'dismiss'
    || result.agency_id !== input.agencyId
    || typeof result.idempotent !== 'boolean'
    || !validNotification(result.notification, input.agencyId)
    || result.notification.id !== input.notificationId
    || !result.notification.dismissed
  ) throw new Error(result?.error || 'Notification dismissal failed integrity validation');
  return { ...result.notification };
}
