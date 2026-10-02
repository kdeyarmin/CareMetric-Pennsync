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



function localDaysUntil(dateStr, today = new Date()) {
  if (!dateStr) return null;
  const raw = String(dateStr).trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(raw)) {
    const [y, m, d] = raw.split('-').map(Number);
    const due = new Date(y, m - 1, d);
    const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((due.getTime() - todayLocal.getTime()) / (1000 * 60 * 60 * 24));
  }
  const due = new Date(dateStr);
  if (Number.isNaN(due.getTime())) return null;
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

function localDatePlusDays(today, days) {
  const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    // Hub cutover guard: once learning is released to the Support Hub, this job
    // must not create assignments or reminders against Base44 course data.
    if (Deno.env.get('CENTRAL_LEARNING_RELEASE') === 'hub-runtime-v1') {
      return Response.json({ success: true, skipped: true, reason: 'central_learning' });
    }

    const today = new Date();
    const runId = crypto.randomUUID();
    // Bound the fetch itself to the 30-day-or-already-expired window (matching
    // the per-cert check below): without this, a tenant with a large backlog of
    // long-expired-but-not-revoked certs would sort BEFORE near-expiry ones
    // under ascending 'expiration_date' and could fill the 5000-row cap before
    // the certs that actually need a renewal are ever reached.
    // windowEnd uses local calendar days (not UTC ISO) so US evenings don't
    // shrink/expand the window by a day.
    const windowEnd = localDatePlusDays(today, 30);
    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ revoked: false, expiration_date: { $lte: windowEnd } }, 'expiration_date', 5000);
    let renewalAssignmentsCreated = 0;

    for (const certificate of certificates) {
      if (!certificate.expiration_date || certificate.annual_cycle_year) continue;
      const daysUntilExpiration = localDaysUntil(certificate.expiration_date, today);
      if (daysUntilExpiration === null) continue;
      // Create the renewal within 30 days of expiration (not only on the exact
      // 30-day mark), so a missed cron run doesn't skip it. The existing-renewal
      // check below prevents a duplicate assignment once one has been created.
      if (daysUntilExpiration > 30) continue;

      // Query the renewal scoped to this course+user rather than scanning a
      // global 5000-row prefetch — in a tenant with >5000 assignments a user's
      // existing renewal could fall outside the window and be re-created each run.
      const existingForUserCourse = await base44.asServiceRole.entities.TrainingAssignment.filter(
        { course_id: certificate.course_id, assigned_to_user_id: certificate.user_id },
        '-created_date',
        50,
      ).catch(() => []);
      const existingRenewal = existingForUserCourse.find((assignment) =>
        ['assigned', 'in_progress', 'overdue', 'failed', 'locked'].includes(assignment.status) &&
        assignment.id !== certificate.assignment_id
      );
      if (existingRenewal) continue;

      // Skip if the user already holds a NEWER certificate for this course (i.e.
      // they have already renewed). The superseded certificate is still
      // non-revoked and within 30 days of its own expiration, and its prior
      // renewal assignment is 'completed' (so it isn't caught by the active-status
      // guard above) — without this check the job re-assigns the renewal and
      // re-notifies every run despite a valid newer certificate.
      const hasNewerCertificate = certificates.some((c) => {
        if (c.id === certificate.id || c.course_id !== certificate.course_id || c.user_id !== certificate.user_id || !c.expiration_date) return false;
        const otherDays = localDaysUntil(c.expiration_date, today);
        return otherDays != null && otherDays > daysUntilExpiration;
      });
      if (hasNewerCertificate) continue;

      // Claim before create so overlapping cron runs don't mint duplicate renewals.
      try {
        await base44.asServiceRole.entities.TrainingCertificate.update(certificate.id, {
          renewal_assignment_claimed_by: runId,
          renewal_assignment_claimed_at: new Date().toISOString(),
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.TrainingCertificate
        .filter({ id: certificate.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].renewal_assignment_claimed_by !== runId) {
        continue;
      }

      const newAssignment = await base44.asServiceRole.entities.TrainingAssignment.create({
        course_id: certificate.course_id,
        course_title: certificate.course_title,
        assigned_to_user_id: certificate.user_id,
        assigned_by: 'system-renewal',
        assigned_date: today.toISOString(),
        due_date: certificate.expiration_date,
        priority: 'high',
        status: 'assigned',
        required: true,
        passing_score_required: 80,
        waiting_period_hours: 0,
        regenerate_test_on_retake: true,
        retake_required: false,
        renewal_frequency: 'annual',
        renewal_due_date: certificate.expiration_date,
        attestation_required: false,
        remediation_message: 'Please complete this renewal training before your certificate expires.',
        progress_percentage: 0,
        notes: 'Automatically assigned 30 days before certificate expiration.',
        archived_status: false
      });

      await base44.asServiceRole.entities.Notification.create({
        user_email: certificate.user_id,
        title: 'Renewal training assigned',
        message: `Your renewal assignment for "${certificate.course_title}" has been assigned and is due by ${new Date(certificate.expiration_date).toLocaleDateString()}.`,
        type: 'training_due',
        priority: 'high',
        action_url: '/MyTraining',
        action_label: 'Open training',
        metadata: {
          assignment_id: newAssignment.id,
          course_id: certificate.course_id,
          certificate_id: certificate.id,
          renewal_trigger: '30_days_before_expiration'
        }
      });

      renewalAssignmentsCreated++;
    }

    return Response.json({ success: true, renewal_assignments_created: renewalAssignmentsCreated });
  } catch (error) {
    console.error('processTrainingRenewals failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});