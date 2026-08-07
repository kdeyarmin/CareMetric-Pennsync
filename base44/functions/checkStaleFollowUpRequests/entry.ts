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


// checkStaleFollowUpRequests — scheduled job that escalates provider
// follow-up requests that were SENT but never answered.
//
// Plain Deno.serve endpoint like the other scheduled jobs (no in-repo cron:
// register a scheduled trigger on the Base44 dashboard, POST with empty body;
// see docs/LEARNING_CENTER_SCHEDULED_JOBS.md for the registration steps).
// Recommended cadence: daily.
//
// Auth requires either an admin session or the configured `x-internal-secret` scheduler header.

const DEFAULT_STALE_DAYS = 4;

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

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

      // Claim before notify so overlapping cron runs don't double-escalate, and
      // only keep the stamp when Notification.create succeeds.
      const claimAt = now;
      const priorStale = fu.stale_notified_at || null;
      try {
        await base44.asServiceRole.entities.Referral.update(r.id, {
          follow_up_requests: { ...fu, stale_notified_at: claimAt },
        });
      } catch {
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.Referral
        .filter({ id: r.id }, '-created_date', 1).catch(() => []);
      const claimedFu = claimCheck[0]?.follow_up_requests;
      if (!claimedFu || claimedFu.stale_notified_at !== claimAt) {
        continue;
      }

      try {
        await base44.asServiceRole.entities.Notification.create({
          user_email: r.created_by,
          title: '⏰ Provider follow-up request unanswered',
          message: `The information request for ${r.patient_name || 'a referral'} has had no provider response for ${staleDays}+ days. The SOC clock is running — consider a phone follow-up or re-sending the form.`,
          type: 'info',
          priority: 'high',
          metadata: { related_entity: 'Referral', related_entity_id: r.id },
          is_read: false,
          action_url: `/ReferralFollowUp?id=${r.id}`,
        });
      } catch (err) {
        console.error('checkStaleFollowUpRequests: notify failed', err?.message || err);
        await base44.asServiceRole.entities.Referral.update(r.id, {
          follow_up_requests: { ...fu, stale_notified_at: priorStale },
        }).catch(() => {});
        continue;
      }
      escalated += 1;
    }

    return Response.json({ success: true, escalated, stale_days: staleDays });
  } catch (error) {
    console.error('checkStaleFollowUpRequests error:', error);
    return Response.json({ error: 'Stale follow-up check failed' }, { status: 500 });
  }
});
