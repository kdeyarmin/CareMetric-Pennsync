import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id, discharge_date } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'patient_id is required' }, { status: 400 });
    }

    // Fetch patient data
    const [patient] = await base44.entities.Patient.filter({ id: patient_id }, undefined, 5000);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    // Fetch all visits for this patient
    const visits = await base44.entities.Visit.filter(
      { patient_id, status: 'completed' },
      '-visit_date',
      5000,
    );

    // Fetch education materials sent
    const educationMaterials = await base44.entities.SentEducationMaterial.filter(
      { patient_id }
    , undefined, 5000);

    // Find admission date (earliest visit)
    const admissionDate = visits.length > 0
      ? visits[visits.length - 1].visit_date
      : patient.created_date;

    // Separate visits by type (Visit.visit_type enum has no 'therapy' —
    // count routine/prn/discharge separately so the signed summary is truthful).
    const skilledNursingVisits = visits.filter(v =>
      ['skilled_nursing', 'admission', 'recertification'].includes(v.visit_type)
    );
    const routineVisits = visits.filter(v =>
      ['routine_visit', 'prn', 'discharge'].includes(v.visit_type)
    );

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
Skilled Nursing / Admission / Recert Visits: ${skilledNursingVisits.length}
Routine / PRN / Discharge Visits: ${routineVisits.length}

RECENT VISIT NOTES (Last 5):
${visits.slice(0, 5).map(v => `
Date: ${v.visit_date}
Type: ${v.visit_type}
Notes: ${v.nurse_notes?.substring(0, 500) || 'No notes'}
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
      model: 'automatic'
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
        // Kept for schema compatibility; Visit has no therapy type — use routine counts.
        therapy_visits: routineVisits.length,
        routine_visits: routineVisits.length,
        visit_highlights: visitHighlights
      },
      // Do NOT fabricate affirmative clinical conclusions here. This record is
      // reviewed and SIGNED as a legal Medicare discharge document, and the review
      // UI must let the clinician set these — never assert "improved" / a specific
      // disposition on a patient who may have been transferred to acute care or
      // expired. Leave functional status / disposition / education understanding
      // blank for the reviewing clinician to complete.
      functional_status: {
        at_admission: 'See admission assessment',
        at_discharge: '',
        improvement_areas: []
      },
      patient_education_provided: educationMaterials.map(e => ({
        topic: e.material_title,
        materials_provided: 'Written materials',
        patient_understanding: ''
      })),
      // discharge_disposition intentionally left unset — the reviewer selects it.
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
        visits_analyzed: visits.length
      }
    });

    return Response.json({
      success: true,
      discharge_summary: dischargeSummary
    });

  } catch (error) {
    console.error('Error generating discharge summary:', error);
    return Response.json({
      error: 'Failed to generate discharge summary'
    }, { status: 500 });
  }
});