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

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). The
    // no-identity cron path is allowed (platform invocation restriction is the
    // control); an authenticated non-admin caller is always rejected.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
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
    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ revoked: false }, '-expiration_date', 5000);
    let renewalAssignmentsCreated = 0;

    for (const certificate of certificates) {
      if (!certificate.expiration_date || certificate.annual_cycle_year) continue;
      const expiration = new Date(`${certificate.expiration_date}T00:00:00Z`);
      const daysUntilExpiration = Math.ceil((expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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
      const hasNewerCertificate = certificates.some((c) =>
        c.id !== certificate.id &&
        c.course_id === certificate.course_id &&
        c.user_id === certificate.user_id &&
        c.expiration_date &&
        new Date(`${c.expiration_date}T00:00:00Z`).getTime() > expiration.getTime()
      );
      if (hasNewerCertificate) continue;

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
    return Response.json({ error: error.message }, { status: 500 });
  }
});