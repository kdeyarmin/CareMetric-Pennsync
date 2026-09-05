import { base44 } from '@/api/base44Client';

const ACTION_FIELDS = Object.freeze({
  edit_demographics: new Set([
    'first_name', 'middle_name', 'last_name', 'date_of_birth',
    'medical_record_number', 'address', 'phone', 'email',
    'emergency_contact_name', 'emergency_contact_phone',
    'emergency_contact_relationship', 'physician_name', 'physician_phone',
    'physician_email', 'caregiver_name', 'caregiver_email', 'caregiver_phone',
  ]),
  edit_clinical_profile: new Set([
    'secondary_diagnoses', 'allergies', 'past_medical_history', 'goals_of_care',
  ]),
  edit_care_episode: new Set(['admission_date', 'admission_source', 'care_type']),
  edit_insurance: new Set(['payor']),
  set_primary_diagnosis: new Set(['primary_diagnosis']),
  change_status: new Set(['status', 'discharge_date', 'discharge_disposition']),
});

// Keep the same canonical action order as the server. The complete action set
// is authorized and combined into one Patient update by the broker.
const ACTION_ORDER = Object.freeze(Object.keys(ACTION_FIELDS));
const FIELD_ACTION = new Map(
  Object.entries(ACTION_FIELDS).flatMap(([action, fields]) => (
    [...fields].map((field) => [field, action])
  )),
);

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validateWholeChangeSet(changes) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new Error('Patient changes must be an object');
  }
  const keys = Object.keys(changes);
  const unsupported = keys.filter((field) => !FIELD_ACTION.has(field));
  if (unsupported.length) {
    throw new Error(`These Patient fields require a dedicated workflow: ${unsupported.join(', ')}`);
  }

  const concrete = Object.fromEntries(
    Object.entries(changes).filter(([, value]) => value !== undefined),
  );
  const statusFields = ['discharge_date', 'discharge_disposition']
    .filter((field) => Object.hasOwn(concrete, field));
  if (statusFields.length && !Object.hasOwn(concrete, 'status')) {
    throw new Error('Discharge fields require an explicit status transition');
  }
  if (concrete.status === 'discharged'
    && (!concrete.discharge_date || !concrete.discharge_disposition)) {
    throw new Error('Discharge requires a date and disposition');
  }
  return concrete;
}

// One invoke site: every finite Patient action set targets the same server-owned
// authorization broker and one expected Patient version.
async function invokePatientActions(payload, expectedActions) {
  const response = await base44.functions.invoke('updateAuthorizedPatient', payload);
  const result = response?.data ?? response;
  if (
    result?.success !== true
    || result?.patient?.id !== payload.patient_id
    || !validInstant(result.patient.updated_date)
    || (payload.agency_id && result.patient.agency_id !== payload.agency_id)
    || !Array.isArray(result.actions)
    || JSON.stringify(result.actions) !== JSON.stringify(expectedActions)
  ) {
    throw new Error(result?.error || 'Patient update failed');
  }
  return result;
}

/**
 * Classify one form-level edit into finite server actions. The entire field set
 * travels in one request and the broker performs at most one Patient update, so
 * unsupported or unauthorized sections cannot produce a partial form save.
 */
export async function updatePatientFields({
  patientId,
  agencyId = null,
  expectedUpdatedDate,
  changes,
} = {}) {
  if (typeof patientId !== 'string' || !patientId.trim()) {
    throw new Error('patientId is required');
  }
  if (!validInstant(expectedUpdatedDate)) {
    throw new Error('A current Patient updated_date is required; reload the chart and retry');
  }

  const concrete = validateWholeChangeSet(changes);
  const grouped = Object.fromEntries(ACTION_ORDER.map((action) => [action, {}]));
  for (const [field, value] of Object.entries(concrete)) {
    grouped[FIELD_ACTION.get(field)][field] = value;
  }

  const actions = ACTION_ORDER
    .filter((action) => Object.keys(grouped[action]).length > 0)
    .map((action) => ({ action, changes: grouped[action] }));

  if (!actions.length) {
    return {
      success: true,
      updated: false,
      action: null,
      changed_fields: [],
      actions: [],
      patient: {
        id: patientId,
        agency_id: agencyId || undefined,
        updated_date: expectedUpdatedDate,
      },
    };
  }

  const payload = {
    patient_id: patientId,
    expected_updated_date: expectedUpdatedDate,
    actions,
  };
  if (agencyId) payload.agency_id = agencyId;
  return invokePatientActions(payload, actions.map(({ action }) => action));
}

export const changePatientStatus = ({
  patientId,
  agencyId = null,
  expectedUpdatedDate,
  status,
  dischargeDate,
  dischargeDisposition,
} = {}) => updatePatientFields({
  patientId,
  agencyId,
  expectedUpdatedDate,
  changes: {
    status,
    ...(dischargeDate !== undefined ? { discharge_date: dischargeDate } : {}),
    ...(dischargeDisposition !== undefined
      ? { discharge_disposition: dischargeDisposition }
      : {}),
  },
});

export const setPatientPrimaryDiagnosis = ({
  patientId,
  agencyId = null,
  expectedUpdatedDate,
  primaryDiagnosis,
} = {}) => updatePatientFields({
  patientId,
  agencyId,
  expectedUpdatedDate,
  changes: { primary_diagnosis: primaryDiagnosis },
});
