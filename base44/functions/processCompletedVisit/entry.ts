import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/** Explicit patient access — Patient/Visit RLS treats role:admin as platform-wide. */
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
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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
    // every time. Prefer the durable ai_processed_at stamp; fall back to existing
    // AI tasks for visits processed before that field existed.
    if (visit.ai_processed_at) {
      const existingAiTasks = await base44.entities.Task
        .filter({ related_visit_id: visit_id, source: 'ai_generated' }, undefined, 5000)
        .catch(() => []);
      return Response.json({
        success: true,
        already_processed: true,
        visit,
        tasks_created: 0,
        tasks: existingAiTasks || [],
      });
    }
    const existingAiTasks = await base44.entities.Task
      .filter({ related_visit_id: visit_id, source: 'ai_generated' }, undefined, 5000)
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

    // Claim BEFORE the LLM work. The task-existence check above is TOCTOU: two
    // concurrent submits both see zero tasks, both run InvokeLLM, then both
    // overwrite nurse_notes and create duplicate tasks. Claim + re-read mirrors
    // onDocumentSigned / sendRenewalReminders.
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ai-process-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.entities.Visit.update(visit_id, { ai_process_claimed_by: claimToken });
    } catch {
      return Response.json({ error: 'Could not claim visit for processing' }, { status: 409 });
    }
    const claimCheck = await base44.entities.Visit.filter({ id: visit_id }, '-created_date', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].ai_process_claimed_by !== claimToken) {
      return Response.json({
        success: true,
        already_processed: true,
        visit: claimCheck[0] || visit,
        tasks_created: 0,
        tasks: [],
        skipped: 'claimed by concurrent run',
      });
    }

    // Always generate the narrative from the ORIGINAL raw input, never from a
    // prior AI narrative. raw_transcription is the canonical raw source; fall back
    // to nurse_notes for older visits that predate it.
    const rawNotes = (visit.raw_transcription && visit.raw_transcription.trim())
      ? visit.raw_transcription
      : (visit.nurse_notes || '');

    const patient = await base44.entities.Patient.get(visit.patient_id);
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

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
      model: 'automatic'
    });

    // Generate follow-up tasks
    const tasksPrompt = `Based on this completed visit, identify critical follow-up tasks that should be assigned:

PATIENT: ${patient.first_name} ${patient.last_name}
VISIT TYPE: ${visit.visit_type}
VITAL SIGNS: ${JSON.stringify(visit.vital_signs || {})}
CLINICAL NOTES: ${visit.nurse_notes || 'None'}

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
      status: 'completed',
      ai_processed_at: new Date().toISOString(),
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
      action_url: `/PatientDetails?id=${visit.patient_id}`,
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
      error: 'Internal server error'
    }, { status: 500 });
  }
});

// Helper function to extract clinical tags from narrative
function extractTags(narrative) {
  const tags = [];
  const text = narrative.toLowerCase();
  
  // Clinical indicators. 'stable' and 'med' must match on a word boundary:
  // 'unstable'.includes('stable') is true, so a narrative documenting an
  // UNSTABLE patient was auto-tagged 'stable', and bare 'med' also fired on
  // "medical", "immediately" and "medium". The rest stay substring matches on
  // purpose (e.g. "breath" has to match "breathing"). `text` is already
  // lowercased.
  if (/\bstable\b/.test(text) || text.includes('improving')) tags.push('stable');
  if (text.includes('decline') || text.includes('worsening')) tags.push('declining');
  if (text.includes('pain')) tags.push('pain_management');
  if (text.includes('wound')) tags.push('wound_care');
  if (text.includes('medication') || /\bmeds?\b/.test(text)) tags.push('medication');
  if (text.includes('edema') || text.includes('swelling')) tags.push('edema');
  if (text.includes('breath') || text.includes('respiratory')) tags.push('respiratory');
  if (text.includes('cardiac') || text.includes('heart')) tags.push('cardiac');
  if (text.includes('fall') || text.includes('safety')) tags.push('safety');
  if (text.includes('teaching') || text.includes('education')) tags.push('teaching');
  if (text.includes('homebound')) tags.push('homebound');
  
  return tags;
}