import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BATCH_IDS = 25;
const CURSOR_VERSION = 1;
const PAGE_SORT = 'id_asc';
const PURPOSE_FIELDS = Object.freeze({
  roster: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'medical_record_number',
    'status', 'care_type', 'admission_date', 'primary_diagnosis', 'updated_date',
  ]),
  contact: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'phone', 'email',
    'emergency_contact_name', 'emergency_contact_phone',
    'emergency_contact_relationship', 'physician_name', 'physician_phone',
    'physician_email', 'caregiver_name', 'caregiver_email', 'caregiver_phone',
  ]),
  identity_match: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'phone', 'address',
  ]),
});
const PURPOSE_MAX_PAGE_SIZE = Object.freeze({
  roster: 50,
  contact: 25,
  identity_match: 25,
});
const PURPOSE_ROLES = Object.freeze({
  roster: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  contact: new Set(['platform_owner', 'agency_admin', 'manager']),
  identity_match: new Set(['platform_owner', 'agency_admin', 'manager']),
});
const STATUSES = new Set(['active', 'hospitalized', 'discharged']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function validScope(scope, agencyId, purpose) {
  if (
    !exactKeys(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    || scope.agency_id !== agencyId
    || !PURPOSE_ROLES[purpose]?.has(scope.tenant_role)
  ) {
    return false;
  }
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null && scope.membership_version === null;
  }
  return exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1
    && typeof scope.tenant_role === 'string'
    && scope.tenant_role.length > 0;
}

function validPatients(patients, purpose, maximumCount, requestedIds = null) {
  if (!Array.isArray(patients) || patients.length > maximumCount) return false;
  const fields = PURPOSE_FIELDS[purpose];
  const allowedIds = requestedIds ? new Set(requestedIds) : null;
  const seen = new Set();
  return patients.every((patient) => {
    if (!patient || typeof patient !== 'object' || Array.isArray(patient)) return false;
    if (!exactIdentifier(patient.id) || seen.has(patient.id)) return false;
    if (allowedIds && !allowedIds.has(patient.id)) return false;
    if (Object.keys(patient).some((field) => !fields.has(field))) return false;
    seen.add(patient.id);
    return true;
  });
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

const CURSOR_KEYS = [
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

// This is an unsigned context echo, not a credential or integrity token.
// The backend re-authorizes every call and derives the tenant query itself.
function validCursor(cursor, context, scope = null) {
  if (!exactKeys(cursor, CURSOR_KEYS)) return false;
  if (
    cursor.version !== CURSOR_VERSION
    || !exactIdentifier(cursor.after_id)
    || cursor.agency_id !== context.agency_id
    || cursor.purpose !== context.purpose
    || cursor.status !== context.status
    || cursor.sort !== PAGE_SORT
    || cursor.page_size !== context.page_size
    || !exactIdentifier(cursor.subject_user_id)
    || (context.subject_user_id !== undefined
      && cursor.subject_user_id !== context.subject_user_id)
    || !PURPOSE_ROLES[context.purpose]?.has(cursor.tenant_role)
  ) {
    return false;
  }
  const ownerCursor = cursor.tenant_role === 'platform_owner';
  if (ownerCursor
    ? cursor.membership_id !== null || cursor.membership_version !== null
    : !exactIdentifier(cursor.membership_id)
      || !Number.isSafeInteger(cursor.membership_version)
      || cursor.membership_version < 1) {
    return false;
  }
  return scope === null || (
    cursor.membership_id === scope.membership_id
    && cursor.membership_version === scope.membership_version
    && cursor.tenant_role === scope.tenant_role
  );
}

function pagePayload(options) {
  const allowed = ['agencyId', 'mode', 'purpose', 'status', 'sort', 'pageSize', 'cursor'];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Patient list contains unsupported options');
  }
  const {
    agencyId,
    purpose,
    status = null,
    sort = PAGE_SORT,
    pageSize = 25,
    cursor = null,
  } = options;
  if (status !== null && !STATUSES.has(status)) throw new Error('status is invalid');
  if (sort !== PAGE_SORT) throw new Error('sort is invalid');
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > PURPOSE_MAX_PAGE_SIZE[purpose]
  ) {
    throw new Error('pageSize is invalid');
  }
  const payload = {
    agency_id: agencyId,
    mode: 'page',
    purpose,
    ...(status === null ? {} : { status }),
    sort,
    page_size: pageSize,
    cursor,
  };
  const cursorContext = { ...payload, status };
  if (cursor !== null && !validCursor(cursor, cursorContext)) {
    throw new Error('cursor is invalid');
  }
  return payload;
}

function idsPayload(options) {
  const allowed = ['agencyId', 'mode', 'purpose', 'patientIds'];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Patient id list contains unsupported options');
  }
  const { agencyId, purpose, patientIds } = options;
  if (
    !Array.isArray(patientIds)
    || patientIds.length < 1
    || patientIds.length > MAX_BATCH_IDS
    || patientIds.some((id) => !exactIdentifier(id))
    || new Set(patientIds).size !== patientIds.length
  ) {
    throw new Error('patientIds is invalid');
  }
  return {
    agency_id: agencyId,
    mode: 'ids',
    purpose,
    patient_ids: patientIds,
  };
}

function validPage(page, payload, patients, scope) {
  if (!exactKeys(page, ['page_size', 'sort', 'after_id', 'has_more', 'next_cursor'])) {
    return false;
  }
  const status = payload.status ?? null;
  const expectedAfterId = payload.cursor?.after_id ?? null;
  if (
    page.page_size !== payload.page_size
    || page.sort !== PAGE_SORT
    || page.after_id !== expectedAfterId
    || typeof page.has_more !== 'boolean'
  ) {
    return false;
  }
  if (!page.has_more) return page.next_cursor === null;
  if (patients.length === 0 || page.next_cursor?.after_id !== patients[patients.length - 1].id) {
    return false;
  }
  return validCursor(page.next_cursor, {
    agency_id: payload.agency_id,
    purpose: payload.purpose,
    status,
    sort: PAGE_SORT,
    page_size: payload.page_size,
    ...(payload.cursor
      ? { subject_user_id: payload.cursor.subject_user_id }
      : {}),
  }, scope);
}

export async function listAuthorizedPatients(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Patient list options must be an object');
  }
  const { agencyId, mode, purpose } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (mode !== 'page' && mode !== 'ids') throw new Error('mode is required');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');

  const payload = mode === 'page' ? pagePayload(options) : idsPayload(options);
  const response = await base44.functions.invoke('listAuthorizedPatients', payload);
  const result = response?.data ?? response;
  const resultKeys = mode === 'page'
    ? ['success', 'mode', 'purpose', 'patients', 'scope', 'page']
    : ['success', 'mode', 'purpose', 'patients', 'scope'];
  if (
    !exactKeys(result, resultKeys)
    || result.success !== true
    || result.mode !== mode
    || result.purpose !== purpose
    || !validScope(result.scope, agencyId, purpose)
    || !validPatients(
      result.patients,
      purpose,
      mode === 'page' ? payload.page_size : options.patientIds.length,
      mode === 'ids' ? options.patientIds : null,
    )
    || (mode === 'page'
      ? !validPage(result.page, payload, result.patients, result.scope)
      : result.page !== undefined)
  ) {
    throw new Error(result?.error || 'Patient list failed');
  }
  return result;
}
