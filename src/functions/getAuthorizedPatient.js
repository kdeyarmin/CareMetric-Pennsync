import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_NAME_LENGTH = 200;
const PURPOSE_FIELDS = Object.freeze({
  display: new Set([
    'id', 'first_name', 'middle_name', 'last_name',
  ]),
  selector: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'medical_record_number',
    'status', 'care_type', 'primary_diagnosis', 'updated_date',
  ]),
  alert_analysis: new Set([
    'id', 'first_name', 'middle_name', 'last_name',
    'primary_diagnosis', 'secondary_diagnoses', 'care_type', 'status', 'allergies',
  ]),
  education_context: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'primary_diagnosis',
    'physician_name', 'allergies',
  ]),
  visit_summary: new Set([
    'id', 'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'primary_diagnosis',
  ]),
  health_history_write_base: new Set([
    'id', 'past_medical_history', 'past_hospitalizations', 'updated_date',
  ]),
});
export const AUTHORIZED_PATIENT_PURPOSES = Object.freeze(Object.keys(PURPOSE_FIELDS));

export function isAuthorizedPatientPurpose(value) {
  return typeof value === 'string' && Object.hasOwn(PURPOSE_FIELDS, value);
}
const PURPOSE_ROLES = Object.freeze({
  display: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  selector: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  alert_analysis: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  education_context: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  visit_summary: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care']),
  health_history_write_base: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
});
const PURPOSE_REQUIRED_FIELDS = Object.freeze({
  display: ['id', 'first_name', 'last_name'],
  selector: ['id', 'first_name', 'last_name', 'status', 'updated_date'],
  alert_analysis: ['id', 'first_name', 'last_name', 'status'],
  education_context: ['id', 'first_name', 'last_name'],
  visit_summary: ['id', 'first_name', 'last_name'],
  health_history_write_base: ['id', 'updated_date'],
});
const STRING_FIELDS = new Set([
  'middle_name',
  'medical_record_number',
  'primary_diagnosis',
  'allergies',
  'physician_name',
]);
const VISIBLE_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const CARE_TYPES = new Set(['home_health', 'hospice']);
const HOSPITALIZATION_FIELDS = new Set(['date', 'reason', 'hospital', 'length_of_stay']);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
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

function validHospitalizations(value) {
  return Array.isArray(value) && value.every((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
    if (Object.keys(entry).some((field) => !HOSPITALIZATION_FIELDS.has(field))) return false;
    return (entry.date === undefined || validCalendarDate(entry.date))
      && (entry.reason === undefined || typeof entry.reason === 'string')
      && (entry.hospital === undefined || typeof entry.hospital === 'string')
      && (entry.length_of_stay === undefined
        || (typeof entry.length_of_stay === 'number' && Number.isFinite(entry.length_of_stay)));
  });
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validRequiredName(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_NAME_LENGTH
    && value.trim() === value;
}

function validProjectedField(field, value, patientId) {
  if (field === 'id') return value === patientId && exactIdentifier(value);
  if (field === 'first_name' || field === 'last_name') return validRequiredName(value);
  if (field === 'care_type') return CARE_TYPES.has(value);
  if (field === 'date_of_birth') return validCalendarDate(value);
  if (STRING_FIELDS.has(field)) return typeof value === 'string';
  if (field === 'status') return VISIBLE_STATUSES.has(value);
  if (field === 'updated_date') {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }
  if (field === 'secondary_diagnoses' || field === 'past_medical_history') {
    return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
  }
  if (field === 'past_hospitalizations') return validHospitalizations(value);
  return false;
}

function validProjection(patient, patientId, purpose) {
  if (!patient || typeof patient !== 'object' || Array.isArray(patient)) return false;
  const fields = PURPOSE_FIELDS[purpose];
  const required = PURPOSE_REQUIRED_FIELDS[purpose];
  const keys = Object.keys(patient);
  return required.every((field) => Object.hasOwn(patient, field))
    && keys.every((field) => (
      fields.has(field) && validProjectedField(field, patient[field], patientId)
    ));
}

export async function getAuthorizedPatient(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Patient lookup options must be an object');
  }
  if (Object.keys(options).some((key) => !['agencyId', 'patientId', 'purpose'].includes(key))) {
    throw new Error('Patient lookup contains unsupported options');
  }
  const { agencyId, patientId, purpose } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(patientId)) throw new Error('patientId is required');
  if (!isAuthorizedPatientPurpose(purpose)) throw new Error('purpose is required');

  const response = await base44.functions.invoke('getAuthorizedPatient', {
    agency_id: agencyId,
    patient_id: patientId,
    purpose,
  });
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'purpose', 'patient', 'scope'])
    || result.success !== true
    || result.purpose !== purpose
    || !validProjection(result.patient, patientId, purpose)
    || !validScope(result.scope, agencyId, purpose)
  ) {
    throw new Error(result?.error || 'Patient lookup failed');
  }
  return result;
}
