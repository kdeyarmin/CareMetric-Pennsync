import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Tenant-authorized Referral read/write broker.
 *
 * Referral carries intake PHI, so direct entity CRUD is denied. Every action
 * derives immutable tenant authority from the authenticated built-in User and
 * one exact active AgencyMembership. Patient links are accepted only after an
 * exact same-agency Patient check. Updates use a conditional versioned write;
 * no caller may set tenant, identity, audit-actor, or revision fields.
 */

const ACTIONS = new Set(['list', 'get', 'list_assignees', 'create', 'update', 'delete']);
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const REFERRAL_ASSIGNEE_ROLES = new Set(['agency_admin', 'manager', 'clinician']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const REFERRAL_STATUSES = new Set([
  'new',
  'pending',
  'processing',
  'awaiting_info',
  'active',
  'declined',
  'ready_for_admission',
  'soc_completed',
]);
const REFERRAL_PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const DOCUMENT_TYPES = new Set(['pdf', 'fax', 'image', 'manual', 'electronic']);
const FOLLOW_UP_CAPABILITY_FIELDS = [
  'portal_link_active',
  'portal_token_id',
  'portal_token_snapshot_hash',
  'portal_token_issued_at',
  'portal_token_expires_at',
  'portal_submission_id',
  'portal_submission_hash',
  'portal_submitted_at',
  // Only processInboundFaxes may bind an IncomingFax to a Referral. Treat this
  // exactly like the provider-token provenance above: browser callers may
  // preserve the current server-issued value while resolving an item, but may
  // never forge or replace it through the general Referral update action.
  'fax_back',
  // The stale worker owns these markers. Client edits must not reset a claim,
  // manufacture a completed alert, or retry an uncertain publication.
  'stale_notified_at',
  'stale_notification_key',
  'stale_notification_claimed_by',
  'stale_notification_claimed_at',
  'stale_notification_publish_started_at',
];

const MAX_BODY_BYTES = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LIST_LIMIT = 5000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const USER_SCAN_LIMIT = 10;

const CLIENT_REFERRAL_FIELDS = new Set([
  'patient_name',
  'patient_id',
  'patient_dob',
  'diagnosis',
  'referral_source',
  'referral_date',
  'estimated_start_date',
  'document_type',
  'priority',
  'status',
  'soc_date',
  'first_visit_date',
  'document_url',
  'processed_document_url',
  'page_range',
  'detection_confidence',
  'manually_confirmed',
  'requires_manual_review',
  'assigned_to',
  'match_confidence',
  'match_factors',
  'match_suggestions',
  'match_analysis',
  'analysis_results',
  'missing_information',
  'discrepancies',
  'ai_generated_tasks',
  'extracted_data',
  'diagnosis_coding',
  'follow_up_requests',
  'follow_up_notes',
]);

const RESPONSE_FIELDS = [
  'id',
  'agency_id',
  'version',
  'created_date',
  'updated_date',
  ...CLIENT_REFERRAL_FIELDS,
  'rejection_date',
  'rejected_by',
  'soc_completed_by',
  'assigned_to_user_id',
  'assigned_to_membership_id',
  'assigned_to_membership_version',
  'assigned_at',
  'assigned_by_user_id',
  'assigned_by_user_email_normalized',
];

const ASSIGNMENT_PROVENANCE_FIELDS = [
  'assigned_to',
  'assigned_to_user_id',
  'assigned_to_membership_id',
  'assigned_to_membership_version',
  'assigned_at',
  'assigned_by_user_id',
  'assigned_by_user_email_normalized',
];

class PublicError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (
    !normalized
    || normalized.length > 320
    || !normalized.includes('@')
    || /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (
    !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PublicError(400, `${label} contains unsupported fields`);
  }
}

async function parseRequest(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  const action = typeof body.action === 'string' ? body.action : '';
  if (!ACTIONS.has(action)) throw new PublicError(400, 'action is invalid');
  const agencyId = exactIdentifier(body.agency_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  return { body, action, agencyId };
}

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rawRows.some((row) => row?.user_id !== userId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  if (rawRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (rawRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');
  const row = rawRows[0];
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !exactIdentifier(row.id)
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  if (!INTAKE_ROLES.has(String(row.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot use Referral intake');
  }
  return row;
}

function validateActiveAssigneeMembership(
  rawRows: Array<Record<string, any>>,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Referral assignee membership is ambiguous');
  }
  if (rawRows.some((row) => (
    row?.agency_id !== agencyId
    || canonicalEmail(row?.user_email_normalized) !== normalizedEmail
  ))) {
    throw new PublicError(409, 'Referral assignee query scope could not be verified');
  }
  if (rawRows.length !== 1) {
    throw new PublicError(403, 'Referral assignee is unavailable');
  }
  const row = rawRows[0];
  const userId = exactIdentifier(row.user_id);
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const transitionReason = boundedReason(row.last_transition_reason);
  if (
    !exactIdentifier(row.id)
    || !userId
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || !REFERRAL_ASSIGNEE_ROLES.has(String(row.tenant_role || ''))
    || row.status !== 'active'
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.activated_at)
    || !validInstant(row.last_transition_at)
    || !transitionReason
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || row.revoked_at != null
    || row.revocation_reason != null
  ) {
    throw new PublicError(409, 'Referral assignee membership integrity check failed');
  }
  return row;
}

async function loadExactAssignee(
  entities: Record<string, any>,
  agencyId: string,
  normalizedEmail: string,
) {
  const memberships = requireRows(
    await entities.AgencyMembership.filter(
      {
        agency_id: agencyId,
        user_email_normalized: normalizedEmail,
        status: 'active',
      },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateActiveAssigneeMembership(
    memberships,
    normalizedEmail,
    agencyId,
  );
  const userRows = requireRows(
    await entities.User.filter({ id: membership.user_id }, undefined, USER_SCAN_LIMIT),
    'User.filter',
  );
  if (userRows.length >= USER_SCAN_LIMIT) {
    throw new PublicError(409, 'Referral assignee identity is ambiguous');
  }
  if (userRows.some((row) => row?.id !== membership.user_id)) {
    throw new PublicError(409, 'Referral assignee identity scope could not be verified');
  }
  if (userRows.length !== 1) {
    throw new PublicError(403, 'Referral assignee is unavailable');
  }
  const user = userRows[0];
  if (
    canonicalEmail(user.email) !== normalizedEmail
    || user.role !== 'user'
    || user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(409, 'Referral assignee identity integrity check failed');
  }
  return { membership, user };
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  agencyId: string,
  expectedSnapshot: Record<string, unknown> | null = null,
) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (
    user.role !== 'user'
    || user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(403, 'Forbidden');
  }
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden');
  const entities = base44.asServiceRole.entities;
  const memberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateMembershipRows(
    memberships,
    userId,
    normalizedEmail,
    agencyId,
  );
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    user_id: userId,
    user_email: normalizedEmail,
    agency_id: agencyId,
    agency_status: agency.status,
    membership_id: membership.id,
    membership_key: membership.membership_key,
    membership_version: membership.version,
    membership_status: membership.status,
    membership_transition_at: membership.last_transition_at,
    tenant_role: membership.tenant_role,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Referral authority changed during request');
  }
  return {
    userId,
    normalizedEmail,
    agencyId,
    tenantRole: String(membership.tenant_role),
    snapshot,
  };
}

function referralCreationKey(agencyId: string, userId: string, requestId: string) {
  return `${agencyId}:${userId}:${requestId}`;
}

function validateReferralIntegrity(
  row: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const creatorId = exactIdentifier(row.created_by_user_id);
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const requestId = exactIdentifier(row.client_request_id);
  const assignedEmail = row.assigned_to == null ? null : canonicalEmail(row.assigned_to);
  const hasAssignmentProvenance = ASSIGNMENT_PROVENANCE_FIELDS
    .slice(1)
    .some((field) => row[field] != null);
  const assignmentProvenanceIsValid = !hasAssignmentProvenance || (
    !!assignedEmail
    && row.assigned_to === assignedEmail
    && !!exactIdentifier(row.assigned_to_user_id)
    && !!exactIdentifier(row.assigned_to_membership_id)
    && Number.isSafeInteger(row.assigned_to_membership_version)
    && row.assigned_to_membership_version >= 1
    && validInstant(row.assigned_at)
    && !!exactIdentifier(row.assigned_by_user_id)
    && canonicalEmail(row.assigned_by_user_email_normalized) === row.assigned_by_user_email_normalized
  );
  const hasArchiveState = row.archived_at != null
    || row.archived_by_user_id != null
    || row.archived_by_user_email_normalized != null
    || row.archive_reason != null;
  const archiveStateIsValid = !hasArchiveState || (
    validInstant(row.archived_at)
    && !!exactIdentifier(row.archived_by_user_id)
    && canonicalEmail(row.archived_by_user_email_normalized) === row.archived_by_user_email_normalized
    && !!boundedReason(row.archive_reason)
  );
  if (
    row.id !== referralId
    || row.agency_id !== agencyId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    // Base44's current response includes created_by_id without necessarily
    // returning created_by. Reject missing or conflicting platform provenance.
    || (row.created_by_id == null && row.created_by == null)
    || (row.created_by_id != null && row.created_by_id !== creatorId)
    || (row.created_by != null && row.created_by !== creatorEmail)
    || !requestId
    || row.referral_creation_key !== referralCreationKey(agencyId, creatorId, requestId)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || (row.patient_id != null && !exactIdentifier(row.patient_id))
    || (row.status != null && !REFERRAL_STATUSES.has(String(row.status)))
    || (row.priority != null && !REFERRAL_PRIORITIES.has(String(row.priority)))
    || (row.assigned_to != null && !assignedEmail)
    || !assignmentProvenanceIsValid
    || !archiveStateIsValid
  ) {
    throw new PublicError(409, 'Referral authority integrity check failed');
  }
  return row;
}

async function loadExactReferral(
  entities: Record<string, any>,
  referralId: string,
  agencyId: string,
  includeArchived = false,
) {
  const rows = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Referral is ambiguous');
  if (rows.some((row) => row?.id !== referralId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Referral unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Referral is ambiguous');
  const row = validateReferralIntegrity(rows[0], referralId, agencyId);
  if (!includeArchived && row.archived_at != null) {
    throw new PublicError(404, 'Referral unavailable');
  }
  return row;
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => (
    row?.id !== patientId
    || row?.agency_id !== agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
  ))) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length !== 1 || !VISIBLE_PATIENT_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  return rows[0];
}

function validateBusinessFields(
  value: unknown,
  mode: 'create' | 'update',
) {
  if (!plainObject(value)) throw new PublicError(400, `Referral ${mode} fields must be an object`);
  if (Object.keys(value).length === 0) {
    throw new PublicError(400, `Referral ${mode} fields cannot be empty`);
  }
  for (const key of Object.keys(value)) {
    if (!CLIENT_REFERRAL_FIELDS.has(key)) {
      throw new PublicError(400, `Unsupported Referral field: ${key}`);
    }
  }
  const output: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value)) {
    if (nested !== undefined) output[key] = nested;
  }
  if (Object.hasOwn(output, 'follow_up_requests')) {
    if (!plainObject(output.follow_up_requests)) {
      throw new PublicError(400, 'follow_up_requests is invalid');
    }
    const clientFollowUp = { ...output.follow_up_requests };
    for (const field of FOLLOW_UP_CAPABILITY_FIELDS) delete clientFollowUp[field];
    output.follow_up_requests = clientFollowUp;
  }
  if (Object.hasOwn(output, 'patient_id') && output.patient_id !== null) {
    const patientId = exactIdentifier(output.patient_id);
    if (!patientId) throw new PublicError(400, 'patient_id is invalid');
    output.patient_id = patientId;
  }
  if (Object.hasOwn(output, 'status') && !REFERRAL_STATUSES.has(String(output.status))) {
    throw new PublicError(400, 'status is invalid');
  }
  if (Object.hasOwn(output, 'priority') && !REFERRAL_PRIORITIES.has(String(output.priority))) {
    throw new PublicError(400, 'priority is invalid');
  }
  if (
    Object.hasOwn(output, 'document_type')
    && output.document_type !== null
    && !DOCUMENT_TYPES.has(String(output.document_type))
  ) {
    throw new PublicError(400, 'document_type is invalid');
  }
  if (Object.hasOwn(output, 'assigned_to') && output.assigned_to !== null) {
    const assignedTo = canonicalEmail(output.assigned_to);
    if (!assignedTo) throw new PublicError(400, 'assigned_to is invalid');
    output.assigned_to = assignedTo;
  }
  return output;
}

function preserveFollowUpCapabilityState(
  current: unknown,
  requested: unknown,
) {
  if (!plainObject(requested)) return requested;
  const output = { ...requested };
  if (
    plainObject(current)
    && validInstant(current.generated_at)
    && current.generated_at === requested.generated_at
  ) {
    for (const field of FOLLOW_UP_CAPABILITY_FIELDS) {
      if (current[field] !== undefined) output[field] = current[field];
    }
  }
  return output;
}

function serverAuditFields(
  fields: Record<string, unknown>,
  normalizedEmail: string,
) {
  const output = { ...fields };
  const now = new Date().toISOString();
  if (output.status === 'declined') {
    output.rejection_date = now;
    output.rejected_by = normalizedEmail;
  }
  if (output.status === 'soc_completed') {
    output.soc_completed_by = normalizedEmail;
  }
  return output;
}

function stampAssignment(
  fields: Record<string, unknown>,
  authority: Record<string, any>,
  assignee: Record<string, any>,
) {
  return {
    ...fields,
    assigned_to: assignee.membership.user_email_normalized,
    assigned_to_user_id: assignee.membership.user_id,
    assigned_to_membership_id: assignee.membership.id,
    assigned_to_membership_version: assignee.membership.version,
    assigned_at: new Date().toISOString(),
    assigned_by_user_id: authority.userId,
    assigned_by_user_email_normalized: authority.normalizedEmail,
  };
}

function assignmentUnset() {
  return Object.fromEntries(ASSIGNMENT_PROVENANCE_FIELDS.map((field) => [field, '']));
}

function narrowReferral(row: Record<string, any>) {
  return pickFields(row, RESPONSE_FIELDS);
}

function scope(authority: Record<string, any>) {
  return {
    agency_id: authority.agencyId,
    membership_id: authority.snapshot.membership_id,
    membership_version: authority.snapshot.membership_version,
    tenant_role: authority.tenantRole,
  };
}

async function removeCreatedReferral(
  entities: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const result = await entities.Referral.delete(referralId).catch(() => null);
  if (!plainObject(result) || result.success !== true) {
    throw new Error('Referral create compensation failed');
  }
  const remaining = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (remaining.some((row) => row?.id === referralId && row?.agency_id === agencyId)) {
    throw new Error('Referral create compensation failed verification');
  }
}

async function listReferrals(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(
    body,
    ['action', 'agency_id', 'limit', 'patient_id', 'status', 'assigned_to'],
    'Referral list',
  );
  const limit = body.limit === undefined ? 200 : body.limit;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > MAX_LIST_LIMIT) {
    throw new PublicError(400, 'limit is invalid');
  }
  const query: Record<string, unknown> = {
    agency_id: authority.agencyId,
    $or: [{ archived_at: { $exists: false } }, { archived_at: null }],
  };
  if (body.patient_id !== undefined) {
    const patientId = exactIdentifier(body.patient_id);
    if (!patientId) throw new PublicError(400, 'patient_id is invalid');
    query.patient_id = patientId;
  }
  if (body.status !== undefined) {
    if (!REFERRAL_STATUSES.has(String(body.status))) {
      throw new PublicError(400, 'status is invalid');
    }
    query.status = body.status;
  }
  if (body.assigned_to !== undefined) {
    const assignedTo = canonicalEmail(body.assigned_to);
    if (!assignedTo || assignedTo !== authority.normalizedEmail) {
      throw new PublicError(403, 'Referral assignment filter is unavailable');
    }
    query.assigned_to = assignedTo;
  }
  const rows = requireRows(
    await base44.asServiceRole.entities.Referral.filter(
      query,
      '-created_date',
      Number(limit),
    ),
    'Referral.filter',
  );
  if (rows.length > Number(limit)) throw new PublicError(409, 'Referral list is ambiguous');
  if (rows.some((row) => (
    row?.agency_id !== authority.agencyId
    || row?.archived_at != null
    || (query.patient_id !== undefined && row?.patient_id !== query.patient_id)
    || (query.status !== undefined && row?.status !== query.status)
    || (query.assigned_to !== undefined && row?.assigned_to !== query.assigned_to)
  ))) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  const referrals = rows.map((row) => (
    narrowReferral(validateReferralIntegrity(
      row,
      exactIdentifier(row?.id) || '',
      authority.agencyId,
    ))
  ));
  const disclosureAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  return Response.json({
    success: true,
    action: 'list',
    referrals,
    scope: scope(disclosureAuthority),
  });
}

async function getReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id'], 'Referral get');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  const row = await loadExactReferral(
    base44.asServiceRole.entities,
    referralId,
    authority.agencyId,
  );
  const disclosureAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  const finalRow = await loadExactReferral(
    base44.asServiceRole.entities,
    referralId,
    authority.agencyId,
  );
  if (!sameValue(narrowReferral(finalRow), narrowReferral(row))) {
    throw new PublicError(409, 'Referral changed during read');
  }
  return Response.json({
    success: true,
    action: 'get',
    referral: narrowReferral(finalRow),
    scope: scope(disclosureAuthority),
  });
}

