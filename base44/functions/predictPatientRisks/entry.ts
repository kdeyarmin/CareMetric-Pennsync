import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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
    const [patients, visits, carePlans, incidents, alerts] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ id: patient_id }),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 20),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }),
      base44.asServiceRole.entities.Incident.filter({ patient_id }),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id, status: 'active' })
    ]);

    const patient = patients[0];
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    const completedVisits = visits.filter(v => v.status === 'completed');
    const recentVisits = completedVisits.slice(0, 5);

    // Prepare data for AI analysis
    const analysisData = {
      patient_info: {
        age: patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / (365.25 * 24 * 60 * 60 * 1000)) : null,
        primary_diagnosis: patient.primary_diagnosis,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        care_type: patient.care_type,
        admission_date: patient.admission_date,
        functional_status: patient.functional_status,
        social_history: patient.social_history,
        past_hospitalizations: patient.past_hospitalizations || []
      },
      recent_vitals: recentVisits.map(v => ({
        date: v.visit_date,
        vitals: v.vital_signs,
        notes_excerpt: v.nurse_notes?.substring(0, 200)
      })),
      vital_trends: calculateVitalTrends(recentVisits),
      care_plan_status: carePlans.map(cp => ({
        problem: cp.problem,
        status: cp.status,
        goal: cp.goal
      })),
      incident_history: incidents.map(i => ({
        type: i.incident_type,
        date: i.incident_date,
        severity: i.severity
      })),
      existing_alerts: alerts.map(a => ({
        type: a.alert_type,
        severity: a.severity
      }))
    };

    // AI Risk Prediction
    const predictionPrompt = `You are an expert clinical risk assessment AI for home health and hospice care. Analyze the following patient data and predict risks for adverse events.

PATIENT DATA:
${JSON.stringify(analysisData, null, 2)}

ANALYZE FOR THE FOLLOWING RISKS:
1. Hospital Readmission Risk (30-day)
2. Fall Risk
3. Disease Exacerbation Risk (CHF, COPD, diabetes, etc.)
4. Medication Non-adherence Risk
5. Functional Decline Risk
6. Infection Risk
7. Pressure Injury Risk
8. Caregiver Burnout Risk

For each risk category:
- Assign a risk score (0-100, where 100 is highest risk)
- Identify specific contributing factors from the data
- Provide actionable recommendations for risk mitigation
- Determine urgency level (low, medium, high, critical)

Pay special attention to:
- Vital sign trends (worsening or unstable)
- Recent incidents or hospitalizations
- Unmet care plan goals
- Diagnosis-specific warning signs
- Social determinants of health
- Gaps in care or documentation

Be specific and evidence-based in your predictions.`;

    const riskPredictions = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: predictionPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          overall_risk_level: {
            type: 'string',
            enum: ['low', 'medium', 'high', 'critical']
          },
          risk_assessments: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                risk_type: { type: 'string' },
                risk_score: { type: 'number' },
                urgency: { type: 'string' },
                contributing_factors: {
                  type: 'array',
                  items: { type: 'string' }
                },
                recommendations: {
                  type: 'array',
                  items: { type: 'string' }
                },
                evidence: { type: 'string' }
              }
            }
          },
          immediate_actions_needed: {
            type: 'array',
            items: { type: 'string' }
          },
          monitoring_priorities: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    });

    // Create alerts for high-risk findings
    const newAlerts = [];
    for (const risk of riskPredictions.risk_assessments) {
      if (risk.risk_score >= 70 && risk.urgency !== 'low') {
        // Check if alert already exists
        const existingAlert = alerts.find(a => 
          a.alert_type === mapRiskToAlertType(risk.risk_type) && 
          a.status === 'active'
        );

        if (!existingAlert) {
          const alert = await base44.asServiceRole.entities.PatientAlert.create({
            patient_id: patient_id,
            alert_type: mapRiskToAlertType(risk.risk_type),
            severity: risk.urgency === 'critical' ? 'critical' : 
                     risk.risk_score >= 85 ? 'high' : 'medium',
            title: `High ${risk.risk_type} Risk Detected`,
            message: `AI analysis indicates elevated risk (${risk.risk_score}/100). ${risk.evidence}`,
            contributing_factors: risk.contributing_factors,
            recommended_actions: risk.recommendations,
            risk_score: risk.risk_score,
            data_sources: {
              analysis_date: new Date().toISOString(),
              vital_trends: analysisData.vital_trends,
              recent_visits_count: recentVisits.length,
              incidents_count: incidents.length
            },
            status: 'active',
            flagged_urgent: risk.urgency === 'critical'
          });
          newAlerts.push(alert);
        }
      }
    }

    // Log the risk assessment
    await base44.asServiceRole.entities.SystemLog.create({
      job_name: 'AI Risk Prediction',
      job_type: 'other',
      status: 'success',
      message: `Analyzed risks for patient ${patient.first_name} ${patient.last_name}`,
      details: {
        patient_id,
        overall_risk_level: riskPredictions.overall_risk_level,
        high_risk_count: riskPredictions.risk_assessments.filter(r => r.risk_score >= 70).length,
        alerts_created: newAlerts.length,
        analyzed_by: user.email
      }
    });

    return Response.json({
      success: true,
      patient_id,
      overall_risk_level: riskPredictions.overall_risk_level,
      risk_assessments: riskPredictions.risk_assessments,
      immediate_actions: riskPredictions.immediate_actions_needed,
      monitoring_priorities: riskPredictions.monitoring_priorities,
      alerts_created: newAlerts.length,
      trends: analysisData.vital_trends
    });

  } catch (error) {
    console.error('Error predicting patient risks:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});

// Helper function to calculate vital sign trends
function calculateVitalTrends(visits) {
  const trends = {};
  const vitalKeys = ['blood_pressure_systolic', 'heart_rate', 'oxygen_saturation', 'weight', 'pain_level'];

  vitalKeys.forEach(key => {
    const values = visits
      .filter(v => v.vital_signs?.[key])
      .map(v => ({ date: v.visit_date, value: v.vital_signs[key] }))
      .reverse();

    if (values.length >= 2) {
      const recent = values.slice(-3).map(v => v.value);
      const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
      const previous = values.slice(0, Math.max(values.length - 3, 1)).map(v => v.value);
      const prevAvg = previous.reduce((a, b) => a + b, 0) / previous.length;

      const change = avg - prevAvg;
      const changePercent = prevAvg !== 0 ? (change / prevAvg) * 100 : 0;

      trends[key] = {
        current_avg: Math.round(avg * 10) / 10,
        previous_avg: Math.round(prevAvg * 10) / 10,
        change: Math.round(change * 10) / 10,
        change_percent: Math.round(changePercent),
        trend: changePercent > 5 ? 'increasing' : changePercent < -5 ? 'decreasing' : 'stable',
        values: values
      };
    }
  });

  return trends;
}

// Map risk types to alert types
function mapRiskToAlertType(riskType) {
  const mapping = {
    'Hospital Readmission Risk': 'readmission_risk',
    'Fall Risk': 'fall_risk',
    'Disease Exacerbation Risk': 'symptom_escalation',
    'Medication Non-adherence Risk': 'medication_risk',
    'Functional Decline Risk': 'care_gap',
    'Infection Risk': 'infection_risk',
    'Pressure Injury Risk': 'infection_risk',
    'Caregiver Burnout Risk': 'caregiver_burnout'
  };
  
  return mapping[riskType] || 'urgent_intervention';
}