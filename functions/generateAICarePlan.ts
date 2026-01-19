import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, auto_create = false } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch comprehensive patient data
    const patient = await base44.entities.Patient.get(patient_id);
    
    // Fetch recent visits
    const visits = await base44.entities.Visit.filter(
      { patient_id },
      '-visit_date',
      10
    );

    // Fetch active alerts
    const alerts = await base44.entities.PatientAlert.filter({
      patient_id,
      status: 'active'
    });

    // Fetch existing care plans
    const existingCarePlans = await base44.entities.CarePlan.filter({
      patient_id,
      status: 'active'
    });

    // Generate AI care plan
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert home health/hospice care planner. Analyze this patient's comprehensive data and generate personalized, evidence-based care plans.

**Patient Profile:**
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31536000000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patient.care_type || 'home_health'}
- Status: ${patient.status}

**Current Medications:**
${JSON.stringify(patient.current_medications || [], null, 2)}

**Functional Status:**
${JSON.stringify(patient.functional_status || {}, null, 2)}

**Mental Health:**
${JSON.stringify(patient.mental_health || {}, null, 2)}

**Pain Management:**
${JSON.stringify(patient.pain_management || {}, null, 2)}

**Recent Visit Notes (last 10):**
${visits.map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Vitals: ${JSON.stringify(v.vital_signs || {})}
Notes: ${v.nurse_notes?.substring(0, 300) || 'No notes'}
`).join('\n---\n')}

**Active Alerts & Identified Risks:**
${alerts.map(a => `
- ${a.severity.toUpperCase()}: ${a.title}
  Message: ${a.message}
  Contributing Factors: ${a.contributing_factors?.join(', ') || 'N/A'}
  Recommended Actions: ${a.recommended_actions?.join(', ') || 'N/A'}
`).join('\n')}

**Existing Care Plans:**
${existingCarePlans.map(cp => `
- Problem: ${cp.problem}
  Goal: ${cp.goal}
  Progress: ${cp.progress_percentage}%
  Status: ${cp.status}
`).join('\n')}

**Instructions:**
1. Identify clinical problems/nursing diagnoses that need addressing (avoid duplicating existing active care plans unless updates needed)
2. For each problem, create a SMART goal (Specific, Measurable, Achievable, Relevant, Time-bound)
3. List evidence-based nursing interventions
4. Define how to measure progress (baseline and target measurements)
5. Suggest appropriate frequency for assessment
6. Estimate timeframe for goal achievement (in days)
7. Prioritize based on patient safety, risk level, and impact on quality of life

**Generate 3-5 high-priority care plans.** Focus on:
- Safety risks (falls, medication issues, infection)
- Care gaps identified in alerts
- Declining functional status or vital signs
- Pain management needs
- Mental health concerns
- Caregiver support needs

For each care plan, provide:
- Clear problem statement (nursing diagnosis format)
- Measurable goal
- 3-5 specific interventions
- Baseline measurement description
- Target measurement for success
- Assessment frequency (e.g., "Each visit", "Weekly", "Bi-weekly")
- Priority level (high/medium/low)
- Estimated days to achieve goal (30-90 days typical)
- Rationale explaining why this care plan is important for this patient

Be specific to THIS patient's situation. Reference their actual diagnoses, alerts, and recent assessment findings.`,
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
                target_measurement: { type: "string" },
                frequency: { type: "string" },
                priority: {
                  type: "string",
                  enum: ["high", "medium", "low"]
                },
                estimated_days: { type: "number" },
                rationale: { type: "string" }
              }
            }
          },
          overall_assessment: { type: "string" },
          care_plan_priorities: {
            type: "array",
            items: { type: "string" }
          },
          monitoring_recommendations: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    const createdCarePlans = [];

    // Auto-create care plans if requested
    if (auto_create && response.care_plans) {
      for (const plan of response.care_plans) {
        const targetDate = new Date();
        targetDate.setDate(targetDate.getDate() + (plan.estimated_days || 60));

        const carePlan = await base44.asServiceRole.entities.CarePlan.create({
          patient_id,
          problem: plan.problem,
          goal: plan.goal,
          interventions: plan.interventions,
          baseline_measurement: plan.baseline_measurement,
          current_measurement: plan.baseline_measurement,
          frequency: plan.frequency,
          target_date: targetDate.toISOString().split('T')[0],
          status: 'active',
          progress_percentage: 0
        });

        createdCarePlans.push(carePlan);
      }
    }

    return Response.json({
      success: true,
      ai_suggestions: response,
      care_plans_created: createdCarePlans.length,
      created_care_plans: createdCarePlans
    });

  } catch (error) {
    console.error('Error generating AI care plan:', error);
    return Response.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});