async function listReferralAssignees(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id'], 'Referral assignee list');
  const entities = base44.asServiceRole.entities;
  const memberships = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: authority.agencyId, status: 'active' },
      'user_email_normalized',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (memberships.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Referral assignee roster is incomplete');
  }
  if (memberships.some((row) => (
    row?.agency_id !== authority.agencyId || row?.status !== 'active'
  ))) {
    throw new PublicError(409, 'Referral assignee roster scope could not be verified');
  }

  const assignees: Array<Record<string, unknown>> = [];
  const seenMembershipIds = new Set<string>();
  const seenUserIds = new Set<string>();
  const seenEmails = new Set<string>();
  for (const row of memberships) {
    if (!REFERRAL_ASSIGNEE_ROLES.has(String(row?.tenant_role || ''))) continue;
    const email = canonicalEmail(row?.user_email_normalized);
    if (!email) throw new PublicError(409, 'Referral assignee roster integrity check failed');
    const exact = await loadExactAssignee(entities, authority.agencyId, email);
    if (exact.membership.id !== row.id || exact.membership.version !== row.version) {
      throw new PublicError(409, 'Referral assignee roster changed during request');
    }
    if (
      seenMembershipIds.has(exact.membership.id)
      || seenUserIds.has(exact.membership.user_id)
      || seenEmails.has(email)
    ) {
      throw new PublicError(409, 'Referral assignee roster is ambiguous');
    }
    seenMembershipIds.add(exact.membership.id);
    seenUserIds.add(exact.membership.user_id);
    seenEmails.add(email);
    const fullName = typeof exact.user.full_name === 'string'
      && exact.user.full_name.trim()
      && exact.user.full_name.length <= 200
      ? exact.user.full_name.trim()
      : null;
    assignees.push({
      user_id: exact.membership.user_id,
      email,
      full_name: fullName,
      tenant_role: exact.membership.tenant_role,
      membership_id: exact.membership.id,
      membership_version: exact.membership.version,
    });
  }
  const disclosureAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  return Response.json({
    success: true,
    action: 'list_assignees',
    assignees,
    scope: scope(disclosureAuthority),
  });
}

