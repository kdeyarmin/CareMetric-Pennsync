// Pure transforms ported out of Base44.
//
// These carry no authority and read nothing. A handler resolves the caller's
// authority, fetches the record through a reviewed broker, and passes the
// already-authorized payload in. Keeping the mapping separate is deliberate:
// it is the part that has drifted before, and it is the part a parity test can
// pin exactly against the Base44 original.

const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * Admission note template, ported from
 * base44/functions/extractReferralDataForSmartNote.
 *
 * The key paths here are load-bearing and have been corrected in the original
 * more than once: several earlier reads named fields the extractor never
 * produces, so those sections silently rendered blank. `pennsyncApiPortParity`
 * compares this against the original across a fixture matrix so a future edit
 * on either side fails rather than quietly emptying a clinician's note.
 */
export function buildAdmissionNoteTemplate(refData) {
  const data = isObject(refData) ? refData : {};
  const sections = [];

  sections.push(`REASON FOR ADMISSION:\n${data.admission_details?.referral_reason || 'Admission to home health services'}`);

  if (data.admission_details?.clinical_history) {
    sections.push(`\nHISTORY OF PRESENT ILLNESS:\n${data.admission_details.clinical_history}`);
  }

  // Each entry is an object ({condition, onset_date, current_status,
  // management}); rendering it directly would emit "[object Object]".
  if (data.diagnoses?.past_medical_history?.length > 0) {
    const history = data.diagnoses.past_medical_history
      .map(entry => (typeof entry === 'string' ? entry : entry?.condition))
      .filter(Boolean);
    if (history.length > 0) sections.push(`\nPAST MEDICAL HISTORY:\n${history.join(', ')}`);
  }

  if (data.medications?.length > 0) {
    const medications = data.medications
      .map(medication => `${medication.name} ${medication.dosage ? `${medication.dosage} ` : ''}${medication.frequency ? medication.frequency : ''}`)
      .join('\n');
    sections.push(`\nCURRENT MEDICATIONS:\n${medications}`);
  }

  sections.push(`\nALLERGIES:\n${data.diagnoses?.allergies || 'NKDA'}`);

  if (data.skilled_needs?.services_ordered?.length > 0) {
    sections.push(`\nSKILLED NURSING NEEDS:\n${data.skilled_needs.services_ordered.join(', ')}`);
  }

  // Vitals are one free-text string, not discrete numeric fields.
  if (data.clinical_info?.vital_signs) {
    sections.push(`\nVITAL SIGNS (from referral):\n${data.clinical_info.vital_signs}`);
  }

  if (data.skilled_needs?.goals_of_care) {
    sections.push(`\nGOALS OF CARE:\n${data.skilled_needs.goals_of_care}`);
  }

  return sections.join('\n\n');
}

/**
 * Smart-note seed built from an already-authorized referral.
 *
 * `today` is injected so the default visit date is deterministic; the original
 * reads the clock directly, which makes it untestable across a midnight
 * boundary.
 */
export function buildSmartNoteData(referral, { today = new Date() } = {}) {
  const refData = isObject(referral?.extracted_data) ? referral.extracted_data : {};
  return {
    patient_id: referral?.patient_id,
    visit_type: 'admission',
    visit_date: refData.admission_details?.admission_date || today.toISOString().split('T')[0],

    diagnosis: refData.diagnoses?.primary_diagnosis || '',
    secondary_diagnoses: refData.diagnoses?.secondary_diagnoses || [],

    vital_signs_text: refData.clinical_info?.vital_signs || '',

    admission_note_template: buildAdmissionNoteTemplate(refData),

    clinical_summary: {
      primary_diagnosis: refData.diagnoses?.primary_diagnosis,
      primary_icd10: refData.diagnoses?.primary_icd10 || '',
      comorbidity_adjustments: refData.diagnoses?.comorbidity_adjustments || [],
      skilled_needs: refData.skilled_needs?.services_ordered || [],
      specific_interventions: refData.skilled_needs?.specific_interventions || [],
      medications: refData.medications || [],
      allergies: refData.diagnoses?.allergies || 'NKDA',
      instructions_from_referral: refData.skilled_needs?.goals_of_care
        || refData.admission_details?.referral_reason || '',
    },

    patient_demographics: {
      name: refData.demographics?.full_name,
      dob: refData.demographics?.date_of_birth,
      address: refData.demographics?.address,
      phone: refData.demographics?.phone,
      emergency_contact: refData.demographics?.emergency_contact,
      physician: refData.demographics?.referring_physician,
    },
  };
}
