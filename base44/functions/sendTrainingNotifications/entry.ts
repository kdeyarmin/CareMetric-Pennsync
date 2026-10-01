import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged scheduled job (mirrors sendExpirationNotifications
    // / sendRenewalReminders). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const today = new Date();
    const runId = crypto.randomUUID();
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
        // Claim offsets before notify so overlapping runs don't double-create.
        const claimedOffsets = [...sentOffsets, ...dueOffsets];
        try {
          await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
            training_due_offsets_sent: claimedOffsets,
            reminder_claimed_by: runId,
            reminder_claimed_at: new Date().toISOString(),
            last_reminder_date: today.toISOString().slice(0, 10),
            reminder_sent: true,
          });
        } catch {
          continue;
        }
        const claimCheck = await base44.asServiceRole.entities.TrainingAssignment
          .filter({ id: assignment.id }, '-created_date', 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].reminder_claimed_by !== runId) {
          continue;
        }

        try {
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
        } catch (err) {
          console.error('sendTrainingNotifications: notify failed', err?.message || err);
          await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
            training_due_offsets_sent: sentOffsets,
            reminder_claimed_by: '',
            reminder_sent: assignment.reminder_sent || false,
            last_reminder_date: assignment.last_reminder_date || null,
          }).catch(() => {});
        }
      }

      if (daysUntilDue < 0 && assignment.status !== 'overdue') {
        const claimToken = `overdue:${runId}`;
        try {
          await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
            reminder_claimed_by: claimToken,
            reminder_claimed_at: new Date().toISOString(),
          });
        } catch {
          continue;
        }
        const overdueClaim = await base44.asServiceRole.entities.TrainingAssignment
          .filter({ id: assignment.id }, '-created_date', 1).catch(() => []);
        if (!overdueClaim[0] || overdueClaim[0].reminder_claimed_by !== claimToken) {
          continue;
        }
        if (overdueClaim[0].status === 'overdue') {
          continue;
        }
        try {
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
          await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
            status: 'overdue',
            reminder_claimed_by: '',
          });
        } catch (err) {
          console.error('sendTrainingNotifications: overdue notify failed', err?.message || err);
          await base44.asServiceRole.entities.TrainingAssignment.update(assignment.id, {
            reminder_claimed_by: '',
          }).catch(() => {});
        }
      }
    }

    // Bound the fetch to a window around now (mirrors sendPersonnelExpiration-
    // Notifications). Fetching ALL non-revoked certs sorted ascending by
    // expiration_date fills the cap with the ever-growing backlog of already-
    // expired certs (which the loop below skips because daysUntilExpiration < 0),
    // starving the soon-expiring certs this renewal sweep exists to warn about —
    // exactly what '-issued_at' also did from the other end. The window spans
    // recently-expired through the furthest reminder tier (30 days).
    const certWindowStart = new Date(today); certWindowStart.setDate(today.getDate() - 30);
    const certWindowEnd = new Date(today); certWindowEnd.setDate(today.getDate() + 30);
    const certStartStr = certWindowStart.toISOString().split('T')[0];
    const certEndStr = certWindowEnd.toISOString().split('T')[0];
    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter(
      { revoked: false, expiration_date: { $gte: certStartStr, $lte: certEndStr } },
      'expiration_date',
      5000,
    );
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
        const claimedRenewalOffsets = [...sentRenewalOffsets, ...renewalOffsets];
        try {
          await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
            renewal_reminder_offsets_sent: claimedRenewalOffsets,
            last_renewal_reminder_date: certTodayKey,
            renewal_assignment_claimed_by: `notify:${runId}`,
            renewal_assignment_claimed_at: new Date().toISOString(),
          });
        } catch {
          continue;
        }
        const claimCheck = await base44.asServiceRole.entities.TrainingCertificate
          .filter({ id: certificate.id }, '-created_date', 1).catch(() => []);
        if (!claimCheck[0] || claimCheck[0].renewal_assignment_claimed_by !== `notify:${runId}`) {
          continue;
        }

        try {
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
        } catch (err) {
          console.error('sendTrainingNotifications: cert notify failed', err?.message || err);
          await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
            renewal_reminder_offsets_sent: sentRenewalOffsets,
            last_renewal_reminder_date: certificate.last_renewal_reminder_date || null,
            renewal_assignment_claimed_by: '',
          }).catch(() => {});
        }
      }
    }

    return Response.json({ success: true, notifications_sent: notificationsSent.length });
  } catch (error) {
    console.error('sendTrainingNotifications failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