async function createReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(
    body,
    ['action', 'agency_id', 'client_request_id', 'referral'],
    'Referral create',
  );
  const requestId = exactIdentifier(body.client_request_id);
  if (!requestId) throw new PublicError(400, 'client_request_id is invalid');
  const clientFields = validateBusinessFields(
    body.referral,
    'create',
  );
  let fields = serverAuditFields(clientFields, authority.normalizedEmail);
  if (Object.hasOwn(clientFields, 'assigned_to')) {
    if (clientFields.assigned_to === null) {
      delete fields.assigned_to;
    } else {
      const assignee = await loadExactAssignee(
        base44.asServiceRole.entities,
        authority.agencyId,
        String(clientFields.assigned_to),
      );
      fields = stampAssignment(fields, authority, assignee);
    }
  }
  if (fields.patient_id) {
    await loadExactPatient(
      base44.asServiceRole.entities,
      String(fields.patient_id),
      authority.agencyId,
    );
  }
  const key = referralCreationKey(authority.agencyId, authority.userId, requestId);
  const existingRows = requireRows(
    await base44.asServiceRole.entities.Referral.filter(
      { referral_creation_key: key, agency_id: authority.agencyId },
      '-created_date',
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (existingRows.some((row) => (
    row?.referral_creation_key !== key || row?.agency_id !== authority.agencyId
  ))) {
    throw new PublicError(409, 'client_request_id query scope could not be verified');
  }
  if (existingRows.length >= EXACT_ROW_LIMIT || existingRows.length > 1) {
    throw new PublicError(409, 'client_request_id is ambiguous');
  }
  if (existingRows.length === 1) {
    const existing = validateReferralIntegrity(
      existingRows[0],
      String(existingRows[0].id),
      authority.agencyId,
    );
    const expectedClientFields = Object.fromEntries(
      Object.keys(clientFields).map((field) => [field, existing[field]]),
    );
    if (existing.version !== 1 || !sameValue(expectedClientFields, clientFields)) {
      throw new PublicError(409, 'client_request_id conflicts with another referral');
    }
    const replayAuthority = await loadAuthority(
      base44,
      authority.agencyId,
      authority.snapshot,
    );
    const replay = await loadExactReferral(
      base44.asServiceRole.entities,
      String(existing.id),
      authority.agencyId,
    );
    if (!sameValue(narrowReferral(replay), narrowReferral(existing))) {
      throw new PublicError(409, 'Referral changed during replay');
    }
    return Response.json({
      success: true,
      action: 'create',
      created: false,
      referral: narrowReferral(replay),
      scope: scope(replayAuthority),
    });
  }

  await loadAuthority(base44, authority.agencyId, authority.snapshot);
  if (fields.assigned_to) {
    await loadExactAssignee(
      base44.asServiceRole.entities,
      authority.agencyId,
      String(fields.assigned_to),
    );
  }
  if (fields.patient_id) {
    await loadExactPatient(
      base44.asServiceRole.entities,
      String(fields.patient_id),
      authority.agencyId,
    );
  }
  const created = await base44.asServiceRole.entities.Referral.create({
    ...fields,
    agency_id: authority.agencyId,
    created_by_user_id: authority.userId,
    created_by_user_email_normalized: authority.normalizedEmail,
    created_by: authority.normalizedEmail,
    client_request_id: requestId,
    referral_creation_key: key,
    version: 1,
  });
  const createdId = exactIdentifier(created?.id);
  if (!createdId) throw new Error('Referral.create returned no exact id');
  let exact: Record<string, any>;
  let finalAuthority: Record<string, any>;
  try {
    exact = await loadExactReferral(
      base44.asServiceRole.entities,
      createdId,
      authority.agencyId,
    );
    for (const [field, value] of Object.entries(fields)) {
      if (!sameValue(exact[field], value)) {
        throw new Error('Referral fields failed post-create verification');
      }
    }
    const keyedRows = requireRows(
      await base44.asServiceRole.entities.Referral.filter(
        { referral_creation_key: key, agency_id: authority.agencyId },
        '-created_date',
        EXACT_ROW_LIMIT,
      ),
      'Referral.filter',
    );
    if (
      keyedRows.some((row) => (
        row?.referral_creation_key !== key || row?.agency_id !== authority.agencyId
      ))
      || keyedRows.length !== 1
      || keyedRows[0]?.id !== createdId
    ) {
      throw new PublicError(409, 'client_request_id is ambiguous');
    }
    finalAuthority = await loadAuthority(base44, authority.agencyId, authority.snapshot);
  } catch (error) {
    await removeCreatedReferral(
      base44.asServiceRole.entities,
      createdId,
      authority.agencyId,
    );
    throw error;
  }
  return Response.json({
    success: true,
    action: 'create',
    created: true,
    referral: narrowReferral(exact),
    scope: scope(finalAuthority),
  }, { status: 201 });
}

async function updateReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id', 'changes'], 'Referral update');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  const clientChanges = validateBusinessFields(body.changes, 'update');
  let changes = serverAuditFields(
    clientChanges,
    authority.normalizedEmail,
  );
  let unsetFields: Record<string, string> | null = null;
  let assignmentEmail: string | null = null;
  if (Object.hasOwn(clientChanges, 'assigned_to')) {
    if (clientChanges.assigned_to === null) {
      delete changes.assigned_to;
      unsetFields = assignmentUnset();
    } else {
      assignmentEmail = String(clientChanges.assigned_to);
      const assignee = await loadExactAssignee(
        base44.asServiceRole.entities,
        authority.agencyId,
        assignmentEmail,
      );
      changes = stampAssignment(changes, authority, assignee);
    }
  }
  const entities = base44.asServiceRole.entities;
  const initial = await loadExactReferral(entities, referralId, authority.agencyId);
  if (Object.hasOwn(changes, 'follow_up_requests')) {
    changes.follow_up_requests = preserveFollowUpCapabilityState(
      initial.follow_up_requests,
      changes.follow_up_requests,
    );
  }
  if (changes.patient_id) {
    await loadExactPatient(entities, String(changes.patient_id), authority.agencyId);
  }
  await loadAuthority(base44, authority.agencyId, authority.snapshot);
  if (assignmentEmail) {
    await loadExactAssignee(entities, authority.agencyId, assignmentEmail);
  }
  const current = await loadExactReferral(entities, referralId, authority.agencyId);
  if (!sameValue(narrowReferral(current), narrowReferral(initial))) {
    throw new PublicError(409, 'Referral changed during update');
  }
  if (changes.patient_id) {
    await loadExactPatient(entities, String(changes.patient_id), authority.agencyId);
  }
  const result = await entities.Referral.updateMany(
    {
      id: referralId,
      agency_id: authority.agencyId,
      version: current.version,
      updated_date: current.updated_date,
    },
    {
      $set: changes,
      ...(unsetFields ? { $unset: unsetFields } : {}),
      $inc: { version: 1 },
    },
  );
  if (
    !plainObject(result)
    || result.success !== true
    || result.updated !== 1
    || result.has_more !== false
  ) {
    throw new PublicError(409, 'Referral changed during update');
  }
  const updated = await loadExactReferral(entities, referralId, authority.agencyId);
  if (updated.version !== current.version + 1) {
    throw new Error('Referral version failed post-update verification');
  }
  for (const [field, value] of Object.entries(changes)) {
    if (!sameValue(updated[field], value)) {
      throw new Error('Referral fields failed post-update verification');
    }
  }
  if (unsetFields && Object.keys(unsetFields).some((field) => updated[field] != null)) {
    throw new Error('Referral assignment removal failed post-update verification');
  }
  const finalAuthority = await loadAuthority(base44, authority.agencyId, authority.snapshot);
  return Response.json({
    success: true,
    action: 'update',
    referral: narrowReferral(updated),
    scope: scope(finalAuthority),
  });
}

