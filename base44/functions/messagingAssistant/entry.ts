import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Unified Messaging Assistant Function
 * Handles: message suggestions and thread summarization
 * Replaces: generateMessageSuggestions, summarizeMessageThread
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { action, ...params } = await req.json();

    switch (action) {
      case 'suggest_content':
        return await suggestMessageContent(base44, params);
      
      case 'summarize_thread':
        return await summarizeThread(base44, params);
      
      default:
        return Response.json({ error: 'Invalid action' }, { status: 400 });
    }
  } catch (error) {
    console.error('Messaging assistant error:', error);
    return Response.json({ 
      error: error.message,
      success: false
    }, { status: 500 });
  }
});

async function suggestMessageContent(base44, params) {
  const { patient_id, thread_id, current_message } = params;

  if (!patient_id) {
    return Response.json({ error: 'Missing patient_id' }, { status: 400 });
  }

  const [patients, recentVisits, carePlans, incidents, threadMessages] = await Promise.all([
    base44.entities.Patient.filter({ id: patient_id }),
    base44.entities.Visit.filter({ patient_id }, '-visit_date', 5),
    base44.entities.CarePlan.filter({ patient_id, status: 'active' }),
    base44.entities.Incident.filter({ patient_id }, '-incident_date', 5),
    thread_id ? base44.entities.Message.filter({ thread_id }, '-created_date', 10) : Promise.resolve([])
  ]);

  const patient = patients[0];
  if (!patient) {
    return Response.json({ error: 'Patient not found' }, { status: 404 });
  }

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Suggest relevant patient information to share in this care team message.

PATIENT: ${patient.first_name} ${patient.last_name}
Primary Diagnosis: ${patient.primary_diagnosis}
Allergies: ${patient.allergies || 'None'}
Medications: ${patient.current_medications?.map(m => m.name).join(', ')}

RECENT VISITS:
${recentVisits.map(v => `${v.visit_date}: ${v.visit_type} - ${v.nurse_notes?.substring(0, 200)}`).join('\n')}

ACTIVE CARE PLANS:
${carePlans.map(cp => `${cp.problem}: ${cp.goal}`).join('\n')}

RECENT INCIDENTS:
${incidents.map(i => `${i.incident_date}: ${i.incident_type}`).join('\n')}

CONVERSATION CONTEXT:
${threadMessages.map(m => `${m.sender_name}: ${m.message_text.substring(0, 200)}`).join('\n')}

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

async function summarizeThread(base44, params) {
  const { thread_id, patient_id } = params;

  if (!thread_id) {
    return Response.json({ error: 'Missing thread_id' }, { status: 400 });
  }

  const messages = await base44.entities.Message.filter({ thread_id }, 'created_date');

  if (messages.length === 0) {
    return Response.json({ error: 'No messages found' }, { status: 404 });
  }

  let patientContext = '';
  if (patient_id) {
    const patients = await base44.entities.Patient.filter({ id: patient_id });
    const patient = patients[0];
    
    if (patient) {
      patientContext = `\n\nPATIENT: ${patient.first_name} ${patient.last_name}, Diagnosis: ${patient.primary_diagnosis}, Status: ${patient.status}`;
    }
  }

  const result = await base44.integrations.Core.InvokeLLM({
    prompt: `Summarize this care team message thread.

SUBJECT: ${messages[0].subject}${patientContext}

MESSAGES (${messages.length}):
${messages.map((m, i) => `[${i + 1}] ${m.sender_name} (${new Date(m.created_date).toLocaleString()}):\n${m.message_text}`).join('\n\n')}

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