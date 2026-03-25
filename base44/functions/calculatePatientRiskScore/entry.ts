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

    // Fetch comprehensive patient data
    const patient = await base44.entities.Patient.get(patient_id);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }
    
    // Fetch recent visits with vitals trends
    const visits = await base44.entities.Visit.filter(
      { patient_id },
      '-visit_date',
      20
    );

    // Fetch active alerts
    const alerts = await base44.entities.PatientAlert.filter({
      patient_id,
      status: 'active'
    });

    // Fetch care plans
    const carePlans = await base44.entities.CarePlan.filter({
      patient_id
    });

    // Fetch incidents
    const incidents = await base44.entities.Incident.filter({
      patient_id
    }, '-incident_date', 10);

    // Calculate vitals trends
    const vitalsTrends = visits
      .filter(v => v.vital_signs)
      .map(v => ({
        date: v.visit_date,
        bp_sys: v.vital_signs?.blood_pressure_systolic,
        bp_dia: v.vital_signs?.blood_pressure_diastolic,
        hr: v.vital_signs?.heart_rate,
        rr: v.vital_signs?.respiratory_rate,
        o2: v.vital_signs?.oxygen_saturation,
        temp: v.vital_signs?.temperature,
        weight: v.vital_signs?.weight
      }));

    // Generate AI risk assessment
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert clinical risk assessment AI. Analyze this patient's comprehensive data and generate a detailed risk score and assessment.

**Patient Demographics:**
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31536000000) : 'Unknown'}
- Care Type: ${patient.care_type || 'home_health'}
- Status: ${patient.status}
- Admission Date: ${patient.admission_date || 'N/A'}

**Diagnoses:**
- Primary: ${patient.primary_diagnosis || 'Not specified'}
- Secondary: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Past Medical History: ${patient.past_medical_history?.join(', ') || 'None'}

**Current Medications (${patient.current_medications?.length || 0}):**
${JSON.stringify(patient.current_medications || [], null, 2)}

**Functional Status:**
- Ambulation: ${patient.functional_status?.ambulation || 'Unknown'}
- ADL Independence: ${patient.functional_status?.adl_independence || 'Unknown'}
- Cognitive Status: ${patient.functional_status?.cognitive_status || 'Unknown'}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Unknown'}

**Mental Health:**
${JSON.stringify(patient.mental_health || {}, null, 2)}

**Pain Management:**
${JSON.stringify(patient.pain_management || {}, null, 2)}

**Active Wounds:** ${patient.wounds?.length || 0}
${patient.wounds ? JSON.stringify(patient.wounds, null, 2) : 'None'}

**Vitals Trends (Last 20 visits):**
${JSON.stringify(vitalsTrends, null, 2)}

**Active Alerts (${alerts.length}):**
${alerts.map(a => `- ${a.severity.toUpperCase()}: ${a.title} (Risk: ${a.risk_score || 'N/A'}%)`).join('\n')}

**Care Plans (${carePlans.length}):**
${carePlans.map(cp => `- ${cp.status.toUpperCase()}: ${cp.problem} (Progress: ${cp.progress_percentage || 0}%)`).join('\n')}

**Recent Incidents (${incidents.length}):**
${incidents.map(i => `- ${i.incident_type}: ${i.severity} on ${i.incident_date}`).join('\n')}

**Hospitalization History:**
${JSON.stringify(patient.past_hospitalizations || [], null, 2)}

**Social Determinants:**
${JSON.stringify(patient.social_history || {}, null, 2)}

**Analysis Instructions:**
1. Calculate an overall risk score (0-100) based on:
   - Clinical stability (vitals trends, diagnoses severity)
   - Functional decline risk (mobility, ADLs, cognitive changes)
   - Safety risks (falls, medications, wounds)
   - Readmission probability
   - Social/environmental factors
   - Care plan adherence and progress
   - Recent incidents and hospitalizations
   - Active alert severity and count

2. Identify specific risk factors contributing to the score
3. Categorize risk level (low, moderate, high, critical)
4. Provide clinical reasoning for the score
5. Suggest priority interventions
6. Identify early warning signs to monitor

**Scoring Guidelines:**
- 0-25: Low Risk (stable, minimal intervention needed)
- 26-50: Moderate Risk (close monitoring, preventive actions)
- 51-75: High Risk (intensive monitoring, immediate interventions)
- 76-100: Critical Risk (urgent medical attention, crisis prevention)

Be evidence-based and specific to THIS patient's actual data.`,
      response_json_schema: {
        type: "object",
        properties: {
          overall_risk_score: {
            type: "number",
            description: "0-100 risk score"
          },
          risk_level: {
            type: "string",
            enum: ["low", "moderate", "high", "critical"]
          },
          risk_factors: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                factor: { type: "string" },
                severity: { type: "string", enum: ["low", "medium", "high", "critical"] },
                impact_score: { type: "number" }
              }
            }
          },
          category_scores: {
            type: "object",
            properties: {
              clinical_stability: { type: "number" },
              functional_status: { type: "number" },
              safety_risk: { type: "number" },
              readmission_risk: { type: "number" },
              social_factors: { type: "number" }
            }
          },
          clinical_reasoning: { type: "string" },
          priority_interventions: {
            type: "array",
            items: { type: "string" }
          },
          early_warning_signs: {
            type: "array",
            items: { type: "string" }
          },
          recommended_monitoring_frequency: { type: "string" },
          confidence_score: {
            type: "number",
            description: "AI confidence in assessment (0-100)"
          }
        }
      }
    });

    // Store risk assessment in patient record with null checks
    try {
      await base44.asServiceRole.entities.Patient.update(patient_id, {
        risk_assessment: {
          score: response?.overall_risk_score || 0,
          level: response?.risk_level || 'low',
          last_calculated: new Date().toISOString(),
          confidence: response?.confidence_score || 0,
          category_scores: response?.category_scores || {}
        }
      });
    } catch (updateError) {
      console.error('Failed to store risk assessment:', updateError);
    }

    return Response.json({
      success: true,
      patient_id,
      risk_assessment: response,
      calculated_at: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error calculating patient risk score:', error);
    return Response.json({
      error: error.message,
      details: error.stack
    }, { status: 500 });
  }
});