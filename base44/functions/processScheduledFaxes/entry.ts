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

// <<<BEGIN SHARED HELPER: batchNeverDispatched — generated, edit base44/_shared/backendHelpers.mjs>>>
function batchNeverDispatched(payload, status) {
  const d = payload || {};
  if (!d.error || typeof d.successful === 'number') return false;
  // Requeue only what a later run could actually send. A 5xx is infrastructure
  // — unreadable credentials, a platform blip — and clears on its own. A 4xx is
  // bad input for THIS row (disallowed file_url, unusable recipient numbers) and
  // would fail identically on every future tick; there is no UI listing
  // ScheduledFax rows, so an unsendable row must reach a terminal status rather
  // than retry forever with nobody watching. An unknown status requeues, because
  // a stuck 'pending' row is recoverable and a destroyed PHI document is not.
  const code = Number(status);
  return !Number.isFinite(code) || code >= 500;
}
// <<<END SHARED HELPER: batchNeverDispatched>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged scheduled job (mirrors processTrainingRenewals /
    // syncFaxStatuses). Admins can run it with session auth; scheduled/internal callers must send `x-internal-secret`; every other caller is rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

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
      // dispatchScheduledSms — Telnyx fax has no client idempotency key.)
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
      // Cancel can race the claim: offboard sets canceled_at + status cancelled,
      // then claim overwrites status to processing — but canceled_at survives.
      // Never send (or requeue to pending) after an explicit cancel.
      if (claimCheck[0].canceled_at || claimCheck[0].status === 'cancelled') {
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'cancelled', claimed_by: '', claimed_at: null,
        }).catch(() => {});
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
          priority: scheduledFax.priority,
          sent_by: scheduledFax.created_by || me?.email || 'scheduler@system',
          internal_secret: Deno.env.get('INTERNAL_FN_SECRET') || '',
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

        // sendBatchFax rejected the whole batch before dispatching anything (bad
        // credentials, disallowed file_url, agency config). Marking the row
        // 'failed' here DESTROYS it — this cron only ever reads status 'pending',
        // so the queued PHI document would never be transmitted and no UI can
        // requeue it. Release the claim instead and let a later run send it once
        // the underlying problem is fixed.
        //
        // Only the never-dispatched case is requeued. If any recipient was
        // actually attempted we keep the terminal status, because Telnyx fax has
        // no client idempotency key and requeueing could re-transmit PHI.
        if (batchNeverDispatched(data, response?.status)) {
          console.error('A scheduled fax was not dispatched and has been requeued:', data.error);
          // Re-read before requeue — a cancel that landed mid-send must not be
          // resurrected as pending.
          const mid = await base44.asServiceRole.entities.ScheduledFax
            .filter({ id: scheduledFax.id }, '-created_date', 1).catch(() => []);
          if (mid[0]?.canceled_at || mid[0]?.status === 'cancelled') {
            await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
              status: 'cancelled', claimed_by: '', claimed_at: null,
            }).catch(() => {});
            continue;
          }
          await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
            status: 'pending', claimed_by: '', claimed_at: null,
          }).catch((err) => console.error('Failed to requeue scheduled fax:', err?.message || err));
          continue;
        }

        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: failed > 0 ? 'failed' : 'sent'
        }).catch((err) => console.error('Failed to mark scheduled fax result:', err?.message || err));

        console.log(`Processed scheduled fax batch: ${successful} sent, ${failed} failed`);
      } catch (error) {
        console.error('Failed to process scheduled fax:', error?.message || error);
        // A non-2xx from sendBatchFax rejects rather than resolving, so the
        // never-dispatched signal arrives here too — same reasoning as above:
        // requeue rather than destroy the queued document.
        if (batchNeverDispatched(error?.response?.data, error?.response?.status)) {
          const mid = await base44.asServiceRole.entities.ScheduledFax
            .filter({ id: scheduledFax.id }, '-created_date', 1).catch(() => []);
          if (mid[0]?.canceled_at || mid[0]?.status === 'cancelled') {
            await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
              status: 'cancelled', claimed_by: '', claimed_at: null,
            }).catch(() => {});
            continue;
          }
          await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
            status: 'pending', claimed_by: '', claimed_at: null,
          }).catch((err) => console.error('Failed to requeue scheduled fax:', err?.message || err));
          continue;
        }
        // Guard the failure write too — an unhandled throw here would abort the
        // whole batch mid-run and surface as a function-level 500 to the scheduler.
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'failed'
        }).catch((err) => console.error('Failed to mark scheduled fax failed:', err?.message || err));
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