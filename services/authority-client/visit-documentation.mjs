// Finite projection of the immutable synthetic S4 subset. This does not admit
// arbitrary clinical records, broader workflow states, or caller-owned scopes.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VITALS = new Set(['temperature', 'blood_pressure_systolic', 'blood_pressure_diastolic',
  'heart_rate', 'respiratory_rate', 'oxygen_saturation', 'pain_level', 'weight']);
const FIELDS = ['id', 'patient_id', 'visit_date', 'visit_type', 'status', 'nurse_notes',
  'raw_transcription', 'vital_signs', 'documentation_source', 'grounding_pending',
  'emr_handoff_status', 'emr_handoff_history', 'updated_date'];
const SCOPE = ['agency_id', 'membership_id', 'membership_version', 'tenant_role',
  'patient_id', 'access_basis', 'assignment_id', 'assignment_version'];
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length
  && keys.every(key => Object.hasOwn(value, key));
const text = (value, limit) => typeof value === 'string' && value.length <= limit;
const identifier = value => typeof value === 'string' && ID.test(value);
const uuid = value => typeof value === 'string' && UUID.test(value);

export const VISIT_DOCUMENTATION_MAX_BYTES = 2_500_000;

export function validVisitDocumentation(result, params) {
  const { visit, scope, context } = result;
  if (result.purpose !== 'documentation' || !exact(visit, FIELDS) || !exact(scope, SCOPE)
    || !uuid(visit.id) || visit.id !== params.p_visit_id.toLowerCase()
    || !identifier(visit.patient_id) || typeof visit.visit_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(visit.visit_date)) return false;
  const date = new Date(`${visit.visit_date}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== visit.visit_date
    || visit.visit_type !== 'skilled_nursing' || visit.status !== 'completed'
    || !text(visit.nurse_notes, 250_000) || !visit.nurse_notes.trim()
    || !text(visit.raw_transcription, 250_000) || !object(visit.vital_signs)
    || Object.keys(visit.vital_signs).some(key => !VITALS.has(key))
    || Object.values(visit.vital_signs).some(value => typeof value !== 'number'
      || !Number.isFinite(value) || Math.abs(value) > 1_000_000)
    || visit.documentation_source !== 'smart_note' || visit.grounding_pending !== false
    || visit.emr_handoff_status !== 'not_started' || !Array.isArray(visit.emr_handoff_history)
    || visit.emr_handoff_history.length !== 0 || typeof visit.updated_date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(visit.updated_date)
    || !Number.isFinite(Date.parse(visit.updated_date))
    || new Date(visit.updated_date).toISOString() !== visit.updated_date) return false;
  if (scope.patient_id !== visit.patient_id || scope.agency_id !== params.p_agency_id
    || !['agency_id', 'membership_id', 'membership_version', 'tenant_role']
      .every(key => scope[key] === context[key])) return false;
  if (context.tenant_role === 'agency_admin') return scope.access_basis === 'agency_wide'
    && scope.assignment_id === null && scope.assignment_version === null;
  return context.tenant_role === 'clinician' && scope.access_basis === 'care_team_assignment'
    && uuid(scope.assignment_id) && Number.isSafeInteger(scope.assignment_version)
    && scope.assignment_version >= 1;
}
