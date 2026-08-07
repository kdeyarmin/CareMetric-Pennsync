import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>



// ───────────────────────────────────────────────────────────────────────────
// Send a "you have overdue required training" reminder to every staff member
// who is behind on a learning plan. Notifications to other users must be
// written with the service role (RLS blocks a client from notifying others),
// so this runs server-side and is admin-gated. Overdue assignments are flagged
// (reminder_sent / last_reminder_date) so the reminder is visible in reports.
// ───────────────────────────────────────────────────────────────────────────

const isAdminUser = (user) =>
  user?.role === 'admin' ||
  user?.account_type === 'agency_admin' ||
  user?.account_type === 'super_admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { planId } = await req.json();
    if (!planId) {
      return Response.json({ error: 'planId is required' }, { status: 400 });
    }

    const [plan] = await base44.asServiceRole.entities.LearningPlan.filter({ id: planId }, undefined, 5000);
    if (!plan) {
      return Response.json({ error: 'Learning plan not found' }, { status: 404 });
    }

    const assignments = await base44.asServiceRole.entities.TrainingAssignment.filter({ plan_id: planId }, '-due_date', 5000);
    const now = new Date();
    // Date-only due_date values must compare on the local calendar — UTC midnight
    // parsing flagged assignments overdue the evening before the due day.
    const isPastDue = (dueDate) => {
      if (!dueDate) return false;
      const raw = String(dueDate).trim();
      if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
        const [y, m, d] = raw.split('-').map(Number);
        const due = new Date(y, m - 1, d);
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        return due < today;
      }
      const due = new Date(dueDate);
      return !Number.isNaN(due.getTime()) && due < now;
    };
    const isOverdue = (a) =>
      a.status !== 'completed' &&
      a.pass_fail_result !== 'passed' &&
      (a.status === 'overdue' || isPastDue(a.due_date));

    // Agency admins can only nudge staff inside their own agency.
    let allowedEmails = null;
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
      const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
      allowedEmails = new Set(allUsers.filter((u) => u.agency_name === user.agency_name).map((u) => u.email));
    }

    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    // Group overdue assignments per learner so each person gets one reminder.
    // Skip assignments already reminded today so re-clicks don't re-notify.
    const byUser = new Map();
    for (const a of assignments) {
      if (!isOverdue(a) || !a.assigned_to_user_id) continue;
      if (allowedEmails && !allowedEmails.has(a.assigned_to_user_id)) continue;
      if (a.reminder_sent && a.last_reminder_date === today) continue;
      if (!byUser.has(a.assigned_to_user_id)) byUser.set(a.assigned_to_user_id, []);
      byUser.get(a.assigned_to_user_id).push(a);
    }

    // Stamp assignments FIRST (claim via last_reminder_date), then notify.
    // Notify-before-stamp let a failed stamp / concurrent click duplicate
    // overdue reminders for the same day.
    let remindedUsers = 0;
    let flagged = 0;
    for (const [email, items] of byUser.entries()) {
      const claimed = [];
      for (const a of items) {
        // Skip if another concurrent run already stamped today.
        if (a.reminder_sent && a.last_reminder_date === today) continue;
        await base44.asServiceRole.entities.TrainingAssignment.update(a.id, {
          reminder_sent: true,
          last_reminder_date: today,
        });
        const recheck = await base44.asServiceRole.entities.TrainingAssignment
          .filter({ id: a.id }, undefined, 1)
          .catch(() => []);
        if (recheck[0]?.last_reminder_date === today) {
          claimed.push(a);
          flagged += 1;
        }
      }
      if (claimed.length === 0) continue;
      try {
        await base44.asServiceRole.entities.Notification.create({
          user_email: email,
          title: 'Overdue required training',
          message: `You have ${claimed.length} overdue in-service${claimed.length === 1 ? '' : 's'} in "${plan.name}". Please complete ${claimed.length === 1 ? 'it' : 'them'} to stay compliant.`,
          type: 'training_due',
          priority: 'high',
          action_url: '/LearningCenter?tab=courses',
          action_label: 'Open My Learning',
          metadata: { plan_id: planId, plan_name: plan.name, overdue_count: claimed.length },
        });
        remindedUsers += 1;
      } catch (err) {
        console.error('remindPlanOverdueStaff notify failed', email, err?.message || err);
      }
    }

    await base44.asServiceRole.entities.TrainingAuditLog.create({
      actor_id: user.email,
      actor_name: user.full_name,
      action: 'assignment_modified',
      entity_type: 'LearningPlan',
      entity_id: planId,
      after_json: { action: 'remind_overdue', plan_name: plan.name, reminded_users: remindedUsers, assignments_flagged: flagged },
      severity: 'info',
    });

    return Response.json({ success: true, reminded_users: remindedUsers, assignments_flagged: flagged });
  } catch (error) {
    console.error('remindPlanOverdueStaff failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});