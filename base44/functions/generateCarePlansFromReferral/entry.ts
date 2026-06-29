import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, referral_data, primary_diagnosis, secondary_diagnoses } = await req.json();

    if (!patient_id || !referral_data) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Verify the caller can actually see this patient (user-scoped read enforces
    // RLS/tenant scoping) BEFORE writing active CarePlans via the service-role
    // client below. Without this, any authenticated user could attach care plans
    // to an arbitrary patient_id outside their scope.
    const patientRows = await base44.entities.Patient.filter({ id: patient_id });
    if (!patientRows || patientRows.length === 0) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Generate comprehensive care plans using AI
    const result = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `Generate comprehensive, Medicare-compliant care plans for this home health patient based on their referral and diagnoses.

PRIMARY DIAGNOSIS: ${primary_diagnosis}
SECONDARY DIAGNOSES: ${secondary_diagnoses?.join(', ') || 'None'}

REFERRAL DATA:
${JSON.stringify(referral_data, null, 2)}

Generate 3-5 specific care plans that:
1. Address the primary diagnosis and key comorbidities
2. Are measurable and time-bound (typically 60 days)
3. Include specific nursing interventions
4. Are Medicare-compliant and PDGM-optimized
5. Follow standard nursing diagnosis frameworks

For each care plan provide:
- Problem/Nursing Diagnosis
- Measurable Goal
- Specific Interventions (3-5)
- Baseline Measurement
- Frequency of Assessment
- Target Date
- Priority Level`,
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
                baseline_measurement: { type: "string" },
                frequency: { type: "string" },
                target_days: { type: "number" },
                priority: { type: "string" }
              }
            }
          },
          education_priorities: {
            type: "array",
            items: { type: "string" }
          },
          coordination_needs: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Create care plans in database
    const createdCarePlans = [];
    const targetDate = new Date();
    
    for (const plan of (result?.care_plans || [])) {
      const planTargetDate = new Date(targetDate);
      planTargetDate.setDate(planTargetDate.getDate() + (plan.target_days || 60));

      const carePlan = await base44.asServiceRole.entities.CarePlan.create({
        patient_id,
        problem: plan.problem,
        goal: plan.goal,
        interventions: plan.interventions,
        baseline_measurement: plan.baseline_measurement,
        frequency: plan.frequency,
        target_date: planTargetDate.toISOString().split('T')[0],
        status: 'active'
      });

      createdCarePlans.push(carePlan);
    }

    return Response.json({
      success: true,
      care_plans_created: createdCarePlans.length,
      care_plans: createdCarePlans,
      education_priorities: result.education_priorities,
      coordination_needs: result.coordination_needs
    });

  } catch (error) {
    console.error('Error generating care plans:', error);
    return Response.json({ 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
});