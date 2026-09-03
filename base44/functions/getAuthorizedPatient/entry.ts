import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Exact, purpose-bound Patient read broker.
 *
 * Patient.assigned_nurses remains deliberately untrusted. A non-manager may
 * read a Patient only when immutable creator provenance matches the caller or
 * an exact, active, server-owned PatientCareTeamAssignment binds the caller's
 * current AgencyMembership to that Patient.
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
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager', 'platform_owner']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);

// <<<BEGIN AUTHORIZED PATIENT EXACT PURPOSE POLICY>>>
const PURPOSE_FIELDS: Record<string, readonly string[]> = {
  display: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
  ],
  selector: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'medical_record_number',
    'status',
    'care_type',
    'primary_diagnosis',
    'updated_date',
  ],
  alert_analysis: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'primary_diagnosis',
    'secondary_diagnoses',
    'care_type',
    'status',
    'allergies',
  ],
  education_context: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'primary_diagnosis',
    'physician_name',
    'allergies',
  ],
  visit_summary: [
    'id',
    'first_name',
    'middle_name',
    'last_name',
    'date_of_birth',
    'primary_diagnosis',
  ],
  health_history_write_base: [
    'id',
    'past_medical_history',
    'past_hospitalizations',
    'updated_date',
  ],
};

const PURPOSE_ROLES: Record<string, ReadonlySet<string>> = {
  display: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  selector: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  alert_analysis: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  education_context: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  visit_summary: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  health_history_write_base: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
};
// <<<END AUTHORIZED PATIENT EXACT PURPOSE POLICY>>>

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
  if (Object.keys(record).some((key) => !['agency_id', 'patient_id', 'purpose'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const patientId = exactIdentifier(record.patient_id);
  const purpose = typeof record.purpose === 'string' ? record.purpose : '';
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new PublicError(400, 'purpose is invalid');
  return { agencyId, patientId, purpose };
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
    throw new PublicError(403, 'Tenant role cannot use this Patient read purpose');
  }
}

function patientScope(authority: Record<string, any>) {
  return {
    agency_id: authority.agencyId,
    is_sample: false,
    is_archived: false,
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
    || !exactIdentifier(row.assignee_membership_id)
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

function isPatientCreator(row: Record<string, any>, authority: Record<string, any>) {
  return row.created_by_user_id === authority.userId
    && row.created_by_user_email_normalized === authority.normalizedEmail;
}

function assignmentAuthoritySnapshot(row: Record<string, any>) {
  return pickFields(row, ASSIGNMENT_AUTHORITY_FIELDS);
}

async function loadPatientReadAccess(
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
        throw new PublicError(409, 'Patient read authority changed during request');
      }
      throw new PublicError(404, 'Patient unavailable');
    }
    if (
      !authority.membership
      || assignment.user_email_normalized !== authority.normalizedEmail
      || assignment.assignee_membership_id !== authority.membership.id
      || assignment.assignee_membership_version_at_enablement > authority.membership.version
    ) {
      throw new PublicError(409, 'Care-team assignment binding is invalid');
    }
    snapshot = {
      basis: 'care_team_assignment',
      assignment: assignmentAuthoritySnapshot(assignment),
    };
  }
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Patient read authority changed during request');
  }
  return snapshot;
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
  purpose: string,
) {
  const query = { id: patientId, ...patientScope(authority) };
  const rows = requireRows(
    await entities.Patient.filter(
      query,
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      patientReadFields(purpose),
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  const exact = rows.filter(
    (row) => row?.id === patientId && row?.agency_id === authority.agencyId,
  );
  if (exact.length === 0) throw new PublicError(404, 'Patient unavailable');
  if (exact.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  return validatePatientIntegrity(exact[0], patientId, authority);
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
    const initialPatient = await loadExactPatient(
      entities,
      input.patientId,
      initialAuthority,
      input.purpose,
    );
    const initialPatientSnapshot = patientAuthoritySnapshot(initialPatient);
    const initialAccessSnapshot = await loadPatientReadAccess(
      entities,
      initialPatient,
      initialAuthority,
    );

    const finalAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(finalAuthority, input.purpose);
    const finalPatient = await loadExactPatient(
      entities,
      input.patientId,
      finalAuthority,
      input.purpose,
    );
    if (!sameValue(patientAuthoritySnapshot(finalPatient), initialPatientSnapshot)) {
      throw new PublicError(409, 'Patient read authority changed during request');
    }
    await loadPatientReadAccess(
      entities,
      finalPatient,
      finalAuthority,
      initialAccessSnapshot,
    );

    return Response.json({
      success: true,
      purpose: input.purpose,
      patient: pickFields(finalPatient, PURPOSE_FIELDS[input.purpose]),
      scope: {
        agency_id: finalAuthority.agencyId,
        membership_id: finalAuthority.membership?.id ?? null,
        membership_version: finalAuthority.membership?.version ?? null,
        tenant_role: finalAuthority.tenantRole,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never retain provider error objects: they may embed query predicates or PHI.
    console.error('getAuthorizedPatient failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
