import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Tiered renewal / due-date reminders for required training.
// processTrainingRenewals already CREATES the renewal assignment + one
// notification; this job
// adds escalating nudges to both the learner and their manager as the due date
// approaches (60 / 30 / 14 / 7 / 1 days) and once it passes (overdue).
//
// Idempotency: each assignment records the tiers it has already nudged in
// TrainingAssignment.reminder_offsets_sent, so a same-day re-run never double
// sends. When a cron run is missed, every tier the due date has already crossed
// is marked as sent so the learner gets exactly one (the most urgent) nudge.
// ───────────────────────────────────────────────────────────────────────────

// Upcoming reminder tiers (days before due). Due-today (daysUntilDue === 0)
// maps to the most urgent upcoming tier (1), NOT overdue. The overdue nudge is
// a separate one-shot recorded under this sentinel offset.
const UPCOMING_TIERS = [60, 30, 14, 7, 1];
const OVERDUE_OFFSET = -1;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin' || me?.account_type === 'agency_admin' || me?.account_type === 'super_admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const svc = base44.asServiceRole.entities;
    const today = new Date();
    const todayIso = today.toISOString().slice(0, 10);

    const openStatuses = ['assigned', 'in_progress', 'overdue', 'failed'];
    // Order by due_date ascending so the overdue + soonest-due assignments are
    // always within the fetch window, even in tenants with >5000 total rows
    // (a newest-by-created_date cap could miss an old-but-due annual assignment).
    const assignments = await svc.TrainingAssignment.list('due_date', 5000);

    // Resolve manager emails lazily via a small cache to copy supervisors.
    const userByEmail = {};
    const loadUser = async (email) => {
      if (!email) return null;
      if (email in userByEmail) return userByEmail[email];
      const [u] = await svc.User.filter({ email }, '-created_date', 1).catch(() => []);
      userByEmail[email] = u || null;
      return userByEmail[email];
    };

    const notifications = [];
    let remindersSent = 0;

    for (const a of assignments) {
      if (!a.required || !a.due_date) continue;
      if (!openStatuses.includes(a.status)) continue;
      if (!a.assigned_to_user_id) continue;

      const due = new Date(`${a.due_date}T00:00:00Z`);
      const daysUntilDue = Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

      // Overdue only AFTER the due date has passed (daysUntilDue < 0). Due-today
      // (=== 0) is an upcoming reminder, not an overdue escalation.
      const overdue = daysUntilDue < 0;
      // Tiers the due date has crossed, and the most urgent (smallest) one to act
      // on now. Overdue collapses to a single sentinel offset.
      const crossed = overdue
        ? [...UPCOMING_TIERS, OVERDUE_OFFSET]
        : UPCOMING_TIERS.filter((t) => daysUntilDue <= t);
      if (crossed.length === 0) continue; // more than 60 days out

      const alreadySent = Array.isArray(a.reminder_offsets_sent) ? a.reminder_offsets_sent : [];
      const tier = Math.min(...crossed); // smallest = most urgent (OVERDUE_OFFSET if overdue)
      if (alreadySent.includes(tier)) continue; // already nudged at this level
      const dueLabel = new Date(a.due_date).toLocaleDateString();
      const learnerMsg = overdue
        ? `Your required training "${a.course_title}" is overdue (was due ${dueLabel}). Please complete it as soon as possible.`
        : `Reminder: your required training "${a.course_title}" is due ${dueLabel} (${daysUntilDue} day${daysUntilDue === 1 ? '' : 's'} left).`;

      notifications.push({
        user_email: a.assigned_to_user_id,
        title: overdue ? 'Training overdue' : 'Training due soon',
        message: learnerMsg,
        type: 'training_due',
        priority: overdue || tier <= 7 ? 'high' : 'medium',
        action_url: '/MyTraining',
        action_label: 'Open training',
        metadata: { assignment_id: a.id, course_id: a.course_id, tier, days_until_due: daysUntilDue },
      });

      // Copy the learner's manager once the deadline is close or passed.
      if (overdue || tier <= 7) {
        const learner = await loadUser(a.assigned_to_user_id);
        const managerEmail = learner?.manager_email;
        if (managerEmail && managerEmail !== a.assigned_to_user_id) {
          notifications.push({
            user_email: managerEmail,
            title: overdue ? 'Staff training overdue' : 'Staff training due soon',
            message: `${learner?.full_name || a.assigned_to_user_id}'s required training "${a.course_title}" is ${overdue ? 'overdue' : `due ${dueLabel}`}.`,
            type: 'compliance_alert',
            priority: 'high',
            action_url: '/AdminTraining',
            action_label: 'Open admin training',
            metadata: { assignment_id: a.id, staff_email: a.assigned_to_user_id, tier },
          });
        }
      }

      // Mark every crossed tier as sent so a missed run doesn't replay old tiers.
      await svc.TrainingAssignment.update(a.id, {
        reminder_offsets_sent: Array.from(new Set([...alreadySent, ...crossed])),
        last_reminder_date: today.toISOString(),
        reminder_sent: true,
      });
      remindersSent++;
    }

    // Batch-create notifications.
    let notificationsCreated = 0;
    for (let i = 0; i < notifications.length; i += 50) {
      const batch = notifications.slice(i, i + 50);
      await Promise.all(batch.map((n) => svc.Notification.create(n).catch((err) => console.error('Notification create failed:', err))));
      notificationsCreated += batch.length;
    }

    return Response.json({ success: true, date: todayIso, reminders_sent: remindersSent, notifications_created: notificationsCreated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
