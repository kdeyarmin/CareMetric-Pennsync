import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visit_id } = await req.json();

    if (!visit_id) {
      return Response.json({ error: 'visit_id is required' }, { status: 400 });
    }

    // Fetch visit data
    const visit = await base44.entities.Visit.get(visit_id);
    
    if (!visit) {
      return Response.json({ error: 'Visit not found' }, { status: 404 });
    }

    // Only process if visit is completed
    if (visit.status !== 'completed') {
      return Response.json({
        error: 'Visit must be completed before processing',
        visit_status: visit.status
      }, { status: 400 });
    }

    // Idempotency guard. This function has no client idempotency key, so a
    // double-click / retry would otherwise (a) overwrite nurse_notes with a fresh
    // narrative generated FROM the previous narrative — progressively corrupting
    // the documentation — and (b) create duplicate follow-up tasks + notifications
    // every time. If AI follow-up tasks already exist for this visit it has been
    // processed; return the prior result instead of re-running.
    const existingAiTasks = await base44.entities.Task
      .filter({ related_visit_id: visit_id, source: 'ai_generated' })
      .catch(() => []);
    if (existingAiTasks && existingAiTasks.length > 0) {
      return Response.json({
        success: true,
        already_processed: true,
        visit,
        tasks_created: 0,
        tasks: existingAiTasks,
      });
    }

    // Always generate the narrative from the ORIGINAL raw input, never from a
    // prior AI narrative. raw_transcription is the canonical raw source; fall back
    // to nurse_notes for older visits that predate it.
    const rawNotes = (visit.raw_transcription && visit.raw_transcription.trim())
      ? visit.raw_transcription
      : (visit.nurse_notes || '');

    // Patient and active care plans are independent reads — fetch concurrently.
    const [patient, carePlans] = await Promise.all([
      base44.entities.Patient.get(visit.patient_id),
      base44.entities.CarePlan.filter({
        patient_id: visit.patient_id,
        status: 'active'
      })
    ]);

    if (!patient) {
      return Response.json({ error: 'Patient not found' }, { status: 404 });
    }

    // Generate Medicare-compliant narrative
    const narrativePrompt = `You are a clinical documentation specialist. Generate a Medicare-compliant visit narrative based on the following information:

PATIENT: ${patient.first_name} ${patient.last_name}
PRIMARY DIAGNOSIS: ${patient.primary_diagnosis || 'Not specified'}
VISIT TYPE: ${visit.visit_type}
VISIT DATE: ${visit.visit_date}

VITAL SIGNS:
${visit.vital_signs ? `
- Temperature: ${visit.vital_signs.temperature || 'N/A'}°F
- Blood Pressure: ${visit.vital_signs.blood_pressure_systolic || 'N/A'}/${visit.vital_signs.blood_pressure_diastolic || 'N/A'} mmHg
- Heart Rate: ${visit.vital_signs.heart_rate || 'N/A'} bpm
- Respiratory Rate: ${visit.vital_signs.respiratory_rate || 'N/A'} breaths/min
- O2 Saturation: ${visit.vital_signs.oxygen_saturation || 'N/A'}%
- Pain Level: ${visit.vital_signs.pain_level || 'N/A'}/10
- Weight: ${visit.vital_signs.weight || 'N/A'} lbs
` : 'No vital signs recorded'}

NURSE NOTES (RAW):
${rawNotes || 'No notes provided'}

ACTIVE CARE PLANS:
${carePlans.map(cp => `- ${cp.problem}: ${cp.goal}`).join('\n') || 'None'}

Generate a comprehensive, Medicare-compliant narrative that includes:
1. Assessment findings
2. Interventions provided
3. Patient response to care
4. Homebound status justification (if applicable)
5. Teaching provided
6. Plan of care updates

Use proper medical terminology and follow Medicare documentation requirements. Be specific and objective.`;

    // Kick off the narrative call now; it runs concurrently with the follow-up
    // tasks call below (both use the same inputs and are independent), roughly
    // halving the clinician's wait on visit completion.
    const narrativePromise = base44.integrations.Core.InvokeLLM({
      prompt: narrativePrompt,
      model: 'claude_opus_4_8'
    });

    // Generate follow-up tasks
    const tasksPrompt = `Based on this completed visit, identify critical follow-up tasks that should be assigned:

PATIENT: ${patient.first_name} ${patient.last_name}
VISIT TYPE: ${visit.visit_type}
VITAL SIGNS: ${JSON.stringify(visit.vital_signs || {})}
CLINICAL NOTES: ${visit.nurse_notes || 'None'}
ACTIVE CARE PLANS: ${carePlans.map(cp => cp.problem).join(', ') || 'None'}

Analyze the visit data and generate follow-up tasks. Return a JSON array of tasks with this structure:
{
  "tasks": [
    {
      "title": "Task title",
      "description": "Detailed description",
      "type": "call|notify|schedule|order|coordinate|document|safety|followup|other",
      "priority": "high|medium|low",
      "due_timeframe": "today|24_hours|48_hours|this_week|next_visit",
      "reason": "Clinical rationale for this task"
    }
  ]
}

Consider:
- Abnormal vital signs requiring follow-up
- Medication changes or orders needed
- Care coordination needs
- Safety concerns
- Documentation requirements
- Physician notifications
- Equipment or supply orders

Only suggest tasks that are clinically necessary. If no follow-up is needed, return empty array.`;

    const tasksPromise = base44.integrations.Core.InvokeLLM({
      prompt: tasksPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                type: {
                  type: 'string',
                  enum: ['call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other']
                },
                priority: {
                  type: 'string',
                  enum: ['high', 'medium', 'low']
                },
                due_timeframe: { type: 'string' },
                reason: { type: 'string' }
              }
            }
          }
        }
      }
    });

    const [narrativeResponse, tasksResponse] = await Promise.all([
      narrativePromise,
      tasksPromise
    ]);

    // Update visit with enhanced narrative. Snapshot the original raw notes into
    // raw_transcription before nurse_notes is overwritten, so the canonical raw
    // input survives for any future regeneration (and isn't lost to the narrative).
    const narrativeText = typeof narrativeResponse === 'string' ? narrativeResponse : JSON.stringify(narrativeResponse);
    const visitUpdate = {
      nurse_notes: narrativeText,
      ai_tags: extractTags(narrativeText),
      status: 'completed'
    };
    if (!visit.raw_transcription || !visit.raw_transcription.trim()) {
      visitUpdate.raw_transcription = rawNotes;
    }
    const updatedVisit = await base44.entities.Visit.update(visit_id, visitUpdate);

    // Allowed Task enums; the AI can emit values outside the enum (which a plain
    // `|| default` would not catch since it only handles falsy), so validate
    // against the allowed sets and fall back to safe defaults before create.
    const ALLOWED_TASK_TYPES = new Set(['call', 'notify', 'schedule', 'order', 'coordinate', 'document', 'safety', 'followup', 'other']);
    const ALLOWED_TASK_PRIORITIES = new Set(['high', 'medium', 'low']);
    const ALLOWED_TASK_TIMEFRAMES = new Set(['today', '24_hours', '48_hours', 'this_week', 'next_visit']);

    // Create follow-up tasks
    const createdTasks = [];
    if (tasksResponse?.tasks && tasksResponse.tasks.length > 0) {
      for (const task of tasksResponse.tasks) {
        const taskType = ALLOWED_TASK_TYPES.has(task.type) ? task.type : 'followup';
        const taskPriority = ALLOWED_TASK_PRIORITIES.has(task.priority) ? task.priority : 'medium';
        const taskTimeframe = ALLOWED_TASK_TIMEFRAMES.has(task.due_timeframe) ? task.due_timeframe : '24_hours';
        const createdTask = await base44.entities.Task.create({
          patient_id: visit.patient_id,
          title: task.title,
          description: task.description,
          type: taskType,
          priority: taskPriority,
          due_timeframe: taskTimeframe,
          assigned_to: user.email,
          source: 'ai_generated',
          ai_reason: task.reason,
          related_visit_id: visit_id,
          status: 'pending'
        });
        createdTasks.push(createdTask);
      }
    }

    // Create notification for user
    await base44.entities.Notification.create({
      user_email: user.email,
      title: 'Visit Documentation Enhanced',
      message: `Medicare-compliant narrative generated for ${patient.first_name} ${patient.last_name}. ${createdTasks.length} follow-up task${createdTasks.length !== 1 ? 's' : ''} created.`,
      type: 'info',
      priority: 'medium',
      action_url: `/patientdetails?id=${visit.patient_id}`,
      action_label: 'View Patient Chart',
      metadata: {
        patient_id: visit.patient_id,
        visit_id: visit_id,
        tasks_created: createdTasks.length
      }
    });

    return Response.json({
      success: true,
      visit: updatedVisit,
      tasks_created: createdTasks.length,
      tasks: createdTasks,
      narrative_length: narrativeText.length
    });

  } catch (error) {
    console.error('Process completed visit error:', error);
    return Response.json({
      error: error.message
    }, { status: 500 });
  }
});

// Helper function to extract clinical tags from narrative
function extractTags(narrative) {
  const tags = [];
  const text = narrative.toLowerCase();
  
  // Clinical indicators
  if (text.includes('stable') || text.includes('improving')) tags.push('stable');
  if (text.includes('decline') || text.includes('worsening')) tags.push('declining');
  if (text.includes('pain')) tags.push('pain_management');
  if (text.includes('wound')) tags.push('wound_care');
  if (text.includes('medication') || text.includes('med')) tags.push('medication');
  if (text.includes('edema') || text.includes('swelling')) tags.push('edema');
  if (text.includes('breath') || text.includes('respiratory')) tags.push('respiratory');
  if (text.includes('cardiac') || text.includes('heart')) tags.push('cardiac');
  if (text.includes('fall') || text.includes('safety')) tags.push('safety');
  if (text.includes('teaching') || text.includes('education')) tags.push('teaching');
  if (text.includes('homebound')) tags.push('homebound');
  
  return tags;
}