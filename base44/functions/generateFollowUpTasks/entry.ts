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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { noteText, patientId, visitId, visitType, diagnosis } = await req.json(); // v2
    if (!noteText) return Response.json({ error: 'noteText is required' }, { status: 400 });

    let patientContext = '';
    let patientName = '';
    // Chart-attached tasks require a patient the caller can access. Optional
    // visitId must belong to that patient (service-role Task.create otherwise
    // lets a foreign related_visit_id slip through).
    if (patientId) {
      const [patient] = await base44.asServiceRole.entities.Patient
        .filter({ id: patientId }, '', 1).catch(() => []);
      const denied = await assertPatientAccess(base44, user, patient);
      if (denied) return denied;
      patientName = `${patient.first_name} ${patient.last_name}`;
      patientContext = `Patient: ${patientName}, Primary Diagnosis: ${patient.primary_diagnosis || diagnosis || 'Not documented'}, Secondary Diagnoses: ${(patient.secondary_diagnoses || []).join(', ') || 'None'}`;
      if (visitId) {
        const [visit] = await base44.asServiceRole.entities.Visit
          .filter({ id: visitId }, '', 1).catch(() => []);
        if (!visit || visit.patient_id !== patientId) {
          return Response.json({ error: 'Visit not found for this patient' }, { status: 404 });
        }
        // Claim before LLM + Task.create so concurrent submits cannot both
        // invent duplicate follow-ups (mirrors extractClinicalEvents).
        const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `followup-tasks-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        try {
          await base44.asServiceRole.entities.Visit.update(visitId, {
            followup_tasks_claimed_by: claimToken,
          });
        } catch {
          return Response.json({ error: 'Could not claim visit for follow-up tasks' }, { status: 409 });
        }
        const claimCheck = await base44.asServiceRole.entities.Visit
          .filter({ id: visitId }, '', 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].followup_tasks_claimed_by !== claimToken) {
          return Response.json({
            success: true,
            already_processed: true,
            tasks_created: 0,
            tasks: [],
            patient_name: patientName,
            skipped: 'claimed by concurrent run',
          });
        }
        const existingAi = await base44.asServiceRole.entities.Task
          .filter({ related_visit_id: visitId, source: 'ai_generated' }, undefined, 1)
          .catch(() => []);
        if (existingAi && existingAi.length > 0) {
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
    } else if (visitId) {
      return Response.json({ error: 'patientId is required when visitId is provided' }, { status: 400 });
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});