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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    const now = new Date().toISOString();

    // Get scheduled faxes that are due, earliest-scheduled first with an explicit
    // cap. Without a sort/limit the SDK returns only its default first page (~50)
    // in arbitrary order, so under a >50 backlog the most-overdue faxes fall off
    // and are never sent. Sort ASCENDING on scheduled_time so the page is the
    // most-overdue rows, matching processScheduledFaxesByPriority.
    const scheduledFaxes = await base44.asServiceRole.entities.ScheduledFax.filter({
      status: 'pending',
      scheduled_time: { "$lte": now }
    }, 'scheduled_time', 200);

    console.log(`Found ${scheduledFaxes.length} scheduled faxes to process`);

    // NOTE: only ONE scheduled-fax processor should be enabled in the platform
    // scheduler (this OR processScheduledFaxesByPriority) — running both will
    // double-send. See docs.

    for (const scheduledFax of scheduledFaxes) {
      // Claim the row (pending -> processing) with a token BEFORE sending, then
      // RE-READ to confirm we own it. A bare status flip isn't atomic: two
      // overlapping runs (or this processor + processScheduledFaxesByPriority)
      // both read 'pending' and both flip it, double-sending the fax. The
      // claim-token + re-read makes the loser detect it lost and skip. (Mirrors
      // dispatchScheduledSms — Twilio fax has no client idempotency key.)
      const runId = crypto.randomUUID();
      try {
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'processing', claimed_by: runId, claimed_at: new Date().toISOString(),
        });
      } catch (claimErr) {
        console.error('Could not claim scheduled fax; skipping', claimErr?.message || claimErr);
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.ScheduledFax
        .filter({ id: scheduledFax.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].claimed_by !== runId) {
        // Another run claimed it first — skip to avoid a duplicate send.
        continue;
      }
      try {
        // Use the batch send function for each scheduled fax
        const response = await base44.asServiceRole.functions.invoke('sendBatchFax', {
          file_url: scheduledFax.document_url,
          to_numbers: scheduledFax.to_numbers,
          from_number: scheduledFax.from_number,
          document_name: scheduledFax.document_name,
          patient_id: scheduledFax.patient_id,
          cover_page_details: scheduledFax.cover_page_details,
          priority: scheduledFax.priority
        });

        // sendBatchFax always resolves 200 (even when every recipient failed), so
        // inspect the result instead of assuming success — otherwise a fax whose
        // recipients ALL failed is falsely recorded as 'sent' (a silent PHI
        // delivery failure with a false delivery confirmation). Mirrors the
        // processScheduledFaxesByPriority sibling.
        const data = response?.data || {};
        const recipientCount = scheduledFax.to_numbers?.length || 0;
        const successful = data.successful || 0;
        const failed = data.failed ?? (recipientCount - successful);

        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: failed > 0 ? 'failed' : 'sent'
        });

        console.log(`Processed scheduled fax batch: ${successful} sent, ${failed} failed`);
      } catch (error) {
        console.error('Failed to process scheduled fax:', error?.message || error);
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'failed'
        });
      }
    }

    return Response.json({
      success: true,
      processed: scheduledFaxes.length
    });

  } catch (error) {
    console.error('Process scheduled faxes error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});