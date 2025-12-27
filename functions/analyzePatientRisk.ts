import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    // Fetch patient data
    const patient = await base44.entities.Patient.filter({ id: patient_id });
    if (!patient || patient.length === 0) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patientData = patient[0];

    // Fetch related data
    const [visits, carePlans, incidents] = await Promise.all([
      base44.entities.Visit.filter({ patient_id }, '-visit_date', 20),
      base44.entities.CarePlan.filter({ patient_id }),
      base44.entities.Incident.filter({ patient_id }, '-incident_date', 10)
    ]);

    // Build comprehensive context for AI analysis
    const analysisPrompt = `Analyze this patient's data and provide a comprehensive risk assessment:

PATIENT DEMOGRAPHICS:
- Age: ${patientData.date_of_birth ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : 'Unknown'}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patientData.care_type || 'home_health'}

CLINICAL STATUS:
- Current Medications: ${patientData.current_medications?.length || 0} medications
- Allergies: ${patientData.allergies || 'None documented'}
- Recent Hospitalizations: ${patientData.past_hospitalizations?.length || 0}
- Functional Status: ${JSON.stringify(patientData.functional_status || {})}
- Fall Risk: ${patientData.functional_status?.fall_risk || 'Not assessed'}

RECENT ACTIVITY:
- Recent Visits: ${visits.length} visits in last 60 days
- Active Care Plans: ${carePlans.filter(cp => cp.status === 'active').length}
- Recent Incidents: ${incidents.length}
- Recent Incident Types: ${incidents.map(i => i.incident_type).join(', ') || 'None'}

VITAL SIGNS TRENDS:
${visits.slice(0, 5).map(v => v.vital_signs ? `- ${v.visit_date}: BP ${v.vital_signs.blood_pressure_systolic}/${v.vital_signs.blood_pressure_diastolic}, HR ${v.vital_signs.heart_rate}, O2 ${v.vital_signs.oxygen_saturation}%` : '').join('\n')}

Provide a detailed risk analysis including:
1. Overall risk score (0-100) for each category
2. Specific risk factors identified
3. Evidence-based actionable interventions
4. Priority level (critical, high, medium, low)
5. Recommended monitoring frequency`;

    const riskAnalysis = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          hospitalization_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              factors: { type: "array", items: { type: "string" } },
              interventions: { type: "array", items: { type: "string" } },
              monitoring_frequency: { type: "string" }
            }
          },
          fall_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              factors: { type: "array", items: { type: "string" } },
              interventions: { type: "array", items: { type: "string" } },
              monitoring_frequency: { type: "string" }
            }
          },
          readmission_risk: {
            type: "object",
            properties: {
              score: { type: "number" },
              level: { type: "string" },
              factors: { type: "array", items: { type: "string" } },
              interventions: { type: "array", items: { type: "string" } },
              monitoring_frequency: { type: "string" }
            }
          },
          overall_summary: { type: "string" },
          priority_actions: { type: "array", items: { type: "string" } }
        }
      }
    });

    // Calculate overall risk score
    const overallScore = Math.round(
      (riskAnalysis.hospitalization_risk.score + 
       riskAnalysis.fall_risk.score + 
       riskAnalysis.readmission_risk.score) / 3
    );

    return Response.json({
      patient_id,
      analysis_date: new Date().toISOString(),
      overall_risk_score: overallScore,
      risk_categories: riskAnalysis,
      analyzed_by: user.email
    });

  } catch (error) {
    console.error('Risk analysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});