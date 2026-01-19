import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { clinical_note, patient_id, visit_type } = await req.json();

    if (!clinical_note) {
      return Response.json({ error: 'Clinical note is required' }, { status: 400 });
    }

    // Fetch patient data for context if provided
    let patientContext = '';
    if (patient_id) {
      try {
        const patient = await base44.entities.Patient.get(patient_id);
        patientContext = `
Patient Context:
- Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'N/A'}
- Care Type: ${patient.care_type || 'N/A'}
`;
      } catch (e) {
        console.log('Could not fetch patient:', e.message);
      }
    }

    const prompt = `You are an expert medical billing specialist with deep knowledge of ICD-10, CPT, and HCPCS codes for home health and hospice care.

${patientContext}

Visit Type: ${visit_type || 'N/A'}

Clinical Note:
${clinical_note}

Based on this clinical documentation, suggest appropriate billing codes with detailed justification:

1. **ICD-10 Diagnosis Codes**: Primary and secondary diagnoses that are documented
2. **CPT Codes**: Procedure codes for services provided (home health visits, skilled nursing, etc.)
3. **HCPCS Codes**: If applicable (supplies, DME, etc.)

For each suggested code, provide:
- The code and description
- Specific documentation in the note that supports this code
- Medical necessity justification
- Any additional documentation recommendations to strengthen the claim

Focus on:
- Medicare compliance and coverage criteria
- Medical necessity documentation
- Specificity (use most specific codes available)
- Chronic condition coding
- Comorbidity capture for case mix

Format your response as a structured analysis.`;

    const response = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false,
      response_json_schema: {
        type: "object",
        properties: {
          icd10_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["primary", "secondary"] },
                supporting_documentation: { type: "string" },
                medical_necessity: { type: "string" }
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
                supporting_documentation: { type: "string" },
                units: { type: "number" }
              }
            }
          },
          hcpcs_codes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                code: { type: "string" },
                description: { type: "string" },
                supporting_documentation: { type: "string" }
              }
            }
          },
          documentation_recommendations: {
            type: "array",
            items: { type: "string" }
          },
          compliance_notes: { type: "string" },
          estimated_reimbursement_impact: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      billing_suggestions: response,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in suggestBillingCodesFromNote:', error);
    return Response.json({ 
      error: 'Failed to generate billing code suggestions',
      details: error.message 
    }, { status: 500 });
  }
});