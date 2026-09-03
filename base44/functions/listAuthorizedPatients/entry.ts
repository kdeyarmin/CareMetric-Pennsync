import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Bounded, purpose-bound Patient list broker.
 *
 * Every service query is tenant-scoped before the keyset continuation is
 * applied. This first slice supports a small page or a capped id batch only;
 * it deliberately omits arbitrary filters, field selection, full exports,
 * and search scans. Non-agency-wide roster access is the ordered union of
 * immutable Patient creator provenance and exact, active, server-owned
 * PatientCareTeamAssignment evidence. Mutable assigned_nurses email values
 * are not treated as authority.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const MAX_PAGE_SIZE = 50;
const MAX_BATCH_IDS = 25;
const ASSIGNMENT_PAGE_BATCH_SIZE = MAX_PAGE_SIZE + 1;
const MAX_ASSIGNMENT_PAGE_SCAN = 255;
const CURSOR_VERSION = 1;

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
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager', 'platform_owner']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const PAGE_SORT = 'id_asc';

// <<<BEGIN AUTHORIZED PATIENT LIST PURPOSE POLICY>>>
const PURPOSE_FIELDS: Record<string, readonly string[]> = {
  roster: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'medical_record_number',
    'status',
    'care_type',
    'admission_date',
    'primary_diagnosis',
    'updated_date',
  ],
  contact: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'phone',
    'email',
    'emergency_contact_name',
    'emergency_contact_phone',
    'emergency_contact_relationship',
    'physician_name',
    'physician_phone',
    'physician_email',
    'caregiver_name',
    'caregiver_email',
    'caregiver_phone',
  ],
  identity_match: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'date_of_birth',
    'medical_record_number',
    'phone',
    'address',
  ],
};

const PURPOSE_ROLES: Record<string, ReadonlySet<string>> = {
  roster: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  contact: new Set(['platform_owner', 'agency_admin', 'manager']),
  identity_match: new Set(['platform_owner', 'agency_admin', 'manager']),
};

const PURPOSE_MAX_PAGE_SIZE: Record<string, number> = {
  roster: 50,
  contact: 25,
  identity_match: 25,
};
// <<<END AUTHORIZED PATIENT LIST PURPOSE POLICY>>>

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

