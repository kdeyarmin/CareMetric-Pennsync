import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: opt-in lockdown for this privileged scheduled job (mirrors
    // processTrainingRenewals / syncFaxStatuses). When INTERNAL_FN_SECRET is set,
    // require an admin OR the internal-secret header; the no-identity cron path is
    // allowed only while no secret is configured.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    // Get today's date and 30 days from now
    const today = new Date();
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(today.getDate() + 30);
    
    const todayStr = today.toISOString().split('T')[0];
    const thirtyDaysStr = thirtyDaysFromNow.toISOString().split('T')[0];

    // Fetch assignments/credentials, sorted ASCENDING by date so the SOONEST-
    // expiring (the ones this job exists to notify) are within the 500-row cap.
    // A descending sort put the furthest-future first and dropped the imminent
    // ones off the tail — exactly the records that needed a warning.
    const assignments = await base44.asServiceRole.entities.TrainingAssignment.filter({
      status: 'completed'
    }, 'due_date', 500);

    const credentials = await base44.asServiceRole.entities.PersonnelCredential.filter({
      status: 'approved'
    }, 'expiration_date', 500);

    const notifications = [];
    const adminNotifications = [];
    // Deferred reminder-tier marker writes. These must run only AFTER the employee
    // notifications are persisted — marking a tier "sent" before bulkCreate means a
    // bulkCreate failure permanently suppresses that reminder for every record
    // processed before the failure. Worst case if a marker write fails post-create
    // is a duplicate reminder next run (the safe direction).
    const markerUpdates = [];

    // Reminder tiers (days before expiration). Fire when the count is AT or
    // BELOW a tier that hasn't been sent yet, rather than on an exact-day match.
    // A missed cron run no longer skips the tier permanently; per-record
    // `reminder_offsets_sent` tracking prevents re-sending a tier already fired.
    const reminderOffsets = [30, 14, 7, 3];

    // Process training assignments with renewal dates
    for (const assignment of assignments) {
      if (!assignment.renewal_due_date) continue;

      const renewalDate = new Date(assignment.renewal_due_date);
      const daysUntilExpiration = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));

      const remindersSent = assignment.reminder_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration <= offset && !remindersSent.includes(offset)
      );

      if (dueOffsets.length > 0) {
        // Create notification for employee
        notifications.push({
          user_email: assignment.assigned_to_user_id,
          type: 'expiration_warning',
          title: `Training Renewal Due Soon: ${assignment.course_title}`,
          message: `Your ${assignment.course_title} certification expires in ${daysUntilExpiration} days. Please complete the renewal training.`,
          action_url: '/MyTraining',
          priority: daysUntilExpiration <= 7 ? 'high' : 'medium',
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });

        // Create admin notification
        adminNotifications.push({
          type: 'training_expiration',
          user_id: assignment.assigned_to_user_id,
          course_title: assignment.course_title,
          days_until_expiration: daysUntilExpiration,
          renewal_due_date: assignment.renewal_due_date
        });

        // Record every newly-crossed tier so it is never re-sent — deferred until
        // after the notifications are actually created (see markerUpdates above).
        markerUpdates.push(() => base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
          reminder_offsets_sent: [...remindersSent, ...dueOffsets]
        }));
      }
    }

    // Process personnel credentials
    for (const credential of credentials) {
      if (!credential.expiration_date) continue;

      const expirationDate = new Date(credential.expiration_date);
      const daysUntilExpiration = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

      const remindersSent = credential.reminder_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration <= offset && !remindersSent.includes(offset)
      );

      if (dueOffsets.length > 0) {
        // Create notification for employee
        notifications.push({
          user_email: credential.user_id,
          type: 'credential_expiration',
          title: `Credential Expiring Soon: ${credential.title}`,
          message: `Your ${credential.title} expires in ${daysUntilExpiration} days. Please upload a renewed document.`,
          action_url: '/PersonnelFile',
          priority: daysUntilExpiration <= 7 ? 'high' : 'medium',
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });

        // Create admin notification
        adminNotifications.push({
          type: 'credential_expiration',
          user_id: credential.user_id,
          user_name: credential.user_name,
          credential_title: credential.title,
          days_until_expiration: daysUntilExpiration,
          expiration_date: credential.expiration_date
        });

        // Record every newly-crossed tier so it is never re-sent — deferred until
        // after the notifications are actually created (see markerUpdates above).
        markerUpdates.push(() => base44.asServiceRole.entities.PersonnelCredential.update(credential.id, {
          reminder_offsets_sent: [...remindersSent, ...dueOffsets]
        }));
      }
    }

    // Bulk create employee notifications
    if (notifications.length > 0) {
      await base44.asServiceRole.entities.Notification.bulkCreate(notifications);
    }

    // Only now that the employee notifications are persisted, record the crossed
    // reminder tiers so a bulkCreate failure can't permanently drop a reminder.
    for (const applyMarker of markerUpdates) {
      await applyMarker();
    }

    // Create consolidated admin notification
    if (adminNotifications.length > 0) {
      const adminUsers = await base44.asServiceRole.entities.User.filter({ role: 'admin' }, '', 100);
      
      for (const admin of adminUsers) {
        await base44.asServiceRole.entities.Notification.create({
          user_email: admin.email,
          type: 'admin_expiration_summary',
          title: `${adminNotifications.length} Upcoming Expirations`,
          message: `There are ${adminNotifications.length} training certifications or credentials expiring soon.`,
          action_url: '/AdminOperations',
          priority: 'medium',
          is_read: false,
          metadata: { expirations: adminNotifications },
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        });
      }
    }

    return Response.json({
      success: true,
      employee_notifications: notifications.length,
      admin_notifications: adminNotifications.length,
      total_expirations: adminNotifications.length
    });

  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});