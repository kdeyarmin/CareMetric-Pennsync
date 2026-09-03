import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_BATCH_IDS = 25;
const MAX_PAGE_OFFSET = 5_000;
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
const STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const SORTS = new Set(['updated_desc', 'name_asc']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function validScope(scope, agencyId) {
  if (!scope || scope.agency_id !== agencyId) return false;
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

function pagePayload(options) {
  const allowed = ['agencyId', 'mode', 'purpose', 'status', 'sort', 'pageSize', 'offset'];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Patient list contains unsupported options');
  }
  const {
    agencyId,
    purpose,
    status = null,
    sort = 'updated_desc',
    pageSize = 25,
    offset = 0,
  } = options;
  if (status !== null && !STATUSES.has(status)) throw new Error('status is invalid');
  if (!SORTS.has(sort)) throw new Error('sort is invalid');
  if (
    !Number.isSafeInteger(pageSize)
    || pageSize < 1
    || pageSize > PURPOSE_MAX_PAGE_SIZE[purpose]
  ) {
    throw new Error('pageSize is invalid');
  }
  if (
    !Number.isSafeInteger(offset)
    || offset < 0
    || offset > MAX_PAGE_OFFSET
    || offset + pageSize > MAX_PAGE_OFFSET
  ) {
    throw new Error('offset is invalid');
  }
  return {
    agency_id: agencyId,
    mode: 'page',
    purpose,
    ...(status === null ? {} : { status }),
    sort,
    page_size: pageSize,
    offset,
  };
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

function validPage(page, payload) {
  if (!page || typeof page !== 'object' || Array.isArray(page)) return false;
  if (
    page.page_size !== payload.page_size
    || page.offset !== payload.offset
    || typeof page.has_more !== 'boolean'
  ) {
    return false;
  }
  return page.has_more
    ? page.next_offset === payload.offset + payload.page_size
      && page.next_offset + payload.page_size <= MAX_PAGE_OFFSET
    : page.next_offset === null;
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
  if (
    result?.success !== true
    || result.mode !== mode
    || result.purpose !== purpose
    || !validScope(result.scope, agencyId)
    || !validPatients(
      result.patients,
      purpose,
      mode === 'page' ? payload.page_size : options.patientIds.length,
      mode === 'ids' ? options.patientIds : null,
    )
    || (mode === 'page' ? !validPage(result.page, payload) : result.page !== undefined)
  ) {
    throw new Error(result?.error || 'Patient list failed');
  }
  return result;
}
