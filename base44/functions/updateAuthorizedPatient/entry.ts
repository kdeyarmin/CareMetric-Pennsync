import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Finite, tenant-authorized Patient mutation broker.
 *
 * Browser callers choose a workflow action; they never submit an arbitrary
 * Patient patch. Tenant, creator/provenance, care-team, merge/archive, sample,
 * idempotency/import, automation-claim, and derived fields are not accepted as
 * caller-controlled Patient data.
 */

const MAX_BODY_BYTES = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_TEXT_LENGTH = 20_000;
const MAX_COLLECTION_ITEMS = 200;
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
const LIVE_PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const CLINICALLY_ACTIVE_PATIENT_STATUSES = new Set(['active', 'hospitalized']);
const CARE_TYPES = new Set(['home_health', 'hospice']);
const ADMISSION_SOURCES = new Set([
  'home',
  'hospital',
  'skilled_nursing_facility',
  'rehab',
  'other',
]);
const DISCHARGE_DISPOSITIONS = new Set([
  'home',
  'hospital',
  'skilled_nursing_facility',
  'deceased',
  'other',
]);
const STATUS_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  active: new Set(['hospitalized', 'discharged']),
  hospitalized: new Set(['active', 'discharged']),
  discharged: new Set(),
};

// <<<BEGIN PATIENT MUTATION ACTION POLICY>>>
const ACTION_FIELD_NAMES: Record<string, readonly string[]> = {
  edit_demographics: [
    'first_name',
    'middle_name',
    'last_name',
    'date_of_birth',
    'medical_record_number',
    'address',
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
  edit_clinical_profile: [
    'secondary_diagnoses',
    'allergies',
    'past_medical_history',
    'goals_of_care',
  ],
  edit_care_episode: [
    'admission_date',
    'admission_source',
    'care_type',
  ],
  edit_insurance: ['payor'],
  set_primary_diagnosis: ['primary_diagnosis'],
  change_status: ['status', 'discharge_date', 'discharge_disposition'],
};

const ACTION_ROLE_NAMES: Record<string, readonly string[]> = {
  edit_demographics: ['agency_admin', 'manager', 'office_staff', 'clinician'],
  edit_clinical_profile: ['agency_admin', 'manager', 'clinician'],
  edit_care_episode: ['agency_admin', 'manager', 'clinician'],
  edit_insurance: ['agency_admin', 'manager', 'office_staff'],
  set_primary_diagnosis: ['agency_admin', 'manager', 'clinician'],
  change_status: ['agency_admin', 'manager', 'clinician'],
};
// <<<END PATIENT MUTATION ACTION POLICY>>>

const ACTIONS = new Set(Object.keys(ACTION_FIELD_NAMES));
const ACTION_CANONICAL_ORDER = Object.freeze(Object.keys(ACTION_FIELD_NAMES));
const ACTION_FIELDS = Object.fromEntries(
  Object.entries(ACTION_FIELD_NAMES).map(([action, fields]) => [action, new Set(fields)]),
) as Record<string, Set<string>>;
const ACTION_ROLES = Object.fromEntries(
  Object.entries(ACTION_ROLE_NAMES).map(([action, roles]) => [action, new Set(roles)]),
) as Record<string, Set<string>>;
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const OFFICE_AGENCY_WIDE_ACTIONS = new Set([
  'edit_demographics',
  'edit_insurance',
]);
const CLINICAL_ACTIONS = new Set([
  'edit_clinical_profile',
  'set_primary_diagnosis',
]);

const SIMPLE_ARRAY_FIELDS = new Set([
  'secondary_diagnoses',
  'past_medical_history',
  'goals_of_care',
]);
const EMAIL_FIELDS = new Set(['email', 'physician_email', 'caregiver_email']);
const DATE_FIELDS = new Set(['date_of_birth', 'admission_date', 'discharge_date']);

// These fields are verified before and after every service-role update. None is
// accepted inside an action's changes object. status is handled only by the
// reviewed change_status transition workflow; archive remains unavailable.
const PROTECTED_PATIENT_FIELDS = [
  'id',
  'agency_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'patient_creation_key',
  'is_sample',
  'is_archived',
  'assigned_nurses',
  'merged_into_id',
  'merged_at',
  'merged_by',
  'risk_predict_claimed_by',
  'care_plans_gen_claimed_by',
  'care_plan_monitor_claimed_by',
  'compliance_monitor_claimed_by',
  'active_alerts',
  'enhanced_notes_history',
  'risk_assessment',
  'validation_overrides',
  'clinical_notes',
  'data_completeness_score',
  'missing_critical_fields',
];

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
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
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
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
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

function validateChangeValue(field: string, value: unknown) {
  if (JSON.stringify(value).length > MAX_BODY_BYTES) {
    throw new PublicError(413, `${field} is too large`);
  }

  if (field === 'first_name' || field === 'last_name' || field === 'primary_diagnosis') {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 1_000) {
      throw new PublicError(400, `${field} is invalid`);
    }
    return value.trim();
  }
  if (field === 'medical_record_number') {
    if (typeof value !== 'string' || value.trim().length > 200) {
      throw new PublicError(400, 'medical_record_number is invalid');
    }
    return value.trim();
  }
  if (EMAIL_FIELDS.has(field)) {
    if (value === '') return '';
    const email = canonicalEmail(value);
    if (!email) throw new PublicError(400, `${field} is invalid`);
    return email;
  }
  if (DATE_FIELDS.has(field)) {
    if (value === '') return '';
    if (!validCalendarDate(value)) throw new PublicError(400, `${field} is invalid`);
    return value;
  }
  if (field === 'care_type') {
    if (typeof value !== 'string' || !CARE_TYPES.has(value)) {
      throw new PublicError(400, 'care_type is invalid');
    }
    return value;
  }
  if (field === 'admission_source') {
    if (typeof value !== 'string' || !ADMISSION_SOURCES.has(value)) {
      throw new PublicError(400, 'admission_source is invalid');
    }
    return value;
  }
  if (field === 'discharge_disposition') {
    if (typeof value !== 'string' || !DISCHARGE_DISPOSITIONS.has(value)) {
      throw new PublicError(400, 'discharge_disposition is invalid');
    }
    return value;
  }
  if (field === 'status') {
    if (typeof value !== 'string' || !LIVE_PATIENT_STATUSES.has(value)) {
      throw new PublicError(400, 'status is invalid');
    }
    return value;
  }
  if (SIMPLE_ARRAY_FIELDS.has(field)) {
    if (
      !Array.isArray(value)
      || value.length > MAX_COLLECTION_ITEMS
      || value.some((item) => typeof item !== 'string' || item.length > 1_000)
    ) {
      throw new PublicError(400, `${field} is invalid`);
    }
    return value;
  }
  if (typeof value !== 'string' || value.length > MAX_TEXT_LENGTH) {
    throw new PublicError(400, `${field} is invalid`);
  }
  return value;
}

