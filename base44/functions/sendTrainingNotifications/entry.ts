import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// Local calendar day count for date-only YYYY-MM-DD fields (mirrors
// remindPlanOverdueStaff / sendPersonnelExpirationNotifications).
function localDaysUntil(dateOnly, now = new Date()) {
  const raw = String(dateOnly || '').trim();
  let target;
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    target = new Date(y, m - 1, d);
  } else {
    target = new Date(dateOnly);
  }
  if (Number.isNaN(target.getTime())) return null;
  const todayLocal = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((target.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
}

function formatLocalDateLabel(dateOnly) {
  const raw = String(dateOnly || '').trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString();
  }
  const parsed = new Date(dateOnly);
  return Number.isNaN(parsed.getTime()) ? String(dateOnly) : parsed.toLocaleDateString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors sendExpirationNotifications
    // / sendRenewalReminders). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    const today = new Date();
    const notificationsSent = [];

    // Sort by due date (soonest first) with a high cap so the most overdue /
    // soonest-due rows are never starved by a newest-first 1000-row window.
    const assignments = await base44.asServiceRole.entities.TrainingAssignment.list('due_date', 5000);

    for (const assignment of assignments.filter((item) => ['assigned', 'in_progress'].includes(item.status))) {
      if (!assignment.due_date || !assignment.assigned_to_user_id) continue;
      const daysUntilDue = localDaysUntil(assignment.due_date, today);
      if (daysUntilDue === null) continue;

      // Fire AT or BELOW an unsent tier (not an exact-day match) so a missed cron
      // run doesn't skip a tier permanently. Use training_due_offsets_sent — not
      // reminder_offsets_sent — so this job does not suppress/collide with
      // sendRenewalReminders which owns reminder_offsets_sent.
      const REMINDER_TIERS = [14, 7, 3, 1];
      const sentOffsets = Array.isArray(assignment.training_due_offsets_sent) ? assignment.training_due_offsets_sent : [];
      const dueOffsets = daysUntilDue >= 0
        ? REMINDER_TIERS.filter((o) => daysUntilDue <= o && !sentOffsets.includes(o))
        : [];
      if (dueOffsets.length > 0) {
        const notification = await base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          title: `Training due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}`,
          message: `Your assigned in-service "${assignment.course_title}" is due on ${formatLocalDateLabel(assignment.due_date)}.`,
          type: 'training_due',
          priority: daysUntilDue <= 3 ? 'high' : 'medium',
          action_url: '/MyTraining',
          action_label: 'Open training',
          metadata: { assignment_id: assignment.id, course_id: assignment.course_id, days_until_due: daysUntilDue }
        });
        notificationsSent.push(notification.id);
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
          training_due_offsets_sent: [...sentOffsets, ...dueOffsets],
          last_reminder_date: today.toISOString().slice(0, 10),
          reminder_sent: true
        });
      }

      if (daysUntilDue < 0 && assignment.status !== 'overdue') {
        const notification = await base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          title: 'Training overdue',
          message: `Your assigned in-service "${assignment.course_title}" is overdue. Please complete it immediately.`,
          type: 'compliance_alert',
          priority: 'critical',
          action_url: '/MyTraining',
          action_label: 'Complete now',
          metadata: { assignment_id: assignment.id, course_id: assignment.course_id }
        });
        notificationsSent.push(notification.id);
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, { status: 'overdue' });
      }
    }

    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ revoked: false }, '-issued_at', 1000);
    for (const certificate of certificates) {
      if (!certificate.expiration_date) continue;
      const daysUntilExpiration = localDaysUntil(certificate.expiration_date, today);
      if (daysUntilExpiration === null) continue;
      // Fire AT or BELOW an unsent tier (not an exact-day match) so a missed cron
      // run doesn't skip a tier permanently; renewal_reminder_offsets_sent dedups
      // already-fired tiers.
      const RENEWAL_TIERS = [30, 14, 7, 3, 1];
      const sentRenewalOffsets = Array.isArray(certificate.renewal_reminder_offsets_sent) ? certificate.renewal_reminder_offsets_sent : [];
      const renewalOffsets = daysUntilExpiration >= 0
        ? RENEWAL_TIERS.filter((o) => daysUntilExpiration <= o && !sentRenewalOffsets.includes(o))
        : [];
      // Same-day guard (the cert block previously had no dedup marker, so a
      // same-day cron re-run re-created every renewal notification).
      const certTodayKey = today.toISOString().slice(0, 10);
      if (renewalOffsets.length > 0 && certificate.last_renewal_reminder_date !== certTodayKey) {
        const notification = await base44.asServiceRole.entities.Notification.create({
          user_email: certificate.user_id,
          title: `Certificate renewal due in ${daysUntilExpiration} day${daysUntilExpiration > 1 ? 's' : ''}`,
          message: `Your certificate for "${certificate.course_title}" expires on ${formatLocalDateLabel(certificate.expiration_date)}.`,
          type: 'compliance_alert',
          priority: daysUntilExpiration <= 3 ? 'high' : 'medium',
          action_url: '/MyTraining',
          action_label: 'View transcript',
          metadata: { certificate_id: certificate.id, course_id: certificate.course_id }
        });
        notificationsSent.push(notification.id);
        await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
          renewal_reminder_offsets_sent: [...sentRenewalOffsets, ...renewalOffsets],
          last_renewal_reminder_date: certTodayKey
        });
      }
    }

    return Response.json({ success: true, notifications_sent: notificationsSent.length });
  } catch (error) {
    console.error('sendTrainingNotifications failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
