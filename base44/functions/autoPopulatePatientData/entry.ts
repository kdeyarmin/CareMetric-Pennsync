import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { file_urls, patient_id } = body;

    if (!file_urls || !Array.isArray(file_urls) || file_urls.length === 0) {
      return Response.json({ error: 'No files provided' }, { status: 400 });
    }

    console.log('[autoPopulatePatientData] Processing', file_urls.length, 'document(s)');

    // Get existing patient data if updating
    let existingPatient = null;
    if (patient_id) {
      const patients = await base44.entities.Patient.filter({ id: patient_id });
      existingPatient = patients[0];
    }

    const prompt = `You are an expert medical data extractor specializing in patient demographics, insurance, and referral information.

Analyze the provided document(s) and extract ALL available administrative and clinical data with extreme precision.

${existingPatient ? `EXISTING PATIENT DATA (only extract NEW or ADDITIONAL information not already present):
${JSON.stringify(existingPatient, null, 2)}` : ''}

Extract the following with maximum detail:

1. DEMOGRAPHICS:
   - Full legal name (first, middle, last)
   - Date of birth (exact format)
   - Medical record number (MRN)
   - Social Security Number (if visible)
   - Gender/sex
   - Marital status
   - Preferred language
   - Contact: phone, email, address (complete with city, state, zip)

2. INSURANCE INFORMATION (PRIMARY):
   - Insurance company/provider name
   - Policy/member ID number
   - Group number
   - Subscriber name (if different from patient)
   - Subscriber relationship to patient
   - Effective date
   - Coverage type (Medicare, Medicaid, Commercial, etc.)
   - Plan type (HMO, PPO, etc.)
   - Authorization/pre-cert requirements

3. INSURANCE INFORMATION (SECONDARY) - if applicable:
   - Same fields as primary

4. REFERRAL INFORMATION:
   - Referring physician name
   - Referring physician NPI
   - Referring practice name
   - Referral date
   - Referral diagnosis/reason
   - Referral source (hospital, clinic, etc.)
   - Admission source if applicable

5. EMERGENCY CONTACTS:
   - Emergency contact name
   - Relationship to patient
   - Phone number(s)
   - Address if available

6. CARE TEAM:
   - Primary care physician (PCP) name
   - PCP phone/fax
   - PCP address
   - Specialist names and specialties
   - Case manager if assigned
   - Social worker if assigned

7. CLINICAL SUMMARY:
   - Primary diagnosis with ICD-10
   - Secondary diagnoses with ICD-10 codes
   - Active medications
   - Known allergies
   - Recent hospitalizations
   - Functional status/homebound indicators

8. PAYOR INFORMATION:
   - Payor name
   - Payor ID
   - Claims address
   - Authorization requirements

Return ONLY the data found in the documents. Use null for missing fields. Do NOT infer or guess.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      file_urls,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          demographics: {
            type: 'object',
            properties: {
              first_name: { type: 'string' },
              middle_name: { type: 'string' },
              last_name: { type: 'string' },
              date_of_birth: { type: 'string' },
              medical_record_number: { type: 'string' },
              ssn: { type: 'string' },
              gender: { type: 'string' },
              marital_status: { type: 'string' },
              preferred_language: { type: 'string' },
              phone: { type: 'string' },
              email: { type: 'string' },
              address: { type: 'string' }
            }
          },
          insurance_primary: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              policy_number: { type: 'string' },
              group_number: { type: 'string' },
              subscriber_name: { type: 'string' },
              subscriber_relationship: { type: 'string' },
              effective_date: { type: 'string' },
              coverage_type: { type: 'string' },
              plan_type: { type: 'string' },
              authorization_required: { type: 'boolean' }
            }
          },
          insurance_secondary: {
            type: 'object',
            properties: {
              provider: { type: 'string' },
              policy_number: { type: 'string' },
              group_number: { type: 'string' }
            }
          },
          referral_information: {
            type: 'object',
            properties: {
              referring_physician_name: { type: 'string' },
              referring_physician_npi: { type: 'string' },
              referring_practice: { type: 'string' },
              referral_date: { type: 'string' },
              referral_diagnosis: { type: 'string' },
              referral_source: { type: 'string' },
              admission_source: { type: 'string' }
            }
          },
          emergency_contact: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              relationship: { type: 'string' },
              phone: { type: 'string' },
              address: { type: 'string' }
            }
          },
          care_team: {
            type: 'object',
            properties: {
              primary_care_physician: { type: 'string' },
              pcp_phone: { type: 'string' },
              pcp_fax: { type: 'string' },
              pcp_address: { type: 'string' },
              specialists: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: { type: 'string' },
                    specialty: { type: 'string' },
                    phone: { type: 'string' }
                  }
                }
              },
              case_manager: { type: 'string' },
              social_worker: { type: 'string' }
            }
          },
          clinical_summary: {
            type: 'object',
            properties: {
              primary_diagnosis: { type: 'string' },
              primary_diagnosis_icd10: { type: 'string' },
              secondary_diagnoses: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    diagnosis: { type: 'string' },
                    icd10: { type: 'string' }
                  }
                }
              },
              medications: {
                type: 'array',
                items: { type: 'string' }
              },
              allergies: { type: 'string' },
              recent_hospitalizations: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    date: { type: 'string' },
                    reason: { type: 'string' },
                    hospital: { type: 'string' }
                  }
                }
              },
              functional_status: { type: 'string' },
              homebound_indicators: {
                type: 'array',
                items: { type: 'string' }
              }
            }
          },
          payor_information: {
            type: 'object',
            properties: {
              payor_name: { type: 'string' },
              payor_id: { type: 'string' },
              claims_address: { type: 'string' },
              authorization_requirements: { type: 'string' }
            }
          },
          extraction_confidence: {
            type: 'string',
            enum: ['high', 'medium', 'low']
          },
          fields_extracted: {
            type: 'array',
            items: { type: 'string' },
            description: 'List of field names that were successfully extracted'
          },
          notes: { type: 'string' }
        }
      }
    });

    return Response.json({
      success: true,
      extracted_data: result,
      file_count: file_urls.length,
      ready_to_apply: true
    });
  } catch (error) {
    console.error('[autoPopulatePatientData] Error:', error.message);
    return Response.json({
      error: 'Auto-population failed',
      details: error.message
    }, { status: 500 });
  }
});