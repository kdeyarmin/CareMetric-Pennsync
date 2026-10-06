import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
        const user = await base44.auth.me();
        if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { extractedData, existingPatients } = await req.json();

        // Validate input shape so malformed payloads return 400, not a 500 from
        // dereferencing extractedData.demographics / existingPatients.length below.
        if (!extractedData || !Array.isArray(existingPatients)) {
            return Response.json({ error: 'extractedData (object) and existingPatients (array) are required' }, { status: 400 });
        }

        // Use AI to analyze and match patients with nuanced data points
        const matchAnalysis = await base44.asServiceRole.integrations.Core.InvokeLLM({
            model: "automatic",
            prompt: `You are an expert patient matching system for healthcare records with advanced fuzzy matching capabilities.

Analyze the referral data and compare it against existing patients to find the best match.

REFERRAL PATIENT DATA:
${JSON.stringify(extractedData.demographics, null, 2)}

EXISTING PATIENTS IN SYSTEM (${existingPatients.length} records):
${JSON.stringify(existingPatients.map(p => ({
    id: p.id,
    first_name: p.first_name,
    middle_name: p.middle_name,
    last_name: p.last_name,
    full_name: `${p.first_name || ''} ${p.middle_name || ''} ${p.last_name || ''}`.trim(),
    mrn: p.medical_record_number,
    dob: p.date_of_birth,
    phone: p.phone,
    email: p.email,
    address: p.address,
    insurance: p.payor,
    physician: p.physician_name,
    physician_phone: p.physician_phone,
    emergency_contact: p.emergency_contact_name,
    emergency_phone: p.emergency_contact_phone,
    past_diagnoses: p.secondary_diagnoses,
    primary_diagnosis: p.primary_diagnosis,
    admission_date: p.admission_date,
    status: p.status,
    care_type: p.care_type
})), null, 2)}

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

Provide detailed match analysis with reasoning.`,
            response_json_schema: {
                type: "object",
                properties: {
                    best_match_id: {
                        type: "string",
                        description: "Patient ID of best match, or null if no confident match"
                    },
                    confidence_score: {
                        type: "number",
                        description: "Confidence percentage 0-100"
                    },
                    confidence_level: {
                        type: "string",
                        enum: ["definitive", "high", "medium", "low", "no_match"],
                        description: "Categorized confidence level"
                    },
                    is_definitive: {
                        type: "boolean",
                        description: "True if MRN match or other definitive criteria met"
                    },
                    match_factors: {
                        type: "array",
                        items: { type: "string" },
                        description: "Specific factors supporting the match (be detailed)"
                    },
                    discrepancies: {
                        type: "array",
                        items: { type: "string" },
                        description: "Factors that don't match or raise questions"
                    },
                    field_matches: {
                        type: "object",
                        properties: {
                            mrn_match: { type: "boolean" },
                            name_match: { type: "string", enum: ["exact", "close", "partial", "none"] },
                            dob_match: { type: "string", enum: ["exact", "close", "none"] },
                            phone_match: { type: "string", enum: ["exact", "partial", "none"] },
                            email_match: { type: "boolean" },
                            address_match: { type: "string", enum: ["exact", "similar", "none"] },
                            physician_match: { type: "boolean" }
                        },
                        description: "Detailed field-by-field match results"
                    },
                    alternative_matches: {
                        type: "array",
                        items: {
                            type: "object",
                            properties: {
                                patient_id: { type: "string" },
                                patient_name: { type: "string" },
                                confidence_score: { type: "number" },
                                reasons: {
                                    type: "array",
                                    items: { type: "string" }
                                }
                            }
                        },
                        description: "Other possible matches ranked by confidence"
                    },
                    recommendation: {
                        type: "string",
                        enum: ["use_match", "manual_review", "create_new"],
                        description: "Recommended action based on confidence and context"
                    },
                    reasoning: {
                        type: "string",
                        description: "Detailed step-by-step explanation of the matching analysis"
                    },
                    warnings: {
                        type: "array",
                        items: { type: "string" },
                        description: "Any warnings or concerns about the match (e.g., patient is discharged, conflicting data)"
                    }
                }
            }
        });

        return Response.json({
            success: true,
            matchAnalysis
        });

    } catch (error) {
        console.error('Error matching patient with AI:', error);
        return Response.json({ 
            error: 'Internal server error',
            success: false
        }, { status: 500 });
    }
});