function patientReadFields(purpose: string) {
  return [...new Set([...PATIENT_AUTHORITY_FIELDS, ...PURPOSE_FIELDS[purpose]])];
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

/**
 * The continuation is deliberately an unsigned, untrusted context echo. It
 * is not an authorization credential and does not claim tamper resistance.
 * Re-resolved authority and a server-built tenant query remain the security
 * boundary; changing after_id can only seek within that already-authorized
 * scope.
 */
function parsePageCursor(
  value: unknown,
  expected: {
    agencyId: string;
    purpose: string;
    status: string | null;
    sort: string;
    pageSize: number;
  },
) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, 'cursor is invalid');
  }
  const cursor = value as Record<string, unknown>;
  const required = [
    'version',
    'after_id',
    'agency_id',
    'purpose',
    'status',
    'sort',
    'page_size',
    'subject_user_id',
    'membership_id',
    'membership_version',
    'tenant_role',
  ];
  const keys = Object.keys(cursor);
  if (keys.length !== required.length || required.some((key) => !Object.hasOwn(cursor, key))) {
    throw new PublicError(400, 'cursor is invalid');
  }
  const afterId = exactIdentifier(cursor.after_id);
  const agencyId = exactIdentifier(cursor.agency_id);
  const subjectUserId = exactIdentifier(cursor.subject_user_id);
  const membershipId = cursor.membership_id === null
    ? null
    : exactIdentifier(cursor.membership_id);
  const membershipVersion = cursor.membership_version;
  const tenantRole = typeof cursor.tenant_role === 'string' ? cursor.tenant_role : '';
  const status = cursor.status === null ? null : String(cursor.status);
  if (
    cursor.version !== CURSOR_VERSION
    || !afterId
    || !agencyId
    || !subjectUserId
    || !Object.hasOwn(PURPOSE_FIELDS, String(cursor.purpose || ''))
    || (status !== null && !VISIBLE_PATIENT_STATUSES.has(status))
    || cursor.sort !== PAGE_SORT
    || !Number.isSafeInteger(cursor.page_size)
    || Number(cursor.page_size) < 1
    || Number(cursor.page_size) > MAX_PAGE_SIZE
    || !PURPOSE_ROLES[expected.purpose]?.has(tenantRole)
    || (tenantRole === 'platform_owner'
      ? membershipId !== null || membershipVersion !== null
      : !membershipId
        || !Number.isSafeInteger(membershipVersion)
        || Number(membershipVersion) < 1)
  ) {
    throw new PublicError(400, 'cursor is invalid');
  }
  const normalized = {
    version: CURSOR_VERSION,
    after_id: afterId,
    agency_id: agencyId,
    purpose: String(cursor.purpose),
    status,
    sort: PAGE_SORT,
    page_size: Number(cursor.page_size),
    subject_user_id: subjectUserId,
    membership_id: membershipId,
    membership_version: membershipVersion === null ? null : Number(membershipVersion),
    tenant_role: tenantRole,
  };
  if (
    normalized.agency_id !== expected.agencyId
    || normalized.purpose !== expected.purpose
    || normalized.status !== expected.status
    || normalized.sort !== expected.sort
    || normalized.page_size !== expected.pageSize
  ) {
    throw new PublicError(400, 'cursor does not match the Patient list request');
  }
  return normalized;
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
  const mode = typeof record.mode === 'string' ? record.mode : '';
  const purpose = typeof record.purpose === 'string' ? record.purpose : '';
  const agencyId = exactIdentifier(record.agency_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new PublicError(400, 'purpose is invalid');

  if (mode === 'page') {
    const allowed = ['agency_id', 'mode', 'purpose', 'status', 'sort', 'page_size', 'cursor'];
    if (Object.keys(record).some((key) => !allowed.includes(key))) {
      throw new PublicError(400, 'Request contains unsupported fields');
    }
    const status = record.status === undefined ? null : String(record.status);
    const sort = record.sort === undefined ? PAGE_SORT : String(record.sort);
    const pageSize = record.page_size === undefined ? 25 : Number(record.page_size);
    if (status !== null && !VISIBLE_PATIENT_STATUSES.has(status)) {
      throw new PublicError(400, 'status is invalid');
    }
    if (sort !== PAGE_SORT) throw new PublicError(400, 'sort is invalid');
    if (
      !Number.isSafeInteger(pageSize)
      || pageSize < 1
      || pageSize > MAX_PAGE_SIZE
      || pageSize > PURPOSE_MAX_PAGE_SIZE[purpose]
    ) {
      throw new PublicError(400, 'page_size is invalid');
    }
    const cursor = parsePageCursor(record.cursor, {
      agencyId,
      purpose,
      status,
      sort,
      pageSize,
    });
    return { agencyId, mode, purpose, status, sort, pageSize, cursor, patientIds: [] };
  }

  if (mode === 'ids') {
    const allowed = ['agency_id', 'mode', 'purpose', 'patient_ids'];
    if (Object.keys(record).some((key) => !allowed.includes(key))) {
      throw new PublicError(400, 'Request contains unsupported fields');
    }
    if (
      !Array.isArray(record.patient_ids)
      || record.patient_ids.length < 1
      || record.patient_ids.length > MAX_BATCH_IDS
    ) {
      throw new PublicError(400, 'patient_ids is invalid');
    }
    const patientIds = record.patient_ids.map(exactIdentifier);
    if (patientIds.some((id) => !id) || new Set(patientIds).size !== patientIds.length) {
      throw new PublicError(400, 'patient_ids is invalid');
    }
    return {
      agencyId,
      mode,
      purpose,
      status: null,
      sort: PAGE_SORT,
      pageSize: 0,
      cursor: null,
      patientIds: patientIds as string[],
    };
  }

  throw new PublicError(400, 'mode is invalid');
}

