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
    // notification writes, no end user). Opt-in lockdown like
    // checkExpiredInvitations (see §4).
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
    // Bound high enough that near-expiry certs aren't truncated (they sort last
    // under '-expiration_date'); the 30-day window is applied per-cert below.
    const certificates = await base44.asServiceRole.entities.TrainingCertificate.filter({ revoked: false }, '-expiration_date', 5000);
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