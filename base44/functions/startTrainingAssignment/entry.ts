import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


const isAdminUser = (user) => user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { assignmentId } = await req.json();
    if (!assignmentId) {
      return Response.json({ error: 'assignmentId is required' }, { status: 400 });
    }

    const [assignment] = await base44.asServiceRole.entities.TrainingAssignment.filter({ id: assignmentId }, undefined, 5000);
    if (!assignment) {
      return Response.json({ error: 'Assignment not found' }, { status: 404 });
    }

    if (!isAdminUser(user) && assignment.assigned_to_user_id !== user.email) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date().toISOString();
    await base44.asServiceRole.entities.TrainingAssignment.update(assignmentId, {
      status: assignment.status === 'assigned' ? 'in_progress' : assignment.status,
      started_date: assignment.started_date || now,
      last_accessed: now,
      progress_percentage: Math.max(assignment.progress_percentage || 0, 5)
    });

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_modified',
      entity_type: 'TrainingAssignment',
      entity_id: assignmentId,
      reason: assignment.latest_attempt_number > 0 ? 'retaken' : 'started',
      after_json: { status: assignment.status === 'assigned' ? 'in_progress' : assignment.status, started_date: assignment.started_date || now },
      severity: 'info'
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('startTrainingAssignment failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});