async function parseRequest(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  if (JSON.stringify(body).length > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Patient mutation request is too large');
  }

  const record = body as Record<string, unknown>;
  const patientId = exactIdentifier(record.patient_id);
  const requestedAgencyId = record.agency_id === undefined || record.agency_id === null
    ? null
    : exactIdentifier(record.agency_id);
  if (!patientId) throw new PublicError(400, 'patient_id is invalid');
  if (record.agency_id !== undefined && record.agency_id !== null && !requestedAgencyId) {
    throw new PublicError(400, 'agency_id is invalid');
  }
  if (!validInstant(record.expected_updated_date)) {
    throw new PublicError(400, 'expected_updated_date is required');
  }

  const allowedTopLevel = new Set([
    'patient_id',
    'agency_id',
    'expected_updated_date',
    'actions',
  ]);
  if (Object.keys(record).some((key) => !allowedTopLevel.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }

  if (
    !Array.isArray(record.actions)
    || record.actions.length === 0
    || record.actions.length > ACTIONS.size
  ) {
    throw new PublicError(400, 'actions must be a nonempty finite action array');
  }
  const seenActions = new Set<string>();
  const actionEntries: Array<{ action: string; changes: Record<string, unknown> }> = [];
  for (const rawEntry of record.actions) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new PublicError(400, 'Each Patient action must be an object');
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      Object.keys(entry).length !== 2
      || !Object.hasOwn(entry, 'action')
      || !Object.hasOwn(entry, 'changes')
    ) {
      throw new PublicError(400, 'Each Patient action must contain only action and changes');
    }
    const action = typeof entry.action === 'string' ? entry.action : '';
    if (
      !ACTIONS.has(action)
      || !Object.hasOwn(ACTION_FIELD_NAMES, action)
      || seenActions.has(action)
    ) {
      throw new PublicError(400, 'Invalid or duplicate Patient action');
    }
    if (!entry.changes || typeof entry.changes !== 'object' || Array.isArray(entry.changes)) {
      throw new PublicError(400, 'changes must be an object');
    }
    const rawChanges = entry.changes as Record<string, unknown>;
    const allowedFields = ACTION_FIELDS[action];
    const keys = Object.keys(rawChanges);
    if (keys.length === 0 || keys.some((key) => !allowedFields.has(key))) {
      throw new PublicError(400, 'Action contains unsupported Patient fields');
    }
    const changes: Record<string, unknown> = {};
    for (const [field, value] of Object.entries(rawChanges)) {
      changes[field] = validateChangeValue(field, value);
    }
    if (action === 'set_primary_diagnosis' && !Object.hasOwn(changes, 'primary_diagnosis')) {
      throw new PublicError(400, 'primary_diagnosis is required');
    }
    if (action === 'change_status' && !Object.hasOwn(changes, 'status')) {
      throw new PublicError(400, 'status is required');
    }
    seenActions.add(action);
    actionEntries.push({ action, changes });
  }
  actionEntries.sort(
    (left, right) => ACTION_CANONICAL_ORDER.indexOf(left.action)
      - ACTION_CANONICAL_ORDER.indexOf(right.action),
  );

  return {
    actionEntries,
    actionNames: actionEntries.map((entry) => entry.action),
    patientId,
    requestedAgencyId,
    expectedUpdatedDate: record.expected_updated_date as string,
  };
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

