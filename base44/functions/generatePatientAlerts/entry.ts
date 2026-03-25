import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get request parameters
    const { patient_id, auto_create_tasks = false } = await req.json();

    // Fetch active patients (or specific patient if provided)
    let patients = [];
    if (patient_id) {
      const patient = await base44.entities.Patient.get(patient_id);
      if (!patient) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      patients = [patient];
    } else {
      patients = await base44.entities.Patient.filter({ status: 'active' });
    }

    const allAlerts = [];
    const allTasks = [];

    for (const patient of patients) {
      // Fetch recent visits for this patient
      const recentVisits = await base44.entities.Visit.filter({
        patient_id: patient.id
      }, '-visit_date', 10);

      // Fetch existing care plans
      const carePlans = await base44.entities.CarePlan.filter({
        patient_id: patient.id,
        status: 'active'
      });

      // Analyze patient data with AI
      const response = await base44.integrations.Core.InvokeLLM({
        prompt: `Analyze this patient's data to identify care gaps, risks, and recommend proactive interventions.

Patient Profile:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? Math.floor((new Date() - new Date(patient.date_of_birth)) / 31536000000) : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${JSON.stringify(patient.current_medications || [])}
- Allergies: ${patient.allergies || 'None documented'}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}
- Mental Health: ${JSON.stringify(patient.mental_health || {})}
- Pain Management: ${JSON.stringify(patient.pain_management || {})}
- Active Wounds: ${patient.wounds?.length || 0}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Unknown'}

Recent Visits (last 10):
${JSON.stringify(recentVisits.map(v => ({
  date: v.visit_date,
  type: v.visit_type,
  vitals: v.vital_signs,
  notes_excerpt: v.nurse_notes?.substring(0, 200)
})))}

Active Care Plans:
${JSON.stringify(carePlans.map(cp => ({
  problem: cp.problem,
  goal: cp.goal,
  progress: cp.progress_percentage,
  status: cp.status
})))}

Identify and flag:
1. **Medication Risks**: Drug interactions, adherence concerns, missing medications
2. **Vital Sign Deterioration**: Concerning trends in BP, HR, O2, weight
3. **Care Plan Gaps**: Unmet goals, missing interventions, lack of progress
4. **Readmission Risks**: Recent hospitalizations, unstable conditions
5. **Fall/Safety Risks**: Environmental hazards, mobility issues, cognitive decline
6. **Infection Risks**: Open wounds, catheter use, recent antibiotic use
7. **Symptom Escalation**: Pain increase, new symptoms, worsening function
8. **Social/Caregiver Issues**: Isolation, caregiver burnout, resource needs
9. **Documentation Gaps**: Missing assessments, incomplete histories
10. **Preventive Care**: Overdue screenings, vaccinations, specialist referrals

For each identified risk/gap, provide:
- Clear, actionable alert title
- Detailed explanation with supporting data
- Specific recommended actions for staff
- Suggested priority/severity
- Whether this requires immediate attention

Only flag genuine concerns - avoid false positives.`,
        response_json_schema: {
          type: "object",
          properties: {
            alerts: {
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
                  data_points: { type: "object" },
                  suggested_tasks: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        description: { type: "string" },
                        priority: {
                          type: "string",
                          enum: ["critical", "high", "medium", "low"]
                        },
                        due_timeframe: {
                          type: "string",
                          enum: ["today", "24_hours", "48_hours", "this_week"]
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      });

      // Create PatientAlert entities
      for (const alertData of response.alerts || []) {
        try {
          const alert = await base44.asServiceRole.entities.PatientAlert.create({
            patient_id: patient.id,
            alert_type: alertData.alert_type,
            severity: alertData.severity,
            title: alertData.title,
            message: alertData.message,
            contributing_factors: alertData.contributing_factors,
            recommended_actions: alertData.recommended_actions,
            data_sources: alertData.data_points,
            status: 'active',
            flagged_urgent: alertData.severity === 'critical',
            assigned_to: user.email
          });

          allAlerts.push(alert);

          // Optionally create tasks
          if (auto_create_tasks && alertData.suggested_tasks) {
            for (const taskData of alertData.suggested_tasks) {
              try {
                const task = await base44.asServiceRole.entities.Task.create({
                  patient_id: patient.id,
                  title: taskData.title,
                  description: taskData.description,
                  type: 'followup',
                  priority: taskData.priority,
                  status: 'pending',
                  due_timeframe: taskData.due_timeframe,
                  source: 'ai_generated',
                  ai_reason: `Generated from alert: ${alertData.title}`,
                  assigned_to: user.email
                });

                allTasks.push(task);
              } catch (taskError) {
                console.error(`Failed to create task for alert ${alertData.title}:`, taskError);
              }
            }
          }
        } catch (alertError) {
          console.error(`Failed to create alert for patient ${patient.id}:`, alertError);
        }
      }
    }

    return Response.json({
      success: true,
      alerts_created: allAlerts.length,
      tasks_created: allTasks.length,
      alerts: allAlerts,
      tasks: allTasks
    });

  } catch (error) {
    console.error('Error generating patient alerts:', error);
    return Response.json({ 
      error: error.message,
      details: error.stack 
    }, { status: 500 });
  }
});