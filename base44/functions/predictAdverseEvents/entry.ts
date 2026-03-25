import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, trigger_source = 'manual' } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch comprehensive patient data
    const [patient, visits, carePlans, incidents, existingAlerts] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ id: patient_id }).then(r => r[0]),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 20),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 10),
      base44.asServiceRole.entities.PatientAlert.filter({ patient_id, status: 'active' })
    ]);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Get recent visit notes
    const recentNotes = visits.slice(0, 5).map(v => ({
      date: v.visit_date,
      type: v.visit_type,
      notes: v.nurse_notes,
      vital_signs: v.vital_signs
    }));

    // Build comprehensive context for AI analysis
    const analysisContext = {
      patient: {
        age: patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'unknown',
        primary_diagnosis: patient.primary_diagnosis,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        allergies: patient.allergies,
        current_medications: patient.current_medications || [],
        past_medical_history: patient.past_medical_history || [],
        past_hospitalizations: patient.past_hospitalizations || [],
        baseline_vitals: patient.baseline_vitals || {},
        functional_status: patient.functional_status || {},
        social_history: patient.social_history || {}
      },
      recent_visits: recentNotes,
      active_care_plans: carePlans.filter(cp => cp.status === 'active').map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status
      })),
      recent_incidents: incidents.map(inc => ({
        type: inc.incident_type,
        date: inc.incident_date,
        severity: inc.severity,
        details: inc.details
      })),
      existing_alerts: existingAlerts.map(a => ({
        type: a.alert_type,
        severity: a.severity,
        created: a.created_date
      }))
    };

    // Call AI to predict adverse events
    const predictionPrompt = `You are a clinical AI assistant analyzing patient data to predict potential adverse events and recommend interventions.

PATIENT DATA:
${JSON.stringify(analysisContext, null, 2)}

ANALYSIS TASK:
Analyze this patient's comprehensive data to identify risks for:
1. Falls
2. Hospital readmissions
3. Infections
4. Clinical deterioration
5. Medication-related adverse events

For each identified risk:
- Assess severity (critical, high, medium, low)
- Identify contributing factors from the data
- Calculate a risk score (0-100)
- Provide specific, actionable intervention recommendations
- Suggest monitoring frequency

IMPORTANT:
- Only flag risks with medium or higher severity
- Be specific about which data points support each risk
- Prioritize actionable interventions nurses can implement
- Consider the patient's functional status and social determinants
- Avoid duplicate alerts if similar risks are already flagged

Return a JSON array of alerts. Each alert must have:
{
  "alert_type": "fall_risk" | "readmission_risk" | "infection_risk" | "deterioration_risk" | "medication_risk",
  "severity": "critical" | "high" | "medium" | "low",
  "title": "Brief alert title",
  "message": "Detailed explanation of the risk",
  "risk_score": number (0-100),
  "contributing_factors": ["factor1", "factor2"],
  "recommended_actions": ["action1", "action2"],
  "monitoring_frequency": "immediate" | "daily" | "every_visit" | "weekly",
  "data_sources": {"vitals": {}, "notes": "", "incidents": ""}
}`;

    const aiResponse = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: predictionPrompt,
      response_json_schema: {
        type: "object",
        properties: {
          alerts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                alert_type: { type: "string" },
                severity: { type: "string" },
                title: { type: "string" },
                message: { type: "string" },
                risk_score: { type: "number" },
                contributing_factors: { type: "array", items: { type: "string" } },
                recommended_actions: { type: "array", items: { type: "string" } },
                monitoring_frequency: { type: "string" },
                data_sources: { type: "object" }
              }
            }
          }
        }
      }
    });

    const predictions = aiResponse.alerts || [];
    
    // Create PatientAlert records for new predictions
    const createdAlerts = [];
    for (const prediction of predictions) {
      // Check if similar alert already exists
      const isDuplicate = existingAlerts.some(ea => 
        ea.alert_type === prediction.alert_type && 
        ea.severity === prediction.severity
      );

      if (!isDuplicate) {
        const alertRecord = await base44.asServiceRole.entities.PatientAlert.create({
          patient_id,
          alert_type: prediction.alert_type,
          severity: prediction.severity,
          title: prediction.title,
          message: prediction.message,
          contributing_factors: prediction.contributing_factors || [],
          recommended_actions: prediction.recommended_actions || [],
          risk_score: prediction.risk_score || 0,
          data_sources: prediction.data_sources || {},
          status: 'active',
          flagged_urgent: prediction.severity === 'critical',
          assigned_to: user.email
        });
        createdAlerts.push(alertRecord);
      }
    }

    // Log activity
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'ai_adverse_event_prediction',
      details: {
        patient_id,
        trigger_source,
        predictions_count: predictions.length,
        new_alerts_count: createdAlerts.length
      },
      page: 'predictAdverseEvents',
      entity_type: 'PatientAlert',
      user_agent: req.headers.get('user-agent')
    });

    return Response.json({
      success: true,
      patient_id,
      predictions_analyzed: predictions.length,
      new_alerts_created: createdAlerts.length,
      alerts: createdAlerts
    });

  } catch (error) {
    console.error('Adverse event prediction error:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});