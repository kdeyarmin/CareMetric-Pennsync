import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// ───────────────────────────────────────────────────────────────────────────
// Policy acknowledgment service. Acknowledgments are an audit/compliance trail,
// so the entity's write RLS is admin-only — learners can NOT write their own
// rows directly. They sign off through this function instead, which validates
// ownership and stamps the transition server-side (precedent: selfEnrollCourse,
// gradeTrainingAttempt). Admins read the org-wide status list through the `list`
// action so account_type-based admins (agency_admin/super_admin) are honored
// even though the entity read RLS follows the codebase `role: admin` convention.
//
//   acknowledge — any authenticated user, only their own un-acknowledged row.
//   list        — admin only; returns acks (optionally scoped to a policy_id).
// ───────────────────────────────────────────────────────────────────────────

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase();
const sameEmail = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin' || (SUPER_ADMIN_EMAIL !== '' && sameEmail(u.email, SUPER_ADMIN_EMAIL))
);
// <<<END SHARED HELPER: isAdminLike>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'acknowledge';
    const svc = base44.asServiceRole.entities;

    // ── ACKNOWLEDGE: validated, server-stamped sign-off on the caller's row ──
    if (action === 'acknowledge') {
      const { acknowledgment_id, signed_name } = body;
      if (!acknowledgment_id || !signed_name || !String(signed_name).trim()) {
        return Response.json({ error: 'acknowledgment_id and signed_name are required' }, { status: 400 });
      }

      const [ack] = await svc.PolicyAcknowledgment.filter({ id: acknowledgment_id }, '-created_date', 1);
      if (!ack) {
        return Response.json({ error: 'Acknowledgment not found' }, { status: 404 });
      }
      // Ownership is enforced here because the write goes through service-role
      // (which bypasses RLS): a user may only sign their own assigned row.
      if (!sameEmail(ack.user_id, user.email)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (ack.acknowledged) {
        // Already signed — idempotent no-op, don't overwrite the original stamp.
        return Response.json({ success: true, already_acknowledged: true });
      }

      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
      await svc.PolicyAcknowledgment.update(ack.id, {
        acknowledged: true,
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        signed_name: String(signed_name).trim(),
        ip_address: ip.split(',')[0].trim(),
        device_metadata: { user_agent: req.headers.get('user-agent') || '' },
      });

      return Response.json({ success: true });
    }

    // ── LIST: admin-only org-wide status (honors account_type admins) ───────
    if (action === 'list') {
      if (!isAdminLike(user)) {
        return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
      }
      const filter = body.policy_id ? { policy_id: body.policy_id } : {};
      let acks = await svc.PolicyAcknowledgment.filter(filter, '-created_date', 5000);
      // Agency admins are scoped to their own agency's staff.
      if (user.account_type === 'agency_admin' && user.agency_name) {
        const agencyUsers = await svc.User.filter({ agency_name: user.agency_name });
        const emails = new Set(agencyUsers.map((u) => u.email));
        acks = acks.filter((a) => emails.has(a.user_id));
      }
      return Response.json({ success: true, acknowledgments: acks });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});
