import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// <<<BEGIN SHARED HELPER: formatAge — generated, edit base44/_shared/backendHelpers.mjs>>>
function parseLocalDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(value).trim());
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, mo, day);
    if (d.getFullYear() !== y || d.getMonth() !== mo || d.getDate() !== day) return null;
    return d;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function calculateAge(dob, now = new Date()) {
  const birth = parseLocalDate(dob);
  const today = parseLocalDate(now);
  if (!birth || !today) return null;
  let age = today.getFullYear() - birth.getFullYear();
  const m = today.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--;
  return age;
}
function formatAge(dob, now = new Date(), fallback = 'Unknown') {
  const age = calculateAge(dob, now);
  return age == null ? fallback : age;
}
// <<<END SHARED HELPER: formatAge>>>


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

    const { patient_id } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    const [patient] = await base44.asServiceRole.entities.Patient
      .filter({ id: patient_id }, '', 1).catch(() => []);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    const [clinicalEvents, existingCarePlans, visits, incidents] = await Promise.all([
      base44.asServiceRole.entities.ClinicalEvent.filter({ patient_id }, '-event_date', 50),
      base44.asServiceRole.entities.CarePlan.filter({ patient_id }, undefined, 5000),
      base44.asServiceRole.entities.Visit.filter({ patient_id }, '-visit_date', 10),
      base44.asServiceRole.entities.Incident.filter({ patient_id }, '-incident_date', 10)
    ]);

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
      model: "automatic",
      prompt: `As a clinical expert, analyze this home health patient's data and generate comprehensive care plan suggestions.

PATIENT PROFILE:
- Name: ${patient.first_name} ${patient.last_name}
- Age: ${formatAge(patient.date_of_birth)}
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
    // Generic client-facing message; detail stays server-side only (matches the
    // hardened userManagement pattern — leaking error.message aids reconnaissance).
    return Response.json({
      error: 'Failed to generate care plan suggestions'
    }, { status: 500 });
  }
});
