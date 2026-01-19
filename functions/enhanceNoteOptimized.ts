import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const {
      roughNote,
      visitType,
      diagnosis,
      nurseType = 'RN',
      contextData = {},
      noteFormat = 'soap',
      formatInstructions = '',
      specialtyContext = null
    } = payload;

    // Build specialty-enhanced prompt
    let specialtyPrompt = '';
    let specialtyCodeGuidance = '';
    
    if (specialtyContext) {
      specialtyPrompt = `\n\nSPECIALTY CONTEXT - ${specialtyContext.specialty}:
${specialtyContext.aiPrompt}

Required Sections: ${specialtyContext.sections.join(', ')}

Focus on specialty-specific assessment and documentation standards.`;

      if (specialtyContext.commonCodes) {
        specialtyCodeGuidance = `\n\nCOMMON CODES FOR THIS SPECIALTY:
ICD-10: ${specialtyContext.commonCodes.icd10?.join(', ') || 'N/A'}
CPT: ${specialtyContext.commonCodes.cpt?.join(', ') || 'N/A'}

Consider these codes when relevant to the documented visit.`;
      }
    }

    const enhancePrompt = `You are an expert medical documentation assistant specializing in ${nurseType} clinical notes.

${formatInstructions}
${specialtyPrompt}

VISIT INFORMATION:
- Visit Type: ${visitType}
- Primary Diagnosis: ${diagnosis}
- Provider Type: ${nurseType}
${contextData?.patient_demographics ? `
PATIENT CONTEXT:
- Age: ${contextData.patient_demographics.age || 'Not specified'}
- Primary Diagnosis: ${contextData.patient_demographics.primary_diagnosis || diagnosis}
- Allergies: ${contextData.patient_demographics.allergies || 'None documented'}
- Current Medications: ${contextData.patient_demographics.current_medications || 'None documented'}
` : ''}

ROUGH NOTES FROM PROVIDER:
${roughNote}

${specialtyCodeGuidance}

TASK: Transform the rough notes into a professional, comprehensive clinical note following ${noteFormat.toUpperCase()} format.

Requirements:
1. Use proper medical terminology and grammar
2. Follow ${noteFormat.toUpperCase()} structure strictly
3. Include all relevant clinical details from the rough notes
4. Add medical necessity justification where appropriate
5. Ensure Medicare/insurance compliance
${specialtyContext ? `6. Include specialty-specific assessments and recommendations
7. Structure according to the ${specialtyContext.templateName} template` : ''}

Output the enhanced clinical note only, properly formatted.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: enhancePrompt
    });

    const enhancedNote = typeof response === 'string' ? response : response.content || response.text || '';

    // Generate specialty-specific differential diagnoses and code suggestions
    let differentialDiagnoses = [];
    let suggestedCodes = { icd10: [], cpt: [] };

    if (specialtyContext || (nurseType === 'MD' || nurseType === 'DO' || nurseType === 'NP')) {
      const diagnosticPrompt = `Based on this clinical note, provide specialty-specific differential diagnoses and billing codes:

Clinical Note:
${enhancedNote}

Primary Diagnosis: ${diagnosis}
${specialtyContext ? `Specialty: ${specialtyContext.specialty}` : `Provider Type: ${nurseType}`}

Provide:
1. Top 3-5 differential diagnoses to consider
2. Appropriate ICD-10 codes with descriptions
3. Recommended CPT codes for documented services`;

      const diagnosticResponse = await base44.integrations.Core.InvokeLLM({
        prompt: diagnosticPrompt,
        response_json_schema: {
          type: "object",
          properties: {
            differential_diagnoses: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  diagnosis: { type: "string" },
                  reasoning: { type: "string" },
                  probability: { type: "string", enum: ["high", "moderate", "low"] }
                }
              }
            },
            icd10_codes: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  code: { type: "string" },
                  description: { type: "string" },
                  relevance: { type: "string" }
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
                  documentation_basis: { type: "string" }
                }
              }
            }
          }
        }
      });

      differentialDiagnoses = diagnosticResponse.differential_diagnoses || [];
      suggestedCodes = {
        icd10: diagnosticResponse.icd10_codes || [],
        cpt: diagnosticResponse.cpt_codes || []
      };
    }

    return Response.json({
      success: true,
      enhanced_note: enhancedNote,
      differential_diagnoses: differentialDiagnoses,
      suggested_codes: suggestedCodes,
      specialty_applied: specialtyContext?.specialty || null
    });

  } catch (error) {
    console.error('Error enhancing note:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});