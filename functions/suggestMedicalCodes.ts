import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Only physicians and NPs can suggest codes
    if (user.credential_type !== 'MD' && user.credential_type !== 'NP') {
      return Response.json({ 
        error: 'Only physicians and nurse practitioners can use medical coding assistant' 
      }, { status: 403 });
    }

    const { 
      enhanced_note, 
      diagnosis, 
      visit_type,
      provider_type,
      patient_context
    } = await req.json();

    if (!enhanced_note || !diagnosis) {
      return Response.json({ 
        error: 'Enhanced note and diagnosis are required' 
      }, { status: 400 });
    }

    console.log('Starting medical code suggestion analysis...');

    const codingPrompt = `You are an expert medical coder, billing compliance specialist, and payer-specific denial prevention expert. Analyze the following clinical note and suggest appropriate medical codes.

CLINICAL NOTE:
${enhanced_note}

PRIMARY DIAGNOSIS: ${diagnosis}
VISIT TYPE: ${visit_type}
PROVIDER TYPE: ${provider_type}

${patient_context ? `PATIENT CONTEXT:
- Patient: ${patient_context.patient_name}
- Age: ${patient_context.date_of_birth ? new Date().getFullYear() - new Date(patient_context.date_of_birth).getFullYear() : 'Unknown'}
- Secondary Diagnoses: ${patient_context.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient_context.current_medications?.map(m => m.name || m).join(', ') || 'None'}
- Insurance: ${patient_context.payor || 'Unknown'}
` : ''}

Please provide comprehensive medical coding recommendations including:

1. PRIMARY ICD-10 CODES: Main diagnostic codes for this visit
2. SECONDARY ICD-10 CODES: Supporting diagnostic codes
3. CPT CODES: Procedure/service codes for billing with RVUs
4. HCPCS CODES: Supply/device/modifier codes (J codes, E codes, L codes, etc.)
5. RECOMMENDED MODIFIERS: CPT/HCPCS modifiers with usage scenarios (25, 59, RT/LT, 76, 77, etc.)
6. PAYER-SPECIFIC DENIAL RISKS: Identify common denial patterns by major payers (Medicare, Medicaid, commercial) with:
   - Specific code combinations that trigger denials
   - Documentation requirements to support codes
   - Pre-authorization needs
   - Age/gender specific denials
7. CCI & BUNDLING CONCERNS: CCI issues and unbundling risks
8. DOCUMENTATION GAPS: Missing documentation needed for coding accuracy
9. COMPLIANCE NOTES: Key compliance considerations

For each code, provide: code number, description, rationale, confidence level (high/medium/low), billing considerations, and typical payer rules.

Format your response as JSON with these exact sections.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: codingPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          primary_icd10_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] }
              }
            }
          },
          secondary_icd10_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] }
              }
            }
          },
          cpt_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                visit_level: { type: "string" },
                typical_rvu: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] }
              }
            }
          },
          hcpcs_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                code_type: { type: "string" },
                description: { type: "string" },
                typical_cost: { type: "string" },
                rationale: { type: "string" },
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                payer_notes: { type: "string" }
              }
            }
          },
          recommended_modifiers: {
            type: "array",
            items: {
              type: "object",
              properties: {
                modifier: { type: "string" },
                description: { type: "string" },
                applies_to_codes: { type: "array", items: { type: "string" } },
                usage_scenario: { type: "string" },
                denial_prevention: { type: "string" }
              }
            }
          },
          payer_specific_denial_risks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                payer_type: { type: "string" },
                risk_level: { type: "string", enum: ["critical", "high", "medium", "low"] },
                problematic_codes: { type: "array", items: { type: "string" } },
                denial_reason: { type: "string" },
                required_documentation: { type: "array", items: { type: "string" } },
                requires_preauth: { type: "boolean" },
                age_gender_restrictions: { type: "string" }
              }
            }
          },
          cci_bundling_concerns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code_pair: { type: "string" },
                concern_type: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "medium", "low"] },
                description: { type: "string" },
                recommendation: { type: "string" }
              }
            }
          },
          documentation_gaps: {
            type: "array",
            items: {
              type: "object",
              properties: {
                gap: { type: "string" },
                impact: { type: "string" },
                suggestion: { type: "string" }
              }
            }
          },
          compliance_notes: {
            type: "array",
            items: { type: "string" }
          },
          billing_form_prefill_data: {
            type: "object",
            properties: {
              primary_icd10: { type: "string" },
              secondary_icd10s: { type: "array", items: { type: "string" } },
              primary_cpt: { type: "string" },
              cpt_modifiers: { type: "array", items: { type: "string" } },
              hcpcs: { type: "array", items: { type: "string" } },
              hcpcs_modifiers: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    });

    console.log('Medical code suggestion analysis completed');

    return Response.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('Error in suggestMedicalCodes:', error);
    return Response.json({ 
      error: error.message || 'Failed to suggest medical codes',
      details: error.stack 
    }, { status: 500 });
  }
});