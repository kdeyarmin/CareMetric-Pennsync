import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const MAX_BODY_BYTES = 1_000_000;
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
const PATIENT_CREATE_ROLES = new Set(['agency_admin', 'manager', 'clinician']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const CARE_TYPES = new Set(['home_health', 'hospice']);

// Explicit initial-chart fields. Tenant/provenance, assignment, lifecycle,
// derived metrics, and automation claim fields are deliberately absent.
const CLIENT_PATIENT_FIELDS = new Set([
  'agency_id',
  'client_request_id',
  'first_name',
  'middle_name',
  'last_name',
  'date_of_birth',
  'medical_record_number',
  'address',
  'phone',
  'email',
  'payor',
  'emergency_contact_name',
  'emergency_contact_phone',
  'emergency_contact_relationship',
  'physician_name',
  'physician_phone',
  'physician_email',
  'caregiver_name',
  'caregiver_email',
  'caregiver_phone',
  'primary_diagnosis',
  'secondary_diagnoses',
  'chronic_conditions',
  'past_surgeries',
  'family_medical_history',
  'social_determinants',
  'allergies',
  'current_medications',
  'past_medical_history',
  'past_hospitalizations',
  'baseline_vitals',
  'functional_status',
  'social_history',
  'mental_health',
  'pain_management',
  'wounds',
  'advance_directives',
  'insurance_primary',
  'insurance_secondary',
  'admission_date',
  'admission_source',
  'care_type',
  'status',
  'validation_overrides',
  'clinical_notes',
  'goals_of_care',
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

function boundedName(value: unknown) {
  if (typeof value !== 'string') return null;
  const name = value.trim();
  return name && name.length <= MAX_NAME_LENGTH ? name : null;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, unknown>>;
}

async function parsePatientInput(req: Request) {
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
    throw new PublicError(413, 'Patient payload is too large');
  }

  for (const key of Object.keys(body)) {
    if (!CLIENT_PATIENT_FIELDS.has(key)) {
      throw new PublicError(400, `Unsupported Patient field: ${key}`);
    }
  }

  const record = body as Record<string, unknown>;
  const requestedAgencyId = record.agency_id === undefined || record.agency_id === null
    ? null
    : exactIdentifier(record.agency_id);
  const clientRequestId = exactIdentifier(record.client_request_id);
  const firstName = boundedName(record.first_name);
  const lastName = boundedName(record.last_name);

  if (record.agency_id !== undefined && record.agency_id !== null && !requestedAgencyId) {
    throw new PublicError(400, 'agency_id is invalid');
  }
  if (!clientRequestId) throw new PublicError(400, 'client_request_id is invalid');
  if (!firstName) throw new PublicError(400, 'first_name is invalid');
  if (!lastName) throw new PublicError(400, 'last_name is invalid');
  if (record.status !== undefined && record.status !== 'active') {
    throw new PublicError(400, 'New Patient status must be active');
  }
  if (record.care_type !== undefined && !CARE_TYPES.has(String(record.care_type))) {
    throw new PublicError(400, 'care_type is invalid');
  }
  for (const field of ['date_of_birth', 'admission_date']) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '' && !validCalendarDate(value)) {
      throw new PublicError(400, `${field} is invalid`);
    }
  }
  for (const field of ['email', 'physician_email', 'caregiver_email']) {
    const value = record[field];
    if (value !== undefined && value !== null && value !== '' && !canonicalEmail(value)) {
      throw new PublicError(400, `${field} is invalid`);
    }
  }

  const patientFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === 'agency_id' || key === 'client_request_id' || value === undefined || value === null) continue;
    if (value === '' && ['date_of_birth', 'admission_date', 'email', 'physician_email', 'caregiver_email'].includes(key)) {
      continue;
    }
    patientFields[key] = value;
  }
  patientFields.first_name = firstName;
  patientFields.last_name = lastName;
  if (typeof record.middle_name === 'string') patientFields.middle_name = record.middle_name.trim();
  patientFields.status = 'active';

  return { requestedAgencyId, clientRequestId, patientFields, firstName, lastName };
}

