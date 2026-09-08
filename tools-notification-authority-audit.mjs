import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_INPUT_BYTES = 50 * 1024 * 1024;
const MAX_ROWS_PER_COLLECTION = 500_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_MESSAGE_LENGTH = 5_000;
const MAX_ACTION_URL_LENGTH = 1_000;
const MAX_ACTION_LABEL_LENGTH = 200;
const SNAPSHOT_VERSION = 2;
const ACTIVE_AGENCY_STATUSES = new Set(['active', 'trial']);
const ACTIVE_MEMBERSHIP_STATUS = 'active';
const AUTHORITY_STATES = new Set(['active', 'invalidated']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const NOTIFICATION_TYPES = new Set([
  'report_ready', 'compliance_alert', 'critical_alert', 'patient_alert',
  'task_assigned', 'task_due_soon', 'new_referral', 'referral_urgent',
  'training_due', 'system_update', 'message_received', 'sms_failed',
  'sms_urgent', 'sms_received', 'fax_delivered', 'fax_failed', 'voicemail',
  'info', 'expiration_warning', 'credential_expiration',
  'admin_expiration_summary', 'care_plan_proposal', 'signature_request',
]);
const PRIORITIES = new Set(['low', 'medium', 'high', 'critical']);
const AUTHORITY_FIELDS = Object.freeze([
  'agency_id',
  'recipient_user_id',
  'recipient_membership_id',
  'recipient_membership_version',
  'authority_version',
  'authority_state',
  'version',
  'user_email',
]);

export const NOTIFICATION_AUDIT_CATEGORIES = Object.freeze([
  'authority_v1_current_active',
  'authority_v1_invalidated_retained',
  'authority_v1_stale_or_unverifiable',
  'legacy_unmigrated',
  'malformed_authority_v1',
  'unsupported_authority_version',
]);

export const NOTIFICATION_AUDIT_REASON_CODES = Object.freeze([
  'agency_ambiguous_or_missing',
  'agency_inactive',
  'authority_state_invalid',
  'authority_version_missing',
  'authority_version_unsupported',
  'membership_ambiguous_or_missing',
  'membership_binding_mismatch',
  'membership_inactive',
  'membership_revision_mismatch',
  'membership_tenant_role_invalid',
  'notification_authority_fields_invalid',
  'notification_dedupe_collision',
  'notification_email_noncanonical',
  'notification_identity_duplicate',
  'notification_not_object',
  'notification_revision_invalid',
  'notification_row_integrity_invalid',
  'user_ambiguous_or_missing',
  'user_binding_mismatch',
  'user_unavailable',
]);

function plainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function canonicalEmail(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length >= 3
    && normalized.length <= 320
    && normalized.includes('@')
    && !/\s/.test(normalized)
    ? normalized
    : null;
}

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value >= 1;
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedText(value, maximum) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= maximum
    && !/[\u0000\u007f]/.test(value);
}

function safeActionUrl(value) {
  if (value == null) return true;
  return typeof value === 'string'
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && value.length <= MAX_ACTION_URL_LENGTH
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function exactTopLevelSnapshot(value) {
  if (!plainObject(value)) return false;
  const expected = ['agencies', 'memberships', 'notifications', 'snapshot_version', 'users'];
  const actual = Object.keys(value).sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

export class NotificationAuditInputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NotificationAuditInputError';
  }
}

export function validateNotificationAuditSnapshot(snapshot) {
  if (!exactTopLevelSnapshot(snapshot) || snapshot.snapshot_version !== SNAPSHOT_VERSION) {
    throw new NotificationAuditInputError('Input must be an exact notification authority snapshot v2.');
  }
  for (const key of ['agencies', 'memberships', 'notifications', 'users']) {
    if (!Array.isArray(snapshot[key]) || snapshot[key].length > MAX_ROWS_PER_COLLECTION) {
      throw new NotificationAuditInputError('Input collections must be bounded arrays.');
    }
  }
  return snapshot;
}

function createIndex(rows, keyOf) {
  const index = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    if (key == null) continue;
    const existing = index.get(key);
    if (existing) existing.push(row);
    else index.set(key, [row]);
  }
  return index;
}

function identifierIndex(rows) {
  return createIndex(rows, (row) => (
    plainObject(row) && exactIdentifier(row.id) ? row.id : null
  ));
}

function membershipBindingKey(row) {
  return plainObject(row)
    && exactIdentifier(row.agency_id)
    && exactIdentifier(row.user_id)
    ? JSON.stringify([row.agency_id, row.user_id])
    : null;
}

