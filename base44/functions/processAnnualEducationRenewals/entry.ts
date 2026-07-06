import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && (
    user.role === 'admin' || user.account_type === 'agency_admin' ||
    user.account_type === 'super_admin'
  );
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
  if (providedSecret === expectedSecret) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (service-role assignment +
    // notification writes, no end user). Opt-in lockdown like
    // checkExpiredInvitations (see §4).
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    const today = new Date();
    // Bound the fetch itself to the 30-day-or-already-expired window (matching
    // the per-cert check below): without this, a tenant with a large backlog of
    // long-expired-but-not-revoked certs would sort BEFORE near-expiry ones
    // under ascending 'expiration_date' and could fill the 5000-row cap before
    // the certs that actually need a renewal are ever reached.
    const windowEnd = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ revoked: false, expiration_date: { $lte: windowEnd } }, 'expiration_date', 5000);
    let created = 0;
    const notificationsToCreate = [];

    for (const certificate of certificates) {
      if (!certificate.expiration_date || !certificate.annual_cycle_year) continue;
      const expiration = new Date(`${certificate.expiration_date}T00:00:00Z`);
      const daysUntilExpiration = Math.ceil((expiration.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      // Create the renewal within 30 days of expiration (not only on the exact
      // 30-day mark), so a missed cron run doesn't skip it. The existing-renewal
      // query below prevents a duplicate assignment once one has been created.
      if (daysUntilExpiration > 30) continue;

      const nextCycleYear = (certificate.annual_cycle_year || today.getUTCFullYear()) + 1;
      // Check for existing renewal assignment (single query instead of list filter)
      const existing = await base44.asServiceRole.entities.TrainingAssignment.filter({
        course_id: certificate.course_id,
        assigned_to_user_id: certificate.user_id,
        annual_cycle_year: nextCycleYear
      }, '-created_date', 1);
      if (existing.length > 0) continue;

      const newAssignment = await base44.asServiceRole.entities.TrainingAssignment.create({
        course_id: certificate.course_id,
        course_title: certificate.course_title,
        assigned_to_user_id: certificate.user_id,
        assigned_by: 'system-annual-renewal',
        assigned_date: today.toISOString(),
        due_date: certificate.expiration_date,
        annual_cycle_year: nextCycleYear,
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
        remediation_message: 'Please complete this annual renewal education before your certificate expires.',
        progress_percentage: 0,
        notes: 'Automatically assigned 30 days before annual certificate expiration.',
        archived_status: false
      });

      // Queue notification instead of creating immediately
      notificationsToCreate.push({
        user_email: certificate.user_id,
        title: 'Annual renewal education assigned',
        message: `Your ${nextCycleYear} renewal assignment for "${certificate.course_title}" has been assigned and is due by ${new Date(certificate.expiration_date).toLocaleDateString()}.`,
        type: 'training_due',
        priority: 'high',
        action_url: '/MyAnnualEducation',
        action_label: 'Open annual education',
        metadata: {
          assignment_id: newAssignment.id,
          course_id: certificate.course_id,
          certificate_id: certificate.id,
          annual_cycle_year: nextCycleYear,
          renewal_trigger: '30_days_before_expiration'
        }
      });

      created++;
    }

    // Batch create notifications to reduce CPU overhead
    let notificationsCreated = 0;
    for (let i = 0; i < notificationsToCreate.length; i += 50) {
      const batch = notificationsToCreate.slice(i, i + 50);
      await Promise.all(
        batch.map(n => base44.asServiceRole.entities.Notification.create(n).catch((err) => console.error('Failed to create notification:', err)))
      );
      notificationsCreated += batch.length;
    }

    return Response.json({ success: true, created, notificationsCreated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});