async function deleteReferral(
  base44: Record<string, any>,
  authority: Record<string, any>,
  body: Record<string, unknown>,
) {
  assertOnlyKeys(body, ['action', 'agency_id', 'referral_id'], 'Referral delete');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  const entities = base44.asServiceRole.entities;
  const initial = await loadExactReferral(entities, referralId, authority.agencyId);
  await loadAuthority(base44, authority.agencyId, authority.snapshot);
  const current = await loadExactReferral(entities, referralId, authority.agencyId);
  if (!sameValue(narrowReferral(current), narrowReferral(initial))) {
    throw new PublicError(409, 'Referral changed during removal');
  }
  const archivedAt = new Date().toISOString();
  const archiveFields = {
    archived_at: archivedAt,
    archived_by_user_id: authority.userId,
    archived_by_user_email_normalized: authority.normalizedEmail,
    archive_reason: 'Removed from Referral Intake',
    status: 'declined',
    rejection_date: archivedAt,
    rejected_by: authority.normalizedEmail,
  };
  const result = await entities.Referral.updateMany(
    {
      id: referralId,
      agency_id: authority.agencyId,
      version: current.version,
      updated_date: current.updated_date,
    },
    { $set: archiveFields, $inc: { version: 1 } },
  );
  if (
    !plainObject(result)
    || result.success !== true
    || result.updated !== 1
    || result.has_more !== false
  ) {
    throw new PublicError(409, 'Referral changed during removal');
  }
  const archived = await loadExactReferral(
    entities,
    referralId,
    authority.agencyId,
    true,
  );
  if (
    archived.version !== current.version + 1
    || archived.archived_at !== archivedAt
    || archived.archived_by_user_id !== authority.userId
    || archived.archived_by_user_email_normalized !== authority.normalizedEmail
    || archived.archive_reason !== archiveFields.archive_reason
  ) {
    throw new Error('Referral removal failed post-update verification');
  }
  const finalAuthority = await loadAuthority(
    base44,
    authority.agencyId,
    authority.snapshot,
  );
  return Response.json({
    success: true,
    action: 'delete',
    archived: true,
    referral_id: referralId,
    scope: scope(finalAuthority),
  });
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(req);
    const authority = await loadAuthority(base44, input.agencyId);
    if (input.action === 'list') return await listReferrals(base44, authority, input.body);
    if (input.action === 'get') return await getReferral(base44, authority, input.body);
    if (input.action === 'list_assignees') {
      return await listReferralAssignees(base44, authority, input.body);
    }
    if (input.action === 'create') return await createReferral(base44, authority, input.body);
    if (input.action === 'update') return await updateReferral(base44, authority, input.body);
    return await deleteReferral(base44, authority, input.body);
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status },
      );
    }
    // Provider errors may contain predicates or PHI; never log the object.
    console.error('manageAuthorizedReferral failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
