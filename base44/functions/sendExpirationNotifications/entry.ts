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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

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
    }, 'renewal_due_date', 500);

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
    // `expiration_note_offsets_sent` tracking prevents re-sending a tier already fired.
    const reminderOffsets = [30, 14, 7, 3];

    // Process training assignments with renewal dates
    for (const assignment of assignments) {
      if (!assignment.renewal_due_date) continue;

      const renewalDate = new Date(assignment.renewal_due_date);
      const daysUntilExpiration = Math.ceil((renewalDate - today) / (1000 * 60 * 60 * 24));

      // Dedicated marker for THIS job's in-app expiration note — sendRenewalReminders
      // uses TrainingAssignment.reminder_offsets_sent with a different tier set, and
      // sharing it meant whichever ran first suppressed the other's reminders.
      const remindersSent = assignment.expiration_note_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration >= 0 && daysUntilExpiration <= offset && !remindersSent.includes(offset)
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
          expiration_note_offsets_sent: [...remindersSent, ...dueOffsets]
        }));
      }
    }

    // Process personnel credentials
    for (const credential of credentials) {
      if (!credential.expiration_date) continue;

      const expirationDate = new Date(credential.expiration_date);
      const daysUntilExpiration = Math.ceil((expirationDate - today) / (1000 * 60 * 60 * 24));

      // Dedicated marker for THIS job — sendCredentialRenewalReminders and
      // sendPersonnelExpirationNotifications key off other fields on the same
      // PersonnelCredential, so a shared marker cross-suppressed their reminders.
      const remindersSent = credential.expiration_note_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration >= 0 && daysUntilExpiration <= offset && !remindersSent.includes(offset)
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
          expiration_note_offsets_sent: [...remindersSent, ...dueOffsets]
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
    console.error('sendExpirationNotifications failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});