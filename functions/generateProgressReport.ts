import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { patient_id, report_type = 'progress_note', date_range_days = 30 } = body;

    if (!patient_id) {
      return Response.json({ error: 'Patient ID required' }, { status: 400 });
    }

    console.log('[generateProgressReport] Generating', report_type, 'for patient', patient_id);

    // Fetch patient data
    const patients = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
    const patient = patients[0];

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Fetch recent visits
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - date_range_days);
    
    const allVisits = await base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date');
    const recentVisits = allVisits.filter(v => new Date(v.visit_date) >= sinceDate);

    // Fetch care plans
    const carePlans = await base44.asServiceRole.entities.CarePlan.filter({ patient_id });

    // Fetch recent tasks
    const tasks = await base44.asServiceRole.entities.Task.filter({ patient_id });
    const recentTasks = tasks.filter(t => new Date(t.created_date) >= sinceDate);

    const patientContext = {
      demographics: {
        name: `${patient.first_name} ${patient.last_name}`,
        dob: patient.date_of_birth,
        mrn: patient.medical_record_number,
        admission_date: patient.admission_date
      },
      diagnoses: {
        primary: patient.primary_diagnosis,
        secondary: patient.secondary_diagnoses || []
      },
      medications: patient.current_medications || [],
      functional_status: patient.functional_status,
      care_type: patient.care_type,
      visit_count: recentVisits.length,
      visits: recentVisits.map(v => ({
        date: v.visit_date,
        type: v.visit_type,
        nurse_notes: v.nurse_notes,
        vitals: v.vital_signs,
        status: v.status
      })),
      care_plans: carePlans.map(cp => ({
        problem: cp.problem,
        goal: cp.goal,
        status: cp.status,
        progress: cp.progress_percentage
      })),
      tasks: recentTasks.map(t => ({
        title: t.title,
        status: t.status,
        priority: t.priority
      }))
    };

    const reportPrompts = {
      progress_note: `Generate a comprehensive clinical progress note for ${patient.first_name} ${patient.last_name}.

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

Create a professional progress note following Medicare documentation standards:

1. PATIENT IDENTIFICATION & BACKGROUND
2. CURRENT STATUS & CHANGES SINCE LAST REPORT
3. VISIT SUMMARY (${date_range_days} days)
   - Frequency and types of visits
   - Key findings from each visit
   - Vital signs trends
4. CLINICAL PROGRESS
   - Response to treatment
   - Improvement or decline in condition
   - Functional status changes
5. CARE PLAN STATUS
   - Progress toward each goal
   - Effectiveness of interventions
6. CURRENT PROBLEMS & CONCERNS
7. PLAN OF CARE MODIFICATIONS (if any)
8. RECOMMENDATION FOR CONTINUED CARE

Use clinical language, be specific with dates and measurements, and support all statements with documented evidence from visits.`,

      discharge_summary: `Generate a discharge summary for ${patient.first_name} ${patient.last_name}.

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

Create a comprehensive discharge summary:

1. ADMISSION INFORMATION
   - Date of admission
   - Admission diagnosis
   - Admission source
2. HOSPITAL COURSE & TREATMENT PROVIDED
3. SIGNIFICANT FINDINGS
4. PROGRESS ACHIEVED
5. CURRENT CONDITION AT DISCHARGE
6. DISCHARGE INSTRUCTIONS
7. MEDICATIONS AT DISCHARGE
8. FOLLOW-UP APPOINTMENTS NEEDED
9. DISCHARGE DISPOSITION
10. PATIENT/CAREGIVER EDUCATION PROVIDED`,

      recertification: `Generate a recertification summary for ${patient.first_name} ${patient.last_name}.

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

Create a recertification document demonstrating continued need for home health:

1. HOMEBOUND STATUS JUSTIFICATION
   - Current functional limitations
   - Reasons patient cannot leave home
   - Evidence from recent visits
2. SKILLED NEED JUSTIFICATION
   - Why skilled nursing/therapy is required
   - Complexity of care
   - Teaching needs
3. PROGRESS IN CURRENT CERTIFICATION PERIOD
4. GOALS FOR NEXT CERTIFICATION PERIOD
5. ANTICIPATED DURATION OF CARE
6. PLAN OF CARE FOR NEXT PERIOD`,

      insurance_appeal: `Generate an insurance appeal letter for ${patient.first_name} ${patient.last_name}.

PATIENT CONTEXT:
${JSON.stringify(patientContext, null, 2)}

Create a persuasive appeal demonstrating medical necessity:

1. PATIENT MEDICAL HISTORY & COMPLEXITY
2. CLINICAL JUSTIFICATION FOR SERVICES
3. EVIDENCE OF PROGRESS
4. CONSEQUENCES OF SERVICE DENIAL
5. SUPPORTING CLINICAL DOCUMENTATION
6. REGULATORY REQUIREMENTS MET
7. REQUEST FOR RECONSIDERATION`
    };

    const prompt = reportPrompts[report_type] || reportPrompts.progress_note;

    const result = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          report_title: { type: 'string' },
          report_type: { type: 'string' },
          patient_name: { type: 'string' },
          date_range: { type: 'string' },
          sections: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                section_title: { type: 'string' },
                content: { type: 'string' }
              }
            }
          },
          key_findings: {
            type: 'array',
            items: { type: 'string' }
          },
          recommendations: {
            type: 'array',
            items: { type: 'string' }
          },
          full_narrative: {
            type: 'string',
            description: 'Complete report in paragraph form'
          },
          data_sources: {
            type: 'object',
            properties: {
              visits_analyzed: { type: 'number' },
              care_plans_reviewed: { type: 'number' },
              date_range: { type: 'string' }
            }
          }
        }
      }
    });

    // Save the report
    const savedReport = await base44.asServiceRole.entities.GeneratedDocument.create({
      patient_id,
      document_type: report_type,
      title: result.report_title || `${report_type} - ${patient.first_name} ${patient.last_name}`,
      content: result.full_narrative,
      structured_data: result,
      generated_by: user.email,
      generated_date: new Date().toISOString(),
      status: 'draft'
    });

    return Response.json({
      success: true,
      report: result,
      report_id: savedReport.id
    });
  } catch (error) {
    console.error('[generateProgressReport] Error:', error.message);
    return Response.json({
      error: 'Report generation failed',
      details: error.message
    }, { status: 500 });
  }
});