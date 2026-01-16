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

    const codingPrompt = `You are an expert medical coder and billing compliance specialist. Analyze the following clinical note and suggest appropriate medical codes.

CLINICAL NOTE:
${enhanced_note}

PRIMARY DIAGNOSIS: ${diagnosis}
VISIT TYPE: ${visit_type}
PROVIDER TYPE: ${provider_type}

${patient_context ? `PATIENT CONTEXT:
- Patient: ${patient_context.patient_name}
- Secondary Diagnoses: ${patient_context.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient_context.current_medications?.map(m => m.name || m).join(', ') || 'None'}
` : ''}

Please analyze this note and provide comprehensive medical coding recommendations including:

1. PRIMARY ICD-10 CODES: Main diagnostic codes applicable to this visit
2. SECONDARY ICD-10 CODES: Supporting diagnostic codes
3. CPT CODES: Procedure/service codes for billing
4. CCI & BUNDLING CONCERNS: Identify any Correct Coding Initiative issues or unbundling risks
5. DOCUMENTATION GAPS: Identify missing documentation needed for coding accuracy
6. COMPLIANCE NOTES: Key compliance considerations for this visit

For each code, provide:
- Code number
- Description
- Rationale for why it applies
- Confidence level (high/medium/low)
- Any special billing considerations

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