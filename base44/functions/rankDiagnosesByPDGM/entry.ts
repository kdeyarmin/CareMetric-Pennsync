import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { diagnoses, patient_data } = await req.json();

    if (!diagnoses || diagnoses.length === 0) {
      return Response.json({ error: 'No diagnoses provided' }, { status: 400 });
    }

    // Use AI to rank diagnoses by PDGM reimbursement potential
    const result = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `You are a Medicare PDGM reimbursement expert. Analyze and rank these diagnoses by their PDGM reimbursement potential.

DIAGNOSES TO RANK:
${diagnoses.map((d, i) => `${i + 1}. ${d}`).join('\n')}

PATIENT CONTEXT:
${JSON.stringify(patient_data || {}, null, 2)}

For each diagnosis, provide:
1. PDGM Clinical Group assignment
2. Estimated reimbursement tier (High, Medium, Low)
3. Key factors affecting reimbursement
4. Comorbidity adjustments that could apply
5. Documentation requirements for optimal reimbursement

Rank all diagnoses from highest to lowest reimbursement potential.`,
      response_json_schema: {
        type: "object",
        properties: {
          ranked_diagnoses: {
            type: "array",
            items: {
              type: "object",
              properties: {
                diagnosis: { type: "string" },
                rank: { type: "number" },
                pdgm_clinical_group: { type: "string" },
                reimbursement_tier: { type: "string" },
                estimated_payment_range: { type: "string" },
                key_factors: {
                  type: "array",
                  items: { type: "string" }
                },
                comorbidity_adjustments: {
                  type: "array",
                  items: { type: "string" }
                },
                documentation_requirements: {
                  type: "array",
                  items: { type: "string" }
                },
                rationale: { type: "string" }
              }
            }
          },
          optimal_primary_diagnosis: { type: "string" },
          recommended_secondary_diagnoses: {
            type: "array",
            items: { type: "string" }
          },
          pdgm_optimization_tips: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      ...result
    });

  } catch (error) {
    console.error('Error ranking diagnoses:', error);
    return Response.json({ 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
});