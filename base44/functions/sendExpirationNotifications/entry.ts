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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// Local calendar day count for date-only YYYY-MM-DD fields (mirrors
// sendPersonnelExpirationNotifications / remindPlanOverdueStaff).
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const today = new Date();

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
    const runId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `exp-${Date.now()}`;

    // Resolve each staff member's agency once so training-expiration items can be
    // attributed. TrainingAssignment carries no agency_name, so these items used
    // to be built unscoped and — because the admin summary treats a null agency
    // as "visible to every admin" — every tenant's admins received every other
    // agency's staff names + course titles. Credentials already carry agency_name.
    const allStaff = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
    const agencyByEmail = new Map(
      (Array.isArray(allStaff) ? allStaff : [])
        .filter((u) => u && u.email)
        .map((u) => [u.email, String(u.agency_name || '').trim() || null]),
    );

    // Reminder tiers (days before expiration). Fire when the count is AT or
    // BELOW a tier that hasn't been sent yet, rather than on an exact-day match.
    // A missed cron run no longer skips the tier permanently; per-record
    // `expiration_note_offsets_sent` tracking prevents re-sending a tier already fired.
    const reminderOffsets = [30, 14, 7, 3];

    // Process training assignments with renewal dates
    for (const assignment of assignments) {
      if (!assignment.renewal_due_date) continue;

      const daysUntilExpiration = localDaysUntil(assignment.renewal_due_date, today);
      if (daysUntilExpiration === null) continue;

      // Dedicated marker for THIS job's in-app expiration note — sendRenewalReminders
      // uses TrainingAssignment.reminder_offsets_sent with a different tier set, and
      // sharing it meant whichever ran first suppressed the other's reminders.
      const remindersSent = assignment.expiration_note_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration >= 0 && daysUntilExpiration <= offset && !remindersSent.includes(offset)
      );

      if (dueOffsets.length === 0) continue;

      const nextOffsets = [...remindersSent, ...dueOffsets];
      const claimToken = `exp:${runId}`;
      try {
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
          expiration_note_offsets_sent: nextOffsets,
          expiration_note_claimed_by: claimToken,
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.TrainingAssignment
        .filter({ id: assignment.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].expiration_note_claimed_by !== claimToken) {
        continue;
      }

      try {
        await base44.asServiceRole.entities.Notification.create({
          user_email: assignment.assigned_to_user_id,
          type: 'expiration_warning',
          title: `Training Renewal Due Soon: ${assignment.course_title}`,
          message: `Your ${assignment.course_title} certification expires in ${daysUntilExpiration} days. Please complete the renewal training.`,
          action_url: '/MyTraining',
          priority: daysUntilExpiration <= 7 ? 'high' : 'medium',
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        notifications.push(1);
        adminNotifications.push({
          type: 'training_expiration',
          user_id: assignment.assigned_to_user_id,
          course_title: assignment.course_title,
          days_until_expiration: daysUntilExpiration,
          renewal_due_date: assignment.renewal_due_date,
          agency_name: agencyByEmail.get(assignment.assigned_to_user_id) || null,
        });
      } catch (err) {
        console.error('sendExpirationNotifications: assignment notify failed', err?.message || err);
        await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
          expiration_note_offsets_sent: remindersSent,
          expiration_note_claimed_by: '',
        }).catch(() => {});
      }
    }

    // Process personnel credentials
    for (const credential of credentials) {
      if (!credential.expiration_date) continue;

      const daysUntilExpiration = localDaysUntil(credential.expiration_date, today);
      if (daysUntilExpiration === null) continue;

      // Dedicated marker for THIS job — sendCredentialRenewalReminders and
      // sendPersonnelExpirationNotifications key off other fields on the same
      // PersonnelCredential, so a shared marker cross-suppressed their reminders.
      const remindersSent = credential.expiration_note_offsets_sent || [];
      const dueOffsets = reminderOffsets.filter(
        (offset) => daysUntilExpiration >= 0 && daysUntilExpiration <= offset && !remindersSent.includes(offset)
      );

      if (dueOffsets.length === 0) continue;

      const nextOffsets = [...remindersSent, ...dueOffsets];
      const claimToken = `exp:${runId}`;
      try {
        await base44.asServiceRole.entities.PersonnelCredential.update(credential.id, {
          expiration_note_offsets_sent: nextOffsets,
          expiration_note_claimed_by: claimToken,
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.PersonnelCredential
        .filter({ id: credential.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].expiration_note_claimed_by !== claimToken) {
        continue;
      }

      try {
        await base44.asServiceRole.entities.Notification.create({
          user_email: credential.user_id,
          type: 'credential_expiration',
          title: `Credential Expiring Soon: ${credential.title}`,
          message: `Your ${credential.title} expires in ${daysUntilExpiration} days. Please upload a renewed document.`,
          action_url: '/PersonnelFile',
          priority: daysUntilExpiration <= 7 ? 'high' : 'medium',
          is_read: false,
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        });
        notifications.push(1);
        adminNotifications.push({
          type: 'credential_expiration',
          user_id: credential.user_id,
          user_name: credential.user_name,
          credential_title: credential.title,
          days_until_expiration: daysUntilExpiration,
          expiration_date: credential.expiration_date,
          agency_name: credential.agency_name || null,
        });
      } catch (err) {
        console.error('sendExpirationNotifications: credential notify failed', err?.message || err);
        await base44.asServiceRole.entities.PersonnelCredential.update(credential.id, {
          expiration_note_offsets_sent: remindersSent,
          expiration_note_claimed_by: '',
        }).catch(() => {});
      }
    }

    if (adminNotifications.length > 0) {
      // Scope each admin to expirations from their own agency (super_admins see
      // all). Unscoped fan-out leaked staff names/credential titles across
      // tenants. Reuse the staff roster fetched above.
      const adminUsers = (Array.isArray(allStaff) ? allStaff : []).filter((u) =>
        u && u.email && (
          u.role === 'admin' ||
          u.account_type === 'agency_admin' ||
          u.account_type === 'super_admin'
        )
      );

      for (const admin of adminUsers) {
        // Agency-scoped admins receive ONLY items positively attributed to their
        // agency; unattributable items (no agency_name) go to super_admins only,
        // never fanned out to every agency admin.
        const scoped = admin.account_type === 'super_admin'
          ? adminNotifications
          : adminNotifications.filter((n) =>
            n.agency_name && n.agency_name === admin.agency_name
          );
        if (scoped.length === 0) continue;
        await base44.asServiceRole.entities.Notification.create({
          user_email: admin.email,
          type: 'admin_expiration_summary',
          title: `${scoped.length} Upcoming Expirations`,
          message: `There are ${scoped.length} training certifications or credentials expiring soon.`,
          action_url: '/AdminOperations',
          priority: 'medium',
          is_read: false,
          metadata: { expirations: scoped },
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
