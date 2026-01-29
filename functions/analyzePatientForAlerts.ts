import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch patient data
    const patient = await base44.entities.Patient.get(patient_id);
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Fetch recent visits
    const recentVisits = await base44.entities.Visit.filter(
      { patient_id },
      '-visit_date',
      10
    );

    // Fetch active care plans
    const carePlans = await base44.entities.CarePlan.filter({
      patient_id,
      status: 'active'
    });

    // Fetch existing active alerts
    const existingAlerts = await base44.entities.PatientAlert.filter({
      patient_id,
      status: 'active'
    });

    // Build comprehensive analysis prompt
    const analysisPrompt = `Analyze this patient's data for potential clinical risks and issues that require alerts:

PATIENT INFO:
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'None'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None'}

CURRENT MEDICATIONS (${patient.current_medications?.length || 0}):
${patient.current_medications?.map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'None'}

BASELINE VITALS:
${patient.baseline_vitals ? JSON.stringify(patient.baseline_vitals, null, 2) : 'None'}

RECENT VISITS (Last ${recentVisits.length}):
${recentVisits.map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Vitals: ${v.vital_signs ? JSON.stringify(v.vital_signs) : 'None'}
Notes Excerpt: ${v.nurse_notes?.substring(0, 200) || 'None'}
`).join('\n---\n')}

FUNCTIONAL STATUS:
${patient.functional_status ? JSON.stringify(patient.functional_status, null, 2) : 'None'}

PAST MEDICAL HISTORY:
${patient.past_medical_history?.join(', ') || 'None'}

EXISTING ACTIVE ALERTS (${existingAlerts.length}):
${existingAlerts.map(a => `- ${a.alert_type}: ${a.title}`).join('\n') || 'None'}

ANALYSIS REQUIREMENTS:
1. Identify vital sign trends (deterioration, stability, improvement)
2. Check for potential medication interactions or contraindications
3. Assess fall risk and safety concerns
4. Evaluate disease progression or complications
5. Identify care gaps or missing interventions
6. Check for readmission risk factors
7. Assess caregiver support needs

For each identified issue, provide:
- Alert type (from: vital_deterioration, medication_risk, fall_risk, readmission_risk, infection_risk, symptom_escalation, care_gap, urgent_intervention, hospice_transition, caregiver_burnout)
- Severity (critical, high, medium, low)
- Title (brief, actionable)
- Message (clear explanation)
- Contributing factors
- Recommended actions
- Risk score (0-100)

IMPORTANT: Only suggest NEW alerts that don't duplicate existing active alerts. Focus on actionable clinical issues.`;

    const { invokeClaude } = await import('./helpers/claudeClient.ts');
    const response = await invokeClaude({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          suggested_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: {
                  type: "string",
                  enum: [
                    "vital_deterioration",
                    "medication_risk",
                    "fall_risk",
                    "readmission_risk",
                    "infection_risk",
                    "symptom_escalation",
                    "care_gap",
                    "urgent_intervention",
                    "hospice_transition",
                    "caregiver_burnout"
                  ]
                },
                severity: {
                  type: "string",
                  enum: ["critical", "high", "medium", "low"]
                },
                title: { type: "string" },
                message: { type: "string" },
                contributing_factors: {
                  type: "array",
                  items: { type: "string" }
                },
                recommended_actions: {
                  type: "array",
                  items: { type: "string" }
                },
                risk_score: { type: "number" },
                data_sources: { type: "object" },
                clinical_rationale: { type: "string" }
              }
            }
          },
          overall_risk_assessment: { type: "string" },
          priority_concerns: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      patient_id,
      analysis_date: new Date().toISOString(),
      suggested_alerts: response.suggested_alerts || [],
      overall_risk_assessment: response.overall_risk_assessment,
      priority_concerns: response.priority_concerns || [],
      patient_summary: {
        name: `${patient.first_name} ${patient.last_name}`,
        primary_diagnosis: patient.primary_diagnosis,
        active_alerts_count: existingAlerts.length,
        recent_visits_count: recentVisits.length
      }
    });

  } catch (error) {
    console.error('Error analyzing patient for alerts:', error);
    return Response.json(
      { error: error.message || 'Failed to analyze patient' },
      { status: 500 }
    );
  }
});