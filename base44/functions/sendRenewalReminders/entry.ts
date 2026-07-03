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

// <<<BEGIN SHARED HELPER: requireSchedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
// Cron gate: anonymous callers must present x-internal-secret when
// INTERNAL_FN_SECRET is set (docs/SECURITY-RLS-CHECKLIST.md §4). Returns a 403
// Response to short-circuit with, or null to proceed. Comparison is
// constant-time (SHA-256 digest XOR) so the secret can't be timing-probed.
async function requireSchedulerAuth(req) {
  const secret = Deno.env.get('INTERNAL_FN_SECRET') || '';
  if (!secret) return null; // opt-in: unset = platform-trust window (set at launch)
  const provided = req.headers.get('x-internal-secret') || '';
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(secret)),
  ]);
  const av = new Uint8Array(a);
  const bv = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < av.length; i++) diff |= av[i] ^ bv[i];
  if (diff === 0) return null;
  return Response.json({ error: 'Forbidden' }, { status: 403 });
}
// <<<END SHARED HELPER: requireSchedulerAuth>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin' || me?.account_type === 'agency_admin' || me?.account_type === 'super_admin';
    if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }
    // No identity: enforce the shared scheduler gate (opt-in INTERNAL_FN_SECRET /
    // x-internal-secret header — see docs/SECURITY-RLS-CHECKLIST.md §4).
    if (!me) {
      const denied = await requireSchedulerAuth(req);
      if (denied) return denied;
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
    // Deferred reminder-tier marker writes. These must run only AFTER the
    // notifications are created — marking a tier "sent" before the create means a
    // failed/timed-out create permanently suppresses that learner's nudge. A
    // duplicate reminder on a later run is the safe failure direction (mirrors
    // sendExpirationNotifications' markerUpdates).
    const markerUpdates = [];
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

      // Record the crossed tiers so a missed run doesn't replay old tiers — but
      // DEFER the write until after the notifications are created (see above).
      markerUpdates.push({
        assignmentId: a.id,
        apply: () => svc.TrainingAssignment.update(a.id, {
          reminder_offsets_sent: Array.from(new Set([...alreadySent, ...crossed])),
          last_reminder_date: today.toISOString(),
          reminder_sent: true,
        }),
      });
      remindersSent++;
    }

    // Batch-create notifications FIRST, with per-notification fault isolation:
    // one un-creatable Notification (e.g. a bad manager_email) must NOT abort the
    // whole run — that would skip every tier marker and re-notify every learner on
    // the next run (a storm). Track the assignments whose notifications failed so
    // ONLY their tier marker is withheld (they replay next run); all others are
    // marked so they don't replay.
    let notificationsCreated = 0;
    const failedAssignmentIds = new Set();
    for (let i = 0; i < notifications.length; i += 50) {
      const batch = notifications.slice(i, i + 50);
      const results = await Promise.allSettled(batch.map((n) => svc.Notification.create(n)));
      results.forEach((r, k) => {
        if (r.status === 'fulfilled') {
          notificationsCreated++;
        } else {
          const aid = batch[k]?.metadata?.assignment_id;
          if (aid) failedAssignmentIds.add(aid);
          console.error('sendRenewalReminders: notification create failed', r.reason?.message || r.reason);
        }
      });
    }

    // Record the crossed tiers, skipping any assignment whose notification failed
    // so its reminder replays next run (the safe direction) instead of being lost.
    for (const { assignmentId, apply } of markerUpdates) {
      if (failedAssignmentIds.has(assignmentId)) continue;
      await apply();
    }

    return Response.json({ success: true, date: todayIso, reminders_sent: remindersSent, notifications_created: notificationsCreated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
