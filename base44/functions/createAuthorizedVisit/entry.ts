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
const VISIT_STATUSES = new Set([
  'scheduled',
  'in_progress',
  'completed',
  'pending_review',
  'cancelled',
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

// These are clinical Visit fields accepted from the authenticated caller. All
// tenant/identity stamps and automation claim fields are deliberately absent.
const CLIENT_VISIT_FIELDS = new Set([
  'patient_id',
  'visit_date',
  'visit_time',
  'visit_type',
  'status',
  'start_time',
  'end_time',
  'nurse_notes',
  'audio_url',
  'raw_transcription',
  'vital_signs',
  'family_update_sent',
  'family_update_date',
  'family_update_text',
  'ai_tags',
  'telehealth_room_id',
  'telehealth_room_name',
  'telehealth_call_duration',
  'telehealth_summary',
  'telehealth_shared_files',
  'telehealth_recording_url',
  'client_request_id',
  'compliance_score',
  'compliance_issues',
  'homebound_status_verified',
  'skilled_intervention_documented',
  'homebound_justification',
  'documentation_source',
  'grounding_pending',
  'emr_handoff_status',
  'emr_handoff_history',
  'documentation_review_ack',
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
  if (record.status !== undefined && !VISIT_STATUSES.has(String(record.status))) {
    throw new PublicError(400, 'status is invalid');
  }

  const visitFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'agency_id' || value === undefined || value === null) continue;
    visitFields[key] = value;
  }
  visitFields.patient_id = patientId;
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
  return resolveActiveMembership(rawMemberships, userId, normalizedEmail, agencyId);
}

function requireExistingPatientAccess(
  patient: Record<string, unknown>,
  membership: Record<string, unknown>,
  normalizedEmail: string,
) {
  if (AGENCY_WIDE_VISIT_ROLES.has(String(membership.tenant_role || ''))) return;
  const isOwner = normalizeEmail(patient.created_by) === normalizedEmail;
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.some((email) => normalizeEmail(email) === normalizedEmail);
  if (!isOwner && !isAssigned) {
    throw new PublicError(403, 'Patient is unavailable');
  }
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
    const { patient, agencyId } = await loadExactActivePatient(
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
    requireExistingPatientAccess(patient, membership, normalizedEmail);

    const authority = {
      patientId: input.patientId,
      agencyId,
      userId,
      normalizedEmail,
    };

    if (input.clientRequestId) {
      const rawExisting = requireRows(
        await entities.Visit.filter(
          { client_request_id: input.clientRequestId },
          '-created_date',
          EXACT_ROW_LIMIT,
        ),
        'Visit.filter',
      );
      if (rawExisting.length >= EXACT_ROW_LIMIT) {
        throw new PublicError(409, 'client_request_id is ambiguous');
      }
      const keyedRows = rawExisting.filter(
        (row) => row?.client_request_id === input.clientRequestId,
      );
      if (keyedRows.length > 1) throw new PublicError(409, 'client_request_id is ambiguous');
      if (keyedRows.length === 1) {
        const existing = keyedRows[0];
        if (
          !visitMatchesAuthority(existing, authority)
          || existing.visit_date !== input.visitFields.visit_date
          || existing.visit_type !== input.visitFields.visit_type
        ) {
          throw new PublicError(409, 'client_request_id conflicts with another visit');
        }
        const { patient: replayPatient } = await loadExactActivePatient(
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
        requireExistingPatientAccess(replayPatient, replayMembership, normalizedEmail);
        return Response.json({ created: false, visit: narrowVisit(existing) });
      }
    }

    // Re-resolve immediately before the privileged write so a membership that
    // was suspended/revoked during input and replay checks is observed. Base44
    // does not expose a cross-entity transaction here, so a residual race still
    // exists between this final proof and Visit.create; post-create authority
    // reconciliation below fails closed and removes a mismatched row.
    const { patient: recheckedPatient } = await loadExactActivePatient(
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
    requireExistingPatientAccess(recheckedPatient, recheckedMembership, normalizedEmail);

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
    const exactCreated = rawCreated.filter((row) => row?.id === createdId);
    if (exactCreated.length !== 1 || !visitMatchesAuthority(exactCreated[0], authority)) {
      await entities.Visit.delete(createdId).catch(() => {});
      throw new Error('Visit authority stamps failed post-create verification');
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