// <<<BEGIN SHARED PATIENT READ TENANT AUTHORITY>>>
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
  const memberships = validateMembershipRows(
    requireRows(
      await entities.AgencyMembership.filter(
        { user_id: userId },
        '-updated_date',
        MEMBERSHIP_SCAN_LIMIT,
      ),
      'AgencyMembership.filter',
    ),
    userId,
    normalizedEmail,
  );
  const active = memberships.filter((row) => row.status === 'active');
  const selected = active.find((row) => row.agency_id === agencyId);
  const isPlatformOwner = isProtectedPlatformOwner(user);
  if (!selected && !isPlatformOwner) {
    throw new PublicError(403, 'No active membership for agency');
  }
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    user: { id: userId, email: normalizedEmail },
    membership: selected ? pickFields(selected, MEMBERSHIP_AUTHORITY_FIELDS) : null,
    agency: { id: agency.id, status: agency.status },
    is_platform_owner: isPlatformOwner,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Patient read authority changed during request');
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
// <<<END SHARED PATIENT READ TENANT AUTHORITY>>>

function requirePurposeRole(authority: Record<string, any>, purpose: string) {
  if (!PURPOSE_ROLES[purpose]?.has(authority.tenantRole)) {
    throw new PublicError(403, 'Tenant role cannot use this Patient list purpose');
  }
}

function pageCursorContext(
  input: Record<string, any>,
  authority: Record<string, any>,
  afterId: string,
) {
  return {
    version: CURSOR_VERSION,
    after_id: afterId,
    agency_id: authority.agencyId,
    purpose: input.purpose,
    status: input.status,
    sort: PAGE_SORT,
    page_size: input.pageSize,
    subject_user_id: authority.userId,
    membership_id: authority.membership?.id ?? null,
    membership_version: authority.membership?.version ?? null,
    tenant_role: authority.tenantRole,
  };
}

function requireCursorAuthority(
  cursor: Record<string, any> | null,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  if (!cursor) return;
  if (!sameValue(cursor, pageCursorContext(input, authority, cursor.after_id))) {
    throw new PublicError(409, 'Patient list continuation context changed');
  }
}

function patientBaseScope(authority: Record<string, any>) {
  return {
    agency_id: authority.agencyId,
    is_sample: false,
    is_archived: false,
  };
}

function creatorPatientScope(authority: Record<string, any>) {
  return {
    ...patientBaseScope(authority),
    created_by_user_id: authority.userId,
    created_by_user_email_normalized: authority.normalizedEmail,
  };
}

function rowMatchesBaseScope(
  row: Record<string, any>,
  authority: Record<string, any>,
  status: string | null,
) {
  if (
    row?.agency_id !== authority.agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
    || (status !== null && row?.status !== status)
  ) {
    return false;
  }
  return true;
}

function isPatientCreator(row: Record<string, any>, authority: Record<string, any>) {
  return row.created_by_user_id === authority.userId
    && row.created_by_user_email_normalized === authority.normalizedEmail;
}