function selectActiveMembership(
  memberships: Array<Record<string, any>>,
  requestedAgencyId: string | null,
) {
  const active = memberships.filter((row) => row.status === 'active');
  if (active.length === 0) throw new PublicError(403, 'No active tenant membership');
  if (!requestedAgencyId && active.length !== 1) {
    throw new PublicError(409, 'agency_id is required for multiple memberships');
  }
  const selected = requestedAgencyId
    ? active.find((row) => row.agency_id === requestedAgencyId)
    : active[0];
  if (!selected) throw new PublicError(403, 'No active membership for agency');
  return selected;
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

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

async function loadMutationAuthority(
  entities: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  requestedAgencyId: string | null,
  actionNames: string[],
  expected: Record<string, any> | null = null,
) {
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
  const membership = selectActiveMembership(memberships, requestedAgencyId);
  const tenantRole = String(membership.tenant_role || '');
  if (actionNames.some((action) => !ACTION_ROLES[action]?.has(tenantRole))) {
    throw new PublicError(403, 'Tenant role cannot perform this Patient action');
  }
  const agencyId = exactIdentifier(membership.agency_id);
  if (!agencyId) throw new PublicError(409, 'Tenant membership integrity check failed');
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    membership: pickFields(membership, MEMBERSHIP_AUTHORITY_FIELDS),
    agency: { id: agency.id, status: agency.status },
  };
  if (expected && !sameValue(snapshot, expected)) {
    throw new PublicError(409, 'Patient mutation authority changed during request');
  }
  return { membership, agencyId, snapshot };
}

