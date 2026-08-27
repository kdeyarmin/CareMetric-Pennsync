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

    const { thread_id, patient_id } = await req.json();

    if (!thread_id) {
      return Response.json({ error: 'Missing thread_id' }, { status: 400 });
    }

    // Fetch all messages in thread. The explicit limit is what makes "all" true:
    // unlimited returns only the server's default page (~50), so a long thread
    // was summarized from its first page while the summary claimed to cover it.
    const messages = await base44.entities.Message.filter({ thread_id }, 'created_date', 5000);

    if (messages.length === 0) {
      return Response.json({ error: 'No messages found' }, { status: 404 });
    }

    // Fetch patient context if provided — gate agency-scoped admins explicitly
    // (bare role:admin RLS is platform-wide; HOSTED-RLS-PROOF §5b).
    let patientContext = '';
    if (patient_id) {
      const patients = await base44.entities.Patient.filter({ id: patient_id }, undefined, 5000);
      const patient = patients[0];
      const denied = await assertPatientAccess(base44, user, patient);
      if (denied) return denied;

      patientContext = `\n\nPATIENT CONTEXT:
Name: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis || 'N/A'}
Status: ${patient.status}`;
    }

    // Generate AI summary
    const result = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
      prompt: `Summarize this care team message thread. Provide a concise overview of the key discussion points, decisions made, and any action items.

THREAD SUBJECT: ${messages[0].subject || 'Patient Discussion'}${patientContext}

MESSAGES (${messages.length} total):
${messages.map((m, i) => `
[${i + 1}] ${m.sender_name} (${new Date(m.created_date).toLocaleString()}):
${String(m.message_text || '')}
`).join('\n')}

Provide:
1. Brief summary of the conversation (2-3 sentences)
2. Key points discussed
3. Decisions made
4. Action items identified
5. Open questions or concerns`,
      response_json_schema: {
        type: "object",
        properties: {
          summary: { type: "string" },
          key_points: {
            type: "array",
            items: { type: "string" }
          },
          decisions_made: {
            type: "array",
            items: { type: "string" }
          },
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
          open_questions: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    return Response.json({
      success: true,
      thread_id,
      message_count: messages.length,
      summary: result?.summary || '',
      key_points: result?.key_points || [],
      decisions_made: result?.decisions_made || [],
      action_items: result?.action_items || [],
      open_questions: result?.open_questions || []
    });

  } catch (error) {
    console.error('Error summarizing thread:', error);
    return Response.json({
      error: 'Internal server error'
    }, { status: 500 });
  }
});