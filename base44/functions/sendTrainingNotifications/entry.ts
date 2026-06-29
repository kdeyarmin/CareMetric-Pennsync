import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
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