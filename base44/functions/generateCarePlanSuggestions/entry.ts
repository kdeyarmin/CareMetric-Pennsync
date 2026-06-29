import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    // Fetch comprehensive patient data
    const [patients, clinicalEvents, existingCarePlans, visits, incidents] = await Promise.all([
      base44.entities.Patient.filter({ id: patient_id }),
      base44.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 50),
      base44.entities.CarePlan.filter({ patient_id }),
      base44.entities.Visit.filter({ patient_id }, '-visit_date', 10),
      base44.entities.Incident.filter({ patient_id }, '-incident_date', 10)
    ]);

    const patient = patients[0];
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Prepare context for AI analysis
    const recentEvents = clinicalEvents.slice(0, 20).map(e => ({
      type: e.event_type,
      title: e.event_title,
      description: e.event_description,
      date: e.event_date,
      severity: e.severity,
      structured_data: e.structured_data
    }));

    const recentVisits = visits.slice(0, 5).map(v => ({
      date: v.visit_date,
      type: v.visit_type,
      vital_signs: v.vital_signs,
      notes_summary: v.nurse_notes?.substring(0, 500)
    }));

    const recentIncidents = incidents.map(i => ({
      type: i.incident_type,
      date: i.incident_date,
      severity: i.severity,
      details: i.details
    }));

    const existingProblems = existingCarePlans.map(cp => cp.problem);

    const result = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `As a clinical expert, analyze this home health patient's data and generate comprehensive care plan suggestions.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${patient.date_of_birth ? new Date().getFullYear() - new Date(patient.date_of_birth).getFullYear() : 'Unknown'}
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Medications: ${patient.current_medications?.map(m => `${m.name} ${m.dosage || ''}`).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'None documented'}
- Functional Status: ${JSON.stringify(patient.functional_status || {})}
- Living Situation: ${patient.social_history?.living_situation || 'Unknown'}

RECENT CLINICAL EVENTS (Last 30 days):
${JSON.stringify(recentEvents, null, 2)}

RECENT VISITS:
${JSON.stringify(recentVisits, null, 2)}

INCIDENTS:
${JSON.stringify(recentIncidents, null, 2)}

EXISTING CARE PLANS:
${existingProblems.join(', ') || 'None'}

Based on this comprehensive patient profile, generate care plan suggestions that address:
1. Unaddressed clinical needs or gaps in current care
2. Risk factors requiring preventive interventions
3. Medication management and adherence
4. Functional improvement opportunities
5. Safety concerns
6. Patient education needs
7. Chronic disease management
8. Post-hospitalization follow-up (if applicable)

For each suggested care plan, provide:
- Problem/Nursing Diagnosis (use NANDA-I terminology where appropriate)
- Measurable Goal (specific, achievable, time-bound)
- Interventions (list 3-5 evidence-based nursing interventions)
- Expected Outcomes (measurable)
- Baseline Measurement (how to measure initial status)
- Frequency (how often to assess: each visit, weekly, etc.)
- Priority (high, medium, low based on clinical urgency)
- Rationale (brief clinical reasoning for this care plan)
- Medicare/Insurance Considerations (documentation tips for reimbursement)

Only suggest care plans that are not already covered by existing plans. Focus on current, actionable needs.`,
      response_json_schema: {
        type: "object",
        properties: {
          suggestions: {
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
                expected_outcomes: { type: "string" },
                baseline_measurement: { type: "string" },
                frequency: { type: "string" },
                priority: { type: "string" },
                rationale: { type: "string" },
                medicare_considerations: { type: "string" },
                target_days: { type: "number" }
              }
            }
          },
          overall_assessment: { type: "string" },
          critical_gaps_identified: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      suggestions: result?.suggestions || [],
      overall_assessment: result?.overall_assessment || '',
      critical_gaps_identified: result?.critical_gaps_identified || []
    });

  } catch (error) {
    console.error('Error generating care plan suggestions:', error);
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});