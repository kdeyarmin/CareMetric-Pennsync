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

    const now = new Date();

    // Get pending faxes that are actually DUE, earliest-scheduled first. The old
    // query fetched the newest 200 by '-scheduled_time' (furthest-future first)
    // and filtered due in code, so under a >200 backlog the most-overdue faxes
    // fell off the end and were never sent. Mirror processScheduledFaxes: filter
    // server-side on scheduled_time and sort ASCENDING so the page is the
    // most-overdue rows. (Belt-and-suspenders: still filter due in code.)
    const scheduledFaxes = await base44.asServiceRole.entities.ScheduledFax.filter({
      status: 'pending',
      scheduled_time: { "$lte": now.toISOString() }
    }, 'scheduled_time', 200);

    // Separate into due and priority groups
    const dueFaxes = scheduledFaxes.filter(fax =>
      new Date(fax.scheduled_time) <= now
    );

    if (dueFaxes.length === 0) {
      return Response.json({ 
        message: 'No faxes due for sending',
        pending: scheduledFaxes.length 
      });
    }

    // Sort by priority (urgent first, then high, normal, low)
    const priorityOrder = { urgent: 0, high: 1, normal: 2, low: 3 };
    dueFaxes.sort((a, b) => {
      const aPriority = priorityOrder[a.priority] ?? 2;
      const bPriority = priorityOrder[b.priority] ?? 2;
      if (aPriority !== bPriority) return aPriority - bPriority;
      // If same priority, sort by scheduled time (earliest first)
      return new Date(a.scheduled_time) - new Date(b.scheduled_time);
    });

    let sentCount = 0;
    let failedCount = 0;

    // NOTE: only ONE scheduled-fax processor should be enabled in the platform
    // scheduler (this OR processScheduledFaxes) — running both double-sends.

    // Process faxes in priority order
    for (const scheduledFax of dueFaxes) {
      // Claim with a token + RE-READ before sending. A bare status flip isn't
      // atomic, so two overlapping runs (or this + processScheduledFaxes, which
      // share the same 'pending' population) both flip and both send. The
      // claim-token + re-read lets the loser detect it lost and skip.
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
      // Honor durable cancel stamp (parity with processScheduledFaxes / SMS).
      if (claimCheck[0].canceled_at || claimCheck[0].status === 'cancelled') {
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'cancelled', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        continue;
      }
      try {
        // Send to all recipients via the batch sender, invoked with the service
        // role. The previous per-recipient base44.functions.invoke('sendFax')
        // ran user-scoped, but the scheduler has no end user — sendFax returned
        // 401, so sendResult.data.success was undefined and EVERY scheduled fax
        // was wrongly marked 'failed'. This mirrors the working
        // processScheduledFaxes sibling.
        const sendResult = await base44.asServiceRole.functions.invoke('sendBatchFax', {
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

        const data = sendResult?.data || {};
        const recipientCount = scheduledFax.to_numbers?.length || 0;
        const successful = data.successful || 0;
        const failed = data.failed ?? (recipientCount - successful);

        // The batch was rejected before any recipient was attempted (bad
        // credentials, disallowed file_url, agency config). Marking it 'failed'
        // destroys the queued PHI document — this processor only ever reads
        // status 'pending', and no UI can requeue a failed row. Release the claim
        // so a later run sends it. Requeue ONLY when nothing was transmitted:
        // Telnyx fax has no idempotency key, so requeueing a partially-sent batch
        // would re-fax PHI. Mirrors the processScheduledFaxes sibling.
        if (batchNeverDispatched(data, sendResult?.status)) {
          console.error('A scheduled fax was not dispatched and has been requeued:', data.error);
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

        sentCount += successful;
        failedCount += failed;

        // Only mark fully 'sent' when every recipient succeeded; otherwise
        // 'failed' so the partial failure is visible and recoverable.
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: failed > 0 ? 'failed' : 'sent'
        });

      } catch (error) {
        console.error('Failed to process scheduled fax:', error?.message || error);
        // A non-2xx from sendBatchFax rejects rather than resolving, so the
        // never-dispatched signal arrives here too — requeue, don't destroy.
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
        await base44.asServiceRole.entities.ScheduledFax.update(scheduledFax.id, {
          status: 'failed'
        });
        failedCount++;
      }
    }

    return Response.json({
      success: true,
      processed: dueFaxes.length,
      sent: sentCount,
      failed: failedCount,
      priority_order: ['urgent', 'high', 'normal', 'low'],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Scheduled fax processing error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});