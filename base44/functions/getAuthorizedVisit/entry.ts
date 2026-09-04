import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Exact, purpose-bound Visit read broker.
 *
 * This function is intentionally not wired into the UI yet. Direct Visit RLS
 * remains unchanged until hosted two-agency proof is complete. A clinician's
 * creator metadata and the legacy Patient.assigned_nurses array are never read
 * as authority: only an exact active PatientCareTeamAssignment bound to the
 * caller's current immutable AgencyMembership version grants chart access.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const VISIT_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'pending_review',
  'cancelled',
]);
const VISIT_TYPES = new Set([
  'skilled_nursing',
  'admission',
  'recertification',
  'discharge',
  'routine_visit',
  'prn',
]);
const DOCUMENTATION_SOURCES = new Set(['smart_note', 'audio', 'manual']);
const HANDOFF_STATUSES = new Set([
  'not_started',
  'copied_to_emr',
  'reviewed_in_emr',
  'signed_in_emr',
]);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager', 'platform_owner']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const VITAL_FIELDS = new Set([
  'temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'heart_rate',
  'respiratory_rate',
  'oxygen_saturation',
  'pain_level',
  'weight',
]);
const REVIEW_FIELDS = new Set([
  'acknowledged',
  'acknowledged_by',
  'acknowledged_at',
  'note_hash',
  'note_length',
  'ai_assisted',
  'nurse_edited',
  'statement',
  'is_clinical_signature',
]);

// <<<BEGIN AUTHORIZED VISIT EXACT PURPOSE POLICY>>>
const PURPOSE_FIELDS: Record<string, readonly string[]> = {
  schedule: [
    'id',
    'patient_id',
    'visit_date',
    'visit_time',
    'visit_type',
    'status',
    'start_time',
    'end_time',
    'updated_date',
  ],
  documentation: [
    'id',
    'patient_id',
    'visit_date',
    'visit_time',
    'visit_type',
    'status',
    'nurse_notes',
    'raw_transcription',
    'vital_signs',
    'documentation_source',
    'grounding_pending',
    'updated_date',
  ],
  compliance_review: [
    'id',
    'patient_id',
    'visit_date',
    'visit_type',
    'status',
    'compliance_score',
    'compliance_issues',
    'homebound_status_verified',
    'skilled_intervention_documented',
    'homebound_justification',
    'ai_tags',
    'emr_handoff_status',
    'documentation_review_ack',
    'updated_date',
  ],
};

const PURPOSE_ROLES: Record<string, ReadonlySet<string>> = {
  schedule: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  documentation: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  compliance_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
};
// <<<END AUTHORIZED VISIT EXACT PURPOSE POLICY>>>

const MEMBERSHIP_AUTHORITY_FIELDS = [
  'id',
  'membership_key',
  'agency_id',
  'user_id',
  'user_email_normalized',
  'tenant_role',
  'status',
  'created_by_user_id',
  'activated_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'version',
];
const PATIENT_AUTHORITY_FIELDS = [
  'id',
  'agency_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'patient_creation_key',
  'is_sample',
  'is_archived',
  'status',
  'updated_date',
];
const VISIT_AUTHORITY_FIELDS = [
  'id',
  'agency_id',
  'patient_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'is_sample',
  'visit_date',
  'visit_type',
  'status',
  'updated_date',
];
const ASSIGNMENT_AUTHORITY_FIELDS = [
  'id',
  'assignment_key',
  'agency_id',
  'patient_id',
  'user_id',
  'user_email_normalized',
  'assignee_membership_id',
  'assignee_membership_version_at_enablement',
  'status',
  'source',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'activated_at',
  'suspended_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'last_transition_action',
  'last_transition_request_id',
  'last_transition_request_key',
  'version',
];

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function visitReadFields(purpose: string) {
  return [...new Set([...VISIT_AUTHORITY_FIELDS, ...PURPOSE_FIELDS[purpose]])];
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

function plainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function validStringList(value: unknown, maximumItems: number, maximumLength: number) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((item) => typeof item === 'string' && item.length <= maximumLength);
}

function validVitals(value: unknown) {
  return plainObject(value)
    && Object.keys(value).every((key) => VITAL_FIELDS.has(key))
    && Object.values(value).every((item) => (
      typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000
    ));
}