function validatePatientIntegrity(row: Record<string, any>, authority: Record<string, any>) {
  const id = exactIdentifier(row.id);
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  const clientRequestId = exactIdentifier(row.client_request_id);
  if (
    !id
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

function patientAuthoritySnapshot(row: Record<string, any>) {
  return pickFields(row, [
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
  ]);
}

function patientRowsSnapshot(rows: Array<Record<string, any>>) {
  return rows.map(patientAuthoritySnapshot);
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
    || !authority.membership
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.normalizedEmail
    || row.assignee_membership_id !== authority.membership.id
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || row.assignee_membership_version_at_enablement > authority.membership.version
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

function assignmentAuthoritySnapshot(row: Record<string, any>) {
  return pickFields(row, ASSIGNMENT_AUTHORITY_FIELDS);
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

function pageAuthorizationSnapshot(
  rows: Array<Record<string, any>>,
  basisByPatientId: Map<string, Record<string, any>>,
) {
  return rows.map((row) => {
    const basis = basisByPatientId.get(row.id);
    if (!basis) throw new Error('Patient list authorization basis is missing');
    return basis;
  });
}

function validateOrderedPatientRows(
  rawRows: Array<Record<string, any>>,
  authority: Record<string, any>,
  status: string | null,
  afterId: string | null,
) {
  const ids = new Set<string>();
  let previousId = afterId;
  return rawRows.map((row) => {
    if (!rowMatchesBaseScope(row, authority, status)) {
      throw new PublicError(409, 'Patient result scope check failed');
    }
    const validated = validatePatientIntegrity(row, authority);
    if (ids.has(validated.id) || (previousId !== null && validated.id <= previousId)) {
      throw new PublicError(409, 'Patient page is ambiguous');
    }
    ids.add(validated.id);
    previousId = validated.id;
    return validated;
  });
}

async function loadPatientBatch(
  entities: Record<string, any>,
  patientIds: string[],
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  if (patientIds.length === 0) return new Map<string, Record<string, any>>();
  const query: Record<string, any> = {
    ...patientBaseScope(authority),
    id: { $in: patientIds },
  };
  if (input.status !== null) query.status = input.status;
  const rawRows = requireRows(
    await entities.Patient.filter(
      query,
      undefined,
      patientIds.length + 1,
      undefined,
      patientReadFields(input.purpose),
    ),
    'Patient.filter',
  );
  if (rawRows.length > patientIds.length) {
    throw new PublicError(409, 'Patient id batch is ambiguous');
  }
  const requested = new Set(patientIds);
  const byId = new Map<string, Record<string, any>>();
  for (const row of rawRows) {
    // A provider-side over-return of a wrong-tenant, filtered-status, or
    // unrequested row is indistinguishable from a missing id to the caller.
    // It is never projected and cannot become an authorization signal.
    if (!requested.has(row?.id) || !rowMatchesBaseScope(row, authority, input.status)) continue;
    const validated = validatePatientIntegrity(row, authority);
    if (byId.has(validated.id)) throw new PublicError(409, 'Patient id batch is ambiguous');
    byId.set(validated.id, validated);
  }
  return byId;
}

async function loadWidePage(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const query: Record<string, any> = patientBaseScope(authority);
  if (input.status !== null) query.status = input.status;
  if (input.cursor) query.id = { $gt: input.cursor.after_id };
  const rawRows = requireRows(
    await entities.Patient.filter(
      query,
      'id',
      input.pageSize + 1,
      undefined,
      patientReadFields(input.purpose),
    ),
    'Patient.filter',
  );
  if (rawRows.length > input.pageSize + 1) {
    throw new PublicError(409, 'Patient page is ambiguous');
  }
  const rows = validateOrderedPatientRows(
    rawRows,
    authority,
    input.status,
    input.cursor?.after_id ?? null,
  );
  return {
    rows,
    authorization: rows.map((row) => ({ patient_id: row.id, basis: 'agency_wide' })),
  };
}

async function loadCreatorPage(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const query: Record<string, any> = creatorPatientScope(authority);
  if (input.status !== null) query.status = input.status;
  if (input.cursor) query.id = { $gt: input.cursor.after_id };
  const rawRows = requireRows(
    await entities.Patient.filter(
      query,
      'id',
      input.pageSize + 1,
      undefined,
      patientReadFields(input.purpose),
    ),
    'Patient.filter',
  );
  if (rawRows.length > input.pageSize + 1) {
    throw new PublicError(409, 'Patient page is ambiguous');
  }
  const rows = validateOrderedPatientRows(
    rawRows,
    authority,
    input.status,
    input.cursor?.after_id ?? null,
  );
  if (rows.some((row) => !isPatientCreator(row, authority))) {
    throw new PublicError(409, 'Patient creator scope check failed');
  }
  return rows;
}

async function loadAssignedPage(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  if (!authority.membership) {
    throw new PublicError(409, 'Care-team assignment binding is invalid');
  }
  const rows: Array<Record<string, any>> = [];
  const basisByPatientId = new Map<string, Record<string, any>>();
  const seenAssignmentIds = new Set<string>();
  let scanAfter = input.cursor?.after_id ?? null;
  let scanned = 0;

  while (rows.length < input.pageSize + 1) {
    const remaining = MAX_ASSIGNMENT_PAGE_SCAN - scanned;
    if (remaining < 1) {
      throw new PublicError(409, 'Care-team assignment page exceeds bounded scan');
    }
    const limit = Math.min(ASSIGNMENT_PAGE_BATCH_SIZE, remaining);
    const query: Record<string, any> = {
      agency_id: authority.agencyId,
      user_id: authority.userId,
      user_email_normalized: authority.normalizedEmail,
      assignee_membership_id: authority.membership.id,
      status: 'active',
    };
    if (scanAfter !== null) query.patient_id = { $gt: scanAfter };
    const discovered = requireRows(
      await entities.PatientCareTeamAssignment.filter(
        query,
        'patient_id',
        limit,
        undefined,
        ASSIGNMENT_AUTHORITY_FIELDS,
      ),
      'PatientCareTeamAssignment.filter',
    );
    if (discovered.length > limit) {
      throw new PublicError(409, 'Care-team assignment page is ambiguous');
    }
    if (discovered.length === 0) break;

    const patientIds: string[] = [];
    let previousPatientId = scanAfter;
    for (const discoveredRow of discovered) {
      const patientId = exactIdentifier(discoveredRow?.patient_id);
      const assignmentId = exactIdentifier(discoveredRow?.id);
      if (
        !patientId
        || !assignmentId
        || seenAssignmentIds.has(assignmentId)
        || (previousPatientId !== null && patientId <= previousPatientId)
        || discoveredRow?.agency_id !== authority.agencyId
        || discoveredRow?.user_id !== authority.userId
        || discoveredRow?.user_email_normalized !== authority.normalizedEmail
        || discoveredRow?.assignee_membership_id !== authority.membership.id
        || discoveredRow?.status !== 'active'
      ) {
        throw new PublicError(409, 'Care-team assignment query scope could not be verified');
      }
      validateAssignmentIntegrity(discoveredRow, patientId, authority);
      seenAssignmentIds.add(assignmentId);
      patientIds.push(patientId);
      previousPatientId = patientId;
    }

    const patientsById = await loadPatientBatch(entities, patientIds, input, authority);
    for (const discoveredRow of discovered) {
      const patient = patientsById.get(discoveredRow.patient_id);
      if (!patient || isPatientCreator(patient, authority)) continue;
      const exact = await loadExactAssignment(entities, patient.id, authority);
      if (
        !exact
        || exact.status !== 'active'
        || !sameValue(
          assignmentAuthoritySnapshot(exact),
          assignmentAuthoritySnapshot(discoveredRow),
        )
      ) {
        throw new PublicError(409, 'Patient read authority changed during request');
      }
      rows.push(patient);
      basisByPatientId.set(patient.id, {
        patient_id: patient.id,
        basis: 'care_team_assignment',
        assignment: assignmentAuthoritySnapshot(exact),
      });
      if (rows.length >= input.pageSize + 1) break;
    }

    scanned += discovered.length;
    scanAfter = patientIds[patientIds.length - 1];
    if (discovered.length < limit) break;
    if (scanned >= MAX_ASSIGNMENT_PAGE_SCAN && rows.length < input.pageSize + 1) {
      throw new PublicError(409, 'Care-team assignment page exceeds bounded scan');
    }
  }
  return { rows, basisByPatientId };
}

async function loadRestrictedPage(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const creatorRows = await loadCreatorPage(entities, input, authority);
  const assigned = await loadAssignedPage(entities, input, authority);
  const byId = new Map<string, Record<string, any>>();
  const basisByPatientId = new Map<string, Record<string, any>>();
  for (const row of creatorRows) {
    byId.set(row.id, row);
    basisByPatientId.set(row.id, { patient_id: row.id, basis: 'patient_creator' });
  }
  for (const row of assigned.rows) {
    if (byId.has(row.id)) continue;
    byId.set(row.id, row);
    const basis = assigned.basisByPatientId.get(row.id);
    if (!basis) throw new Error('Care-team assignment authorization basis is missing');
    basisByPatientId.set(row.id, basis);
  }
  const rows = [...byId.values()]
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    .slice(0, input.pageSize + 1);
  return { rows, authorization: pageAuthorizationSnapshot(rows, basisByPatientId) };
}

async function loadPage(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  return AGENCY_WIDE_ROLES.has(authority.tenantRole)
    ? loadWidePage(entities, input, authority)
    : loadRestrictedPage(entities, input, authority);
}

async function loadIdBatch(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const byId = await loadPatientBatch(entities, input.patientIds, input, authority);
  const rows: Array<Record<string, any>> = [];
  const authorization: Array<Record<string, any>> = [];
  for (const patientId of input.patientIds) {
    const row = byId.get(patientId);
    if (!row) continue;
    if (AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
      rows.push(row);
      authorization.push({ patient_id: row.id, basis: 'agency_wide' });
      continue;
    }
    if (isPatientCreator(row, authority)) {
      rows.push(row);
      authorization.push({ patient_id: row.id, basis: 'patient_creator' });
      continue;
    }
    const exact = await loadExactAssignment(entities, row.id, authority);
    if (!exact || exact.status !== 'active') continue;
    rows.push(row);
    authorization.push({
      patient_id: row.id,
      basis: 'care_team_assignment',
      assignment: assignmentAuthoritySnapshot(exact),
    });
  }
  return { rows, authorization };
}

async function loadPatients(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  return input.mode === 'page'
    ? loadPage(entities, input, authority)
    : loadIdBatch(entities, input, authority);
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
    requireCursorAuthority(input.cursor, input, initialAuthority);
    const entities = base44.asServiceRole.entities;
    const initialResult = await loadPatients(entities, input, initialAuthority);
    const initialRowsSnapshot = patientRowsSnapshot(initialResult.rows);
    const initialAuthorizationSnapshot = initialResult.authorization;

    const finalAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(finalAuthority, input.purpose);
    requireCursorAuthority(input.cursor, input, finalAuthority);
    const finalResult = await loadPatients(entities, input, finalAuthority);
    if (
      !sameValue(patientRowsSnapshot(finalResult.rows), initialRowsSnapshot)
      || !sameValue(finalResult.authorization, initialAuthorizationSnapshot)
    ) {
      throw new PublicError(409, 'Patient read authority changed during request');
    }

    const visibleRows = input.mode === 'page'
      ? finalResult.rows.slice(0, input.pageSize)
      : finalResult.rows;
    const response: Record<string, any> = {
      success: true,
      mode: input.mode,
      purpose: input.purpose,
      patients: visibleRows.map((row) => pickFields(row, PURPOSE_FIELDS[input.purpose])),
      scope: {
        agency_id: finalAuthority.agencyId,
        membership_id: finalAuthority.membership?.id ?? null,
        membership_version: finalAuthority.membership?.version ?? null,
        tenant_role: finalAuthority.tenantRole,
      },
    };
    if (input.mode === 'page') {
      const hasMore = finalResult.rows.length > input.pageSize;
      const nextAfterId = hasMore ? visibleRows[visibleRows.length - 1]?.id : null;
      if (hasMore && !exactIdentifier(nextAfterId)) {
        throw new PublicError(409, 'Patient page is ambiguous');
      }
      response.page = {
        page_size: input.pageSize,
        sort: PAGE_SORT,
        after_id: input.cursor?.after_id ?? null,
        has_more: hasMore,
        next_cursor: hasMore
          ? pageCursorContext(input, finalAuthority, nextAfterId)
          : null,
      };
    }
    return Response.json(response);
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never retain provider error objects: they may embed query predicates or PHI.
    console.error('listAuthorizedPatients failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
