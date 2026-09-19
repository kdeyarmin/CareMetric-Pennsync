// Ported from base44/functions/matchPatientWithAI.
//
// The candidate patients arrive in the request rather than from a query, which
// is why this reads no entity row and can be written before the record store
// exists. It does send patient demographics to the model — as the original did,
// unchanged. A port is not the place to alter what leaves the system.
//
// One divergence, deliberate and the only one: the original answers a malformed
// body with `{error: 'extractedData (object) and existingPatients (array) are
// required'}` and a 400. This service has a uniform error envelope that every
// handler shares, and a handler inventing its own shape is the thing that
// envelope exists to prevent. So the same inputs are refused with the same
// status, under this service's code. The validity rule itself is preserved
// exactly, including that an empty array is a valid list of candidates.
import { fail, isObject } from './contracts.mjs';

export const MATCH_MODEL = 'automatic';

/** The original's guard, reproduced: any object will do, but the list must be an array. */
export const matchInputValid = (extractedData, existingPatients) =>
  Boolean(extractedData) && Array.isArray(existingPatients);

/**
 * The projection the original sends. Only these fields reach the model, and
 * `full_name` is assembled here rather than read, with the same `|| ''`
 * fallbacks and the same trim — so a patient with no middle name produces one
 * space fewer, exactly as before.
 */
export const projectPatient = patient => ({
  id: patient.id,
  first_name: patient.first_name,
  middle_name: patient.middle_name,
  last_name: patient.last_name,
  full_name: `${patient.first_name || ''} ${patient.middle_name || ''} ${patient.last_name || ''}`.trim(),
  mrn: patient.medical_record_number,
  dob: patient.date_of_birth,
  phone: patient.phone,
  email: patient.email,
  address: patient.address,
  insurance: patient.payor,
  physician: patient.physician_name,
  physician_phone: patient.physician_phone,
  emergency_contact: patient.emergency_contact_name,
  emergency_phone: patient.emergency_contact_phone,
  past_diagnoses: patient.secondary_diagnoses,
  primary_diagnosis: patient.primary_diagnosis,
  admission_date: patient.admission_date,
  status: patient.status,
  care_type: patient.care_type,
});

export const PATIENT_MATCH_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    best_match_id: { type: 'string', description: 'Patient ID of best match, or null if no confident match' },
    confidence_score: { type: 'number', description: 'Confidence percentage 0-100' },
    confidence_level: {
      type: 'string',
      enum: ['definitive', 'high', 'medium', 'low', 'no_match'],
      description: 'Categorized confidence level',
    },
    is_definitive: { type: 'boolean', description: 'True if MRN match or other definitive criteria met' },
    match_factors: {
      type: 'array', items: { type: 'string' },
      description: 'Specific factors supporting the match (be detailed)',
    },
    discrepancies: {
      type: 'array', items: { type: 'string' },
      description: "Factors that don't match or raise questions",
    },
    field_matches: {
      type: 'object',
      properties: {
        mrn_match: { type: 'boolean' },
        name_match: { type: 'string', enum: ['exact', 'close', 'partial', 'none'] },
        dob_match: { type: 'string', enum: ['exact', 'close', 'none'] },
        phone_match: { type: 'string', enum: ['exact', 'partial', 'none'] },
        email_match: { type: 'boolean' },
        address_match: { type: 'string', enum: ['exact', 'similar', 'none'] },
        physician_match: { type: 'boolean' },
      },
      description: 'Detailed field-by-field match results',
    },
    alternative_matches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          patient_id: { type: 'string' },
          patient_name: { type: 'string' },
          confidence_score: { type: 'number' },
          reasons: { type: 'array', items: { type: 'string' } },
        },
      },
      description: 'Other possible matches ranked by confidence',
    },
    recommendation: {
      type: 'string',
      enum: ['use_match', 'manual_review', 'create_new'],
      description: 'Recommended action based on confidence and context',
    },
    reasoning: { type: 'string', description: 'Detailed step-by-step explanation of the matching analysis' },
    warnings: {
      type: 'array', items: { type: 'string' },
      description: 'Any warnings or concerns about the match (e.g., patient is discharged, conflicting data)',
    },
  },
});

export function buildMatchPrompt(extractedData, existingPatients) {
  return `You are an expert patient matching system for healthcare records with advanced fuzzy matching capabilities.

Analyze the referral data and compare it against existing patients to find the best match.

REFERRAL PATIENT DATA:
${JSON.stringify(extractedData.demographics, null, 2)}

EXISTING PATIENTS IN SYSTEM (${existingPatients.length} records):
${JSON.stringify(existingPatients.map(projectPatient), null, 2)}

ADVANCED MATCHING CRITERIA:
1. **Name Matching** (High Priority):
   - Exact matches (first + last, or first + middle + last)
   - Partial matches with transposed first/middle names
   - Nicknames and common variations (Bob/Robert, Bill/William, Liz/Elizabeth, etc.)
   - Typos and spelling variations (1-2 character differences)
   - Maiden name vs married name considerations
   - Hyphenated names and name order variations

2. **Medical Record Number** (DEFINITIVE if present):
   - Exact MRN match = DEFINITIVE match regardless of other fields
   - Similar MRNs (1 digit difference) = flag for manual review

3. **Date of Birth** (High Priority):
   - Exact DOB match strongly supports match
   - Day/month transposition (common data entry error)
   - 1-day difference (timezone or transcription errors)
   - Missing DOB but other strong matches = medium confidence

4. **Contact Information** (Medium-High Priority):
   - Phone number exact match (ignore formatting)
   - Phone number partial match (last 4-7 digits)
   - Email exact match
   - Address similarity (street name, city, zip)

5. **Clinical Context** (Medium Priority):
   - Physician name match
   - Physician phone match
   - Insurance provider match
   - Emergency contact match (name or phone)
   - Diagnosis overlap
   - Recent admission dates (within 30 days)

6. **Demographics** (Supporting Evidence):
   - Age consistency (DOB derived)
   - Gender consistency
   - Care type consistency (home health vs hospice)

CONFIDENCE SCORING GUIDE:
- **90-100%**: DEFINITIVE (MRN match or 3+ high-priority exact matches)
- **75-89%**: HIGH (Name + DOB + 1 contact match, or Name + 2 contact matches)
- **60-74%**: MEDIUM (Name similarity + DOB or contact info)
- **40-59%**: LOW (Partial name match + some demographics)
- **0-39%**: NO MATCH (insufficient similarity)

SPECIAL CONSIDERATIONS:
- If referral has MRN and matches existing patient MRN exactly → DEFINITIVE match (100% confidence)
- Multiple patients with similar names but different MRNs → NO match (create new)
- Same name, DOB, and phone → HIGH confidence match
- Consider patient status (prefer matching active patients over discharged)
- Flag if existing patient is discharged but new referral suggests readmission

Provide detailed match analysis with reasoning.`;
}

export async function matchPatientWithAI({ params, integration }) {
  const input = isObject(params) ? params : {};
  if (!matchInputValid(input.extractedData, input.existingPatients)) fail(400, 'INVALID_PARAMS');
  const matchAnalysis = await integration('InvokeLLM', {
    model: MATCH_MODEL,
    prompt: buildMatchPrompt(input.extractedData, input.existingPatients),
    response_json_schema: structuredClone(PATIENT_MATCH_SCHEMA),
  });
  return { success: true, matchAnalysis };
}