function validAuthorityShape(row, reasons) {
  let valid = true;
  if (!exactIdentifier(row.agency_id)
    || !exactIdentifier(row.recipient_user_id)
    || !exactIdentifier(row.recipient_membership_id)
    || !positiveInteger(row.recipient_membership_version)) {
    reasons.add('notification_authority_fields_invalid');
    valid = false;
  }
  if (!positiveInteger(row.version)) {
    reasons.add('notification_revision_invalid');
    valid = false;
  }
  const email = canonicalEmail(row.user_email);
  if (!email || row.user_email !== email) {
    reasons.add('notification_email_noncanonical');
    valid = false;
  }
  if (!AUTHORITY_STATES.has(row.authority_state)) {
    reasons.add('authority_state_invalid');
    valid = false;
  }
  return valid;
}

function validNotificationRow(row, reasons) {
  const valid = exactIdentifier(row.id)
    && boundedText(row.title, MAX_TITLE_LENGTH)
    && boundedText(row.message, MAX_MESSAGE_LENGTH)
    && NOTIFICATION_TYPES.has(String(row.type || ''))
    && PRIORITIES.has(String(row.priority || ''))
    && validInstant(row.created_date)
    && typeof row.is_read === 'boolean'
    && (row.is_read ? validInstant(row.read_at) : row.read_at == null)
    && typeof row.dismissed === 'boolean'
    && (row.dismissed ? validInstant(row.dismissed_at) : row.dismissed_at == null)
    && safeActionUrl(row.action_url)
    && (row.action_label == null || boundedText(row.action_label, MAX_ACTION_LABEL_LENGTH));
  if (!valid) reasons.add('notification_row_integrity_invalid');
  return valid;
}

function userSnapshotMatches(row, user) {
  const email = canonicalEmail(user.email);
  return exactIdentifier(user.id)
    && user.id === row.recipient_user_id
    && email === row.user_email
    && user.email === email;
}

function userIsAvailable(user) {
  return user.is_active !== false
    && user.disabled !== true
    && user.is_service !== true
    && user.is_verified !== false;
}

function membershipSnapshotMatches(row, membership) {
  const email = canonicalEmail(membership.user_email_normalized);
  return exactIdentifier(membership.id)
    && membership.id === row.recipient_membership_id
    && membership.agency_id === row.agency_id
    && membership.user_id === row.recipient_user_id
    && membership.membership_key === `${row.agency_id}:${row.recipient_user_id}`
    && email === row.user_email
    && membership.user_email_normalized === email;
}

function validateRelations(row, indexes, reasons) {
  const agencies = indexes.agencies.get(row.agency_id) || [];
  if (agencies.length !== 1 || !plainObject(agencies[0]) || agencies[0].id !== row.agency_id) {
    reasons.add('agency_ambiguous_or_missing');
  } else if (!ACTIVE_AGENCY_STATUSES.has(agencies[0].status)) {
    reasons.add('agency_inactive');
  }

  const users = indexes.users.get(row.recipient_user_id) || [];
  if (users.length !== 1 || !plainObject(users[0])) {
    reasons.add('user_ambiguous_or_missing');
  } else {
    if (!userSnapshotMatches(row, users[0])) reasons.add('user_binding_mismatch');
    if (!userIsAvailable(users[0])) reasons.add('user_unavailable');
  }

  const membershipsById = indexes.membershipsById.get(row.recipient_membership_id) || [];
  const bindingKey = exactIdentifier(row.agency_id) && exactIdentifier(row.recipient_user_id)
    ? JSON.stringify([row.agency_id, row.recipient_user_id])
    : null;
  const membershipsByBinding = bindingKey
    ? indexes.membershipsByBinding.get(bindingKey) || []
    : [];
  if (membershipsById.length !== 1
    || membershipsByBinding.length !== 1
    || membershipsById[0] !== membershipsByBinding[0]
    || !plainObject(membershipsById[0])) {
    reasons.add('membership_ambiguous_or_missing');
    return;
  }
  const membership = membershipsById[0];
  if (!membershipSnapshotMatches(row, membership)) reasons.add('membership_binding_mismatch');
  if (membership.status !== ACTIVE_MEMBERSHIP_STATUS) reasons.add('membership_inactive');
  if (!TENANT_ROLES.has(String(membership.tenant_role || ''))) {
    reasons.add('membership_tenant_role_invalid');
  }
  if (membership.version !== row.recipient_membership_version) {
    reasons.add('membership_revision_mismatch');
  }
}

function classifyNotification(row, indexes) {
  const reasons = new Set();
  if (!plainObject(row)) {
    reasons.add('notification_not_object');
    return { category: 'malformed_authority_v1', reasons };
  }
  if (exactIdentifier(row.id) && (indexes.notificationsById.get(row.id) || []).length !== 1) {
    reasons.add('notification_identity_duplicate');
  }
  if (typeof row.dedupe_key === 'string'
    && row.dedupe_key.length > 0
    && (indexes.notificationsByDedupe.get(row.dedupe_key) || []).length !== 1) {
    reasons.add('notification_dedupe_collision');
  }
  if (!Object.hasOwn(row, 'authority_version') || row.authority_version == null) {
    reasons.add('authority_version_missing');
    return { category: 'legacy_unmigrated', reasons };
  }
  if (row.authority_version !== 1) {
    reasons.add('authority_version_unsupported');
    return { category: 'unsupported_authority_version', reasons };
  }

  const authorityShapeValid = validAuthorityShape(row, reasons);
  const rowIntegrityValid = validNotificationRow(row, reasons);
  validateRelations(row, indexes, reasons);

  if (!authorityShapeValid || !rowIntegrityValid) {
    return { category: 'malformed_authority_v1', reasons };
  }
  if (reasons.size > 0) {
    return { category: 'authority_v1_stale_or_unverifiable', reasons };
  }
  return {
    category: row.authority_state === 'invalidated'
      ? 'authority_v1_invalidated_retained'
      : 'authority_v1_current_active',
    reasons,
  };
}

