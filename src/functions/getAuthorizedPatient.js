import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
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

function validProjection(patient, patientId, purpose) {
  if (!patient || typeof patient !== 'object' || Array.isArray(patient)) return false;
  if (patient.id !== patientId) return false;
  const fields = PURPOSE_FIELDS[purpose];
  return Object.keys(patient).every((field) => fields.has(field));
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
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');

  const response = await base44.functions.invoke('getAuthorizedPatient', {
    agency_id: agencyId,
    patient_id: patientId,
    purpose,
  });
  const result = response?.data ?? response;
  if (
    result?.success !== true
    || result.purpose !== purpose
    || !validProjection(result.patient, patientId, purpose)
    || !validScope(result.scope, agencyId)
  ) {
    throw new Error(result?.error || 'Patient lookup failed');
  }
  return result;
}
