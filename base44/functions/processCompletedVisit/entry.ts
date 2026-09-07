import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const MAX_IDENTIFIER_LENGTH = 200;
const SOURCE_SHA256_PATTERN = /^[a-f0-9]{64}$/;

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validAiSourceResult(result, visitId) {
  const source = result?.source;
  const visit = source?.visit;
  const patient = source?.patient;
  const processing = result?.processing;
  return plainObject(result)
    && result.updated === false
    && result.action === 'read_ai_processing_source'
    && SOURCE_SHA256_PATTERN.test(String(result.source_sha256 || ''))
    && plainObject(source)
    && source.protocol === 'completed_visit_ai_source_v1'
    && exactIdentifier(source.agency_id)
    && plainObject(visit)
    && visit.id === visitId
    && exactIdentifier(visit.patient_id)
    && visit.status === 'completed'
    && typeof visit.nurse_notes === 'string'
    && typeof visit.raw_transcription === 'string'
    && plainObject(visit.vital_signs)
    && plainObject(patient)
    && patient.id === visit.patient_id
    && patient.agency_id === source.agency_id
    && typeof patient.first_name === 'string'
    && typeof patient.last_name === 'string'
    && typeof patient.primary_diagnosis === 'string'
    && typeof patient.updated_date === 'string'
    && Number.isFinite(Date.parse(patient.updated_date))
    && plainObject(processing)
    && (processing.claimed_by === null || exactIdentifier(processing.claimed_by))
    && (processing.processed_at === null
      || (typeof processing.processed_at === 'string'
        && Number.isFinite(Date.parse(processing.processed_at))));
}

// Source-level containment remains in place while the completed-visit flow is
// proven in hosted two-agency tests. Both Visit mutations now cross the
// immutable AgencyMembership/Patient authority checks in updateAuthorizedVisit;
// this release gate must still remain before client creation, authentication,
// or any entity/integration access until nested-auth, claim-race, and provider
// failure evidence has been accepted.
const PROCESS_COMPLETED_VISIT_PAUSED = true;

async function invokeAuthorizedVisitAction(base44, payload) {
  const internalSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (internalSecret.length < 32) {
    throw new Error('Internal Visit mutation authorization is unavailable');
  }
  const response = await base44.functions.fetch('/updateAuthorizedVisit', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-internal-secret': internalSecret,
    },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.action !== payload.action) {
    throw new Error('Authorized Visit action failed');
  }
  return result;
}

async function readAuthorizedVisitAiSource(base44, visitId) {
  const result = await invokeAuthorizedVisitAction(base44, {
    visit_id: visitId,
    action: 'read_ai_processing_source',
  });
  if (!validAiSourceResult(result, visitId)) {
    throw new Error('Authorized Visit AI source read failed');
  }
  return result;
}

async function invokeAuthorizedVisitMutation(base44, payload) {
  const result = await invokeAuthorizedVisitAction(base44, payload);
  if (result?.updated !== true) {
    throw new Error('Authorized Visit mutation failed');
  }
  return result;
}

Deno.serve(async (req) => {
  if (PROCESS_COMPLETED_VISIT_PAUSED) {
    return Response.json({
      error: 'Completed-visit AI processing is temporarily unavailable pending tenant-safe Visit update migration',
      code: 'visit_update_security_validation_pending',
    }, { status: 503 });
  }

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

    // Read only the finite, purpose-bound source projection through the same
    // immutable tenant/Patient/Visit authority broker that owns the claim and
    // publication. No legacy user-mode Visit/Patient read participates.
    const initialSource = await readAuthorizedVisitAiSource(base44, visit_id);
    const visit = initialSource.source.visit;
    const patient = initialSource.source.patient;
    const sourceSha256 = initialSource.source_sha256;

    // Idempotency guard. This function has no client idempotency key, so a
    // double-click / retry would otherwise (a) overwrite nurse_notes with a fresh
    // narrative generated FROM the previous narrative — progressively corrupting
    // the documentation — and (b) create duplicate follow-up tasks + notifications
    // every time. Prefer the durable ai_processed_at stamp; fall back to existing
    // AI tasks for visits processed before that field existed.
    if (initialSource.processing.processed_at) {
      const existingAiTasks = await base44.entities.Task
        .filter({ related_visit_id: visit_id, source: 'ai_generated' }, undefined, 5000)
        .catch(() => []);
      return Response.json({
        success: true,
        already_processed: true,
        visit: { ...visit, ai_processed_at: initialSource.processing.processed_at },
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
    const claimNonce = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `ai-process-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const claimToken = `visit-ai-v1:${sourceSha256}:${claimNonce}`;
    try {
      const claimResult = await invokeAuthorizedVisitMutation(base44, {
        visit_id,
        action: 'claim_ai_processing',
        claim_token: claimToken,
        expected_source_sha256: sourceSha256,
      });
      if (claimResult?.visit?.ai_process_claimed_by !== claimToken) {
        throw new Error('Authorized Visit claim was not confirmed');
      }
    } catch {
      return Response.json({ error: 'Could not claim visit for processing' }, { status: 409 });
    }
    const claimedSource = await readAuthorizedVisitAiSource(base44, visit_id).catch(() => null);
    if (
      !claimedSource
      || claimedSource.processing.claimed_by !== claimToken
      || claimedSource.processing.processed_at !== null
      || claimedSource.source_sha256 !== sourceSha256
      || JSON.stringify(claimedSource.source) !== JSON.stringify(initialSource.source)
    ) {
      return Response.json({
        success: true,
        already_processed: true,
        visit,
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
    const publishResult = await invokeAuthorizedVisitMutation(base44, {
      visit_id,
      action: 'publish_ai_processing',
      claim_token: claimToken,
      expected_source_sha256: sourceSha256,
      nurse_notes: visitUpdate.nurse_notes,
      ai_tags: visitUpdate.ai_tags,
      ai_processed_at: visitUpdate.ai_processed_at,
      ...(visitUpdate.raw_transcription === undefined
        ? {}
        : { raw_transcription: visitUpdate.raw_transcription }),
    });
    if (
      publishResult?.visit?.ai_process_claimed_by !== claimToken
      || publishResult?.visit?.ai_processed_at !== visitUpdate.ai_processed_at
    ) {
      throw new Error('Authorized Visit publication was not confirmed');
    }
    const updatedVisit = {
      ...visit,
      ...visitUpdate,
      documentation_review_ack: null,
    };

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

  } catch {
    // Provider and SDK error objects can retain the PHI-bearing prompts and
    // clinical payloads processed above. Keep the operational breadcrumb fixed.
    console.error('processCompletedVisit failed');
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
