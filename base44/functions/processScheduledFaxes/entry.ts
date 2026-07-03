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

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). The
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
        console.error(`Could not claim scheduled fax ${scheduledFax.id}; skipping`, claimErr);
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

        console.log(`Processed scheduled fax ${scheduledFax.id}: ${successful} sent, ${failed} failed`);
      } catch (error) {
        console.error(`Failed to process scheduled fax ${scheduledFax.id}:`, error);
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});