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
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

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