function validReviewAcknowledgement(value: unknown) {
  if (!plainObject(value) || Object.keys(value).some((key) => !REVIEW_FIELDS.has(key))) {
    return false;
  }
  return (value.acknowledged === undefined || typeof value.acknowledged === 'boolean')
    && (value.acknowledged_by === undefined
      || (typeof value.acknowledged_by === 'string' && value.acknowledged_by.length <= 320))
    && (value.acknowledged_at === undefined || validInstant(value.acknowledged_at))
    && (value.note_hash === undefined
      || (typeof value.note_hash === 'string' && /^[a-f0-9]{64}$/.test(value.note_hash)))
    && (value.note_length === undefined
      || (Number.isSafeInteger(value.note_length) && Number(value.note_length) >= 0))
    && (value.ai_assisted === undefined || typeof value.ai_assisted === 'boolean')
    && (value.nurse_edited === undefined || typeof value.nurse_edited === 'boolean')
    && (value.statement === undefined
      || (typeof value.statement === 'string' && value.statement.length <= 2_000))
    && (value.is_clinical_signature === undefined || value.is_clinical_signature === false);
}

function validVisitPurposeField(field: string, value: unknown) {
  if (field === 'id' || field === 'patient_id') return !!exactIdentifier(value);
  if (field === 'visit_date') return validCalendarDate(value);
  if (field === 'visit_type') return typeof value === 'string' && VISIT_TYPES.has(value);
  if (field === 'status') return typeof value === 'string' && VISIT_STATUSES.has(value);
  if (field === 'updated_date') return validInstant(value);
  if (field === 'visit_time' || field === 'start_time' || field === 'end_time') {
    return typeof value === 'string' && value.length <= 100;
  }
  if (field === 'nurse_notes' || field === 'raw_transcription') {
    return typeof value === 'string' && value.length <= 250_000;
  }
  if (field === 'homebound_justification') {
    return typeof value === 'string' && value.length <= 20_000;
  }
  if (field === 'vital_signs') return validVitals(value);
  if (field === 'documentation_source') {
    return typeof value === 'string' && DOCUMENTATION_SOURCES.has(value);
  }
  if (
    field === 'grounding_pending'
    || field === 'homebound_status_verified'
    || field === 'skilled_intervention_documented'
  ) {
    return typeof value === 'boolean';
  }
  if (field === 'compliance_score') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  if (field === 'compliance_issues') return validStringList(value, 100, 2_000);
  if (field === 'ai_tags') return validStringList(value, 64, 128);
  if (field === 'emr_handoff_status') {
    return typeof value === 'string' && HANDOFF_STATUSES.has(value);
  }
  if (field === 'documentation_review_ack') return validReviewAcknowledgement(value);
  return false;
}

