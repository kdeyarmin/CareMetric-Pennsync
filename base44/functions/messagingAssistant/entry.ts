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

/**
 * Unified Messaging Assistant Function
 * Handles: message suggestions and thread summarization
 * Replaces: generateMessageSuggestions, summarizeMessageThread
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case 'suggest_content':
        return await suggestMessageContent(base44, user, params);

      case 'summarize_thread':
        return await summarizeThread(base44, user, params);

      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Messaging assistant error:', error);
    return Response.json({
      error: 'Internal server error',
      success: false
    }, { status: 500 });
  }
});

async function suggestMessageContent(base44, user, params) {
  const { patient_id, thread_id, current_message } = params;

  if (!patient_id) {
    return Response.json({ error: 'Missing patient_id' }, { status: 400 });
  }

  const [patients, recentVisits, incidents, threadMessages] = await Promise.all([
    base44.entities.Patient.filter({ id: patient_id }, undefined, 5000),
    base44.entities.Visit.filter({ patient_id }, '-visit_date', 5),
    base44.entities.Incident.filter({ patient_id }, '-incident_date', 5),
    thread_id ? base44.entities.Message.filter({ thread_id }, '-created_date', 10) : Promise.resolve([])
  ]);

  const patient = patients[0];
  const denied = await assertPatientAccess(base44, user, patient);
  if (denied) return denied;

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Suggest relevant patient information to share in this care team message.

PATIENT: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis}
Allergies: ${patient.allergies || 'None'}
Medications: ${patient.current_medications?.map(m => m.name).join(', ')}

RECENT VISITS:
${recentVisits.map(v => `${v.visit_date}: ${v.visit_type} - ${String(v.nurse_notes || '').substring(0, 200)}`).join('\n')}

RECENT INCIDENTS:
${incidents.map(i => `${i.incident_date}: ${i.incident_type}`).join('\n')}

CONVERSATION CONTEXT:
${threadMessages.map(m => `${m.sender_name}: ${String(m.message_text || '').substring(0, 200)}`).join('\n')}

${current_message ? `CURRENT MESSAGE:\n${current_message}` : ''}

Suggest: relevant patient info, recent changes/concerns, care plan updates, safety concerns, medication info.`,
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
        quick_facts: { type: "array", items: { type: "string" } },
        safety_alerts: { type: "array", items: { type: "string" } },
        suggested_actions: { type: "array", items: { type: "string" } }
      }
    }
  });

  return Response.json({
    success: true,
    patient_name: `${patient.first_name} ${patient.last_name}`,
    ...result
  });
}

async function summarizeThread(base44, user, params) {
  const { thread_id, patient_id } = params;

  if (!thread_id) {
    return Response.json({ error: 'Missing thread_id' }, { status: 400 });
  }

  // Explicit limit: unlimited returns only the server's default page (~50), so
  // the assistant reasoned over a truncated thread on any long conversation.
  const messages = await base44.entities.Message.filter({ thread_id }, 'created_date', 5000);

  if (messages.length === 0) {
    return Response.json({ error: 'No messages found' }, { status: 404 });
  }

  let patientContext = '';
  if (patient_id) {
    const patients = await base44.entities.Patient.filter({ id: patient_id }, undefined, 5000);
    const patient = patients[0];
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;
    patientContext = `\n\nPATIENT: ${patient.first_name} ${patient.last_name}, Diagnosis: ${patient.primary_diagnosis}, Status: ${patient.status}`;
  }

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Summarize this care team message thread.

SUBJECT: ${messages[0].subject || '(no subject)'}${patientContext}

MESSAGES (${messages.length}):
${messages.map((m, i) => `[${i + 1}] ${m.sender_name} (${new Date(m.created_date).toLocaleString()}):\n${String(m.message_text || '')}`).join('\n\n')}

Provide: brief summary (2-3 sentences), key points, decisions made, action items, open questions.`,
    response_json_schema: {
      type: "object",
      properties: {
        summary: { type: "string" },
        key_points: { type: "array", items: { type: "string" } },
        decisions_made: { type: "array", items: { type: "string" } },
        action_items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              action: { type: "string" },
              assigned_to: { type: "string" },
              priority: { type: "string" }
            }
          }
        },
        open_questions: { type: "array", items: { type: "string" } }
      }
    }
  });

  return Response.json({
    success: true,
    thread_id,
    message_count: messages.length,
    ...result
  });
}