function zeroCounts(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

/**
 * Pure, aggregate-only audit. It never changes the snapshot and never returns
 * identifiers, emails, notification text, metadata, or per-row findings.
 */
export function auditNotificationAuthority(snapshot) {
  validateNotificationAuditSnapshot(snapshot);
  const indexes = {
    agencies: identifierIndex(snapshot.agencies),
    users: identifierIndex(snapshot.users),
    membershipsById: identifierIndex(snapshot.memberships),
    membershipsByBinding: createIndex(snapshot.memberships, membershipBindingKey),
    notificationsById: identifierIndex(snapshot.notifications),
    notificationsByDedupe: createIndex(snapshot.notifications, (row) => (
      plainObject(row) && typeof row.dedupe_key === 'string' && row.dedupe_key.length > 0
        ? row.dedupe_key
        : null
    )),
  };
  const categories = zeroCounts(NOTIFICATION_AUDIT_CATEGORIES);
  const reasonCounts = zeroCounts(NOTIFICATION_AUDIT_REASON_CODES);

  for (const row of snapshot.notifications) {
    const finding = classifyNotification(row, indexes);
    categories[finding.category] += 1;
    for (const reason of finding.reasons) reasonCounts[reason] += 1;
  }

  const findings = Object.fromEntries(
    Object.entries(reasonCounts).filter(([, count]) => count > 0),
  );
  const rowReviewRequired = categories.legacy_unmigrated > 0
    || categories.malformed_authority_v1 > 0
    || categories.unsupported_authority_version > 0
    || categories.authority_v1_stale_or_unverifiable > 0;

  return {
    mode: 'dry-run-only',
    report_schema_version: 2,
    mutations_performed: 0,
    contains_row_values: false,
    input_counts: {
      agencies: snapshot.agencies.length,
      users: snapshot.users.length,
      memberships: snapshot.memberships.length,
      notifications: snapshot.notifications.length,
    },
    categories,
    findings,
    producer_cutover_verified_by_this_tool: false,
    producer_cutover_required_before_backfill: true,
    row_review_required: rowReviewRequired,
    backfill_authorized: false,
  };
}

export async function readNotificationAuditSnapshot(path) {
  let info;
  try {
    info = await stat(path);
  } catch {
    throw new NotificationAuditInputError('Input could not be read.');
  }
  if (!info.isFile() || info.size > MAX_INPUT_BYTES) {
    throw new NotificationAuditInputError('Input must be a bounded regular file.');
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'));
  } catch {
    throw new NotificationAuditInputError('Input must contain valid JSON.');
  }
  return validateNotificationAuditSnapshot(parsed);
}

function usage() {
  return 'Usage: set NOTIFICATION_AUTHORITY_SNAPSHOT_PATH or pass --input <snapshot.json> to node directly.\n';
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
  const forbidden = args.some((arg) => /^(?:--)?(?:apply|backfill|delete|fix|mutate|update|write)(?:=|$)/i.test(arg));
  const environmentMode = args.length === 0
    && typeof process.env.NOTIFICATION_AUTHORITY_SNAPSHOT_PATH === 'string'
    && process.env.NOTIFICATION_AUTHORITY_SNAPSHOT_PATH.length > 0;
  const directMode = args.length === 2 && args[0] === '--input' && !!args[1];
  if (forbidden || (!environmentMode && !directMode)) {
    process.stderr.write(usage());
    process.exitCode = 64;
    return;
  }
  try {
    const path = environmentMode ? process.env.NOTIFICATION_AUTHORITY_SNAPSHOT_PATH : args[1];
    const snapshot = await readNotificationAuditSnapshot(path);
    const report = auditNotificationAuthority(snapshot);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch {
    // Never echo a path, row, parsed value, or exception: any of them could
    // contain patient/user identifiers or notification text.
    process.stderr.write('Notification authority audit failed: input could not be read or validated.\n');
    process.exitCode = 1;
  }
}

if (resolve(process.argv[1] || '') === fileURLToPath(import.meta.url)) {
  await main();
}

// Keep the complete authority field list exported for source-contract tests;
// it is schema metadata only and never includes row values.
export { AUTHORITY_FIELDS };