function canonicalAssignments(value: unknown) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 500) {
    throw new PublicError(409, 'Patient care-team integrity check failed');
  }
  return value.map((email) => {
    const normalized = canonicalEmail(email);
    if (!normalized || email !== normalized) {
      throw new PublicError(409, 'Patient care-team integrity check failed');
    }
    return normalized;
  });
}

function validatePatientRecord(
  row: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const creatorEmail = canonicalEmail(row.created_by_user_email_normalized);
  const platformCreatorEmail = canonicalEmail(row.created_by);
  const status = typeof row.status === 'string' ? row.status : '';
  const assignments = canonicalAssignments(row.assigned_nurses);
  const hasAdmissionDate = row.admission_date !== undefined && row.admission_date !== null
    && row.admission_date !== '';
  const hasAdmissionSource = row.admission_source !== undefined && row.admission_source !== null
    && row.admission_source !== '';
  const hasDischargeDate = row.discharge_date !== undefined && row.discharge_date !== null
    && row.discharge_date !== '';
  const hasDischargeDisposition = row.discharge_disposition !== undefined
    && row.discharge_disposition !== null
    && row.discharge_disposition !== '';
  if (
    row.id !== patientId
    || row.agency_id !== agencyId
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || platformCreatorEmail !== creatorEmail
    || row.is_sample !== false
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Patient authority integrity check failed');
  }
  if (
    row.is_archived !== false
    || !LIVE_PATIENT_STATUSES.has(status)
    || status === 'merged'
  ) {
    throw new PublicError(403, 'Patient is unavailable');
  }
  if (
    (row.care_type !== undefined && row.care_type !== null && !CARE_TYPES.has(row.care_type))
    || (hasAdmissionDate && !validCalendarDate(row.admission_date))
    || (hasAdmissionSource && !ADMISSION_SOURCES.has(row.admission_source))
    || (hasDischargeDate && !validCalendarDate(row.discharge_date))
    || (hasDischargeDisposition && !DISCHARGE_DISPOSITIONS.has(row.discharge_disposition))
    || (hasAdmissionDate && hasDischargeDate && row.discharge_date < row.admission_date)
    || (status === 'discharged' && (!hasDischargeDate || !hasDischargeDisposition))
    || (status !== 'discharged' && (hasDischargeDate || hasDischargeDisposition))
  ) {
    throw new PublicError(409, 'Patient lifecycle integrity check failed');
  }
  return { row, assignments };
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  const exact = rows.filter(
    (row) => row?.id === patientId && row?.agency_id === agencyId,
  );
  if (exact.length === 0) throw new PublicError(403, 'Patient is unavailable');
  if (exact.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
  return validatePatientRecord(exact[0], patientId, agencyId);
}

function requirePatientActionAccess(
  patient: Record<string, any>,
  assignments: string[],
  membership: Record<string, any>,
  userId: string,
  normalizedEmail: string,
  action: string,
) {
  const tenantRole = String(membership.tenant_role || '');
  if (CLINICAL_ACTIONS.has(action) && !CLINICALLY_ACTIVE_PATIENT_STATUSES.has(patient.status)) {
    throw new PublicError(409, 'Patient is not in a clinically active state');
  }
  if (AGENCY_WIDE_ROLES.has(tenantRole)) return;
  if (tenantRole === 'office_staff' && OFFICE_AGENCY_WIDE_ACTIONS.has(action)) return;

  const isCreator = patient.created_by_user_id === userId
    && patient.created_by_user_email_normalized === normalizedEmail;
  const isAssigned = assignments.includes(normalizedEmail);
  if (!isCreator && !isAssigned) throw new PublicError(403, 'Patient is unavailable');
}

function patientAuthoritySnapshot(row: Record<string, any>) {
  return {
    ...pickFields(row, PROTECTED_PATIENT_FIELDS),
    status: row.status,
    is_archived: row.is_archived,
    updated_date: row.updated_date,
  };
}

function assertExpectedPatient(
  current: Record<string, any>,
  expectedSnapshot: Record<string, any>,
) {
  if (!sameValue(patientAuthoritySnapshot(current), expectedSnapshot)) {
    throw new PublicError(409, 'Patient changed during request');
  }
}

function requireActionLifecycle(
  action: string,
  changes: Record<string, unknown>,
  patient: Record<string, any>,
) {
  if (action === 'edit_care_episode') {
    if (patient.status === 'discharged') {
      throw new PublicError(409, 'Discharged care episodes require a dedicated correction workflow');
    }
    if (Object.hasOwn(changes, 'care_type') && patient.status !== 'active') {
      throw new PublicError(409, 'care_type can change only while the Patient is active');
    }
    const admissionDate = Object.hasOwn(changes, 'admission_date')
      ? changes.admission_date
      : patient.admission_date;
    if (
      admissionDate
      && patient.discharge_date
      && validCalendarDate(admissionDate)
      && validCalendarDate(patient.discharge_date)
      && String(admissionDate) > patient.discharge_date
    ) {
      throw new PublicError(409, 'admission_date cannot follow discharge_date');
    }
  }

  if (action === 'change_status') {
    const target = String(changes.status || '');
    const current = String(patient.status || '');
    const hasDischargeDate = Object.hasOwn(changes, 'discharge_date');
    const hasDisposition = Object.hasOwn(changes, 'discharge_disposition');
    if (target === current) {
      if (hasDischargeDate || hasDisposition) {
        throw new PublicError(400, 'Discharge fields require a discharge transition');
      }
      return;
    }
    if (!STATUS_TRANSITIONS[current]?.has(target)) {
      throw new PublicError(409, 'Patient status transition is not allowed');
    }
    if (target === 'discharged') {
      if (
        !hasDischargeDate
        || !hasDisposition
        || !validCalendarDate(changes.discharge_date)
        || typeof changes.discharge_disposition !== 'string'
        || !changes.discharge_disposition.trim()
      ) {
        throw new PublicError(
          400,
          'discharge_date and discharge_disposition are required for discharge',
        );
      }
      if (
        validCalendarDate(patient.admission_date)
        && String(changes.discharge_date) < patient.admission_date
      ) {
        throw new PublicError(409, 'discharge_date cannot precede admission_date');
      }
    } else if (hasDischargeDate || hasDisposition) {
      throw new PublicError(400, 'Discharge fields are accepted only when discharging');
    }
  }
}

async function requireAgencyMrnAvailable(
  entities: Record<string, any>,
  agencyId: string,
  patientId: string,
  medicalRecordNumber: unknown,
) {
  if (typeof medicalRecordNumber !== 'string' || !medicalRecordNumber) return;
  const rows = requireRows(
    await entities.Patient.filter(
      { agency_id: agencyId, medical_record_number: medicalRecordNumber },
      '-updated_date',
      EXACT_ROW_LIMIT,
    ),
    'Patient.filter MRN collision check',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'medical_record_number is ambiguous');
  }
  const exact = rows.filter((row) => (
    row?.agency_id === agencyId
    && row?.medical_record_number === medicalRecordNumber
  ));
  if (exact.some((row) => row?.id !== patientId)) {
    throw new PublicError(409, 'medical_record_number already belongs to another Patient');
  }
  if (exact.filter((row) => row?.id === patientId).length > 1) {
    throw new PublicError(409, 'Patient is ambiguous');
  }
}

