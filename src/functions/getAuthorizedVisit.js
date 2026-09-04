import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_NOTE_LENGTH = 250_000;
const MAX_SHORT_TEXT = 20_000;
const VISIT_TYPES = new Set([
  'skilled_nursing', 'admission', 'recertification', 'discharge', 'routine_visit', 'prn',
]);
const VISIT_STATUSES = new Set([
  'scheduled', 'in_progress', 'completed', 'pending_review', 'cancelled',
]);
const DOCUMENTATION_SOURCES = new Set(['smart_note', 'audio', 'manual']);
const HANDOFF_STATUSES = new Set([
  'not_started', 'copied_to_emr', 'reviewed_in_emr', 'signed_in_emr',
]);
const PURPOSE_FIELDS = Object.freeze({
  schedule: new Set([
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'start_time', 'end_time', 'updated_date',
  ]),
  documentation: new Set([
    'id', 'patient_id', 'visit_date', 'visit_time', 'visit_type', 'status',
    'nurse_notes', 'raw_transcription', 'vital_signs', 'documentation_source',
    'grounding_pending', 'updated_date',
  ]),
  compliance_review: new Set([
    'id', 'patient_id', 'visit_date', 'visit_type', 'status', 'compliance_score',
    'compliance_issues', 'homebound_status_verified', 'skilled_intervention_documented',
    'homebound_justification', 'ai_tags', 'emr_handoff_status',
    'documentation_review_ack', 'updated_date',
  ]),
});
const PURPOSE_ROLES = Object.freeze({
  schedule: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  documentation: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  compliance_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
});
const VITAL_FIELDS = new Set([
  'temperature',
  'blood_pressure_systolic',
  'blood_pressure_diastolic',
  'heart_rate',
  'respiratory_rate',
  'oxygen_saturation',
  'pain_level',
  'weight',
]);
const REVIEW_FIELDS = new Set([
  'acknowledged',
  'acknowledged_by',
  'acknowledged_at',
  'note_hash',
  'note_length',
  'ai_assisted',
  'nurse_edited',
  'statement',
  'is_clinical_signature',
]);

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

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validString(value, maximum = MAX_SHORT_TEXT) {
  return typeof value === 'string' && value.length <= maximum;
}

function validStringList(value, maximumItems, maximumLength) {
  return Array.isArray(value)
    && value.length <= maximumItems
    && value.every((entry) => (
      typeof entry === 'string' && entry.length <= maximumLength
    ));
}

function validVitals(value) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && Object.keys(value).every((key) => VITAL_FIELDS.has(key))
    && Object.values(value).every((item) => (
      typeof item === 'number' && Number.isFinite(item) && Math.abs(item) <= 1_000_000
    ));
}

function validReviewAcknowledgement(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (Object.keys(value).some((key) => !REVIEW_FIELDS.has(key))) return false;
  return (value.acknowledged === undefined || typeof value.acknowledged === 'boolean')
    && (value.acknowledged_by === undefined || validString(value.acknowledged_by, 320))
    && (value.acknowledged_at === undefined
      || (typeof value.acknowledged_at === 'string'
        && Number.isFinite(Date.parse(value.acknowledged_at))))
    && (value.note_hash === undefined
      || (typeof value.note_hash === 'string' && /^[a-f0-9]{64}$/.test(value.note_hash)))
    && (value.note_length === undefined
      || (Number.isSafeInteger(value.note_length) && value.note_length >= 0))
    && (value.ai_assisted === undefined || typeof value.ai_assisted === 'boolean')
    && (value.nurse_edited === undefined || typeof value.nurse_edited === 'boolean')
    && (value.statement === undefined || validString(value.statement, 2_000))
    && (value.is_clinical_signature === undefined
      || value.is_clinical_signature === false);
}

function validProjectedField(field, value, visitId) {
  if (field === 'id') return value === visitId && exactIdentifier(value);
  if (field === 'patient_id') return exactIdentifier(value);
  if (field === 'visit_date') return validCalendarDate(value);
  if (field === 'visit_type') return VISIT_TYPES.has(value);
  if (field === 'status') return VISIT_STATUSES.has(value);
  if (field === 'updated_date') {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
  }
  if (['visit_time', 'start_time', 'end_time'].includes(field)) {
    return validString(value, 100);
  }
  if (field === 'nurse_notes' || field === 'raw_transcription') {
    return validString(value, MAX_NOTE_LENGTH);
  }
  if (field === 'homebound_justification') return validString(value);
  if (field === 'vital_signs') return validVitals(value);
  if (field === 'documentation_source') return DOCUMENTATION_SOURCES.has(value);
  if (
    field === 'grounding_pending'
    || field === 'homebound_status_verified'
    || field === 'skilled_intervention_documented'
  ) {
    return typeof value === 'boolean';
  }
  if (field === 'compliance_score') {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
  }
  if (field === 'compliance_issues') return validStringList(value, 100, 2_000);
  if (field === 'ai_tags') return validStringList(value, 64, 128);
  if (field === 'emr_handoff_status') return HANDOFF_STATUSES.has(value);
  if (field === 'documentation_review_ack') return validReviewAcknowledgement(value);
  return false;
}

function validProjection(visit, visitId, purpose) {
  if (!visit || typeof visit !== 'object' || Array.isArray(visit)) return false;
  const fields = PURPOSE_FIELDS[purpose];
  const required = ['id', 'patient_id', 'visit_date', 'visit_type', 'status', 'updated_date'];
  const keys = Object.keys(visit);
  return required.every((field) => Object.hasOwn(visit, field))
    && keys.every((field) => (
      fields.has(field) && validProjectedField(field, visit[field], visitId)
    ));
}

function validScope(scope, agencyId, patientId, purpose) {
  if (
    !exactKeys(scope, [
      'agency_id',
      'membership_id',
      'membership_version',
      'tenant_role',
      'patient_id',
      'access_basis',
      'assignment_id',
      'assignment_version',
    ])
    || scope.agency_id !== agencyId
    || scope.patient_id !== patientId
    || !PURPOSE_ROLES[purpose]?.has(scope.tenant_role)
  ) {
    return false;
  }
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null
      && scope.membership_version === null
      && scope.access_basis === 'agency_wide'
      && scope.assignment_id === null
      && scope.assignment_version === null;
  }
  if (
    !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
  ) {
    return false;
  }
  if (scope.tenant_role === 'clinician') {
    return scope.access_basis === 'care_team_assignment'
      && exactIdentifier(scope.assignment_id)
      && Number.isSafeInteger(scope.assignment_version)
      && scope.assignment_version >= 1;
  }
  return (scope.tenant_role === 'agency_admin' || scope.tenant_role === 'manager')
    && scope.access_basis === 'agency_wide'
    && scope.assignment_id === null
    && scope.assignment_version === null;
}

export async function getAuthorizedVisit(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Visit lookup options must be an object');
  }
  if (Object.keys(options).some((key) => !['agencyId', 'visitId', 'purpose'].includes(key))) {
    throw new Error('Visit lookup contains unsupported options');
  }
  const { agencyId, visitId, purpose } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(visitId)) throw new Error('visitId is required');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');

  const response = await base44.functions.invoke('getAuthorizedVisit', {
    agency_id: agencyId,
    visit_id: visitId,
    purpose,
  });
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'purpose', 'visit', 'scope'])
    || result.success !== true
    || result.purpose !== purpose
    || !validProjection(result.visit, visitId, purpose)
    || !validScope(result.scope, agencyId, result.visit?.patient_id, purpose)
  ) {
    throw new Error(result?.error || 'Visit lookup failed');
  }
  return result;
}
