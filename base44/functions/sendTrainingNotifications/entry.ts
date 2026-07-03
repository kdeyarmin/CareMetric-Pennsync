import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    // Authorization: privileged scheduled job (mirrors sendExpirationNotifications
    // / sendRenewalReminders). The
    // no-identity cron path is allowed (platform invocation restriction is the
    // control); an authenticated non-admin caller is always rejected.
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

    const today = new Date();
    const notificationsSent = [];

    const assignments = await base44.asServiceRole.entities.TrainingAssignment.list('-created_date', 1000);

    for (const assignment of assignments.filter((item) => ['assigned', 'in_progress'].includes(item.status))) {
      if (!assignment.due_date || !assignment.assigned_to_user_id) continue;
      const dueDate = new Date(assignment.due_date);
      const daysUntilDue = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

      // Fire AT or BELOW an unsent tier (not an exact-day match) so a missed cron
      // run doesn't skip a tier permanently; reminder_offsets_sent dedups both
      // same-day re-runs and already-fired tiers.
      const REMINDER_TIERS = [14, 7, 3, 1];
      const sentOffsets = Array.isArray(assignment.reminder_offsets_sent) ? assignment.reminder_offsets_sent : [];
      const dueOffsets = daysUntilDue >= 0
        ? REMINDER_TIERS.filter((o) => daysUntilDue <= o && !sentOffsets.includes(o))
        : [];
      if (dueOffsets.length > 0) {
        const notification = await base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          title: `Training due in ${daysUntilDue} day${daysUntilDue > 1 ? 's' : ''}`,
          message: `Your assigned in-service "${assignment.course_title}" is due on ${dueDate.toLocaleDateString()}.`,
          type: 'training_due',
          priority: daysUntilDue <= 3 ? 'high' : 'medium',
          action_url: '/MyTraining',
          action_label: 'Open training',
          metadata: { assignment_id: assignment.id, course_id: assignment.course_id, days_until_due: daysUntilDue }
        });
        notificationsSent.push(notification.id);
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
          reminder_offsets_sent: [...sentOffsets, ...dueOffsets],
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
      const expiration = new Date(certificate.expiration_date);
      const daysUntilExpiration = Math.ceil((expiration - today) / (1000 * 60 * 60 * 24));
      // Same-day guard (the cert block previously had no dedup marker, so a
      // same-day cron re-run re-created every renewal notification).
      const certTodayKey = today.toISOString().slice(0, 10);
      if ([30, 14, 7, 3, 1].includes(daysUntilExpiration) && certificate.last_renewal_reminder_date !== certTodayKey) {
        const notification = await base44.asServiceRole.entities.Notification.create({
          user_email: certificate.user_id,
          title: `Certificate renewal due in ${daysUntilExpiration} day${daysUntilExpiration > 1 ? 's' : ''}`,
          message: `Your certificate for "${certificate.course_title}" expires on ${expiration.toLocaleDateString()}.`,
          type: 'compliance_alert',
          priority: daysUntilExpiration <= 3 ? 'high' : 'medium',
          action_url: '/MyTraining',
          action_label: 'View transcript',
          metadata: { certificate_id: certificate.id, course_id: certificate.course_id }
        });
        notificationsSent.push(notification.id);
        await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
          last_renewal_reminder_date: certTodayKey
        });
      }
    }

    return Response.json({ success: true, notifications_sent: notificationsSent.length });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});