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

/**
 * Resolve Telnyx credentials from the in-app IntegrationSecret row with
 * provider 'telnyx'.
 */
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = null;
  let publicKey = null;
  let messagingProfileId = null;
  let voiceConnectionId = null;
  let faxConnectionId = null;
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' }, undefined, 5000);
    const rec = rows?.[0] || {};
    apiKey = pick(rec.api_key);
    publicKey = pick(rec.public_key);
    messagingProfileId = pick(rec.messaging_profile_id);
    voiceConnectionId = pick(rec.voice_connection_id);
    faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

// ---- fax retry policy (source of truth: src/components/fax/faxRetry.js). Copied
// verbatim from handleTelnyxStatusWebhook so the poller and the DLR webhook plan a
// failed fax's retry/exhaustion identically — the poller must NOT declare every
// Telnyx-reported failure permanent while retries remain. ----
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
// Transient signals win over a coincidental permanent word ("rejected - line
// busy" is retryable). Checked first. Mirrors src/components/fax/faxRetry.js.
const TRANSIENT_FAILURE_PATTERNS = [
  /busy/i, /no.?answer/i, /temporar/i, /timeout/i, /timed out/i,
  /try again/i, /congestion/i, /\b(429|500|502|503|504)\b/,
];
function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ''} ${errorMessage ?? ''}`.trim();
  if (!s) return 'transient';
  if (TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(s))) return 'transient';
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? 'permanent' : 'transient';
}
function faxRetryConfig(config) {
  const c = config || {};
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form
  // round-trip, and Number.isFinite("5") is false — which would silently drop the
  // admin's configured value in favor of the default. Mirrors src/components/fax/faxRetry.js.
  const maxRetriesNum = Number(c.max_retries);
  const baseDelayNum = Number(c.retry_delay_minutes);
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: Number.isFinite(maxRetriesNum) ? Math.max(0, maxRetriesNum) : 3,
    baseDelayMinutes: Number.isFinite(baseDelayNum) && baseDelayNum > 0 ? baseDelayNum : 15,
    notifyOnFinalFailure: c.notify_on_final_failure !== false,
    priorityMultiplier: c.priority_multiplier && typeof c.priority_multiplier === 'object' ? c.priority_multiplier : {},
  };
}
function nextRetryDelayMinutes(attempt, config, priority = 'normal', factor = 2, maxMinutes = 360) {
  const c = faxRetryConfig(config);
  const a = Math.max(0, Number(attempt) || 0);
  const mult = Number.isFinite(c.priorityMultiplier[priority]) ? c.priorityMultiplier[priority] : 1;
  const minutes = c.baseDelayMinutes * factor ** a * mult;
  return Math.max(1, Math.min(maxMinutes, Math.round(minutes)));
}
function planFaxRetry(opts) {
  const { retryCount = 0, errorCode, errorMessage, priority = 'normal', config, now = Date.now() } = opts || {};
  const c = faxRetryConfig(config);
  const classification = classifyFaxFailure(errorCode, errorMessage);
  const attempts = Number(retryCount) || 0;
  if (!c.enabled || classification === 'permanent' || attempts >= c.maxRetries) {
    return { willRetry: false, classification, exhausted: true, nextRetryAt: null, nextRetryCount: attempts, delayMinutes: 0 };
  }
  const delayMinutes = nextRetryDelayMinutes(attempts, config, priority);
  return { willRetry: true, classification, exhausted: false, nextRetryAt: new Date(now + delayMinutes * 60000).toISOString(), nextRetryCount: attempts + 1, delayMinutes };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged status-poll job (service-role FaxLog reads/writes
    // + Telnyx calls, no end user). Opt-in lockdown like checkExpiredInvitations
    // (see §4); mirrors the admin-gated syncFaxStatuses.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    // Only poll faxes from the last 48 hours that are still pending
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const pendingFaxes = await base44.asServiceRole.entities.FaxLog.filter(
      { status: { $in: ['queued', 'sending'] } },
      '-created_date',
      20  // Small batch to avoid CPU limit
    );

    // Filter to only recent faxes and those with a Telnyx ID
    const faxesToCheck = pendingFaxes.filter(f => f.telnyx_fax_id && f.created_date > cutoff);

    if (faxesToCheck.length === 0) {
      return Response.json({ success: true, checked: 0, updated: 0 });
    }

    const { apiKey } = await resolveTelnyxCreds(base44);

    if (!apiKey) {
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 400 });
    }

    // Load the admin retry policy ONCE (shared across the parallel checks below) so
    // a Telnyx-reported failure schedules a retry instead of being declared final.
    const cfgRows = await base44.asServiceRole.entities.FaxRetryConfig.list('-created_date', 1).catch(() => []);
    const cfg = cfgRows[0] || {};
    const retryCfg = faxRetryConfig(cfg);

    let updated = 0;

    // Process all faxes in parallel instead of sequentially
    await Promise.all(faxesToCheck.map(async (fax) => {
      try {
        const response = await fetch(
          `https://api.telnyx.com/v2/faxes/${fax.telnyx_fax_id}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (!response.ok) return;

        const faxData = await response.json();
        const newStatus = mapFaxStatus(faxData?.data?.status);

        // Unknown Telnyx status: skip rather than coercing to the non-terminal
        // 'queued', which would keep re-polling this fax forever.
        if (!newStatus) return;

        if (newStatus !== fax.status) {
          // Share the webhook's idempotency markers (delivery_confirmation_sent /
          // final_failure_notified) so the poller and handleTelnyxStatusWebhook
          // can't both notify the sender for the same terminal transition.
          const update = { status: newStatus, telnyx_fax_id: faxData?.data?.id };
          let notifyType = null;
          if (newStatus === 'delivered' && fax.sent_by && !fax.delivery_confirmation_sent) {
            update.delivery_confirmation_sent = true;
            notifyType = 'fax_delivered';
          } else if (newStatus === 'failed') {
            // Honor the admin FaxRetryConfig instead of declaring EVERY failure
            // permanent. If the poller observes a failure before the DLR webhook,
            // schedule a retry (next_retry_at + retry_count) that autoRetryFailedFaxes
            // will honor while retries remain, and only set final_failure_notified +
            // notify the sender once retries are truly exhausted. Mirrors
            // handleTelnyxStatusWebhook.handleFaxEvent so the poller and the webhook
            // can't disagree about when a fax is really dead (and so the poller can't
            // suppress the webhook's later legitimate terminal notification).
            const failureReason = faxData?.data?.failure_reason || fax.failure_reason || 'Fax delivery failed';
            update.failure_reason = failureReason;
            const plan = planFaxRetry({
              retryCount: fax.retry_count || 0,
              errorCode: faxData?.data?.failure_code || faxData?.data?.error_code,
              errorMessage: failureReason,
              priority: fax.priority || 'normal',
              config: cfg,
            });
            // planFaxRetry already encodes the budget; schedule whenever willRetry
            // (including nextRetryCount === maxRetries — the last allowed send).
            if (plan.willRetry) {
              update.next_retry_at = plan.nextRetryAt;
              update.retry_count = plan.nextRetryCount;
            } else {
              if (retryCfg.notifyOnFinalFailure && fax.sent_by && !fax.final_failure_notified) {
                notifyType = 'fax_failed';
              }
              update.final_failure_notified = true;
            }
          }
          // 'sent' is a non-terminal progress state, not delivery — don't notify the
          // sender it was 'fax_delivered'. The delivered/failed branches above own the
          // sender notification when a terminal state is reached.

          await base44.asServiceRole.entities.FaxLog.update(fax.id, update);

          if (notifyType) {
            await base44.asServiceRole.entities.Notification.create({
              user_email: fax.sent_by,
              type: notifyType,
              title: notifyType === 'fax_failed' ? 'Fax Failed' : 'Fax Status Update',
              message: getNotificationMessage(newStatus, { ...fax, ...update }),
              metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
              is_read: false
            }).catch(err => console.error('Failed to create fax notification:', err.message));
          }

          updated++;
        }
      } catch (error) {
        console.error('Error checking fax status:', error.message);
      }
    }));

    return Response.json({ success: true, checked: faxesToCheck.length, updated });
  } catch (error) {
    console.error('pollFaxStatuses failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

function mapFaxStatus(telnyxStatus) {
  const statusMap = {
    'queued': 'queued',
    'media.processed': 'sending',
    'originated': 'sending',
    'sending': 'sending',
    'sent': 'sent',
    'delivered': 'delivered',
    'failed': 'failed',
    'cancelled': 'failed',
    'canceled': 'failed'
  };
  return statusMap[telnyxStatus] || null;
}

function getNotificationMessage(status, fax) {
  const docName = fax.document_name || 'Document';
  const recipient = fax.to_name || fax.to_number;
  switch (status) {
    case 'sent': return `Fax "${docName}" sent to ${recipient}`;
    case 'delivered': return `Fax "${docName}" delivered to ${recipient}`;
    case 'failed': return `Fax "${docName}" failed to ${recipient}. Reason: ${fax.failure_reason || 'Unknown'}`;
    default: return `Fax status updated to ${status}`;
  }
}