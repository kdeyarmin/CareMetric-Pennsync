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

    const { patient_id, thread_id, current_message } = await req.json();

    if (!patient_id) {
      return Response.json({ error: 'Missing patient_id' }, { status: 400 });
    }

    // Fetch patient data and recent thread
    const [patients, recentVisits, incidents, threadMessages] = await Promise.all([
      base44.entities.Patient.filter({ id: patient_id }, undefined, 5000),
      base44.entities.Visit.filter({ patient_id }, '-visit_date', 5),
      base44.entities.Incident.filter({ patient_id }, '-incident_date', 5),
      thread_id ? base44.entities.Message.filter({ thread_id }, '-created_date', 10) : Promise.resolve([])
    ]);

    const patient = patients[0];
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    // Generate contextual suggestions
    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `You are an AI assistant helping a care team communicate about a patient. Based on the patient's record and conversation, suggest relevant information to share.

PATIENT INFORMATION:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
Allergies: ${patient.allergies || 'None documented'}
Current Medications: ${patient.current_medications?.map(m => m.name).join(', ') || 'None'}

RECENT VISITS (${recentVisits.length}):
${recentVisits.map(v => `${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n')}

RECENT INCIDENTS (${incidents.length}):
${incidents.map(i => `${i.incident_date}: ${i.incident_type} - ${i.severity}`).join('\n')}

CONVERSATION CONTEXT:
${threadMessages.map(m => `${m.sender_name}: ${String(m.message_text || '').substring(0, 200)}`).join('\n')}

${current_message ? `CURRENT MESSAGE BEING WRITTEN:\n${current_message}` : ''}

Suggest:
1. Relevant patient information that would be helpful to share
2. Recent clinical changes or concerns
3. Care plan updates worth discussing
4. Any safety concerns or alerts
5. Medication information relevant to the discussion`,
      response_json_schema: {
        type: "object",
        properties: {
          suggested_info: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                information: { type: "string" },
                relevance: { type: "string" }
              }
            }
          },
          quick_facts: {
            type: "array",
            items: { type: "string" }
          },
          safety_alerts: {
            type: "array",
            items: { type: "string" }
          },
          suggested_actions: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      patient_name: `${patient.first_name} ${patient.last_name}`,
      suggested_info: result?.suggested_info || [],
      quick_facts: result?.quick_facts || [],
      safety_alerts: result?.safety_alerts || [],
      suggested_actions: result?.suggested_actions || []
    });

  } catch (error) {
    console.error('Error generating suggestions:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});