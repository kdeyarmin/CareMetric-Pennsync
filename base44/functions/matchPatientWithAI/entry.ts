import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

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
        const matchAnalysis = await base44.integrations.Core.InvokeLLM({
            model: "claude_opus_4_8",
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
            error: error.message,
            success: false
        }, { status: 500 });
    }
});