function validateVisitPurposeData(row: Record<string, any>, purpose: string) {
  for (const field of PURPOSE_FIELDS[purpose]) {
    const value = row[field];
    if (value === undefined) continue;
    if (!validVisitPurposeField(field, value)) {
      throw new PublicError(409, 'Visit purpose projection integrity check failed');
    }
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['agency_id', 'visit_id', 'purpose'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const visitId = exactIdentifier(record.visit_id);
  const purpose = typeof record.purpose === 'string' ? record.purpose : '';
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!visitId) throw new PublicError(400, 'visit_id is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new PublicError(400, 'purpose is invalid');
  return { agencyId, visitId, purpose };
}

// <<<BEGIN SHARED VISIT READ TENANT AUTHORITY>>>
function isProtectedPlatformOwner(user: Record<string, any>) {
  if (user.role !== 'admin') return false;
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail && canonicalEmail(user.email) === configuredEmail;
}

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const candidates = rawRows.filter((row) => row?.user_id === userId);
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();
  const validated: Array<Record<string, any>> = [];

  for (const row of candidates) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
    const status = typeof row.status === 'string' ? row.status : '';
    if (
      !id
      || !agencyId
      || !membershipKey
      || !storedEmail
      || row.user_email_normalized !== storedEmail
      || storedEmail !== normalizedEmail
      || membershipKey !== `${agencyId}:${userId}`
      || !TENANT_ROLES.has(String(row.tenant_role || ''))
      || !MEMBERSHIP_STATUSES.has(status)
      || !Number.isSafeInteger(row.version)
      || Number(row.version) < 1
      || !exactIdentifier(row.created_by_user_id)
      || !exactIdentifier(row.last_transition_by_user_id)
      || !transitionEmail
      || row.last_transition_by_email_normalized !== transitionEmail
      || !validInstant(row.last_transition_at)
      || !boundedReason(row.last_transition_reason)
      || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
      || (status === 'revoked' && (
        !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
      ))
      || (status !== 'revoked' && (
        row.revoked_at != null || row.revocation_reason != null
      ))
    ) {
      throw new PublicError(409, 'Tenant membership integrity check failed');
    }
    if (ids.has(id) || keys.has(membershipKey) || agencyIds.has(agencyId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    ids.add(id);
    keys.add(membershipKey);
    agencyIds.add(agencyId);
    validated.push(row);
  }
  return validated;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exact = rows.filter((row) => row?.id === agencyId);
  if (exact.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (exact.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (!ENABLED_AGENCY_STATUSES.has(String(exact[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exact[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  agencyId: string,
  expectedSnapshot: Record<string, any> | null = null,
) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (
    user.is_active === false
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
  const isPlatformOwner = isProtectedPlatformOwner(user);
  if (!isPlatformOwner) {
    if (user.role !== 'user') throw new PublicError(403, 'Forbidden');
  }
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  let selected: Record<string, any> | null = null;
  if (isPlatformOwner) {
    if (rawMemberships.length >= MEMBERSHIP_SCAN_LIMIT) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    if (rawMemberships.some((row) => row?.user_id !== userId)) {
      throw new PublicError(409, 'Tenant membership query scope could not be verified');
    }
    if (rawMemberships.length !== 0) {
      throw new PublicError(409, 'Platform owner tenant membership must not exist');
    }
  } else {
    const memberships = validateMembershipRows(rawMemberships, userId, normalizedEmail);
    const active = memberships.filter((row) => row.status === 'active');
    selected = active.find((row) => row.agency_id === agencyId) ?? null;
    if (!selected) throw new PublicError(403, 'No active membership for agency');
  }
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    user: { id: userId, email: normalizedEmail, role: user.role },
    membership: selected ? pickFields(selected, MEMBERSHIP_AUTHORITY_FIELDS) : null,
    agency: { id: agency.id, status: agency.status },
    is_platform_owner: isPlatformOwner,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Visit read authority changed during request');
  }
  return {
    agencyId,
    userId,
    normalizedEmail,
    tenantRole: selected ? String(selected.tenant_role || '') : 'platform_owner',
    membership: selected,
    snapshot,
  };
}
// <<<END SHARED VISIT READ TENANT AUTHORITY>>>

function requirePurposeRole(authority: Record<string, any>, purpose: string) {
  if (!PURPOSE_ROLES[purpose]?.has(authority.tenantRole)) {
    throw new PublicError(403, 'Tenant role cannot use this Visit read purpose');
  }
}

function validatePatientIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  const clientRequestId = exactIdentifier(row.client_request_id);
  if (
    row.id !== patientId
    || row.agency_id !== authority.agencyId
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.created_by !== creatorEmail
    || !clientRequestId
    || row.patient_creation_key
      !== `${authority.agencyId}:${row.created_by_user_id}:${clientRequestId}`
    || row.is_sample !== false
    || row.is_archived !== false
    || !VISIBLE_PATIENT_STATUSES.has(String(row.status || ''))
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Patient authority integrity check failed');
  }
  return row;
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      {
        id: patientId,
        agency_id: authority.agencyId,
        is_sample: false,
        is_archived: false,
      },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      PATIENT_AUTHORITY_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => (
    row?.id !== patientId
    || row?.agency_id !== authority.agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
  ))) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Visit unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  return validatePatientIntegrity(rows[0], patientId, authority);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function validateAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  const suspendedAt = row?.suspended_at;
  const revokedAt = row?.revoked_at;
  const revocationReason = row?.revocation_reason;
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.normalizedEmail
    || !authority.membership
    || row.assignee_membership_id !== authority.membership.id
    || row.assignee_membership_version_at_enablement !== authority.membership.version
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (suspendedAt != null && !validInstant(suspendedAt))
    || (status === 'suspended' && !validInstant(suspendedAt))
    || (revokedAt != null && !validInstant(revokedAt))
    || (status === 'revoked' && (
      !validInstant(revokedAt) || !boundedReason(revocationReason)
    ))
    || (status !== 'revoked' && (revokedAt != null || revocationReason != null))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId
    || row.last_transition_request_key !== transitionRequestKey(key, requestId)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  return row;
}

async function loadExactAssignment(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: authority.agencyId,
        patient_id: patientId,
        user_id: authority.userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
      undefined,
      ASSIGNMENT_AUTHORITY_FIELDS,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== authority.userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  return rows.length === 1
    ? validateAssignmentIntegrity(rows[0], patientId, authority)
    : null;
}

function assignmentAuthoritySnapshot(row: Record<string, any>) {
  return pickFields(row, ASSIGNMENT_AUTHORITY_FIELDS);
}

async function loadVisitReadAccess(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
  expectedSnapshot: Record<string, any> | null = null,
) {
  let snapshot: Record<string, any>;
  if (AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
    snapshot = { basis: 'agency_wide', assignment: null };
  } else if (authority.tenantRole === 'clinician') {
    const assignment = await loadExactAssignment(entities, patientId, authority);
    if (!assignment || assignment.status !== 'active') {
      if (expectedSnapshot?.basis === 'care_team_assignment') {
        throw new PublicError(409, 'Visit read authority changed during request');
      }
      throw new PublicError(404, 'Visit unavailable');
    }
    snapshot = {
      basis: 'care_team_assignment',
      assignment: assignmentAuthoritySnapshot(assignment),
    };
  } else {
    throw new PublicError(403, 'Tenant role cannot read Visits');
  }
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Visit read authority changed during request');
  }
  return snapshot;
}

function validateVisitIntegrity(
  row: Record<string, any>,
  visitId: string,
  authority: Record<string, any>,
  purpose: string,
) {
  const patientId = exactIdentifier(row.patient_id);
  const creatorId = exactIdentifier(row.created_by_user_id);
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  if (
    row.id !== visitId
    || row.agency_id !== authority.agencyId
    || !patientId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.created_by !== creatorEmail
    || (row.client_request_id != null && !exactIdentifier(row.client_request_id))
    || row.is_sample !== false
    || !validCalendarDate(row.visit_date)
    || !VISIT_TYPES.has(String(row.visit_type || ''))
    || !VISIT_STATUSES.has(String(row.status || ''))
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Visit authority integrity check failed');
  }
  validateVisitPurposeData(row, purpose);
  return row;
}

async function loadExactVisit(
  entities: Record<string, any>,
  visitId: string,
  authority: Record<string, any>,
  purpose: string,
) {
  const rows = requireRows(
    await entities.Visit.filter(
      { id: visitId, agency_id: authority.agencyId, is_sample: false },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      visitReadFields(purpose),
    ),
    'Visit.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Visit is ambiguous');
  if (rows.some((row) => (
    row?.id !== visitId
    || row?.agency_id !== authority.agencyId
    || row?.is_sample !== false
  ))) {
    throw new PublicError(409, 'Visit query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Visit unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Visit is ambiguous');
  return validateVisitIntegrity(rows[0], visitId, authority, purpose);
}

function patientAuthoritySnapshot(row: Record<string, any>) {
  return pickFields(row, PATIENT_AUTHORITY_FIELDS);
}

function visitReadSnapshot(row: Record<string, any>, purpose: string) {
  return pickFields(row, visitReadFields(purpose));
}

function responseScope(
  authority: Record<string, any>,
  patientId: string,
  access: Record<string, any>,
) {
  return {
    agency_id: authority.agencyId,
    membership_id: authority.membership?.id ?? null,
    membership_version: authority.membership?.version ?? null,
    tenant_role: authority.tenantRole,
    patient_id: patientId,
    access_basis: access.basis,
    assignment_id: access.assignment?.id ?? null,
    assignment_version: access.assignment?.version ?? null,
  };
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
    const initialAuthority = await loadAuthority(base44, input.agencyId);
    requirePurposeRole(initialAuthority, input.purpose);
    const entities = base44.asServiceRole.entities;
    const initialVisit = await loadExactVisit(
      entities,
      input.visitId,
      initialAuthority,
      input.purpose,
    );
    const patientId = String(initialVisit.patient_id);
    const initialPatient = await loadExactPatient(entities, patientId, initialAuthority);
    const initialAccess = await loadVisitReadAccess(
      entities,
      patientId,
      initialAuthority,
    );
    const initialVisitSnapshot = visitReadSnapshot(initialVisit, input.purpose);
    const initialPatientSnapshot = patientAuthoritySnapshot(initialPatient);

    const finalAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(finalAuthority, input.purpose);
    const finalVisit = await loadExactVisit(
      entities,
      input.visitId,
      finalAuthority,
      input.purpose,
    );
    if (!sameValue(visitReadSnapshot(finalVisit, input.purpose), initialVisitSnapshot)) {
      throw new PublicError(409, 'Visit changed during read');
    }
    if (finalVisit.patient_id !== patientId) {
      throw new PublicError(409, 'Visit read authority changed during request');
    }
    const finalPatient = await loadExactPatient(entities, patientId, finalAuthority);
    if (!sameValue(patientAuthoritySnapshot(finalPatient), initialPatientSnapshot)) {
      throw new PublicError(409, 'Visit read authority changed during request');
    }
    const finalAccess = await loadVisitReadAccess(
      entities,
      patientId,
      finalAuthority,
      initialAccess,
    );
    // Put one last authority/assignment gate after the final Visit and Patient
    // reads so a concurrent suspension or revocation cannot reuse the earlier
    // in-memory authority snapshot for disclosure.
    const disclosureAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(disclosureAuthority, input.purpose);
    const disclosureAccess = await loadVisitReadAccess(
      entities,
      patientId,
      disclosureAuthority,
      finalAccess,
    );

    return Response.json({
      success: true,
      purpose: input.purpose,
      visit: pickFields(finalVisit, PURPOSE_FIELDS[input.purpose]),
      scope: responseScope(disclosureAuthority, patientId, disclosureAccess),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never retain provider error objects: they may embed predicates or PHI.
    console.error('getAuthorizedVisit failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
