import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/**
 * Source-only care-team assignment lifecycle.
 *
 * This broker is intentionally unwired. It establishes a service-owned,
 * immutable User-id relation without trusting Patient.assigned_nurses,
 * ProviderPatientAssignment, or custom User tenant claims. Assignment alone
 * never chooses a Patient projection; future read brokers must also enforce
 * their finite purpose/role policy and revalidate the current membership.
 */

// HARD RELEASE GATE: Base44 currently exposes no documented atomic
// create-if-absent/unique constraint for assignment_key and no multi-entity
// transaction spanning membership, Agency, Patient, and assignment authority.
// Keep every assignment mutation unavailable until those hosted guarantees and
// the authenticated concurrency matrix are proved. Tests explicitly opt into
// the dormant transition implementation; runtime configuration cannot enable it.
const CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED = false;

const ACTIONS = new Set(['inspect', 'grant', 'activate', 'suspend', 'revoke']);
const MUTATION_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const ENABLING_ACTIONS = new Set(['grant', 'activate']);
const TRANSITION_ACTIONS = new Set(['activate', 'suspend', 'revoke']);
const MANAGER_ROLES = new Set(['agency_admin', 'manager']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const AGENCY_STATUSES = new Set(['active', 'trial', 'suspended', 'cancelled']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const VISIBLE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_REASON_LENGTH = 500;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;

const MEMBERSHIP_SNAPSHOT_FIELDS = [
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

const PATIENT_SNAPSHOT_FIELDS = [
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

const ASSIGNMENT_SNAPSHOT_FIELDS = [
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
  if (!reason || reason.length > MAX_REASON_LENGTH || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    return null;
  }
  return reason;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
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

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function isProtectedPlatformOwner(user: Record<string, any>) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && user.role === 'admin'
    && canonicalEmail(user.email) === configuredEmail;
}

function isProtectedOwnerIdentity(user: Record<string, any>) {
  return isProtectedOwnerEmail(user.email);
}

function isProtectedOwnerEmail(value: unknown) {
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail && canonicalEmail(value) === configuredEmail;
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

  const input = body as Record<string, unknown>;
  const action = typeof input.action === 'string' ? input.action : '';
  if (!ACTIONS.has(action)) throw new PublicError(400, 'action is invalid');

  const agencyId = exactIdentifier(input.agency_id);
  const patientId = exactIdentifier(input.patient_id);
  const targetUserId = exactIdentifier(input.target_user_id);
  if (!agencyId || !patientId || !targetUserId) {
    throw new PublicError(400, 'Exact agency_id, patient_id, and target_user_id are required');
  }

  if (action === 'inspect') {
    const allowed = new Set(['action', 'agency_id', 'patient_id', 'target_user_id']);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new PublicError(400, 'Request contains unsupported fields');
    }
    return {
      action,
      agencyId,
      patientId,
      targetUserId,
      clientRequestId: null,
      expectedVersion: null,
      reason: null,
    };
  }

  const clientRequestId = exactIdentifier(input.client_request_id);
  const reason = boundedReason(input.reason);
  if (!clientRequestId) throw new PublicError(400, 'client_request_id is invalid');
  if (!reason) throw new PublicError(400, 'A bounded transition reason is required');

  if (action === 'grant') {
    const allowed = new Set([
      'action',
      'agency_id',
      'patient_id',
      'target_user_id',
      'client_request_id',
      'reason',
    ]);
    if (Object.keys(input).some((key) => !allowed.has(key))) {
      throw new PublicError(400, 'Request contains unsupported fields');
    }
    return {
      action,
      agencyId,
      patientId,
      targetUserId,
      clientRequestId,
      expectedVersion: null,
      reason,
    };
  }

  const allowed = new Set([
    'action',
    'agency_id',
    'patient_id',
    'target_user_id',
    'client_request_id',
    'expected_version',
    'reason',
  ]);
  if (Object.keys(input).some((key) => !allowed.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  if (!Number.isSafeInteger(input.expected_version) || Number(input.expected_version) < 1) {
    throw new PublicError(400, 'expected_version is required for assignment transitions');
  }
  return {
    action,
    agencyId,
    patientId,
    targetUserId,
    clientRequestId,
    expectedVersion: Number(input.expected_version),
    reason,
  };
}

function validateUserIdentity(user: Record<string, any>, label: string) {
  const id = exactIdentifier(user?.id);
  const email = canonicalEmail(user?.email);
  if (!id || !email) throw new PublicError(409, `${label} identity is invalid`);
  return { id, email };
}

function requireEnabledUser(user: Record<string, any>, label: string) {
  if (
    user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(409, `${label} is unavailable`);
  }
}

async function loadExactUser(entities: Record<string, any>, userId: string) {
  const rows = requireRows(
    await entities.User.filter({ id: userId }, '-created_date', EXACT_ROW_LIMIT),
    'User.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Target User is ambiguous');
  if (rows.some((row) => row?.id !== userId)) {
    throw new PublicError(409, 'Target User query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Target User not found');
  if (rows.length !== 1) throw new PublicError(409, 'Target User is ambiguous');
  validateUserIdentity(rows[0], 'Target User');
  return rows[0];
}

async function loadExactAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, '-created_date', EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Agency not found');
  if (rows.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (!AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(409, 'Agency integrity check failed');
  }
  return rows[0];
}

function validateMembership(
  row: Record<string, any>,
  agencyId: string,
  userId: string,
) {
  const id = exactIdentifier(row?.id);
  const storedEmail = canonicalEmail(row?.user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const status = typeof row?.status === 'string' ? row.status : '';
  if (
    !id
    || row.agency_id !== agencyId
    || row.user_id !== userId
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
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
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return row;
}

async function loadExactMembership(
  entities: Record<string, any>,
  agencyId: string,
  userId: string,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Tenant membership is ambiguous');
  return rows.length === 1 ? validateMembership(rows[0], agencyId, userId) : null;
}

function validatePatient(row: Record<string, any>, agencyId: string, patientId: string) {
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row?.created_by);
  const clientRequestId = exactIdentifier(row?.client_request_id);
  if (
    row?.id !== patientId
    || row?.agency_id !== agencyId
    || !exactIdentifier(row?.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.created_by !== creatorEmail
    || !clientRequestId
    || row.patient_creation_key
      !== `${agencyId}:${row.created_by_user_id}:${clientRequestId}`
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
  agencyId: string,
  patientId: string,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      PATIENT_SNAPSHOT_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => row?.id !== patientId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Patient not found');
  if (rows.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  return validatePatient(rows[0], agencyId, patientId);
}

function validateAssignment(
  row: Record<string, any>,
  agencyId: string,
  patientId: string,
  userId: string,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(agencyId, patientId, userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== agencyId
    || row.patient_id !== patientId
    || row.user_id !== userId
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
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !MUTATION_ACTIONS.has(String(row.last_transition_action || ''))
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
  agencyId: string,
  patientId: string,
  userId: string,
) {
  const key = assignmentKey(agencyId, patientId, userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: agencyId,
        patient_id: patientId,
        user_id: userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  return rows.length === 1
    ? validateAssignment(rows[0], agencyId, patientId, userId)
    : null;
}

function callerSnapshot(
  user: Record<string, any>,
  identity: Record<string, string>,
  agency: Record<string, any>,
  membership: Record<string, any> | null,
  isPlatformOwner: boolean,
) {
  return {
    user: {
      id: identity.id,
      email: identity.email,
      role: user.role ?? null,
      is_active: user.is_active ?? null,
      disabled: user.disabled ?? null,
      is_service: user.is_service ?? null,
      is_verified: user.is_verified ?? null,
    },
    agency: { id: agency.id, status: agency.status },
    membership: membership ? pickFields(membership, MEMBERSHIP_SNAPSHOT_FIELDS) : null,
    is_platform_owner: isPlatformOwner,
  };
}

async function loadCallerAuthority(
  base44: Record<string, any>,
  entities: Record<string, any>,
  agencyId: string,
  expected: Record<string, any> | null = null,
  observedUser: Record<string, any> | null = null,
) {
  const user = observedUser ?? await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (
    user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(403, 'Forbidden');
  }
  const identity = validateUserIdentity(user, 'Caller');
  const isPlatformOwner = isProtectedPlatformOwner(user);
  let membership: Record<string, any> | null = null;
  let tenantRole = 'platform_owner';
  if (!isPlatformOwner) {
    membership = await loadExactMembership(entities, agencyId, identity.id);
    if (
      !membership
      || membership.status !== 'active'
      || membership.user_email_normalized !== identity.email
      || !MANAGER_ROLES.has(String(membership.tenant_role || ''))
    ) {
      throw new PublicError(403, 'Active agency manager membership is required');
    }
    tenantRole = String(membership.tenant_role);
  }
  // Resolve the Agency only after a non-owner has proved an exact membership,
  // so arbitrary agency ids cannot be used as an existence oracle.
  const agency = await loadExactAgency(entities, agencyId);
  const snapshot = callerSnapshot(
    user,
    identity,
    agency,
    membership,
    isPlatformOwner,
  );
  if (expected && !sameValue(snapshot, expected)) {
    throw new PublicError(409, 'Care-team management authority changed during request');
  }
  return {
    user,
    userId: identity.id,
    userEmail: identity.email,
    agency,
    membership,
    tenantRole,
    isPlatformOwner,
    snapshot,
  };
}

function targetSnapshot(user: Record<string, any>, membership: Record<string, any>) {
  const identity = validateUserIdentity(user, 'Target User');
  return {
    user: {
      id: identity.id,
      email: identity.email,
      role: user.role ?? null,
      is_active: user.is_active ?? null,
      disabled: user.disabled ?? null,
      is_service: user.is_service ?? null,
      is_verified: user.is_verified ?? null,
    },
    membership: pickFields(membership, MEMBERSHIP_SNAPSHOT_FIELDS),
  };
}

async function loadTargetAuthority(
  entities: Record<string, any>,
  agencyId: string,
  userId: string,
  enabling: boolean,
  expected: Record<string, any> | null = null,
) {
  const user = await loadExactUser(entities, userId);
  const identity = validateUserIdentity(user, 'Target User');
  const membership = await loadExactMembership(entities, agencyId, userId);
  if (!membership) throw new PublicError(409, 'Target User has no membership in this Agency');
  if (enabling) {
    requireEnabledUser(user, 'Target User');
    if (
      membership.status !== 'active'
      || membership.user_email_normalized !== identity.email
    ) {
      throw new PublicError(409, 'Target User requires an exact active AgencyMembership');
    }
  }
  const snapshot = targetSnapshot(user, membership);
  if (expected && !sameValue(snapshot, expected)) {
    throw new PublicError(409, 'Target User authority changed during request');
  }
  return {
    user,
    userId: identity.id,
    userEmail: identity.email,
    membership,
    snapshot,
  };
}

function assignmentSnapshot(row: Record<string, any>) {
  return pickFields(row, ASSIGNMENT_SNAPSHOT_FIELDS);
}

function patientSnapshot(row: Record<string, any>) {
  return pickFields(row, PATIENT_SNAPSHOT_FIELDS);
}

async function recheckContext(
  base44: Record<string, any>,
  entities: Record<string, any>,
  input: Record<string, any>,
  expectedCaller: Record<string, any>,
  expectedTarget: Record<string, any> | null,
  expectedPatient: Record<string, any> | null,
) {
  const caller = await loadCallerAuthority(
    base44,
    entities,
    input.agencyId,
    expectedCaller,
  );
  let target: Record<string, any> | null = null;
  if (expectedTarget) {
    target = await loadTargetAuthority(
      entities,
      input.agencyId,
      input.targetUserId,
      ENABLING_ACTIONS.has(input.action),
      expectedTarget,
    );
  }
  let patient: Record<string, any> | null = null;
  if (expectedPatient) {
    patient = await loadExactPatient(entities, input.agencyId, input.patientId);
    if (!sameValue(patientSnapshot(patient), expectedPatient)) {
      throw new PublicError(409, 'Patient authority changed during request');
    }
  }
  return { caller, target, patient };
}

function publicAssignment(row: Record<string, any>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    patient_id: row.patient_id,
    user_id: row.user_id,
    status: row.status,
    version: row.version,
    activated_at: row.activated_at,
    suspended_at: row.suspended_at || null,
    revoked_at: row.revoked_at || null,
    last_transition_at: row.last_transition_at,
  };
}

function success(
  row: Record<string, any>,
  action: string,
  idempotent: boolean,
  authority: Record<string, any>,
  status = 200,
) {
  return Response.json({
    success: true,
    action,
    idempotent,
    assignment: publicAssignment(row),
    scope: {
      agency_id: authority.agency.id,
      membership_id: authority.membership?.id ?? null,
      membership_version: authority.membership?.version ?? null,
      tenant_role: authority.tenantRole,
    },
  }, { status });
}

function requireVersionCapacity(row: Record<string, any>) {
  if (row.version >= Number.MAX_SAFE_INTEGER) {
    throw new PublicError(409, 'Care-team assignment version capacity is exhausted');
  }
}

function requireExpectedVersion(row: Record<string, any>, expectedVersion: number | null) {
  if (row.version !== expectedVersion) {
    throw new PublicError(409, 'Care-team assignment changed; reload before retrying');
  }
}

function transitionMetadata(
  key: string,
  requestId: string,
  action: string,
  actorId: string,
  actorEmail: string,
  reason: string,
  now: string,
) {
  return {
    last_transition_by_user_id: actorId,
    last_transition_by_email_normalized: actorEmail,
    last_transition_at: now,
    last_transition_reason: reason,
    last_transition_action: action,
    last_transition_request_id: requestId,
    last_transition_request_key: transitionRequestKey(key, requestId),
  };
}

function exactReplay(
  row: Record<string, any>,
  input: Record<string, any>,
  desiredStatus: string,
  actor: Record<string, any>,
) {
  if (!input.clientRequestId) return false;
  const key = assignmentKey(input.agencyId, input.patientId, input.targetUserId);
  const expectedResultVersion = input.action === 'grant'
    ? 1
    : Number.isSafeInteger(input.expectedVersion)
      ? input.expectedVersion + 1
      : null;
  return Number.isSafeInteger(expectedResultVersion)
    && row.version === expectedResultVersion
    && row.status === desiredStatus
    && row.last_transition_action === input.action
    && row.last_transition_by_user_id === actor.userId
    && row.last_transition_by_email_normalized === actor.userEmail
    && row.last_transition_request_id === input.clientRequestId
    && row.last_transition_request_key === transitionRequestKey(key, input.clientRequestId)
    && row.last_transition_reason === input.reason;
}

async function requireUnchangedAssignment(
  entities: Record<string, any>,
  input: Record<string, any>,
  expected: Record<string, any> | null,
) {
  const current = await loadExactAssignment(
    entities,
    input.agencyId,
    input.patientId,
    input.targetUserId,
  );
  if (expected === null) {
    if (current) throw new PublicError(409, 'A care-team assignment already exists');
    return null;
  }
  if (!current || !sameValue(assignmentSnapshot(current), expected)) {
    throw new PublicError(409, 'Care-team assignment changed during request');
  }
  return current;
}

async function reconcileTransition(
  entities: Record<string, any>,
  input: Record<string, any>,
  before: Record<string, any>,
  expected: Record<string, any>,
) {
  const after = await loadExactAssignment(
    entities,
    input.agencyId,
    input.patientId,
    input.targetUserId,
  );
  if (
    !after
    || after.id !== before.id
    || Object.entries(expected).some(([field, value]) => !sameValue(after[field], value))
  ) {
    throw new PublicError(409, 'Care-team assignment transition could not be reconciled');
  }
  return after;
}

async function applyConditionalTransition(
  entities: Record<string, any>,
  input: Record<string, any>,
  before: Record<string, any>,
  expected: Record<string, any>,
) {
  const { version: expectedVersion, ...setFields } = expected;
  if (expectedVersion !== before.version + 1) {
    throw new Error('Invalid care-team assignment version transition');
  }
  const preimage = assignmentSnapshot(before);
  const query = Object.fromEntries(
    Object.entries(preimage).map(([field, value]) => [
      field,
      value === undefined ? { $exists: false } : value,
    ]),
  );
  const outcome = await entities.PatientCareTeamAssignment.updateMany(query, {
    $set: setFields,
    $inc: { version: 1 },
  });
  if (
    !outcome
    || outcome.success !== true
    || outcome.updated !== 1
    || outcome.has_more !== false
  ) {
    throw new PublicError(409, 'Care-team assignment changed; reload before retrying');
  }
  return reconcileTransition(entities, input, before, {
    ...preimage,
    ...expected,
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
    if (input.action !== 'inspect' && !CARE_TEAM_ASSIGNMENT_MUTATIONS_ENABLED) {
      return Response.json({
        error: 'Care-team assignment mutations are paused',
        code: 'care_team_assignment_mutations_paused',
      }, { status: 503 });
    }

    const base44 = createClientFromRequest(req);
    const observedCaller = await base44.auth.me().catch(() => null);
    if (!observedCaller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (
      observedCaller.is_active === false
      || observedCaller.disabled === true
      || observedCaller.is_service === true
      || observedCaller.is_verified === false
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    try {
      validateUserIdentity(observedCaller, 'Caller');
    } catch {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const entities = base44.asServiceRole.entities;
    const initialCaller = await loadCallerAuthority(
      base44,
      entities,
      input.agencyId,
      null,
      observedCaller,
    );
    if (
      ENABLING_ACTIONS.has(input.action)
      && !ENABLED_AGENCY_STATUSES.has(String(initialCaller.agency.status || ''))
    ) {
      throw new PublicError(409, 'Agency is unavailable for an enabling transition');
    }

    const current = await loadExactAssignment(
      entities,
      input.agencyId,
      input.patientId,
      input.targetUserId,
    );
    if (input.action !== 'grant' && !current) {
      throw new PublicError(404, 'Care-team assignment not found');
    }

    const requiresLiveTarget = input.action === 'inspect'
      || ENABLING_ACTIONS.has(input.action);
    const initialTarget = requiresLiveTarget
      ? await loadTargetAuthority(
        entities,
        input.agencyId,
        input.targetUserId,
        ENABLING_ACTIONS.has(input.action),
      )
      : null;
    if (
      !initialCaller.isPlatformOwner
      && (
        (initialTarget && isProtectedOwnerIdentity(initialTarget.user))
        || (!initialTarget && current && isProtectedOwnerEmail(current.user_email_normalized))
      )
    ) {
      throw new PublicError(403, 'Only the protected platform owner may manage this identity');
    }
    const initialPatient = requiresLiveTarget
      ? await loadExactPatient(entities, input.agencyId, input.patientId)
      : null;
    const initialPatientSnapshot = initialPatient ? patientSnapshot(initialPatient) : null;
    if (
      current
      && initialTarget
      && current.assignee_membership_id !== initialTarget.membership.id
    ) {
      throw new PublicError(409, 'Care-team assignment membership binding is invalid');
    }
    if (
      current
      && initialTarget
      && (input.action === 'inspect' || ENABLING_ACTIONS.has(input.action))
      && (
        current.user_email_normalized !== initialTarget.userEmail
        || current.assignee_membership_version_at_enablement
          > initialTarget.membership.version
      )
    ) {
      throw new PublicError(409, 'Care-team assignment identity binding is stale or invalid');
    }

    if (input.action === 'inspect') {
      if (!current || !initialTarget || !initialPatientSnapshot) {
        throw new Error('Verified inspect context is missing');
      }
      await recheckContext(
        base44,
        entities,
        input,
        initialCaller.snapshot,
        initialTarget?.snapshot ?? null,
        initialPatientSnapshot,
      );
      const finalAssignment = await requireUnchangedAssignment(
        entities,
        input,
        assignmentSnapshot(current),
      );
      if (!finalAssignment) throw new Error('Verified assignment disappeared');
      return success(finalAssignment, input.action, true, initialCaller);
    }

    const reason = input.reason;
    const requestId = input.clientRequestId;
    if (!reason || !requestId) throw new Error('Validated transition metadata is missing');
    const key = assignmentKey(input.agencyId, input.patientId, input.targetUserId);

    if (input.action === 'grant') {
      if (!initialTarget || !initialPatientSnapshot) {
        throw new Error('Verified grant context is missing');
      }
      if (current) {
        if (exactReplay(current, input, 'active', initialCaller)) {
          await recheckContext(
            base44,
            entities,
            input,
            initialCaller.snapshot,
            initialTarget.snapshot,
            initialPatientSnapshot,
          );
          await requireUnchangedAssignment(entities, input, assignmentSnapshot(current));
          return success(current, input.action, true, initialCaller);
        }
        throw new PublicError(409, 'A care-team assignment already exists');
      }

      await recheckContext(
        base44,
        entities,
        input,
        initialCaller.snapshot,
        initialTarget.snapshot,
        initialPatientSnapshot,
      );
      await requireUnchangedAssignment(entities, input, null);
      const now = new Date().toISOString();
      const createPayload = {
        assignment_key: key,
        agency_id: input.agencyId,
        patient_id: input.patientId,
        user_id: input.targetUserId,
        user_email_normalized: initialTarget.userEmail,
        assignee_membership_id: initialTarget.membership.id,
        assignee_membership_version_at_enablement: initialTarget.membership.version,
        status: 'active',
        source: 'manual',
        created_by_user_id: initialCaller.userId,
        created_by_user_email_normalized: initialCaller.userEmail,
        activated_at: now,
        version: 1,
        ...transitionMetadata(
          key,
          requestId,
          input.action,
          initialCaller.userId,
          initialCaller.userEmail,
          reason,
          now,
        ),
      };
      const created = await entities.PatientCareTeamAssignment.create(createPayload);
      const createdId = exactIdentifier(created?.id);
      if (!createdId) throw new Error('PatientCareTeamAssignment.create returned no exact id');
      const reconciled = await loadExactAssignment(
        entities,
        input.agencyId,
        input.patientId,
        input.targetUserId,
      );
      if (
        !reconciled
        || reconciled.id !== createdId
        || Object.entries(createPayload).some(
          ([field, value]) => !sameValue(reconciled[field], value),
        )
        || reconciled.suspended_at != null
        || reconciled.revoked_at != null
        || reconciled.revocation_reason != null
      ) {
        throw new PublicError(409, 'Granted care-team assignment could not be reconciled');
      }
      await recheckContext(
        base44,
        entities,
        input,
        initialCaller.snapshot,
        initialTarget.snapshot,
        initialPatientSnapshot,
      );
      const finalAssignment = await requireUnchangedAssignment(
        entities,
        input,
        assignmentSnapshot(reconciled),
      );
      if (!finalAssignment) throw new Error('Verified assignment disappeared');
      return success(finalAssignment, input.action, false, initialCaller, 201);
    }

    if (!TRANSITION_ACTIONS.has(input.action)) {
      throw new PublicError(400, 'action is invalid');
    }
    if (!current) throw new Error('Verified transition assignment is missing');
    const activationTarget = input.action === 'activate' ? initialTarget : null;
    if (input.action === 'activate' && (!activationTarget || !initialPatientSnapshot)) {
      throw new Error('Verified activation context is missing');
    }

    const desiredStatus = input.action === 'activate'
      ? 'active'
      : input.action === 'suspend'
        ? 'suspended'
        : 'revoked';
    if (exactReplay(current, input, desiredStatus, initialCaller)) {
      await recheckContext(
        base44,
        entities,
        input,
        initialCaller.snapshot,
        initialTarget?.snapshot ?? null,
        initialPatientSnapshot,
      );
      await requireUnchangedAssignment(entities, input, assignmentSnapshot(current));
      return success(current, input.action, true, initialCaller);
    }
    if (current.status === desiredStatus) {
      throw new PublicError(409, 'Care-team assignment is already in the requested state');
    }
    if (current.status === 'revoked') {
      throw new PublicError(409, 'Revoked care-team assignment is terminal');
    }
    if (input.action === 'activate' && current.status !== 'suspended') {
      throw new PublicError(409, 'Care-team assignment cannot be activated from its current state');
    }
    if (input.action === 'suspend' && current.status !== 'active') {
      throw new PublicError(409, 'Care-team assignment cannot be suspended from its current state');
    }

    requireExpectedVersion(current, input.expectedVersion);
    requireVersionCapacity(current);
    const beforeSnapshot = assignmentSnapshot(current);
    await recheckContext(
      base44,
      entities,
      input,
      initialCaller.snapshot,
      initialTarget?.snapshot ?? null,
      initialPatientSnapshot,
    );
    await requireUnchangedAssignment(entities, input, beforeSnapshot);

    const now = new Date().toISOString();
    const expected: Record<string, any> = {
      status: desiredStatus,
      version: current.version + 1,
      ...(activationTarget ? {
        user_email_normalized: activationTarget.userEmail,
        assignee_membership_id: activationTarget.membership.id,
        assignee_membership_version_at_enablement: activationTarget.membership.version,
        activated_at: now,
      } : {}),
      ...(input.action === 'suspend' ? { suspended_at: now } : {}),
      ...(input.action === 'revoke' ? {
        revoked_at: now,
        revocation_reason: reason,
      } : {}),
      ...transitionMetadata(
        key,
        requestId,
        input.action,
        initialCaller.userId,
        initialCaller.userEmail,
        reason,
        now,
      ),
    };
    const reconciled = await applyConditionalTransition(
      entities,
      input,
      current,
      expected,
    );
    await recheckContext(
      base44,
      entities,
      input,
      initialCaller.snapshot,
      initialTarget?.snapshot ?? null,
      initialPatientSnapshot,
    );
    const finalAssignment = await requireUnchangedAssignment(
      entities,
      input,
      assignmentSnapshot(reconciled),
    );
    if (!finalAssignment) throw new Error('Verified assignment disappeared');
    return success(finalAssignment, input.action, false, initialCaller);
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never place request bodies, patient identifiers, emails, or datastore
    // error strings in retained logs.
    console.error('managePatientCareTeamAssignment failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
