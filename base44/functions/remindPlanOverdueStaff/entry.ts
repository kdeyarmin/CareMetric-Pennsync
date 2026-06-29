import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    if (!isAdminUser(user)) {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    const { planId } = await req.json();
    if (!planId) {
      return Response.json({ error: 'planId is required' }, { status: 400 });
    }

    const [plan] = await base44.asServiceRole.entities.LearningPlan.filter({ id: planId });
    if (!plan) {
      return Response.json({ error: 'Learning plan not found' }, { status: 404 });
    }

    const assignments = await base44.asServiceRole.entities.TrainingAssignment.filter({ plan_id: planId }, '-due_date', 5000);
    const now = new Date();
    const isOverdue = (a) =>
      a.status !== 'completed' &&
      a.pass_fail_result !== 'passed' &&
      (a.status === 'overdue' || (a.due_date && new Date(a.due_date) < now));

    // Agency admins can only nudge staff inside their own agency.
    let allowedEmails = null;
    if (user.account_type === 'agency_admin' && user.agency_name) {
      const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
      allowedEmails = new Set(allUsers.filter((u) => u.agency_name === user.agency_name).map((u) => u.email));
    }

    // Group overdue assignments per learner so each person gets one reminder.
    const byUser = new Map();
    for (const a of assignments) {
      if (!isOverdue(a) || !a.assigned_to_user_id) continue;
      if (allowedEmails && !allowedEmails.has(a.assigned_to_user_id)) continue;
      if (!byUser.has(a.assigned_to_user_id)) byUser.set(a.assigned_to_user_id, []);
      byUser.get(a.assigned_to_user_id).push(a);
    }

    const today = now.toISOString().slice(0, 10);

    // One reminder per user; flag every overdue assignment. Both run in bounded
    // parallel chunks so a large plan (many staff × many courses) doesn't
    // serialize into a long, timeout-prone sequence of awaits.
    const notifications = [];
    const flagOps = [];
    for (const [email, items] of byUser.entries()) {
      notifications.push(() => base44.asServiceRole.entities.Notification.create({
        user_email: email,
        title: 'Overdue required training',
        message: `You have ${items.length} overdue in-service${items.length === 1 ? '' : 's'} in "${plan.name}". Please complete ${items.length === 1 ? 'it' : 'them'} to stay compliant.`,
        type: 'training_due',
        priority: 'high',
        action_url: '/MyLearning',
        action_label: 'Open My Learning',
        metadata: { plan_id: planId, plan_name: plan.name, overdue_count: items.length },
      }));
      for (const a of items) {
        flagOps.push(() => base44.asServiceRole.entities.TrainingAssignment.update(a.id, {
          reminder_sent: true,
          last_reminder_date: today,
        }));
      }
    }

    const remindedUsers = notifications.length;
    const flagged = flagOps.length;

    const runChunked = async (ops, size = 25) => {
      for (let i = 0; i < ops.length; i += size) {
        await Promise.all(ops.slice(i, i + size).map((op) => op()));
      }
    };
    await runChunked(notifications);
    await runChunked(flagOps);

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
    return Response.json({ error: error.message }, { status: 500 });
  }
});