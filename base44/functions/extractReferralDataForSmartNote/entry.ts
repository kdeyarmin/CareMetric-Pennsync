import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value);
}

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, any>, expected: string[]) {
  const actual = Object.keys(value).sort();
  return JSON.stringify(actual) === JSON.stringify([...expected].sort());
}

async function parseInput(req: Request) {
  if (req.method !== 'POST') {
    throw new PublicError(405, 'Method not allowed');
  }
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body) || !exactKeys(body, ['agency_id', 'referral_id'])) {
    throw new PublicError(400, 'Invalid request');
  }
  if (!exactIdentifier(body.agency_id) || !exactIdentifier(body.referral_id)) {
    throw new PublicError(400, 'Invalid request');
  }
  return { agencyId: body.agency_id as string, referralId: body.referral_id as string };
}

function unwrapFunctionResult(value: unknown) {
  return plainObject(value) && plainObject(value.data) ? value.data : value;
}

function validateAuthorizedReferralResult(
  value: unknown,
  agencyId: string,
  referralId: string,
) {
  if (!plainObject(value) || !exactKeys(value, ['success', 'action', 'referral', 'scope'])) {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  const { referral, scope } = value;
  if (
    value.success !== true
    || value.action !== 'get'
    || !plainObject(referral)
    || referral.id !== referralId
    || referral.agency_id !== agencyId
    || !Number.isSafeInteger(referral.version)
    || referral.version < 1
    || !Number.isFinite(Date.parse(referral.created_date))
    || !Number.isFinite(Date.parse(referral.updated_date))
    || !plainObject(scope)
    || !exactKeys(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    || scope.agency_id !== agencyId
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
    || !INTAKE_ROLES.has(scope.tenant_role)
  ) {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  return referral;
}

Deno.serve(async (req) => {
  try {
    const { agencyId, referralId } = await parseInput(req);
    const base44 = createClientFromRequest(req);
    const brokerResponse = await base44.functions.invoke('manageAuthorizedReferral', {
      action: 'get',
      agency_id: agencyId,
      referral_id: referralId,
    });
    const referral = validateAuthorizedReferralResult(
      unwrapFunctionResult(brokerResponse),
      agencyId,
      referralId,
    );
    if (!plainObject(referral.extracted_data)) {
      throw new PublicError(404, 'Referral not found or not processed');
    }
    const refData = referral.extracted_data;

    const smartNoteData = {
      patient_id: referral.patient_id,
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

    return Response.json({
      success: true,
      smartNoteData,
      scope: {
        agency_id: agencyId,
        referral_id: referralId,
        referral_version: referral.version,
      },
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            'Cache-Control': 'no-store',
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('extractReferralDataForSmartNote failed');
    return Response.json(
      { error: 'Internal server error' },
      { status: 500, headers: { 'Cache-Control': 'no-store' } },
    );
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
