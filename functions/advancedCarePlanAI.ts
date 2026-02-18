import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id } = body;

    if (!patient_id) {
      return Response.json({ error: 'patient_id required' }, { status: 400 });
    }

    console.log(`[Care Plan AI] Analyzing patient ${patient_id}`);

    // Gather comprehensive patient data
    const [patients, carePlans, visits, tasks, alerts, incidents, riskAnalyses] = await Promise.all([
      base44.asServiceRole.entities.Patient.list(),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 20),
      base44.asServiceRole.entities.Task.filter({ patient_id }),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id }),
      base44.asServiceRole.entities.Incident.filter({ patient_id }),
      base44.asServiceRole.entities.RiskAnalysis.filter({ patient_id }, '-created_date', 5)
    ]);

    const patient = patients.find(p => p.id === patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Build context
    const activeCarePlans = carePlans.filter(cp => cp.status === 'active' || cp.status === 'in_progress');
    const recentVisits = visits.filter(v => v.status === 'completed').slice(0, 10);
    const activeAlerts = alerts.filter(a => a.status === 'active');
    const recentIncidents = incidents.slice(0, 5);
    const latestRisks = riskAnalyses[0];

    const patientContext = `
PATIENT PROFILE:
Name: ${patient.first_name} ${patient.last_name}
Age: ${calculateAge(patient.date_of_birth)}
Primary Diagnosis: ${patient.primary_diagnosis}
Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ')}
Chronic Conditions: ${(patient.chronic_conditions || []).map(c => c.condition).join(', ')}
Functional Status: ${patient.functional_status || 'Not documented'}
Mobility: ${patient.mobility_status || 'Not documented'}
Cognitive Status: ${patient.cognitive_status || 'Not documented'}

CURRENT MEDICATIONS (${(patient.current_medications || []).length}):
${(patient.current_medications || []).map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n')}

ACTIVE CARE PLANS (${activeCarePlans.length}):
${activeCarePlans.map(cp => `
Problem: ${cp.problem}
Goal: ${cp.goal}
Interventions: ${(cp.interventions || []).join(', ')}
Status: ${cp.status}
Target Date: ${cp.target_date}
`).join('\n')}

RECENT VISIT TRENDS (Last ${recentVisits.length} visits):
${recentVisits.slice(0, 5).map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Vitals: BP ${v.vital_signs?.blood_pressure_systolic}/${v.vital_signs?.blood_pressure_diastolic}, HR ${v.vital_signs?.heart_rate}, O2 ${v.vital_signs?.oxygen_saturation}%
Key Notes: ${(v.nurse_notes || '').substring(0, 300)}
`).join('\n')}

ACTIVE ALERTS (${activeAlerts.length}):
${activeAlerts.map(a => `- ${a.severity.toUpperCase()}: ${a.title}`).join('\n')}

RECENT INCIDENTS (${recentIncidents.length}):
${recentIncidents.map(i => `- ${i.incident_type}: ${i.description} (${i.date_occurred})`).join('\n')}

LATEST RISK SCORES:
${latestRisks ? `
Hospital Readmission: ${latestRisks.readmission_risk_score}%
Fall Risk: ${latestRisks.fall_risk_score}%
Overall Risk Level: ${latestRisks.overall_risk_level}
` : 'No recent risk analysis available'}

SOCIAL FACTORS:
Living Situation: ${patient.living_situation || 'Unknown'}
Caregiver Support: ${patient.caregiver_availability || 'Unknown'}
`;

    // AI Analysis
    const analysis = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert clinical care planning specialist for home health and hospice patients.

PATIENT CONTEXT:
${patientContext}

TASK: Perform comprehensive care plan analysis and provide:

1. **CARE PLAN GAP ANALYSIS**: Identify missing or inadequate care plans based on:
   - Patient's diagnoses and conditions
   - Recent clinical trends and vital signs
   - Active alerts and risk factors
   - Evidence-based best practices
   - Medicare coverage requirements

2. **EVIDENCE-BASED INTERVENTION SUGGESTIONS**: For each gap or existing plan, recommend:
   - Specific, actionable interventions
   - Clinical rationale (cite guidelines when possible)
   - Expected outcomes
   - Monitoring parameters
   - Frequency/duration

3. **ADHERENCE PREDICTION**: Analyze likelihood of patient adherence to each care plan considering:
   - Cognitive status and understanding
   - Caregiver support availability
   - Complexity of interventions
   - Past adherence patterns (from visit notes)
   - Barriers (physical, social, financial)
   - Provide adherence probability (0-100%) and key factors

4. **PRIORITY RANKING**: Rank all recommendations by:
   - Clinical urgency
   - Impact on outcomes
   - Medicare compliance
   - Resource requirements

5. **CARE PLAN OPTIMIZATION**: Suggest modifications to existing active care plans to improve effectiveness.

Be specific, actionable, and evidence-based. Focus on practical interventions nurses can implement.`,
      response_json_schema: {
        type: "object",
        properties: {
          gap_analysis: {
            type: "array",
            items: {
              type: "object",
              properties: {
                gap_type: { type: "string" },
                diagnosis_related: { type: "string" },
                severity: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                description: { type: "string" },
                clinical_rationale: { type: "string" },
                evidence_base: { type: "string" }
              }
            }
          },
          suggested_care_plans: {
            type: "array",
            items: {
              type: "object",
              properties: {
                problem: { type: "string" },
                goal: { type: "string" },
                interventions: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
                monitoring_parameters: { type: "array", items: { type: "string" } },
                frequency: { type: "string" },
                expected_outcomes: { type: "string" },
                target_timeframe: { type: "string" },
                priority: { type: "string", enum: ["critical", "high", "moderate", "low"] },
                adherence_prediction: {
                  type: "object",
                  properties: {
                    probability_percentage: { type: "number" },
                    confidence_level: { type: "string" },
                    facilitating_factors: { type: "array", items: { type: "string" } },
                    barriers: { type: "array", items: { type: "string" } },
                    adherence_strategies: { type: "array", items: { type: "string" } }
                  }
                }
              }
            }
          },
          existing_plan_optimizations: {
            type: "array",
            items: {
              type: "object",
              properties: {
                care_plan_id: { type: "string" },
                current_problem: { type: "string" },
                suggested_modifications: { type: "array", items: { type: "string" } },
                rationale: { type: "string" },
                expected_improvement: { type: "string" }
              }
            }
          },
          overall_assessment: {
            type: "object",
            properties: {
              care_plan_completeness_score: { type: "number" },
              adherence_risk_level: { type: "string" },
              key_concerns: { type: "array", items: { type: "string" } },
              immediate_actions: { type: "array", items: { type: "string" } }
            }
          }
        }
      }
    });

    console.log(`[Care Plan AI] Analysis complete - ${analysis.gap_analysis?.length || 0} gaps, ${analysis.suggested_care_plans?.length || 0} suggestions`);

    return Response.json({
      success: true,
      analysis,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      analyzed_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('[Care Plan AI] Error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function calculateAge(dob) {
  if (!dob) return 'Unknown';
  const diff = Date.now() - new Date(dob).getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
}