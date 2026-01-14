import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get all active patients
    const patients = await base44.entities.Patient.filter({ status: 'active' });

    const riskAnalyses = [];

    for (const patient of patients) {
      // Get recent visits (last 30 days)
      const visits = await base44.entities.Visit.filter({ 
        patient_id: patient.id 
      }, '-visit_date', 10);

      // Get recent incidents
      const incidents = await base44.entities.Incident.filter({ 
        patient_id: patient.id 
      }, '-incident_date', 5);

      // Get care plans
      const carePlans = await base44.entities.CarePlan.filter({ 
        patient_id: patient.id,
        status: 'active'
      });

      // Build context for AI analysis
      const patientContext = {
        patient_name: `${patient.first_name} ${patient.last_name}`,
        primary_diagnosis: patient.primary_diagnosis,
        secondary_diagnoses: patient.secondary_diagnoses || [],
        age: patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : null,
        baseline_vitals: patient.baseline_vitals,
        recent_visits: visits.map(v => ({
          date: v.visit_date,
          type: v.visit_type,
          vitals: v.vital_signs,
          notes: v.nurse_notes
        })),
        recent_incidents: incidents.map(i => ({
          type: i.incident_type,
          date: i.incident_date,
          severity: i.severity,
          details: i.details
        })),
        active_care_plans: carePlans.length,
        medications: patient.current_medications || [],
        functional_status: patient.functional_status
      };

      // Use AI to analyze risk
      const aiResponse = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a clinical risk assessment AI. Analyze this patient's data and identify potential risks for adverse events, re-hospitalization, or care plan deviations.

Patient Data:
${JSON.stringify(patientContext, null, 2)}

Analyze for:
1. Re-hospitalization risk (based on diagnosis, vitals trends, recent incidents)
2. Adverse event risk (medication interactions, functional decline, incident patterns)
3. Care plan deviation risk (missed visits, declining vitals, non-compliance indicators)
4. Fall risk (functional status, age, recent falls)
5. Medication adherence concerns

Provide:
- Overall risk level (low, medium, high, critical)
- Specific risk factors identified
- Recommended interventions
- Priority level (1-5, where 5 is most urgent)`,
        response_json_schema: {
          type: "object",
          properties: {
            overall_risk_level: { type: "string", enum: ["low", "medium", "high", "critical"] },
            risk_score: { type: "number", description: "0-100 risk score" },
            risk_factors: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  category: { type: "string" },
                  description: { type: "string" },
                  severity: { type: "string", enum: ["low", "medium", "high", "critical"] }
                }
              }
            },
            recommended_interventions: {
              type: "array",
              items: { type: "string" }
            },
            priority: { type: "number", description: "1-5 priority level" },
            requires_immediate_attention: { type: "boolean" },
            summary: { type: "string" }
          }
        }
      });

      // Only create alerts for medium or higher risk
      if (aiResponse.overall_risk_level !== 'low') {
        // Create or update risk alert
        const existingAlerts = await base44.asServiceRole.entities.RiskAlert.filter({
          patient_id: patient.id,
          status: 'active'
        });

        if (existingAlerts.length > 0) {
          // Update existing alert
          await base44.asServiceRole.entities.RiskAlert.update(existingAlerts[0].id, {
            risk_level: aiResponse.overall_risk_level,
            risk_score: aiResponse.risk_score,
            risk_factors: aiResponse.risk_factors,
            recommended_actions: aiResponse.recommended_interventions,
            priority: aiResponse.priority,
            requires_immediate_action: aiResponse.requires_immediate_attention,
            summary: aiResponse.summary,
            last_analyzed: new Date().toISOString()
          });
        } else {
          // Create new alert
          await base44.asServiceRole.entities.RiskAlert.create({
            patient_id: patient.id,
            patient_name: `${patient.first_name} ${patient.last_name}`,
            risk_level: aiResponse.overall_risk_level,
            risk_score: aiResponse.risk_score,
            risk_factors: aiResponse.risk_factors,
            recommended_actions: aiResponse.recommended_interventions,
            priority: aiResponse.priority,
            requires_immediate_action: aiResponse.requires_immediate_attention,
            summary: aiResponse.summary,
            status: 'active',
            acknowledged_by: null,
            resolved_at: null
          });
        }

        // Create intervention tasks if high priority
        if (aiResponse.priority >= 4 && aiResponse.recommended_interventions.length > 0) {
          for (const intervention of aiResponse.recommended_interventions.slice(0, 3)) {
            await base44.asServiceRole.entities.Task.create({
              patient_id: patient.id,
              title: `High-Risk Alert: ${intervention}`,
              description: `AI-identified risk requires intervention for ${patient.first_name} ${patient.last_name}`,
              type: 'followup',
              priority: 'critical',
              status: 'pending',
              source: 'ai_generated',
              ai_reason: aiResponse.summary,
              due_timeframe: 'today'
            });
          }
        }

        riskAnalyses.push({
          patient_id: patient.id,
          patient_name: `${patient.first_name} ${patient.last_name}`,
          analysis: aiResponse
        });
      }
    }

    return Response.json({
      success: true,
      analyzed_patients: patients.length,
      high_risk_patients: riskAnalyses.length,
      risk_analyses: riskAnalyses
    });

  } catch (error) {
    console.error('Error analyzing patient risks:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});