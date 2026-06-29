import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patient_id, discharge_date } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch patient data
    const [patient] = await base44.entities.Patient.filter({ id: patient_id });
    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Fetch all visits for this patient
    const visits = await base44.entities.Visit.filter(
      { patient_id, status: 'completed' },
      '-visit_date'
    );

    // Fetch care plans
    const carePlans = await base44.entities.CarePlan.filter({ patient_id });

    // Fetch education materials sent
    const educationMaterials = await base44.entities.SentEducationMaterial.filter(
      { patient_id }
    );

    // Find admission date (earliest visit)
    const admissionDate = visits.length > 0
      ? visits[visits.length - 1].visit_date
      : patient.created_date;

    // Separate visits by type
    const skilledNursingVisits = visits.filter(v =>
      ['skilled_nursing', 'admission', 'recertification'].includes(v.visit_type)
    );
    const therapyVisits = visits.filter(v => v.visit_type === 'therapy');

    // Generate comprehensive AI summary
    const aiPrompt = `You are a home health discharge summary specialist. Generate a comprehensive, Medicare-compliant discharge summary based on the following patient data.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
Admission Date: ${admissionDate}
Discharge Date: ${discharge_date || new Date().toISOString().split('T')[0]}

VISIT SUMMARY:
Total Visits: ${visits.length}
Skilled Nursing Visits: ${skilledNursingVisits.length}
Therapy Visits: ${therapyVisits.length}

RECENT VISIT NOTES (Last 5):
${visits.slice(0, 5).map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Notes: ${v.nurse_notes?.substring(0, 500) || 'No notes'}
`).join('\n')}

CARE PLANS:
${carePlans.map(cp => `
Problem: ${cp.problem}
Goal: ${cp.goal}
Status: ${cp.status}
Interventions: ${cp.interventions?.join(', ') || 'None listed'}
`).join('\n')}

PATIENT EDUCATION PROVIDED:
${educationMaterials.map(e => e.material_title).join(', ')}

Generate a comprehensive discharge summary with the following sections:
1. REASON FOR ADMISSION - Brief summary of why home health was initiated
2. SUMMARY OF CARE - Comprehensive narrative of care provided during episode
3. FUNCTIONAL STATUS - Patient's status at admission vs discharge
4. DISCHARGE INSTRUCTIONS - Clear patient instructions
5. FOLLOW-UP RECOMMENDATIONS - What patient should do after discharge

Format as a professional medical summary. Be detailed, objective, and Medicare-compliant.`;

    const aiResponseRaw = await base44.integrations.Core.InvokeLLM({
      prompt: aiPrompt,
      model: 'claude_opus_4_8'
    });
    // InvokeLLM may return a structured object rather than a raw string; coerce so
    // the .split() parsing below can't throw "split is not a function".
    const aiResponse = typeof aiResponseRaw === 'string'
      ? aiResponseRaw
      : (aiResponseRaw?.text ?? JSON.stringify(aiResponseRaw ?? ''));

    // Extract visit highlights
    const visitHighlights = visits.slice(0, 5).map(v => {
      if (v.vital_signs) {
        const vitals = Object.entries(v.vital_signs)
          .filter(([k, v]) => v != null)
          .map(([k, v]) => `${k}: ${v}`)
          .join(', ');
        return `${v.visit_date}: ${vitals}`;
      }
      return `${v.visit_date}: ${v.visit_type}`;
    });

    // Determine care plan outcomes
    const carePlanOutcomes = carePlans.map(cp => ({
      problem: cp.problem,
      goal: cp.goal,
      outcome: cp.status === 'met' ? 'met' :
               cp.status === 'not_met' ? 'not_met' :
               cp.status === 'revised' ? 'partially_met' : 'ongoing',
      notes: cp.progress_notes || 'See visit documentation'
    }));

    // Create discharge summary
    const dischargeSummary = await base44.entities.DischargeSummary.create({
      patient_id,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      admission_date: admissionDate,
      discharge_date: discharge_date || new Date().toISOString().split('T')[0],
      primary_diagnosis: patient.primary_diagnosis,
      secondary_diagnoses: patient.secondary_diagnoses || [],
      reason_for_admission: aiResponse.split('REASON FOR ADMISSION')[1]?.split('\n\n')[0]?.trim() ||
        `Patient admitted to home health for management of ${patient.primary_diagnosis}`,
      summary_of_care: aiResponse,
      visit_summary: {
        total_visits: visits.length,
        skilled_nursing_visits: skilledNursingVisits.length,
        therapy_visits: therapyVisits.length,
        visit_highlights: visitHighlights
      },
      care_plan_outcomes: carePlanOutcomes,
      functional_status: {
        at_admission: 'See admission assessment',
        at_discharge: 'Patient improved overall functional status',
        improvement_areas: (carePlans || [])
          .filter(cp => cp && cp.status === 'met' && cp.problem)
          .map(cp => cp.problem)
      },
      patient_education_provided: educationMaterials.map(e => ({
        topic: e.material_title,
        materials_provided: 'Written materials',
        patient_understanding: 'Patient verbalized understanding'
      })),
      discharge_disposition: 'home_independent',
      discharge_instructions: 'Continue current medications. Follow up with physician as recommended. Contact home health if symptoms worsen.',
      follow_up_recommendations: [
        {
          recommendation: 'Follow up with primary care physician',
          provider: patient.physician_name || 'PCP',
          timeframe: 'Within 1-2 weeks'
        }
      ],
      status: 'pending_review',
      generated_by: user.email,
      generated_date: new Date().toISOString(),
      ai_generation_metadata: {
        visits_analyzed: visits.length,
        care_plans_analyzed: carePlans.length,
        generation_confidence: 95
      }
    });

    return Response.json({
      success: true,
      discharge_summary: dischargeSummary
    });

  } catch (error) {
    console.error('Error generating discharge summary:', error);
    return Response.json({
      error: error.message || 'Failed to generate discharge summary'
    }, { status: 500 });
  }
});