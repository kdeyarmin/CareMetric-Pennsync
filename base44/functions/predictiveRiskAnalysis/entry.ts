import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, risk_types } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch comprehensive patient data
    const patient = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
    if (!patient || patient.length === 0) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const patientData = patient[0];

    // Fetch related data
    const [visits, carePlans, incidents, existingAlerts] = await Promise.all([
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 10),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 5),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id, status: 'active' })
    ]);

    // Calculate age
    const age = patientData.date_of_birth 
      ? Math.floor((new Date() - new Date(patientData.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000))
      : null;

    // Analyze vital sign trends
    const vitalTrends = analyzeVitalTrends(visits);

    // Build comprehensive context
    const patientContext = `
PATIENT PROFILE:
- Name: ${patientData.first_name} ${patientData.last_name}
- Age: ${age || 'Unknown'}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patientData.secondary_diagnoses?.join(', ') || 'None'}
- Care Type: ${patientData.care_type || 'home_health'}
- Status: ${patientData.status || 'active'}

FUNCTIONAL STATUS:
- Ambulation: ${patientData.functional_status?.ambulation || 'Not assessed'}
- ADL Independence: ${patientData.functional_status?.adl_independence || 'Not assessed'}
- Cognitive Status: ${patientData.functional_status?.cognitive_status || 'Not assessed'}
- Fall Risk: ${patientData.functional_status?.fall_risk || 'Not assessed'}

SOCIAL DETERMINANTS:
- Living Situation: ${patientData.social_history?.living_situation || 'Unknown'}
- Primary Language: ${patientData.social_history?.primary_language || 'Not specified'}
- Interpreter Needed: ${patientData.social_history?.interpreter_needed ? 'Yes' : 'No'}
- Support System: ${patientData.social_history?.support_system || 'Not documented'}
- Transportation: ${patientData.social_history?.transportation || 'Not documented'}

MEDICATIONS: ${patientData.current_medications?.length || 0} medications
${patientData.current_medications?.slice(0, 10).map(m => `- ${m.name} ${m.dosage} ${m.frequency}`).join('\n') || 'None documented'}

ALLERGIES: ${patientData.allergies || 'None documented'}

RECENT VISIT HISTORY (Last 10 visits):
${visits.map(v => `- ${v.visit_date} (${v.visit_type}): ${v.nurse_notes?.substring(0, 200) || 'No notes'}...`).join('\n') || 'No recent visits'}

VITAL SIGN TRENDS:
${vitalTrends}

PAST HOSPITALIZATIONS:
${patientData.past_hospitalizations?.map(h => `- ${h.date}: ${h.reason} at ${h.hospital} (${h.length_of_stay} days)`).join('\n') || 'None documented'}

RECENT INCIDENTS (Last 5):
${incidents.map(i => `- ${i.incident_date}: ${i.incident_type} (${i.severity}) - ${i.report?.substring(0, 150)}...`).join('\n') || 'None reported'}

ACTIVE CARE PLANS:
${carePlans.filter(cp => cp.status === 'active').map(cp => `- Problem: ${cp.problem}, Goal: ${cp.goal}`).join('\n') || 'None active'}

BASELINE VITALS:
- BP: ${patientData.baseline_vitals?.blood_pressure_systolic}/${patientData.baseline_vitals?.blood_pressure_diastolic} mmHg
- HR: ${patientData.baseline_vitals?.heart_rate} bpm
- Temp: ${patientData.baseline_vitals?.temperature}°F
- O2: ${patientData.baseline_vitals?.oxygen_saturation}%
- Weight: ${patientData.baseline_vitals?.weight} lbs
`;

    // Generate risk analysis
    const riskAnalysis = await base44.integrations.Core.InvokeLLM({
      prompt: `You are an expert clinical risk assessment AI for home health/hospice care. Analyze this patient's comprehensive data to predict risk of adverse events and recommend preventative interventions.

${patientContext}

RISK ANALYSIS TASKS:
1. READMISSION RISK (0-100): Analyze likelihood of hospital readmission within 30 days based on:
   - Recent hospitalizations
   - Diagnosis complexity and comorbidities
   - Vital sign instability
   - Medication complexity and potential non-compliance
   - Social determinants (living alone, transportation issues, support system)
   - Fall risk and functional decline
   - Cognitive impairment

2. FALL RISK (0-100): Assess fall likelihood based on:
   - Functional status (ambulation, fall risk score)
   - Age and diagnoses
   - Medications causing dizziness/weakness
   - Cognitive status
   - Home environment factors
   - Previous fall incidents

3. ADVERSE EVENT RISK (0-100): Predict likelihood of adverse clinical events:
   - Vital sign trends showing deterioration
   - Symptom progression
   - Medication errors or interactions
   - Wound complications or infections
   - Acute exacerbations of chronic conditions

4. MEDICATION SAFETY RISK (0-100): Assess medication-related risks:
   - Polypharmacy (number of medications)
   - High-risk medications
   - Cognitive impairment affecting compliance
   - Lack of caregiver support
   - Recent medication changes

5. FUNCTIONAL DECLINE RISK (0-100): Predict likelihood of ADL/IADL decline:
   - Current functional status
   - Diagnosis progression
   - Age factors
   - Social isolation
   - Nutritional concerns

For EACH risk type with score >= 50, provide:
- Specific contributing factors from patient data
- Evidence-based preventative interventions
- Care plan adjustments
- Recommended tasks for care team
- Timeline for reassessment

Be specific, actionable, and clinically sound. Reference actual patient data points.

Return comprehensive risk assessment:`,
      response_json_schema: {
        type: "object",
        properties: {
          risk_scores: {
            type: "object",
            properties: {
              readmission_risk: { type: "number" },
              fall_risk: { type: "number" },
              adverse_event_risk: { type: "number" },
              medication_safety_risk: { type: "number" },
              functional_decline_risk: { type: "number" }
            }
          },
          high_risk_alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: { type: "string" },
                severity: { type: "string" },
                risk_score: { type: "number" },
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
                care_adjustments: {
                  type: "array",
                  items: { type: "string" }
                },
                reassessment_timeframe: { type: "string" }
              }
            }
          },
          overall_risk_level: { type: "string" },
          summary: { type: "string" }
        }
      }
    });

    // Create or update patient alerts for high-risk findings
    const createdAlerts = [];
    for (const alert of riskAnalysis.high_risk_alerts || []) {
      // Check if similar alert already exists
      const existingSimilar = existingAlerts.find(ea => 
        ea.alert_type === alert.alert_type && ea.status === 'active'
      );

      if (!existingSimilar) {
        const newAlert = await base44.asServiceRole.entities.PatientAlert.create({
          patient_id,
          alert_type: alert.alert_type,
          severity: alert.severity,
          title: alert.title,
          message: alert.message,
          contributing_factors: alert.contributing_factors,
          recommended_actions: alert.recommended_actions,
          risk_score: alert.risk_score,
          data_sources: {
            analysis_date: new Date().toISOString(),
            patient_age: age,
            diagnoses: patientData.primary_diagnosis,
            recent_visits: visits.length,
            incidents: incidents.length
          },
          status: 'active',
          flagged_urgent: alert.severity === 'critical'
        });
        createdAlerts.push(newAlert);
      }
    }

    return Response.json({
      success: true,
      patient_id,
      risk_scores: riskAnalysis.risk_scores,
      overall_risk_level: riskAnalysis.overall_risk_level,
      summary: riskAnalysis.summary,
      alerts_created: createdAlerts.length,
      high_risk_alerts: riskAnalysis.high_risk_alerts,
      analysis_timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Predictive risk analysis error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});

