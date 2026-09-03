import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/** Explicit patient access for service-role clinical processing. */
function assertPatientAccess(user, callerEmail, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isOwner = normalizeProtectedEmail(patient.created_by) === callerEmail;
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.some(
      (email) => normalizeProtectedEmail(email) === callerEmail,
    );
  if (!isOwner && !isAssigned && !isProtectedSuperAdmin(user)) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const body = await req.json();
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { noteText, patientId, visitId, visitType, diagnosis } = body; // v2
    if (typeof noteText !== 'string' || !noteText.trim()) {
      return Response.json({ error: 'noteText is required' }, { status: 400 });
    }
    if (typeof patientId !== 'string' || !patientId.trim() || patientId.trim().length > 200) {
      return Response.json({ error: 'patientId is required' }, { status: 400 });
    }
    if (visitId !== undefined
      && (typeof visitId !== 'string' || !visitId.trim() || visitId.trim().length > 200)) {
      return Response.json({ error: 'Invalid visitId' }, { status: 400 });
    }
    const scopedPatientId = patientId.trim();
    const scopedVisitId = typeof visitId === 'string' ? visitId.trim() : '';

    let patientContext = '';
    let patientName = '';
    // Chart-attached tasks require a patient the caller can access. Optional
    // visitId must belong to that patient (service-role Task.create otherwise
    // lets a foreign related_visit_id slip through).
    const patientRows = await base44.asServiceRole.entities.Patient
      .filter({ id: scopedPatientId }, '', 1).catch(() => []);
    // A service-role result is data, not proof that the requested id matched.
    const patient = (Array.isArray(patientRows) ? patientRows : [])
      .find((row) => typeof row?.id === 'string' && row.id.trim() === scopedPatientId);
    const denied = assertPatientAccess(user, callerEmail, patient);
    if (denied) return denied;
    patientName = `${patient.first_name} ${patient.last_name}`;
    const secondaryDiagnoses = Array.isArray(patient.secondary_diagnoses)
      ? patient.secondary_diagnoses.join(', ')
      : '';
    patientContext = `Patient: ${patientName}, Primary Diagnosis: ${patient.primary_diagnosis || diagnosis || 'Not documented'}, Secondary Diagnoses: ${secondaryDiagnoses || 'None'}`;
    if (scopedVisitId) {
      const visitRows = await base44.asServiceRole.entities.Visit
        .filter({ id: scopedVisitId }, '', 1).catch(() => []);
      const visit = (Array.isArray(visitRows) ? visitRows : [])
        .find((row) => typeof row?.id === 'string'
          && row.id.trim() === scopedVisitId
          && typeof row?.patient_id === 'string'
          && row.patient_id.trim() === scopedPatientId);
      if (!visit) {
        return Response.json({ error: 'Visit not found for this patient' }, { status: 404 });
      }
      // Claim before LLM + Task.create so concurrent submits cannot both
      // invent duplicate follow-ups (mirrors extractClinicalEvents).
      const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `followup-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      try {
        await base44.asServiceRole.entities.Visit.update(scopedVisitId, {
          followup_tasks_claimed_by: claimToken,
        });
      } catch {
        return Response.json({ error: 'Could not claim visit for follow-up tasks' }, { status: 409 });
      }
      const claimRows = await base44.asServiceRole.entities.Visit
        .filter({ id: scopedVisitId }, '', 1).catch(() => []);
      const claimCheck = (Array.isArray(claimRows) ? claimRows : [])
        .find((row) => typeof row?.id === 'string'
          && row.id.trim() === scopedVisitId
          && typeof row?.patient_id === 'string'
          && row.patient_id.trim() === scopedPatientId);
      if (!claimCheck || claimCheck.followup_tasks_claimed_by !== claimToken) {
        return Response.json({
          success: true,
          already_processed: true,
          tasks_created: 0,
          tasks: [],
          patient_name: patientName,
          skipped: 'claimed by concurrent run',
        });
      }
      const existingRows = await base44.asServiceRole.entities.Task
        .filter({ related_visit_id: scopedVisitId, source: 'ai_generated' }, undefined, 1)
        .catch(() => []);
      const existingAi = (Array.isArray(existingRows) ? existingRows : [])
        .filter((task) => typeof task?.related_visit_id === 'string'
          && task.related_visit_id.trim() === scopedVisitId
          && task.source === 'ai_generated');
      if (existingAi.length > 0) {
        return Response.json({
          success: true,
          already_processed: true,
          tasks_created: 0,
          tasks: [],
          patient_name: patientName,
          skipped: 'ai follow-up tasks already exist for visit',
        });
      }
    }

    const response = await base44.integrations.Core.InvokeLLM({
      model: "automatic",
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

    const suggestedTasks = Array.isArray(response?.tasks) ? response.tasks : [];

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
          patient_id: scopedPatientId,
          ...(scopedVisitId ? { related_visit_id: scopedVisitId } : {}),
          assigned_to: callerEmail,
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