function buildMutation(
  action: string,
  changes: Record<string, unknown>,
  patient: Record<string, any>,
) {
  const mutation: Record<string, unknown> = {};

  if (
    action === 'edit_demographics'
    || action === 'edit_clinical_profile'
    || action === 'edit_care_episode'
    || action === 'edit_insurance'
  ) {
    for (const field of ACTION_FIELD_NAMES[action]) {
      if (Object.hasOwn(changes, field)) mutation[field] = changes[field];
    }
  } else if (action === 'set_primary_diagnosis') {
    mutation.primary_diagnosis = changes.primary_diagnosis;
  } else if (action === 'change_status') {
    for (const field of ACTION_FIELD_NAMES.change_status) {
      if (Object.hasOwn(changes, field)) mutation[field] = changes[field];
    }
  }

  for (const [field, value] of Object.entries(mutation)) {
    if (sameValue(patient[field], value)) delete mutation[field];
  }
  return mutation;
}

function buildBatchMutation(
  actionEntries: Array<{ action: string; changes: Record<string, unknown> }>,
  patient: Record<string, any>,
) {
  const mutation: Record<string, unknown> = {};
  for (const entry of actionEntries) {
    const actionMutation = buildMutation(entry.action, entry.changes, patient);
    for (const [field, value] of Object.entries(actionMutation)) {
      if (Object.hasOwn(mutation, field)) {
        throw new Error(`Patient action policy assigns a field more than once: ${field}`);
      }
      mutation[field] = value;
    }
  }
  return mutation;
}

