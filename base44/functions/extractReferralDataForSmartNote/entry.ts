import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require authentication: previously unauthenticated, so any caller could
    // read a referral's full demographics/clinical PHI by id (IDOR).
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referral_id } = await req.json();

    if (!referral_id) {
      return Response.json({ error: 'referral_id is required' }, { status: 400 });
    }

    // Fetch the referral with the USER-SCOPED client so RLS restricts it to
    // referrals the caller may see (the frontend reads Referral the same way).
    // The prior asServiceRole read bypassed RLS — any caller could read any
    // referral's demographics/clinical PHI by id, despite the "fixed" comment.
    const referral = await base44.entities.Referral.filter({ id: referral_id });
    if (!referral?.length || !referral[0].extracted_data) {
      return Response.json({ error: 'Referral not found or not processed' }, { status: 404 });
    }

    const refData = referral[0].extracted_data;

    // Extract and format data for Smart Note pre-population
    const smartNoteData = {
      patient_id: referral[0].patient_id,
      visit_type: 'admission',
      visit_date: refData.admission_details?.admission_date || new Date().toISOString().split('T')[0],
      
      // Diagnosis
      diagnosis: refData.diagnoses?.primary_diagnosis || '',
      secondary_diagnoses: refData.diagnoses?.secondary_diagnoses || [],
      
      // Vitals from referral. The extraction stores vitals as a single free-text
      // string at clinical_info.vital_signs — there are no discrete numeric
      // components to populate — so surface the text (the prior reads of
      // refData.vital_signs.* did not exist and always came back blank).
      vital_signs_text: refData.clinical_info?.vital_signs || '',

      // Admission-specific notes template
      admission_note_template: generateAdmissionNoteTemplate(refData),

      // Key clinical points (mapped to the real extraction schema keys: the prior
      // icd10_codes / care_needs.skilled_nursing / urgent_clinical_items /
      // admission_details.special_instructions keys are not produced by the
      // extractor, so each came back empty).
      clinical_summary: {
        primary_diagnosis: refData.diagnoses?.primary_diagnosis,
        primary_icd10: refData.diagnoses?.primary_icd10 || '',
        comorbidity_adjustments: refData.diagnoses?.comorbidity_adjustments || [],
        skilled_needs: refData.skilled_needs?.services_ordered || [],
        specific_interventions: refData.skilled_needs?.specific_interventions || [],
        medications: refData.medications || [],
        allergies: refData.diagnoses?.allergies || 'NKDA',

        // Pre-visit instructions: the schema's closest source is the skilled-care
        // goals, falling back to the referral reason.
        instructions_from_referral: refData.skilled_needs?.goals_of_care || refData.admission_details?.referral_reason || ''
      },
      
      // Patient demographics for context
      patient_demographics: {
        name: refData.demographics?.full_name,
        dob: refData.demographics?.date_of_birth,
        address: refData.demographics?.address,
        phone: refData.demographics?.phone,
        emergency_contact: refData.demographics?.emergency_contact,
        physician: refData.demographics?.referring_physician
      }
    };

    return Response.json({ smartNoteData });
  } catch (error) {
    console.error('Error extracting referral data:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function generateAdmissionNoteTemplate(refData) {
  const sections = [];
  
  // Chief Complaint / Reason for Admission
  sections.push(`REASON FOR ADMISSION:\n${refData.admission_details?.referral_reason || 'Admission to home health services'}`);
  
  // History of Present Illness (from referral)
  if (refData.admission_details?.clinical_history) {
    sections.push(`\nHISTORY OF PRESENT ILLNESS:\n${refData.admission_details.clinical_history}`);
  }
  
  // Past Medical History — the schema stores each entry as an object
  // ({ condition, onset_date, current_status, management }), so render the
  // condition rather than emitting "[object Object]".
  if (refData.diagnoses?.past_medical_history?.length > 0) {
    const pmh = refData.diagnoses.past_medical_history
      .map((h) => (typeof h === 'string' ? h : h?.condition))
      .filter(Boolean);
    if (pmh.length > 0) sections.push(`\nPAST MEDICAL HISTORY:\n${pmh.join(', ')}`);
  }
  
  // Current Medications (from referral)
  if (refData.medications?.length > 0) {
    const medsList = refData.medications.map(m => 
      `${m.name} ${m.dosage ? m.dosage + ' ' : ''}${m.frequency ? m.frequency : ''}`
    ).join('\n');
    sections.push(`\nCURRENT MEDICATIONS:\n${medsList}`);
  }
  
  // Allergies
  sections.push(`\nALLERGIES:\n${refData.diagnoses?.allergies || 'NKDA'}`);
  
  // Skilled Nursing Needs — schema field is skilled_needs.services_ordered.
  if (refData.skilled_needs?.services_ordered?.length > 0) {
    sections.push(`\nSKILLED NURSING NEEDS:\n${refData.skilled_needs.services_ordered.join(', ')}`);
  }

  // Vital Signs (from referral) — stored as a free-text string at
  // clinical_info.vital_signs, not discrete numeric fields.
  if (refData.clinical_info?.vital_signs) {
    sections.push(`\nVITAL SIGNS (from referral):\n${refData.clinical_info.vital_signs}`);
  }

  // Goals of care / pre-visit instructions.
  if (refData.skilled_needs?.goals_of_care) {
    sections.push(`\nGOALS OF CARE:\n${refData.skilled_needs.goals_of_care}`);
  }
  
  return sections.join('\n\n');
}