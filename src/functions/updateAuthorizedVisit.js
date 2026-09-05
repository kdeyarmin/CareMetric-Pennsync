import { base44 } from '@/api/base44Client';

// One invoke site: every Visit mutation below targets the same server-owned
// authorization broker. Keeping action construction here prevents components
// from sending a generic patch that could smuggle tenant/provenance fields.
const invokeUpdateAuthorizedVisit = async (payload, functions = null) => {
  const response = functions
    ? await functions.invoke('updateAuthorizedVisit', payload)
    : await base44.functions.invoke('updateAuthorizedVisit', payload);
  const result = response?.data ?? response;
  if (result?.updated !== true || !result?.visit?.id) {
    throw new Error(result?.error || 'Visit update failed');
  }
  return result;
};

const DOCUMENTATION_FIELDS = new Set([
  'status',
  'nurse_notes',
  'raw_transcription',
  'vital_signs',
  'compliance_score',
  'compliance_issues',
  'homebound_status_verified',
  'skilled_intervention_documented',
  'homebound_justification',
  'documentation_source',
  'grounding_pending',
  'ai_tags',
]);

// Retired offline clients may contain only the same bounded clinical fields.
// Anything broader is deliberately refused; retiredOfflineQueue then retains
// the queue, legacy stores, and retirement flag for supervised recovery rather
// than dropping or partially applying unsent clinical work.
const LEGACY_RECOVERY_FIELDS = new Set([
  'visit_date',
  'visit_time',
  'visit_type',
  'status',
  'start_time',
  'end_time',
  'nurse_notes',
  'audio_url',
  'raw_transcription',
  'vital_signs',
  'family_update_sent',
  'family_update_date',
  'family_update_text',
  'telehealth_room_id',
  'telehealth_room_name',
  'telehealth_call_duration',
  'telehealth_summary',
  'telehealth_shared_files',
  'telehealth_recording_url',
  'compliance_score',
  'compliance_issues',
  'homebound_status_verified',
  'skilled_intervention_documented',
  'homebound_justification',
  'documentation_source',
  'grounding_pending',
  'ai_tags',
]);

const REPORTING_TAG_PREFIXES = ['trend:', 'chart_flag:', 'denial_risk:'];

function exactFields(fields, allowed, label) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error(`${label} fields must be an object`);
  }
  const keys = Object.keys(fields);
  const rejected = keys.filter((key) => !allowed.has(key));
  if (rejected.length) {
    throw new Error(`${label} cannot write: ${rejected.join(', ')}`);
  }
  const compact = {};
  for (const key of keys) {
    if (fields[key] !== undefined) compact[key] = fields[key];
  }
  if (!Object.keys(compact).length) throw new Error(`${label} fields are empty`);
  return compact;
}

/**
 * Save clinical documentation to an existing Visit.
 *
 * patientId is an assertion checked against the stored Visit and Patient; it
 * is never included in the mutable field set.
 */
export const saveVisitDocumentation = async ({ visitId, patientId, fields } = {}) =>
  invokeUpdateAuthorizedVisit({
    visit_id: visitId,
    action: 'save_documentation',
    patient_id: patientId,
    ...(() => {
      const clinicalFields = exactFields(fields, DOCUMENTATION_FIELDS, 'Visit documentation');
      if (clinicalFields.ai_tags !== undefined) {
        if (!Array.isArray(clinicalFields.ai_tags)
          || clinicalFields.ai_tags.some((tag) => (
            typeof tag !== 'string'
            || !REPORTING_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix))
          ))) {
          throw new Error('Visit documentation ai_tags must use reporting tag prefixes');
        }
      }
      return clinicalFields;
    })(),
  });

export const rescheduleVisit = async ({ visitId, visitTime } = {}) =>
  invokeUpdateAuthorizedVisit({
    visit_id: visitId,
    action: 'reschedule',
    visit_time: visitTime,
  });

export const setVisitAiTags = async ({ visitId, tags } = {}) =>
  invokeUpdateAuthorizedVisit({
    visit_id: visitId,
    action: 'set_ai_tags',
    ai_tags: tags,
  });

export const advanceVisitHandoff = async ({ visitId, nextStatus } = {}) =>
  invokeUpdateAuthorizedVisit({
    visit_id: visitId,
    action: 'advance_handoff',
    next_status: nextStatus,
  });

export async function hashVisitNoteForReview(noteText) {
  if (typeof noteText !== 'string') throw new Error('Review note text must be a string');
  if (!globalThis.crypto?.subtle || typeof globalThis.TextEncoder !== 'function') {
    throw new Error('Secure review hashing is unavailable');
  }
  const encoded = new TextEncoder().encode(noteText);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const setVisitReviewAcknowledgement = async ({
  visitId,
  acknowledged,
  nurseEdited = false,
  noteText,
} = {}) => {
  if (typeof acknowledged !== 'boolean') {
    throw new Error('acknowledged must be a boolean');
  }
  const payload = {
    visit_id: visitId,
    action: 'set_review_ack',
    acknowledged,
  };
  if (acknowledged) {
    payload.expected_note_hash = await hashVisitNoteForReview(noteText);
    payload.nurse_edited = nurseEdited === true;
  }
  // Withdrawal has no hash/editable metadata: the broker rejects extra fields
  // and clears the stored acknowledgement atomically.
  return invokeUpdateAuthorizedVisit(payload);
};

export const recoverLegacyVisitUpdate = async ({ visitId, fields, functions } = {}) =>
  invokeUpdateAuthorizedVisit({
    visit_id: visitId,
    action: 'legacy_recovery',
    ...exactFields(fields, LEGACY_RECOVERY_FIELDS, 'Legacy Visit recovery'),
  }, functions);