function verifyReadback(
  before: Record<string, any>,
  after: Record<string, any>,
  mutation: Record<string, unknown>,
  action: string,
) {
  for (const field of PROTECTED_PATIENT_FIELDS) {
    if (!sameValue(after[field], before[field])) {
      throw new Error(`Patient protected field changed during ${action}: ${field}`);
    }
  }
  const expectedStatus = Object.hasOwn(mutation, 'status') ? mutation.status : before.status;
  if (after.status !== expectedStatus || after.is_archived !== before.is_archived) {
    throw new Error('Patient lifecycle readback did not match the authorized mutation');
  }
  if (
    Object.keys(mutation).length > 0
    && Date.parse(String(after.updated_date || '')) <= Date.parse(String(before.updated_date || ''))
  ) {
    throw new Error('Patient updated_date did not advance after mutation');
  }
  if (Object.keys(mutation).length === 0 && after.updated_date !== before.updated_date) {
    throw new PublicError(409, 'Patient changed during no-op validation');
  }
  for (const [field, value] of Object.entries(mutation)) {
    if (!sameValue(after[field], value)) {
      throw new Error(`Patient mutation readback did not match field: ${field}`);
    }
  }
}

function narrowPatient(row: Record<string, any>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    first_name: row.first_name,
    middle_name: row.middle_name || '',
    last_name: row.last_name,
    status: row.status,
    care_type: row.care_type || 'home_health',
    is_archived: row.is_archived === true,
    updated_date: row.updated_date,
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

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (
      user.is_active === false
      || user.disabled === true
      || user.is_service === true
      || user.is_verified === false
    ) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const userId = exactIdentifier(user.id);
    const normalizedEmail = canonicalEmail(user.email);
    if (!userId || !normalizedEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const input = await parseRequest(req);
    const entities = base44.asServiceRole.entities;
    const initialAuthority = await loadMutationAuthority(
      entities,
      userId,
      normalizedEmail,
      input.requestedAgencyId,
      input.actionNames,
    );
    const initialPatientResult = await loadExactPatient(
      entities,
      input.patientId,
      initialAuthority.agencyId,
    );
    const initialPatient = initialPatientResult.row;
    if (initialPatient.updated_date !== input.expectedUpdatedDate) {
      throw new PublicError(409, 'Patient changed; reload before retrying');
    }
    for (const entry of input.actionEntries) {
      requirePatientActionAccess(
        initialPatient,
        initialPatientResult.assignments,
        initialAuthority.membership,
        userId,
        normalizedEmail,
        entry.action,
      );
      requireActionLifecycle(entry.action, entry.changes, initialPatient);
    }
    const demographicsAction = input.actionEntries.find(
      (entry) => entry.action === 'edit_demographics',
    );
    const requestedMrn = demographicsAction
      && Object.hasOwn(demographicsAction.changes, 'medical_record_number')
      ? demographicsAction.changes.medical_record_number
      : null;
    if (requestedMrn !== null && requestedMrn !== initialPatient.medical_record_number) {
      await requireAgencyMrnAvailable(
        entities,
        initialAuthority.agencyId,
        input.patientId,
        requestedMrn,
      );
    }
    const initialPatientSnapshot = patientAuthoritySnapshot(initialPatient);

    // Exact re-reads immediately before the service-role write reduce the
    // membership/patient TOCTOU window. Base44 exposes no cross-entity
    // transaction or compare-and-swap here, so post-write checks also fail
    // closed if authority or protected fields changed across the residual race.
    const prePatientResult = await loadExactPatient(
      entities,
      input.patientId,
      initialAuthority.agencyId,
    );
    assertExpectedPatient(prePatientResult.row, initialPatientSnapshot);
    for (const entry of input.actionEntries) {
      requireActionLifecycle(entry.action, entry.changes, prePatientResult.row);
    }
    if (requestedMrn !== null && requestedMrn !== prePatientResult.row.medical_record_number) {
      await requireAgencyMrnAvailable(
        entities,
        initialAuthority.agencyId,
        input.patientId,
        requestedMrn,
      );
    }

    const preAuthority = await loadMutationAuthority(
      entities,
      userId,
      normalizedEmail,
      initialAuthority.agencyId,
      input.actionNames,
      initialAuthority.snapshot,
    );
    for (const entry of input.actionEntries) {
      requirePatientActionAccess(
        prePatientResult.row,
        prePatientResult.assignments,
        preAuthority.membership,
        userId,
        normalizedEmail,
        entry.action,
      );
    }

    const mutation = buildBatchMutation(
      input.actionEntries,
      prePatientResult.row,
    );
    // Validate the final, combined lifecycle before the single write. Checking
    // actions independently is insufficient: admission and discharge changes
    // can each be valid against the old row but invalid when applied together.
    validatePatientRecord(
      { ...prePatientResult.row, ...mutation },
      input.patientId,
      initialAuthority.agencyId,
    );
    const changedFields = Object.keys(mutation).sort();

    if (changedFields.length > 0) {
      await entities.Patient.update(input.patientId, mutation);
    }

    const readbackResult = await loadExactPatient(
      entities,
      input.patientId,
      initialAuthority.agencyId,
    );
    verifyReadback(
      prePatientResult.row,
      readbackResult.row,
      mutation,
      input.actionNames.join(','),
    );
    if (Object.hasOwn(mutation, 'medical_record_number')) {
      await requireAgencyMrnAvailable(
        entities,
        initialAuthority.agencyId,
        input.patientId,
        mutation.medical_record_number,
      );
    }

    const postAuthority = await loadMutationAuthority(
      entities,
      userId,
      normalizedEmail,
      initialAuthority.agencyId,
      input.actionNames,
      initialAuthority.snapshot,
    );
    for (const entry of input.actionEntries) {
      requirePatientActionAccess(
        readbackResult.row,
        readbackResult.assignments,
        postAuthority.membership,
        userId,
        normalizedEmail,
        entry.action,
      );
    }

    return Response.json({
      success: true,
      updated: changedFields.length > 0,
      action: input.actionNames.length === 1 ? input.actionNames[0] : 'batch',
      actions: input.actionNames,
      changed_fields: changedFields,
      patient: narrowPatient(readbackResult.row),
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error('updateAuthorizedPatient failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
