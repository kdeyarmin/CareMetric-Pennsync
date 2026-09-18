// Purpose-specific immutable fictional context. No defaults, inferred names or history.
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const DISPLAY = ['id', 'first_name', 'middle_name', 'last_name'];
const SMART = [...DISPLAY, 'date_of_birth', 'medical_record_number', 'status', 'care_type', 'primary_diagnosis',
  'secondary_diagnoses', 'chronic_conditions', 'past_medical_history', 'current_medications', 'allergies',
  'functional_status', 'wounds', 'enhanced_notes_history', 'clinical_notes', 'updated_date'];
const STRINGS = new Set(['middle_name', 'medical_record_number', 'primary_diagnosis', 'allergies', 'clinical_notes']);
const OBJECT_ARRAYS = new Set(['chronic_conditions', 'current_medications', 'wounds', 'enhanced_notes_history']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const timestamp = value => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/.test(value)
  && !value.startsWith('0000') && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const date = value => typeof value === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)
  && timestamp(`${value}T00:00:00.000Z`);

export function validPatientContext(result, params) {
  const { patient, context, scope, purpose } = result;
  if (!['display', 'smart_note_context'].includes(purpose) || purpose !== params.p_purpose || !object(patient)
    || !['id', 'first_name', 'last_name', ...(purpose === 'smart_note_context' ? ['status', 'updated_date'] : [])]
      .every(key => Object.hasOwn(patient, key))
    || !exact(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    || !['agency_admin', 'clinician'].includes(context.tenant_role)
    || Object.keys(scope).some(key => scope[key] !== context[key]) || scope.agency_id !== params.p_agency_id) return false;
  const allowed = purpose === 'display' ? DISPLAY : SMART;
  return Object.entries(patient).every(([key, value]) => {
    if (!allowed.includes(key)) return false;
    if (key === 'id') return value === params.p_patient_id && typeof value === 'string' && ID.test(value);
    if (key === 'first_name' || key === 'last_name') return typeof value === 'string' && value.length > 0 && value.length <= 200 && value.trim() === value;
    if (STRINGS.has(key)) return typeof value === 'string';
    if (key === 'date_of_birth') return date(value);
    if (key === 'updated_date') return timestamp(value);
    if (key === 'status') return ['active', 'hospitalized', 'discharged'].includes(value);
    if (key === 'care_type') return ['home_health', 'hospice'].includes(value);
    if (key === 'secondary_diagnoses' || key === 'past_medical_history') return Array.isArray(value) && value.every(entry => typeof entry === 'string');
    if (OBJECT_ARRAYS.has(key)) return Array.isArray(value) && value.length <= (key === 'enhanced_notes_history' ? 5000 : 500) && value.every(object);
    if (key === 'functional_status') return object(value);
    return false;
  });
}
