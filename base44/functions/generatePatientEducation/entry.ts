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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { patientId, visitId, carePlanId } = await req.json();

    if (!patientId) {
      return Response.json({ error: 'patientId is required' }, { status: 400 });
    }

    // Get patient via the RLS-scoped client (NOT asServiceRole) so the
    // platform enforces this caller may access this patient, and we avoid
    // loading every patient in the tenant via .list() (IDOR / over-fetch).
    // Agency-scoped admins still need assertPatientAccess: bare role:admin RLS
    // is platform-wide (HOSTED-RLS-PROOF §5b).
    const patientResults = await base44.entities.Patient.filter({ id: patientId }, undefined, 5000);
    const patient = patientResults[0];
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    // Get recent visit if visitId provided (RLS-scoped). Bind visit to patient
    // so notes from another chart cannot be mixed into this patient's education.
    let visitData = null;
    if (visitId) {
      const visits = await base44.entities.Visit.filter({ id: visitId }, undefined, 5000);
      visitData = visits[0];
      if (visitData && String(visitData.patient_id || '') !== String(patientId)) {
        return Response.json({ error: 'visitId does not belong to this patient' }, { status: 400 });
      }
    }

    // Use LLM to generate personalized education topics
    const educationPrompt = `You are a healthcare education specialist. Based on the patient's medical information, generate 3-4 personalized educational topics that would benefit this patient.

Patient Information:
- Primary Diagnosis: ${patient.primary_diagnosis || 'Not specified'}
- Secondary Diagnoses: ${patient.secondary_diagnoses?.join(', ') || 'None'}
- Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}
- Allergies: ${patient.allergies || 'NKDA'}
- Functional Status: ${patient.functional_status?.adl_independence || 'Not documented'}
- Fall Risk: ${patient.functional_status?.fall_risk || 'Not documented'}
${visitData?.nurse_notes ? `\nLatest Visit Notes: ${visitData.nurse_notes.substring(0, 500)}` : ''}

Return JSON: { "topics": [{ "title": "string", "reason": "brief explanation why this education is needed", "key_points": ["point1", "point2", "point3"] }] }`;

    const topicsResult = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: educationPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          topics: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                reason: { type: 'string' },
                key_points: { type: 'array', items: { type: 'string' } }
              }
            }
          }
        }
      }
    });

    // Generate detailed content for each topic
    const educationMaterials = [];

    for (const topic of topicsResult?.topics || []) {
      const contentPrompt = `Create patient-friendly educational material on "${topic.title}" for a patient with ${patient.primary_diagnosis || 'chronic health condition'}.

Key Points to Cover:
${topic.key_points?.map(p => `- ${p}`).join('\n') || ''}

Instructions:
1. Use simple, clear language (8th grade reading level)
2. Include practical, actionable steps
3. Format with headings and bullet points
4. Include warning signs to watch for
5. Suggest when to call the doctor
6. Keep to 300-400 words

Do NOT use medical jargon. Make it conversational and supportive.`;

      const contentResult = await base44.integrations.Core.InvokeLLM({
        model: "automatic",
        prompt: contentPrompt
      });

      const material = {
        patient_id: patientId,
        topic: topic.title,
        diagnosis_related: patient.primary_diagnosis,
        education_content: contentResult,
        content_type: 'text',
        reading_level: 'basic',
        generated_from_visit_id: visitId || null,
        generated_date: new Date().toISOString(),
        delivery_status: 'pending'
      };

      // Save education material
      const saved = await base44.asServiceRole.entities.PatientEducationDelivery.create(material);
      educationMaterials.push(saved);
    }

    return Response.json({
      success: true,
      patient_id: patientId,
      materials_generated: educationMaterials.length,
      materials: educationMaterials
    });
  } catch (error) {
    console.error('Education generation error:', error);
    return Response.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
});