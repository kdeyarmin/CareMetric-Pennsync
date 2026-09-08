import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BODY_BYTES = 1_000_000;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const VISIT_TYPES = new Set([
  'skilled_nursing',
  'admission',
  'recertification',
  'discharge',
  'routine_visit',
  'prn',
]);
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
const AGENCY_WIDE_VISIT_ROLES = new Set(['agency_admin', 'manager']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);

// Creation accepts scheduling input only. Documentation, workflow status,
// handoff history, and review acknowledgement are server-owned and may change
// only through updateAuthorizedVisit's dedicated, transition-checked actions.
const CLIENT_VISIT_FIELDS = new Set([
  'patient_id',
  'visit_date',
  'visit_time',
  'visit_type',
  'status',
  'start_time',
  'end_time',
  'client_request_id',
  // Optional selector for users with more than one active membership. It is
  // validated against AgencyMembership and then overwritten by the server.
  'agency_id',
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

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, unknown>>;
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

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

async function parseVisitInput(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Visit payload is too large');
  }

  for (const key of Object.keys(body)) {
    if (!CLIENT_VISIT_FIELDS.has(key)) {
      throw new PublicError(400, `Unsupported Visit field: ${key}`);
    }
  }

  const record = body as Record<string, unknown>;
  const patientId = exactIdentifier(record.patient_id);
  const requestedAgencyId = record.agency_id === undefined || record.agency_id === null
    ? null
    : exactIdentifier(record.agency_id);
  const clientRequestId = record.client_request_id === undefined || record.client_request_id === null
    ? null
    : exactIdentifier(record.client_request_id);

  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  if (record.agency_id !== undefined && record.agency_id !== null && !requestedAgencyId) {
    throw new PublicError(400, 'agency_id is invalid');
  }
  if (record.client_request_id !== undefined && record.client_request_id !== null && !clientRequestId) {
    throw new PublicError(400, 'client_request_id is invalid');
  }
  if (!validCalendarDate(record.visit_date)) {
    throw new PublicError(400, 'visit_date is invalid');
  }
  if (typeof record.visit_type !== 'string' || !VISIT_TYPES.has(record.visit_type)) {
    throw new PublicError(400, 'visit_type is invalid');
  }
  if (record.status !== undefined && record.status !== 'scheduled') {
    throw new PublicError(400, 'New Visits must start as scheduled');
  }

  const visitFields: Record<string, unknown> = {
    patient_id: patientId,
    visit_date: record.visit_date,
    visit_type: record.visit_type,
    status: 'scheduled',
    emr_handoff_status: 'not_started',
    emr_handoff_history: [],
    documentation_review_ack: null,
  };
  for (const key of ['visit_time', 'start_time', 'end_time']) {
    const value = record[key];
    if (value !== undefined && value !== null) visitFields[key] = value;
  }
  if (clientRequestId) visitFields.client_request_id = clientRequestId;
  return { patientId, requestedAgencyId, clientRequestId, visitFields };
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function resolveActiveMembership(
  rawRows: Array<Record<string, unknown>>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }

  // Query all lifecycle states and then exact-check the pair in memory. A stale
  // revoked/suspended duplicate must make the authority ambiguous; filtering
  // only status=active would hide that duplicate and silently authorize.
  const exactRows = rawRows.filter(
    (row) => row?.user_id === userId && row?.agency_id === agencyId,
  );
  if (exactRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (exactRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');

  const row = exactRows[0];
  const id = exactIdentifier(row.id);
  const membershipKey = exactIdentifier(row.membership_key);
  const storedEmail = normalizeEmail(row.user_email_normalized);
  const createdBy = exactIdentifier(row.created_by_user_id);
  const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
  const transitionEmail = normalizeEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !id
    || !membershipKey
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
    || membershipKey !== `${agencyId}:${userId}`
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 1
    || !createdBy
    || !transitionedBy
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
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  return row;
}

async function loadExactActivePatient(
  entities: Record<string, any>,
  patientId: string,
  requestedAgencyId: string | null,
) {
  const rawRows = requireRows(
    await entities.Patient.filter({ id: patientId }, undefined, EXACT_ROW_LIMIT),
    'Patient.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rawRows.some((row) => row?.id !== patientId)) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  const exactRows = rawRows.filter((row) => row?.id === patientId);
  if (exactRows.length === 0) throw new PublicError(403, 'Patient is unavailable');
  if (exactRows.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  const patient = exactRows[0];
  const agencyId = exactIdentifier(patient.agency_id);
  if (!agencyId || patient.status !== 'active') {
    throw new PublicError(403, 'Patient is unavailable');
  }
  if (requestedAgencyId && requestedAgencyId !== agencyId) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  return { patient, agencyId };
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rawRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rawRows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  const exactRows = rawRows.filter((row) => row?.id === agencyId);
  if (exactRows.length !== 1) throw new PublicError(403, 'Agency is unavailable');
  if (!ENABLED_AGENCY_STATUSES.has(String(exactRows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exactRows[0];
}

async function loadExactActiveMembership(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rawMemberships.some((row) => row?.user_id !== userId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  return resolveActiveMembership(rawMemberships, userId, normalizedEmail, agencyId);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function validateAssignmentIntegrity(
  row: Record<string, unknown>,
  patientId: string,
  agencyId: string,
  userId: string,
  normalizedEmail: string,
  membership: Record<string, unknown>,
) {
  const key = assignmentKey(agencyId, patientId, userId);
  const id = exactIdentifier(row.id);
  const userEmail = normalizeEmail(row.user_email_normalized);
  const creatorEmail = normalizeEmail(row.created_by_user_email_normalized);
  const transitionEmail = normalizeEmail(row.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row.last_transition_request_id);
  const status = typeof row.status === 'string' ? row.status : '';
  const action = typeof row.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== agencyId
    || row.patient_id !== patientId
    || row.user_id !== userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== normalizedEmail
    || row.assignee_membership_id !== membership.id
    || row.assignee_membership_version_at_enablement !== membership.version
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || Number(row.assignee_membership_version_at_enablement) < 1
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
    || row.last_transition_request_key !== transitionRequestKey(key, requestId)
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 1
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  return row;
}

async function loadExactActiveAssignment(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
  userId: string,
  normalizedEmail: string,
  membership: Record<string, unknown>,
) {
  const key = assignmentKey(agencyId, patientId, userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      { assignment_key: key, agency_id: agencyId, patient_id: patientId, user_id: userId },
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
  if (rows.length === 0) throw new PublicError(403, 'Patient is unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  const assignment = validateAssignmentIntegrity(
    rows[0],
    patientId,
    agencyId,
    userId,
    normalizedEmail,
    membership,
  );
  if (assignment.status !== 'active') throw new PublicError(403, 'Patient is unavailable');
  return assignment;
}

function visitCreateAccessSnapshot(
  membership: Record<string, unknown>,
  assignment: Record<string, unknown> | null,
) {
  return {
    membership: {
      id: membership.id,
      membership_key: membership.membership_key,
      status: membership.status,
      tenant_role: membership.tenant_role,
      version: membership.version,
      last_transition_at: membership.last_transition_at,
    },
    basis: assignment ? 'care_team_assignment' : 'agency_wide',
    assignment: assignment ? {
      id: assignment.id,
      assignment_key: assignment.assignment_key,
      status: assignment.status,
      version: assignment.version,
      assignee_membership_id: assignment.assignee_membership_id,
      assignee_membership_version_at_enablement:
        assignment.assignee_membership_version_at_enablement,
      last_transition_at: assignment.last_transition_at,
    } : null,
  };
}

async function loadVisitCreateAccess(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
  userId: string,
  normalizedEmail: string,
  membership: Record<string, unknown>,
  expectedSnapshot: Record<string, unknown> | null = null,
) {
  const tenantRole = String(membership.tenant_role || '');
  let assignment: Record<string, unknown> | null = null;
  if (AGENCY_WIDE_VISIT_ROLES.has(tenantRole)) {
    assignment = null;
  } else if (tenantRole === 'clinician') {
    assignment = await loadExactActiveAssignment(
      entities,
      patientId,
      agencyId,
      userId,
      normalizedEmail,
      membership,
    );
  } else {
    throw new PublicError(403, 'Tenant role cannot create Visits');
  }
  const snapshot = visitCreateAccessSnapshot(membership, assignment);
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Visit create authority changed during request');
  }
  return snapshot;
}

function narrowVisit(row: Record<string, unknown>) {
  return {
    id: row.id,
    patient_id: row.patient_id,
    agency_id: row.agency_id,
    created_by_user_id: row.created_by_user_id,
    created_by_user_email_normalized: row.created_by_user_email_normalized,
    visit_date: row.visit_date,
    visit_time: row.visit_time || null,
    visit_type: row.visit_type,
    status: row.status || 'scheduled',
    client_request_id: row.client_request_id || null,
  };
}

function visitMatchesAuthority(
  row: Record<string, unknown>,
  { patientId, agencyId, userId, normalizedEmail }:
  { patientId: string; agencyId: string; userId: string; normalizedEmail: string },
) {
  return !!exactIdentifier(row.id)
    && row.patient_id === patientId
    && row.agency_id === agencyId
    && row.created_by_user_id === userId
    && row.created_by_user_email_normalized === normalizedEmail
    && normalizeEmail(row.created_by_user_email_normalized) === normalizedEmail;
}

async function removeCreatedVisit(
  entities: Record<string, any>,
  visitId: string,
) {
  await entities.Visit.delete(visitId);
  const remaining = requireRows(
    await entities.Visit.filter({ id: visitId }, undefined, EXACT_ROW_LIMIT),
    'Visit.filter',
  );
  if (
    remaining.length >= EXACT_ROW_LIMIT
    || remaining.some((row) => row?.id !== visitId)
    || remaining.length !== 0
  ) {
    throw new Error('Visit create compensation failed verification');
  }
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user) || user?.disabled === true) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const userId = exactIdentifier(user.id);
    const normalizedEmail = normalizeEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input = await parseVisitInput(req);
    const entities = base44.asServiceRole.entities;
    const { agencyId } = await loadExactActivePatient(
      entities,
      input.patientId,
      input.requestedAgencyId,
    );
    await loadExactEnabledAgency(entities, agencyId);
    const membership = await loadExactActiveMembership(
      entities,
      userId,
      normalizedEmail,
      agencyId,
    );
    const initialAccess = await loadVisitCreateAccess(
      entities,
      input.patientId,
      agencyId,
      userId,
      normalizedEmail,
      membership,
    );

    const authority = {
      patientId: input.patientId,
      agencyId,
      userId,
      normalizedEmail,
    };

    if (input.clientRequestId) {
      const replayQuery = {
        client_request_id: input.clientRequestId,
        agency_id: agencyId,
        created_by_user_id: userId,
      };
      const rawExisting = requireRows(
        await entities.Visit.filter(
          replayQuery,
          '-created_date',
          EXACT_ROW_LIMIT,
        ),
        'Visit.filter',
      );
      if (rawExisting.length >= EXACT_ROW_LIMIT) {
        throw new PublicError(409, 'client_request_id is ambiguous');
      }
      if (rawExisting.some((row) => (
        row?.client_request_id !== input.clientRequestId
        || row?.agency_id !== agencyId
        || row?.created_by_user_id !== userId
      ))) {
        throw new PublicError(409, 'client_request_id query scope could not be verified');
      }
      if (rawExisting.length > 1) throw new PublicError(409, 'client_request_id is ambiguous');
      if (rawExisting.length === 1) {
        const existing = rawExisting[0];
        if (
          !visitMatchesAuthority(existing, authority)
          || Object.entries(input.visitFields).some(
            ([field, value]) => !sameValue(existing[field], value),
          )
        ) {
          throw new PublicError(409, 'client_request_id conflicts with another visit');
        }
        await loadExactActivePatient(
          entities,
          input.patientId,
          agencyId,
        );
        await loadExactEnabledAgency(entities, agencyId);
        const replayMembership = await loadExactActiveMembership(
          entities,
          userId,
          normalizedEmail,
          agencyId,
        );
        await loadVisitCreateAccess(
          entities,
          input.patientId,
          agencyId,
          userId,
          normalizedEmail,
          replayMembership,
          initialAccess,
        );
        return Response.json({ created: false, visit: narrowVisit(existing) });
      }
    }

    // Re-resolve immediately before the privileged write so a membership that
    // was suspended/revoked during input and replay checks is observed. Base44
    // does not expose a cross-entity transaction here, so a residual race still
    // exists between this final proof and Visit.create; post-create authority
    // reconciliation below fails closed and removes a mismatched row.
    await loadExactActivePatient(
      entities,
      input.patientId,
      agencyId,
    );
    await loadExactEnabledAgency(entities, agencyId);
    const recheckedMembership = await loadExactActiveMembership(
      entities,
      userId,
      normalizedEmail,
      agencyId,
    );
    await loadVisitCreateAccess(
      entities,
      input.patientId,
      agencyId,
      userId,
      normalizedEmail,
      recheckedMembership,
      initialAccess,
    );

    const created = await entities.Visit.create({
      ...input.visitFields,
      patient_id: input.patientId,
      agency_id: agencyId,
      created_by_user_id: userId,
      created_by_user_email_normalized: normalizedEmail,
      created_by: normalizedEmail,
    });
    const createdId = exactIdentifier(created?.id);
    if (!createdId) throw new Error('Visit.create returned no exact id');

    const rawCreated = requireRows(
      await entities.Visit.filter({ id: createdId }, undefined, EXACT_ROW_LIMIT),
      'Visit.filter',
    );
    if (rawCreated.length >= EXACT_ROW_LIMIT || rawCreated.some((row) => row?.id !== createdId)) {
      await removeCreatedVisit(entities, createdId);
      throw new Error('Visit post-create query scope could not be verified');
    }
    const exactCreated = rawCreated.filter((row) => row?.id === createdId);
    if (
      exactCreated.length !== 1
      || !visitMatchesAuthority(exactCreated[0], authority)
      || Object.entries(input.visitFields).some(
        ([field, value]) => !sameValue(exactCreated[0][field], value),
      )
    ) {
      await removeCreatedVisit(entities, createdId);
      throw new Error('Visit fields failed post-create verification');
    }

    try {
      await loadExactActivePatient(
        entities,
        input.patientId,
        agencyId,
      );
      await loadExactEnabledAgency(entities, agencyId);
      const postCreateMembership = await loadExactActiveMembership(
        entities,
        userId,
        normalizedEmail,
        agencyId,
      );
      await loadVisitCreateAccess(
        entities,
        input.patientId,
        agencyId,
        userId,
        normalizedEmail,
        postCreateMembership,
        initialAccess,
      );
    } catch (error) {
      await removeCreatedVisit(entities, createdId);
      throw error;
    }

    return Response.json({ created: true, visit: narrowVisit(exactCreated[0]) });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('createAuthorizedVisit failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});