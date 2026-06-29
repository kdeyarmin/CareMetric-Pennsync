import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { noteText, patientId, visitId, visitType, diagnosis } = await req.json();
    if (!noteText) return Response.json({ error: 'noteText is required' }, { status: 400 });

    let patientContext = '';
    let patientName = '';
    if (patientId) {
      // RLS-scoped read (NOT asServiceRole) so the caller cannot pull another
      // patient's PHI into the prompt via a guessed patientId.
      const patients = await base44.entities.Patient.filter({ id: patientId });
      const patient = patients[0];
      // Make the access check BLOCKING: if the RLS-scoped read returns nothing
      // the caller can't see this patient, so don't attach AI Tasks to it below.
      if (!patient) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      patientName = `${patient.first_name} ${patient.last_name}`;
      patientContext = `Patient: ${patientName}, Primary Diagnosis: ${patient.primary_diagnosis || diagnosis || 'Not documented'}, Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}`;
    }

    const response = await base44.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt: `You are a home health/hospice clinical supervisor reviewing a finalized nursing note. Extract specific follow-up tasks the clinician must complete after this visit.

FINALIZED NOTE:
${noteText}

${patientContext ? `PATIENT CONTEXT:\n${patientContext}` : ''}
VISIT TYPE: ${visitType || 'routine_visit'}

Extract 2-5 concrete, actionable follow-up tasks. Focus ONLY on tasks clearly evidenced or implied by the note:
- Physician contact / notifications needed (e.g., "Contact MD re: elevated BP 172/96")
- Orders to obtain (wound care supplies, labs, medication changes)
- Scheduling (follow-up visits, recertification due, specialist referrals)
- Patient/family callbacks or education reinforcement
- Safety monitoring items (fall risk, infection signs)
- Documentation to complete

Return JSON array of tasks.`,
      response_json_schema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                type: { type: "string", enum: ["call", "notify", "schedule", "order", "coordinate", "document", "safety", "followup", "other"] },
                priority: { type: "string", enum: ["high", "medium", "low"] },
                due_timeframe: { type: "string", enum: ["today", "24_hours", "48_hours", "this_week", "next_visit"] },
                ai_reason: { type: "string" }
              }
            }
          }
        }
      }
    });

    const suggestedTasks = response.tasks || [];

    const calculateDueDate = (timeframe) => {
      const date = new Date();
      const map = { today: 0, '24_hours': 1, '48_hours': 2, 'this_week': 7, 'next_visit': 3 };
      date.setDate(date.getDate() + (map[timeframe] ?? 3));
      return date.toISOString().split('T')[0];
    };

    const createdTasks = await Promise.all(
      suggestedTasks.map(task =>
        base44.asServiceRole.entities.Task.create({
          title: task.title,
          description: task.description || task.ai_reason || '',
          type: task.type || 'followup',
          priority: task.priority || 'medium',
          due_date: calculateDueDate(task.due_timeframe),
          due_timeframe: task.due_timeframe || 'next_visit',
          status: 'pending',
          source: 'ai_generated',
          ai_reason: task.ai_reason || '',
          ...(patientId ? { patient_id: patientId } : {}),
          ...(visitId ? { related_visit_id: visitId } : {}),
          assigned_to: user.email,
        })
      )
    );

    return Response.json({
      success: true,
      tasks_created: createdTasks.length,
      tasks: createdTasks,
      patient_name: patientName
    });

  } catch (error) {
    console.error('generateFollowUpTasks error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});