function validateMembershipRows(
  rawRows: Array<Record<string, unknown>>,
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
  const validated: Array<Record<string, unknown>> = [];

  for (const row of candidates) {
    const id = exactIdentifier(row.id);
    const agencyId = exactIdentifier(row.agency_id);
    const membershipKey = exactIdentifier(row.membership_key);
    const storedEmail = canonicalEmail(row.user_email_normalized);
    const status = typeof row.status === 'string' ? row.status : '';
    const tenantRole = typeof row.tenant_role === 'string' ? row.tenant_role : '';
    const createdBy = exactIdentifier(row.created_by_user_id);
    const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
    const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);

    if (
      !id
      || !agencyId
      || !membershipKey
      || !storedEmail
      || row.user_email_normalized !== storedEmail
      || storedEmail !== normalizedEmail
      || membershipKey !== `${agencyId}:${userId}`
      || !MEMBERSHIP_STATUSES.has(status)
      || !TENANT_ROLES.has(tenantRole)
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

function selectMembership(
  rows: Array<Record<string, unknown>>,
  requestedAgencyId: string | null,
) {
  const activeRows = rows.filter((row) => row.status === 'active');
  if (activeRows.length === 0) throw new PublicError(403, 'No active tenant membership');
  if (!requestedAgencyId && activeRows.length !== 1) {
    throw new PublicError(409, 'agency_id is required for multiple memberships');
  }
  const selected = requestedAgencyId
    ? activeRows.find((row) => row.agency_id === requestedAgencyId)
    : activeRows[0];
  if (!selected) throw new PublicError(403, 'No active membership for agency');
  if (!PATIENT_CREATE_ROLES.has(String(selected.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot create patients');
  }
  return selected;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rawRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === agencyId);
  if (exactRows.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (exactRows.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (!ENABLED_AGENCY_STATUSES.has(String(exactRows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exactRows[0];
}

async function loadCreationAuthority(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  requestedAgencyId: string | null,
  expected: Record<string, unknown> | null = null,
) {
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = selectMembership(
    validateMembershipRows(rawMemberships, userId, normalizedEmail),
    requestedAgencyId,
  );
  const agencyId = exactIdentifier(membership.agency_id);
  if (!agencyId) throw new PublicError(409, 'Tenant membership integrity check failed');
  if (expected && (
    membership.id !== expected.id
    || membership.agency_id !== expected.agency_id
    || membership.tenant_role !== expected.tenant_role
    || membership.version !== expected.version
  )) {
    throw new PublicError(409, 'Tenant membership changed during request');
  }
  await loadExactEnabledAgency(entities, agencyId);
  return { membership, agencyId };
}

function narrowPatient(row: Record<string, unknown>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    created_by_user_id: row.created_by_user_id,
    created_by_user_email_normalized: row.created_by_user_email_normalized,
    first_name: row.first_name,
    middle_name: row.middle_name || '',
    last_name: row.last_name,
    medical_record_number: row.medical_record_number || null,
    status: row.status,
    care_type: row.care_type || 'home_health',
    is_sample: row.is_sample === true,
    is_archived: row.is_archived === true,
    client_request_id: row.client_request_id,
  };
}

function patientMatchesAuthority(
  row: Record<string, unknown>,
  authority: {
    agencyId: string;
    userId: string;
    normalizedEmail: string;
    clientRequestId: string;
    creationKey: string;
  },
) {
  return !!exactIdentifier(row.id)
    && row.agency_id === authority.agencyId
    && row.created_by_user_id === authority.userId
    && row.created_by_user_email_normalized === authority.normalizedEmail
    && canonicalEmail(row.created_by_user_email_normalized) === authority.normalizedEmail
    && canonicalEmail(row.created_by) === authority.normalizedEmail
    && row.client_request_id === authority.clientRequestId
    && row.patient_creation_key === authority.creationKey
    && row.status === 'active'
    && row.is_sample === false
    && row.is_archived === false;
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
    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input = await parsePatientInput(req);
    const entities = base44.asServiceRole.entities;
    const initial = await loadCreationAuthority(
      entities,
      userId,
      normalizedEmail,
      input.requestedAgencyId,
    );
    const creationKey = `${initial.agencyId}:${userId}:${input.clientRequestId}`;
    const authority = {
      agencyId: initial.agencyId,
      userId,
      normalizedEmail,
      clientRequestId: input.clientRequestId,
      creationKey,
    };

    const rawExisting = requireRows(
      await entities.Patient.filter(
        { patient_creation_key: creationKey },
        '-created_date',
        EXACT_ROW_LIMIT,
      ),
      'Patient.filter',
    );
    if (rawExisting.length >= EXACT_ROW_LIMIT) {
      throw new PublicError(409, 'Patient creation request is ambiguous');
    }
    const keyedRows = rawExisting.filter((row) => row?.patient_creation_key === creationKey);
    if (keyedRows.length > 1) throw new PublicError(409, 'Patient creation request is ambiguous');
    if (keyedRows.length === 1) {
      const existing = keyedRows[0];
      if (
        !patientMatchesAuthority(existing, authority)
        || existing.first_name !== input.firstName
        || existing.last_name !== input.lastName
      ) {
        throw new PublicError(409, 'client_request_id conflicts with another patient');
      }
      await loadCreationAuthority(
        entities,
        userId,
        normalizedEmail,
        initial.agencyId,
        initial.membership,
      );
      return Response.json({ created: false, patient: narrowPatient(existing) });
    }

    // Re-resolve immediately before the service-role write. Base44 does not
    // expose a cross-entity transaction here, so the post-create proof below
    // removes the just-created row if authority changes across the residual race.
    await loadCreationAuthority(
      entities,
      userId,
      normalizedEmail,
      initial.agencyId,
      initial.membership,
    );

    const created = await entities.Patient.create({
      ...input.patientFields,
      agency_id: initial.agencyId,
      created_by_user_id: userId,
      created_by_user_email_normalized: normalizedEmail,
      created_by: normalizedEmail,
      client_request_id: input.clientRequestId,
      patient_creation_key: creationKey,
      status: 'active',
      is_sample: false,
      is_archived: false,
    });
    const createdId = exactIdentifier(created?.id);
    if (!createdId) throw new Error('Patient.create returned no exact id');

    try {
      await loadCreationAuthority(
        entities,
        userId,
        normalizedEmail,
        initial.agencyId,
        initial.membership,
      );
      const rawCreated = requireRows(
        await entities.Patient.filter({ id: createdId }, undefined, EXACT_ROW_LIMIT),
        'Patient.filter',
      );
      const exactCreated = rawCreated.filter((row) => row?.id === createdId);
      if (exactCreated.length !== 1 || !patientMatchesAuthority(exactCreated[0], authority)) {
        throw new Error('Patient authority stamps failed post-create verification');
      }
      const keyedAfterCreate = requireRows(
        await entities.Patient.filter(
          { patient_creation_key: creationKey },
          '-created_date',
          EXACT_ROW_LIMIT,
        ),
        'Patient.filter',
      ).filter((row) => row?.patient_creation_key === creationKey);
      if (keyedAfterCreate.length !== 1 || keyedAfterCreate[0].id !== createdId) {
        throw new PublicError(409, 'Concurrent Patient creation request detected');
      }
      return Response.json({ created: true, patient: narrowPatient(exactCreated[0]) });
    } catch (error) {
      await entities.Patient.delete(createdId).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('createAuthorizedPatient failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
