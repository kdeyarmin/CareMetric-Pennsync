import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referralData, intakeAnalysis, existingCarePlans = [] } = await req.json();

    const prompt = `You are an expert home health care planning specialist. Generate comprehensive, Medicare-compliant care plans based on this referral data.

REFERRAL DATA:
${JSON.stringify(referralData, null, 2)}

AI INTAKE ANALYSIS:
${JSON.stringify(intakeAnalysis, null, 2)}

EXISTING CARE PLANS (if any):
${JSON.stringify(existingCarePlans, null, 2)}

Generate 3-5 care plans that address the patient's primary needs. Each care plan should follow this structure and be specific, measurable, and achievable.

Return a JSON array of care plans with this exact structure:
[
  {
    "problem": "Clear nursing diagnosis (e.g., 'Impaired mobility related to post-surgical status')",
    "goal": "Specific, measurable goal with timeframe (e.g., 'Patient will ambulate 50 feet with walker independently within 30 days')",
    "interventions": [
      "Specific nursing intervention 1",
      "Specific nursing intervention 2",
      "Specific nursing intervention 3"
    ],
    "frequency": "How often to assess (e.g., 'Each visit', 'Weekly', '3x per week')",
    "baseline_measurement": "Current state/measurement (e.g., 'Currently ambulates 20 feet with max assist')",
    "target_days": 30 or 60 or 90,
    "priority": "high|medium|low",
    "rationale": "Brief clinical rationale for this care plan"
  }
]

GUIDELINES:
- Address primary diagnosis and complications
- Include medication management if applicable
- Address functional limitations and ADL needs
- Include patient/caregiver education
- Consider safety issues (falls, infection, etc.)
- Avoid duplicating existing care plans
- Make goals SMART (Specific, Measurable, Achievable, Relevant, Time-bound)
- Use professional nursing language
- Prioritize based on clinical urgency and patient needs`;

    const response = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: prompt,
      response_json_schema: {
        type: "object",
        properties: {
          care_plans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                goal: { type: "string" },
                interventions: {
                  type: "array",
                  items: { type: "string" }
                },
                frequency: { type: "string" },
                baseline_measurement: { type: "string" },
                target_days: { type: "number" },
                priority: { type: "string" },
                rationale: { type: "string" }
              }
            }
          }
        }
      }
    });

    return Response.json({
      success: true,
      care_plans: response.care_plans || []
    });

  } catch (error) {
    console.error('Care plan generation error:', error);
    return Response.json({ 
      error: 'Failed to generate care plans',
      details: error.message 
    }, { status: 500 });
  }
});