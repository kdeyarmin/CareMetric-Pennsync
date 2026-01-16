import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Restrict to physicians and NPs
    if (user.credential_type !== 'MD' && user.credential_type !== 'NP') {
      return Response.json({ error: 'Only physicians and NPs can access medical coding suggestions' }, { status: 403 });
    }

    const {
      enhanced_note,
      diagnosis,
      visit_type,
      provider_type,
      patient_context
    } = await req.json();

    const prompt = `You are an expert medical coding assistant. Analyze the following clinical note and provide detailed ICD-10 and CPT code suggestions.

VISIT TYPE: ${visit_type}
PRIMARY DIAGNOSIS: ${diagnosis}
PROVIDER TYPE: ${provider_type}

${patient_context ? `PATIENT CONTEXT:
- Secondary Diagnoses: ${patient_context.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient_context.current_medications?.map(m => m.name).join(', ') || 'None'}
` : ''}

CLINICAL NOTE:
${enhanced_note}

Please provide:

1. PRIMARY ICD-10 CODES:
   - For the main diagnosis and any significant secondary diagnoses/conditions documented
   - Include: Code, Description, Confidence Level (high/medium/low), Rationale

2. CPT CODES:
   - For the visit/service level based on documented complexity and time/medical decision-making
   - Include: Code, Description, Typical RVU, Work involved, Confidence Level, Rationale

3. BUNDLING & CCI CONCERNS:
   - Flag any potential CPT code pairs that may have CCI edits (Column 1/2 indicators)
   - Identify any unbundling risks
   - Suggest proper coding hierarchy to avoid denials

4. DOCUMENTATION GAPS:
   - Note any missing documentation that would support higher-level coding
   - Suggest specific documentation improvements

5. COMPLIANCE NOTES:
   - Any Medicare/regulatory concerns with the suggested codes
   - Adherence to coding guidelines

Format response as structured JSON.`;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
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
                confidence: { type: "string", enum: ["high", "medium", "low"] },
                rationale: { type: "string" },
                is_primary: { type: "boolean" }
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
                confidence: { type: "string" },
                rationale: { type: "string" }
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
                typical_rvu: { type: "number" },
                work_rvu: { type: "number" },
                confidence: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          cci_bundling_concerns: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code_pair: { type: "string" },
                concern_type: { type: "string", enum: ["CCI_Edit", "Unbundling_Risk", "Separate_Billing"] },
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
          }
        }
      }
    });

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