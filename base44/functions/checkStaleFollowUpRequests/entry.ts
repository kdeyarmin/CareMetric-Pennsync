import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// checkStaleFollowUpRequests — scheduled job that escalates provider
// follow-up requests that were SENT but never answered.
//
// Plain Deno.serve endpoint like the other scheduled jobs (no in-repo cron:
// register a scheduled trigger on the Base44 dashboard, POST with empty body;
// see docs/LEARNING_CENTER_SCHEDULED_JOBS.md for the registration steps).
// Recommended cadence: daily.
//
// Auth follows the repo's cron convention: the no-identity cron path is
// allowed, an authenticated NON-admin is rejected.

const DEFAULT_STALE_DAYS = 4;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin' || me?.account_type === 'agency_admin' || me?.account_type === 'super_admin';
    if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const staleDays = Math.min(Math.max(Number(body?.stale_days) || DEFAULT_STALE_DAYS, 1), 30);
    const cutoffMs = Date.now() - staleDays * 24 * 60 * 60 * 1000;
    const now = new Date().toISOString();

    // Recent referrals only — a request stale for months has been handled (or
    // abandoned) outside this loop; don't re-nag forever.
    const referrals = await base44.asServiceRole.entities.Referral.list('-created_date', 300);
    let escalated = 0;

    for (const r of referrals || []) {
      const fu = r.follow_up_requests;
      if (!fu || fu.status !== 'sent' || !fu.generated_at) continue;
      const sentMs = Date.parse(fu.generated_at);
      if (!Number.isFinite(sentMs) || sentMs > cutoffMs) continue;
      // One escalation per send: skip when already notified for this send.
      if (fu.stale_notified_at && Date.parse(fu.stale_notified_at) >= sentMs) continue;
      if (!r.created_by) continue;

      await base44.asServiceRole.entities.Notification.create({
        user_email: r.created_by,
        title: '⏰ Provider follow-up request unanswered',
        message: `The information request for ${r.patient_name || 'a referral'} has had no provider response for ${staleDays}+ days. The SOC clock is running — consider a phone follow-up or re-sending the form.`,
        type: 'info',
        priority: 'high',
        metadata: { related_entity: 'Referral', related_entity_id: r.id },
        is_read: false,
        action_url: `/ReferralFollowUp?id=${r.id}`,
      }).catch(() => {});

      await base44.asServiceRole.entities.Referral.update(r.id, {
        follow_up_requests: { ...fu, stale_notified_at: now },
      }).catch(() => {});
      escalated += 1;
    }

    return Response.json({ success: true, escalated, stale_days: staleDays });
  } catch (error) {
    console.error('checkStaleFollowUpRequests error:', error);
    return Response.json({ error: 'Stale follow-up check failed' }, { status: 500 });
  }
});
