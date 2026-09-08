import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Unwired, read-only OASISAssessment broker.
 *
 * Both exact and bounded reads are rooted in an immutable AgencyMembership,
 * an exact active Agency, a tenant-stamped Patient, and either agency-wide,
 * patient-creator, or exact PatientCareTeamAssignment chart authority. The
 * browser never chooses fields or predicates. Response-bearing reads expose
 * only native v2 clinician-selected rows whose stored provenance is complete.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT_LENGTH = 300;
const MAX_CODE_LENGTH = 100;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const DEFAULT_LIST_LIMIT = 10;
const MAX_LIST_LIMIT = 25;
const MAX_OASIS_ITEMS = 500;
const MAX_MULTI_SELECT_CODES = 100;
const MAX_GRID_ROWS = 500;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const OASIS_READER_ROLES = new Set([
  'platform_owner',
  'agency_admin',
  'manager',
  'clinician',
]);
const AGENCY_WIDE_ROLES = new Set(['platform_owner', 'agency_admin', 'manager']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const ASSESSMENT_VISIT_TYPES = new Set([
  'Start of Care',
  'Resumption of Care',
  'Recertification',
  'Discharge',
  'Transfer',
]);
const ASSESSMENT_STATUSES = new Set(['draft', 'in_progress', 'completed', 'submitted']);
const RESPONSE_SCHEMAS = new Set([
  'pennsync-oasis-response-v1-legacy',
  'pennsync-oasis-response-v2-cms-e2',
]);
const MIGRATION_STATUSES = new Set([
  'native_v2',
  'legacy_unconverted',
  'legacy_provenance_annotated',
]);
const RESPONSE_SHAPES = new Set(['single', 'multi_select', 'matrix_choice', 'grid']);
const VERIFIED_RESPONSE_SCHEMA = 'pennsync-oasis-response-v2-cms-e2';
const VERIFIED_INSTRUMENT = 'oasis-e2';
const VERIFIED_SCHEMA_SOURCE = 'final-oasis-e2-all-item-04-01-2026';

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
const SUMMARY_ASSESSMENT_FIELDS = [
  'id',
  'agency_id',
  'patient_id',
  'visit_id',
  'visit_type',
  'assessment_date',
  'status',
  'completion_percentage',
  'response_schema_id',
  'instrument_version',
  'response_schema_source',
  'migration_status',
  'last_written_by',
  'last_written_at',
  'created_by',
  'created_date',
  'updated_date',
];
const VERIFIED_ASSESSMENT_FIELDS = [...SUMMARY_ASSESSMENT_FIELDS, 'oasis_items'];
const SUMMARY_PROJECTION_FIELDS = [
  'id',
  'patient_id',
  'visit_id',
  'visit_type',
  'assessment_date',
  'status',
  'completion_percentage',
  'response_schema_id',
  'instrument_version',
  'migration_status',
  'created_date',
  'updated_date',
];
const VERIFIED_ITEM_KEYS = new Set([
  'definition_id',
  'item_number',
  'item_name',
  'item_source',
  'item_spec_version',
  'response_schema_id',
  'response_shape',
  'response_value',
  'response_origin',
  'selected_by',
  'selected_at',
  'ai_suggested',
]);

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

function boundedText(value: unknown, max = MAX_TEXT_LENGTH) {
  return typeof value === 'string'
    && value.length <= max
    && value.trim() === value;
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
  return Object.fromEntries(fields.map((field) => [field, row[field] ?? null]));
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

function exactObjectKeys(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value as Record<string, unknown>).sort();
  return sameValue(actual, [...keys].sort());
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
  const operation = record.operation;
  if (operation !== 'get' && operation !== 'list') {
    throw new PublicError(400, 'operation is invalid');
  }
  const supported = operation === 'get'
    ? ['operation', 'agency_id', 'patient_id', 'assessment_id', 'purpose']
    : ['operation', 'agency_id', 'patient_id', 'purpose', 'limit'];
  if (Object.keys(record).some((key) => !supported.includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const patientId = exactIdentifier(record.patient_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  if (operation === 'get') {
    const assessmentId = exactIdentifier(record.assessment_id);
    if (!assessmentId) throw new PublicError(400, 'assessment_id is invalid');
    if (record.purpose !== 'summary' && record.purpose !== 'verified_responses') {
      throw new PublicError(400, 'purpose is invalid');
    }
    return {
      operation,
      agencyId,
      patientId,
      assessmentId,
      purpose: record.purpose,
      limit: null,
    };
  }
  if (record.purpose !== 'summary') {
    throw new PublicError(400, 'Bounded OASIS reads support summary purpose only');
  }
  const limit = record.limit === undefined ? DEFAULT_LIST_LIMIT : Number(record.limit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIST_LIMIT) {
    throw new PublicError(400, 'limit is invalid');
  }
  return {
    operation,
    agencyId,
    patientId,
    assessmentId: null,
    purpose: 'summary',
    limit,
  };
}

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
  if (rawRows.some((row) => row?.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencyIds = new Set<string>();
  const validated: Array<Record<string, any>> = [];

  for (const row of rawRows) {
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
      || row.version < 1
      || !exactIdentifier(row.created_by_user_id)
      || !exactIdentifier(row.last_transition_by_user_id)
      || !transitionEmail
      || row.last_transition_by_email_normalized !== transitionEmail
      || !validInstant(row.last_transition_at)
      || !boundedReason(row.last_transition_reason)
      || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
      || (status === 'pending' && row.activated_at != null)
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

async function loadExactActiveAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (rows[0].status !== 'active') throw new PublicError(403, 'Agency is unavailable');
  return rows[0];
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
    selected = memberships.find(
      (row) => row.agency_id === agencyId && row.status === 'active',
    ) ?? null;
    if (!selected) throw new PublicError(403, 'No active membership for agency');
  }
  const agency = await loadExactActiveAgency(entities, agencyId);
  const tenantRole = selected ? String(selected.tenant_role || '') : 'platform_owner';
  if (!OASIS_READER_ROLES.has(tenantRole)) {
    throw new PublicError(403, 'Tenant role cannot read OASIS assessments');
  }
  const snapshot = {
    user: { id: userId, email: normalizedEmail, role: user.role },
    membership: selected ? pickFields(selected, MEMBERSHIP_AUTHORITY_FIELDS) : null,
    agency: { id: agency.id, status: agency.status },
    is_platform_owner: isPlatformOwner,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'OASIS read authority changed during request');
  }
  return {
    agencyId,
    userId,
    normalizedEmail,
    tenantRole,
    membership: selected,
    snapshot,
  };
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
  const query = {
    id: patientId,
    agency_id: authority.agencyId,
    is_sample: false,
    is_archived: false,
  };
  const rows = requireRows(
    await entities.Patient.filter(
      query,
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
  if (rows.length === 0) throw new PublicError(404, 'Patient unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  return validatePatientIntegrity(rows[0], patientId, authority);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
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
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || !exactIdentifier(row.assignee_membership_id)
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (row.suspended_at != null && !validInstant(row.suspended_at))
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (row.revoked_at != null && !validInstant(row.revoked_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
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
    || row.last_transition_request_key !== `${key}:${requestId}`
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

function isPatientCreator(row: Record<string, any>, authority: Record<string, any>) {
  return row.created_by_user_id === authority.userId
    && row.created_by_user_email_normalized === authority.normalizedEmail;
}

async function loadPatientAccess(
  entities: Record<string, any>,
  patient: Record<string, any>,
  authority: Record<string, any>,
  expectedSnapshot: Record<string, any> | null = null,
) {
  let snapshot: Record<string, any>;
  if (AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
    snapshot = { basis: 'agency_wide', assignment: null };
  } else if (isPatientCreator(patient, authority)) {
    snapshot = { basis: 'patient_creator', assignment: null };
  } else {
    const assignment = await loadExactAssignment(entities, patient.id, authority);
    if (!assignment || assignment.status !== 'active') {
      if (expectedSnapshot?.basis === 'care_team_assignment') {
        throw new PublicError(409, 'OASIS read authority changed during request');
      }
      throw new PublicError(404, 'Patient unavailable');
    }
    if (
      !authority.membership
      || assignment.user_email_normalized !== authority.normalizedEmail
      || assignment.assignee_membership_id !== authority.membership.id
      || assignment.assignee_membership_version_at_enablement !== authority.membership.version
    ) {
      throw new PublicError(409, 'Care-team assignment binding is invalid');
    }
    snapshot = {
      basis: 'care_team_assignment',
      assignment: pickFields(assignment, ASSIGNMENT_AUTHORITY_FIELDS),
    };
  }
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'OASIS read authority changed during request');
  }
  return snapshot;
}

function patientSnapshot(row: Record<string, any>) {
  return pickFields(row, PATIENT_AUTHORITY_FIELDS);
}

function validateAssessmentBase(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const createdBy = canonicalEmail(row.created_by);
  const visitId = row.visit_id;
  const completion = row.completion_percentage;
  const schema = row.response_schema_id;
  const instrument = row.instrument_version;
  const schemaSource = row.response_schema_source;
  const migration = row.migration_status;
  if (
    !exactIdentifier(row.id)
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || (visitId != null && !exactIdentifier(visitId))
    || !ASSESSMENT_VISIT_TYPES.has(String(row.visit_type || ''))
    || !validCalendarDate(row.assessment_date)
    || !ASSESSMENT_STATUSES.has(String(row.status || ''))
    || (completion != null && (
      typeof completion !== 'number'
      || !Number.isFinite(completion)
      || completion < 0
      || completion > 100
    ))
    || (schema != null && !RESPONSE_SCHEMAS.has(schema))
    || (instrument != null && instrument !== VERIFIED_INSTRUMENT)
    || (schemaSource != null && schemaSource !== VERIFIED_SCHEMA_SOURCE)
    || (migration != null && !MIGRATION_STATUSES.has(migration))
    || !createdBy
    || row.created_by !== createdBy
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'OASIS assessment integrity check failed');
  }
  return row;
}

function validCode(value: unknown) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_CODE_LENGTH
    && value.trim() === value;
}

function validateResponseValue(shape: string, value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (shape === 'single' || shape === 'matrix_choice') {
    return exactObjectKeys(record, ['code']) && validCode(record.code);
  }
  if (shape === 'multi_select') {
    if (!exactObjectKeys(record, ['codes']) || !Array.isArray(record.codes)) return false;
    if (record.codes.length < 1 || record.codes.length > MAX_MULTI_SELECT_CODES) return false;
    return record.codes.every(validCode) && new Set(record.codes).size === record.codes.length;
  }
  if (shape === 'grid') {
    if (!exactObjectKeys(record, ['rows']) || !Array.isArray(record.rows)) return false;
    if (record.rows.length < 1 || record.rows.length > MAX_GRID_ROWS) return false;
    const rowIds = new Set<string>();
    for (const rawRow of record.rows) {
      if (!exactObjectKeys(rawRow, ['row_id', 'code'])) return false;
      const gridRow = rawRow as Record<string, unknown>;
      const rowId = exactIdentifier(gridRow.row_id);
      if (!rowId || !validCode(gridRow.code) || rowIds.has(rowId)) return false;
      rowIds.add(rowId);
    }
    return true;
  }
  return false;
}

function validateVerifiedItems(row: Record<string, any>) {
  const items = row.oasis_items;
  const lastWriter = canonicalEmail(row.last_written_by);
  if (
    row.response_schema_id !== VERIFIED_RESPONSE_SCHEMA
    || row.instrument_version !== VERIFIED_INSTRUMENT
    || row.response_schema_source !== VERIFIED_SCHEMA_SOURCE
    || row.migration_status !== 'native_v2'
    || !lastWriter
    || row.last_written_by !== lastWriter
    || !validInstant(row.last_written_at)
    || !Array.isArray(items)
    || items.length > MAX_OASIS_ITEMS
  ) {
    throw new PublicError(409, 'OASIS response provenance is unverified');
  }

  const definitions = new Set<string>();
  const itemNumbers = new Set<string>();
  const projected: Array<Record<string, any>> = [];
  for (const item of items) {
    if (
      !item
      || typeof item !== 'object'
      || Array.isArray(item)
      || Object.keys(item).some((key) => !VERIFIED_ITEM_KEYS.has(key))
    ) {
      throw new PublicError(409, 'OASIS response provenance is unverified');
    }
    const definitionId = exactIdentifier(item.definition_id);
    const itemNumber = item.item_number == null ? null : exactIdentifier(item.item_number);
    const itemName = item.item_name;
    const itemSource = item.item_source;
    const selectedBy = canonicalEmail(item.selected_by);
    const responseShape = String(item.response_shape || '');
    const itemSpecVersion = item.item_spec_version;
    const normalizedItemNumber = itemNumber?.toLowerCase().replace(/[^a-z0-9]/g, '') || '';
    if (
      !definitionId
      || (itemSource !== 'cms_item' && itemSource !== 'pennsync_screening')
      || (itemSource === 'cms_item' && (
        !itemNumber || itemSpecVersion !== VERIFIED_INSTRUMENT
      ))
      || (itemSource === 'pennsync_screening' && (
        itemNumber !== null || itemSpecVersion != null
      ))
      || (itemName != null && !boundedText(itemName))
      || item.response_schema_id !== VERIFIED_RESPONSE_SCHEMA
      || !RESPONSE_SHAPES.has(responseShape)
      || !validateResponseValue(responseShape, item.response_value)
      || item.response_origin !== 'clinician_selected'
      || !selectedBy
      || item.selected_by !== selectedBy
      || selectedBy !== lastWriter
      || !validInstant(item.selected_at)
      || Date.parse(item.selected_at) > Date.parse(row.last_written_at)
      || item.ai_suggested !== false
      || definitions.has(definitionId)
      || (normalizedItemNumber && itemNumbers.has(normalizedItemNumber))
    ) {
      throw new PublicError(409, 'OASIS response provenance is unverified');
    }
    definitions.add(definitionId);
    if (normalizedItemNumber) itemNumbers.add(normalizedItemNumber);
    projected.push({
      definition_id: definitionId,
      item_number: itemNumber,
      item_name: itemName ?? null,
      item_source: itemSource,
      item_spec_version: itemSpecVersion ?? null,
      response_schema_id: item.response_schema_id,
      response_shape: responseShape,
      response_value: item.response_value,
      response_origin: item.response_origin,
      selected_by: selectedBy,
      selected_at: item.selected_at,
      ai_suggested: false,
    });
  }
  return projected;
}

function projectAssessment(row: Record<string, any>, purpose: string) {
  const summary = pickFields(row, SUMMARY_PROJECTION_FIELDS);
  if (purpose === 'summary') return summary;
  return {
    ...summary,
    response_schema_source: row.response_schema_source,
    last_written_by: row.last_written_by,
    last_written_at: row.last_written_at,
    oasis_items: validateVerifiedItems(row),
  };
}

function assessmentSnapshot(row: Record<string, any>, purpose: string) {
  return purpose === 'summary'
    ? pickFields(row, SUMMARY_ASSESSMENT_FIELDS)
    : {
      ...pickFields(row, VERIFIED_ASSESSMENT_FIELDS),
      oasis_items: validateVerifiedItems(row),
    };
}

async function loadExactAssessment(
  entities: Record<string, any>,
  assessmentId: string,
  patientId: string,
  authority: Record<string, any>,
  purpose: string,
) {
  const query = {
    id: assessmentId,
    agency_id: authority.agencyId,
    patient_id: patientId,
  };
  const fields = purpose === 'verified_responses'
    ? VERIFIED_ASSESSMENT_FIELDS
    : SUMMARY_ASSESSMENT_FIELDS;
  const rows = requireRows(
    await entities.OASISAssessment.filter(
      query,
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      fields,
    ),
    'OASISAssessment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'OASIS assessment is ambiguous');
  if (rows.some((row) => (
    row?.id !== assessmentId
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
  ))) {
    throw new PublicError(409, 'OASIS assessment query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'OASIS assessment unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'OASIS assessment is ambiguous');
  const assessment = validateAssessmentBase(rows[0], patientId, authority);
  if (purpose === 'verified_responses') validateVerifiedItems(assessment);
  return assessment;
}

async function loadAssessmentWindow(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
  limit: number,
) {
  const queryLimit = limit + 1;
  const rows = requireRows(
    await entities.OASISAssessment.filter(
      { agency_id: authority.agencyId, patient_id: patientId },
      '-assessment_date',
      queryLimit,
      undefined,
      SUMMARY_ASSESSMENT_FIELDS,
    ),
    'OASISAssessment.filter',
  );
  if (rows.length > queryLimit) throw new PublicError(409, 'OASIS assessment window is invalid');
  const ids = new Set<string>();
  let previousDate: string | null = null;
  for (const row of rows) {
    if (row?.agency_id !== authority.agencyId || row?.patient_id !== patientId) {
      throw new PublicError(409, 'OASIS assessment query scope could not be verified');
    }
    validateAssessmentBase(row, patientId, authority);
    if (ids.has(row.id)) throw new PublicError(409, 'OASIS assessment is ambiguous');
    if (previousDate && row.assessment_date > previousDate) {
      throw new PublicError(409, 'OASIS assessment ordering could not be verified');
    }
    ids.add(row.id);
    previousDate = row.assessment_date;
  }
  return {
    visible: rows.slice(0, limit),
    hasMore: rows.length > limit,
  };
}

function responseScope(
  authority: Record<string, any>,
  patientId: string,
  accessSnapshot: Record<string, any>,
) {
  return {
    agency_id: authority.agencyId,
    patient_id: patientId,
    membership_id: authority.membership?.id ?? null,
    membership_version: authority.membership?.version ?? null,
    tenant_role: authority.tenantRole,
    chart_access_basis: accessSnapshot.basis,
  };
}

async function recheckDisclosureAccess(
  base44: Record<string, any>,
  entities: Record<string, any>,
  agencyId: string,
  patientId: string,
  authoritySnapshot: Record<string, any>,
  expectedPatientSnapshot: Record<string, any>,
  expectedAccessSnapshot: Record<string, any>,
) {
  const authority = await loadAuthority(base44, agencyId, authoritySnapshot);
  const patient = await loadExactPatient(entities, patientId, authority);
  if (!sameValue(patientSnapshot(patient), expectedPatientSnapshot)) {
    throw new PublicError(409, 'OASIS read authority changed during request');
  }
  const accessSnapshot = await loadPatientAccess(
    entities,
    patient,
    authority,
    expectedAccessSnapshot,
  );
  return { authority, accessSnapshot };
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
    const entities = base44.asServiceRole.entities;
    const initialPatient = await loadExactPatient(entities, input.patientId, initialAuthority);
    const initialPatientSnapshot = patientSnapshot(initialPatient);
    const initialAccessSnapshot = await loadPatientAccess(
      entities,
      initialPatient,
      initialAuthority,
    );

    let initialAssessmentSnapshot: unknown;
    if (input.operation === 'get') {
      const initialAssessment = await loadExactAssessment(
        entities,
        input.assessmentId as string,
        input.patientId,
        initialAuthority,
        input.purpose,
      );
      initialAssessmentSnapshot = assessmentSnapshot(initialAssessment, input.purpose);
    } else {
      const initialWindow = await loadAssessmentWindow(
        entities,
        input.patientId,
        initialAuthority,
        input.limit as number,
      );
      initialAssessmentSnapshot = {
        assessments: initialWindow.visible.map((row) => assessmentSnapshot(row, 'summary')),
        has_more: initialWindow.hasMore,
      };
    }

    const finalAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    const finalPatient = await loadExactPatient(entities, input.patientId, finalAuthority);
    if (!sameValue(patientSnapshot(finalPatient), initialPatientSnapshot)) {
      throw new PublicError(409, 'OASIS read authority changed during request');
    }
    await loadPatientAccess(
      entities,
      finalPatient,
      finalAuthority,
      initialAccessSnapshot,
    );

    if (input.operation === 'get') {
      const finalAssessment = await loadExactAssessment(
        entities,
        input.assessmentId as string,
        input.patientId,
        finalAuthority,
        input.purpose,
      );
      if (!sameValue(
        assessmentSnapshot(finalAssessment, input.purpose),
        initialAssessmentSnapshot,
      )) {
        throw new PublicError(409, 'OASIS assessment changed during request');
      }
      const disclosure = await recheckDisclosureAccess(
        base44,
        entities,
        input.agencyId,
        input.patientId,
        initialAuthority.snapshot,
        initialPatientSnapshot,
        initialAccessSnapshot,
      );
      return Response.json({
        success: true,
        operation: 'get',
        purpose: input.purpose,
        assessment: projectAssessment(finalAssessment, input.purpose),
        scope: responseScope(
          disclosure.authority,
          input.patientId,
          disclosure.accessSnapshot,
        ),
      });
    }

    const finalWindow = await loadAssessmentWindow(
      entities,
      input.patientId,
      finalAuthority,
      input.limit as number,
    );
    const finalWindowSnapshot = {
      assessments: finalWindow.visible.map((row) => assessmentSnapshot(row, 'summary')),
      has_more: finalWindow.hasMore,
    };
    if (!sameValue(finalWindowSnapshot, initialAssessmentSnapshot)) {
      throw new PublicError(409, 'OASIS assessment window changed during request');
    }
    const disclosure = await recheckDisclosureAccess(
      base44,
      entities,
      input.agencyId,
      input.patientId,
      initialAuthority.snapshot,
      initialPatientSnapshot,
      initialAccessSnapshot,
    );
    return Response.json({
      success: true,
      operation: 'list',
      purpose: 'summary',
      assessments: finalWindow.visible.map((row) => projectAssessment(row, 'summary')),
      page: {
        limit: input.limit,
        returned: finalWindow.visible.length,
        has_more: finalWindow.hasMore,
      },
      scope: responseScope(
        disclosure.authority,
        input.patientId,
        disclosure.accessSnapshot,
      ),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Provider failures can contain predicates or PHI; never return them.
    console.error('readAuthorizedOASISAssessments failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