function analyzeVitalTrends(visits) {
  if (!visits || visits.length === 0) return 'No vital sign data available';

  const trends = [];
  const vitals = visits
    .filter(v => v.vital_signs)
    .map(v => ({
      date: v.visit_date,
      ...v.vital_signs
    }));

  if (vitals.length === 0) return 'No vital signs documented in recent visits';

  // BP trend
  const bpReadings = vitals.filter(v => v.blood_pressure_systolic).map(v => v.blood_pressure_systolic);
  if (bpReadings.length >= 2) {
    const recent = bpReadings.slice(0, 3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    trends.push(`BP Systolic avg (last 3): ${avg.toFixed(0)} mmHg`);
  }

  // Weight trend
  const weights = vitals.filter(v => v.weight).map(v => v.weight);
  if (weights.length >= 2) {
    const change = weights[0] - weights[weights.length - 1];
    trends.push(`Weight change: ${change > 0 ? '+' : ''}${change.toFixed(1)} lbs`);
  }

  // O2 trend
  const o2Readings = vitals.filter(v => v.oxygen_saturation).map(v => v.oxygen_saturation);
  if (o2Readings.length >= 2) {
    const recent = o2Readings.slice(0, 3);
    const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
    trends.push(`O2 Sat avg (last 3): ${avg.toFixed(0)}%`);
  }

  return trends.join('\n') || 'Insufficient data for trend analysis';
}