import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, visit_type, referral_data } = await req.json();

    if (!patient_id && !referral_data) {
      return Response.json({ error: 'Either patient_id or referral_data required' }, { status: 400 });
    }

    // Fetch patient data if patient_id provided
    let patientData = null;
    let carePlans = [];
    
    if (patient_id) {
      const [patients, plans] = await Promise.all([
        base44.entities.Patient.filter({ id: patient_id }),
        base44.entities.CarePlan.filter({ patient_id, status: 'active' })
      ]);
      patientData = patients[0];
      carePlans = plans;
    }

    const contextData = referral_data || patientData;

    // Generate OASIS assessment using AI
    const result = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `Generate a comprehensive OASIS assessment guide for this home health patient.

VISIT TYPE: ${visit_type || 'Start of Care'}

PATIENT DATA:
${JSON.stringify(contextData, null, 2)}

ACTIVE CARE PLANS:
${JSON.stringify(carePlans, null, 2)}

CRITICAL INSTRUCTIONS:
- Provide clear, complete responses without abbreviations or truncated text
- Write full words and sentences - do NOT use shortened text like "- & A s s e s s"
- Always write complete OASIS item names
- Use proper spacing between words
- Do NOT include administrative items M1000-M1060 (Medicare Number, Medicaid Number, Physician Name, Physician Phone)
- These administrative items are auto-generated in the EHR system

Generate:

1. KEY OASIS ITEMS: Identify the most relevant OASIS items based on diagnoses and clinical presentation (15-20 items)
   - Exclude M1000-M1060 administrative section
   - Focus on clinical assessment items only

2. PRE-FILLED RESPONSES: For each item, provide:
   - Item number and full description (not truncated)
   - Complete suggested response/score based on available data
   - Confidence level (High/Medium/Low)
   - Clear rationale for the suggestion
   - Specific questions to ask patient/caregiver to confirm
   - Documentation tips with complete sentences

3. ASSESSMENT PRIORITIES: What to assess first based on clinical urgency

4. PDGM OPTIMIZATION: Which responses maximize appropriate reimbursement

5. MISSING DATA: What critical information is needed but not available

Focus on functional status, cognitive status, medications, wounds, and clinical factors affecting care.
Write everything clearly and completely - no truncated text.`,
      response_json_schema: {
        type: "object",
        properties: {
          oasis_items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                item_number: { type: "string" },
                item_name: { type: "string" },
                category: { type: "string" },
                suggested_response: { type: "string" },
                confidence_level: { type: "string" },
                rationale: { type: "string" },
                questions_to_ask: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_tips: {
                  type: "array",
                  items: { type: "string" }
                },
                pdgm_impact: { type: "string" }
              }
            }
          },
          assessment_priorities: {
            type: "array",
            items: {
              type: "object",
              properties: {
                priority: { type: "string" },
                area: { type: "string" },
                rationale: { type: "string" }
              }
            }
          },
          missing_critical_data: {
            type: "array",
            items: { type: "string" }
          },
          pdgm_optimization_notes: {
            type: "array",
            items: { type: "string" }
          },
          estimated_pdgm_group: { type: "string" },
          clinical_summary: { type: "string" }
        }
      }
    });

    return Response.json({
      success: true,
      visit_type: visit_type || 'Start of Care',
      ...result
    });

  } catch (error) {
    console.error('Error generating OASIS assessment:', error);
    // Do not leak internal error details (error.toString()/stack) to the
    // caller — could expose PHI or implementation details.
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});