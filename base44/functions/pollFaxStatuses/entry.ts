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

// <<<BEGIN SHARED HELPER: resolveFaxRetryConfig — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveFaxRetryConfig(base44, agencyName) {
  const key = String(agencyName || '').trim();
  if (key) {
    const rows = await base44.asServiceRole.entities.FaxRetryConfig
      .filter({ agency_name: key }, '-created_date', 1)
      .catch(() => []);
    if (rows?.[0]) return rows[0];
  }
  const newest = await base44.asServiceRole.entities.FaxRetryConfig
    .list('-created_date', 5)
    .catch(() => []);
  const legacy = (newest || []).filter((r) => !String(r?.agency_name || '').trim());
  // Prefer a single unscoped legacy row when the agency-specific row is missing.
  if (legacy.length === 1) return legacy[0];
  if (key) return null;
  if ((newest || []).length > 1) return null;
  return newest?.[0] || null;
}
// <<<END SHARED HELPER: resolveFaxRetryConfig>>>


// <<<BEGIN SHARED HELPER: resolveTelnyxCreds — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let record = null;
  let readError = null;
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, '-updated_date', 5000);
    const list = Array.isArray(rows) ? rows : [];
    // Deterministic row selection. This read used to be unsorted with no is_active
    // filter and took rows[0], and saveTelnyxSecret picks from the same unordered
    // query — so with two telnyx rows the admin could be writing one row while the
    // senders read the other, and re-entering the key could never fix it.
    record = list.find((r) => r && r.is_active === true && pick(r.api_key))
      || list.find((r) => r && pick(r.api_key))
      || list[0]
      || null;
  } catch (err) {
    // Do NOT collapse this into "not configured". A failed read (this invocation
    // path carries no service token, entity 404, 401/403, rate limit, platform
    // blip) is a completely different problem from an unconfigured integration,
    // and reporting them identically is what sent operators chasing a credential
    // they had already entered correctly.
    readError = (err && err.message) ? String(err.message) : 'IntegrationSecret read failed';
    // The catch used to be bare, so an unreadable credential row left no
    // server-side breadcrumb at all — the only signal was a misleading
    // "not configured" reply. Log it; unattended runs have nowhere else to say so.
    console.error('resolveTelnyxCreds: could not read the Telnyx IntegrationSecret row:', readError);
  }
  const rec = record || {};
  return {
    apiKey: pick(rec.api_key),
    publicKey: pick(rec.public_key),
    messagingProfileId: pick(rec.messaging_profile_id),
    voiceConnectionId: pick(rec.voice_connection_id),
    faxConnectionId: pick(rec.fax_connection_id),
    record,
    readError,
  };
}

// Build the caller-facing message for a missing Telnyx credential. Distinguishing
// "could not read" from "not stored" is the whole point: the first is not fixed by
// entering a key, and telling an admin to enter one is what caused two reverted
// env-fallback regressions.
function telnyxCredsMessage(creds, what) {
  const label = what || 'credentials';
  if (creds && creds.readError) {
    return `Could not read Telnyx ${label} — the stored-credential lookup failed (${creds.readError}). This is NOT a missing key, so re-entering it will not help. Retry; if it persists, this function is running without service-role access to IntegrationSecret.`;
  }
  return `Telnyx ${label} not configured — add the API key in Admin › Telnyx (it is stored on the IntegrationSecret row; TELNYX_* environment variables are not read).`;
}
// <<<END SHARED HELPER: resolveTelnyxCreds>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
function numberOrNull(value) {
  // Number(null)/Number("") are both 0, which makes an unset entity field
  // indistinguishable from an explicit zero. Mirrors src/components/fax/faxRetry.js.
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function faxRetryConfig(config) {
  const c = config || {};
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form
  // round-trip, and Number.isFinite("5") is false — which would silently drop the
  // admin's configured value in favor of the default. Mirrors src/components/fax/faxRetry.js.
  // An unset max_retries must mean "use the default", not 0 retries — see
  // numberOrNull above and src/components/fax/faxRetry.js.
  const maxRetriesNum = numberOrNull(c.max_retries);
  const baseDelayNum = numberOrNull(c.retry_delay_minutes);
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: maxRetriesNum === null ? 3 : Math.max(0, maxRetriesNum),
    baseDelayMinutes: baseDelayNum !== null && baseDelayNum > 0 ? baseDelayNum : 15,
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
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    // Release stale retry claims: if a retryFailedFax isolate died between its
    // claim (status 'retrying') and settle/release, the row would otherwise be
    // stranded forever — no poller or cron looks at 'retrying', so the fax
    // silently never goes out. A claim older than 15 minutes is dead (the retry
    // send itself takes seconds); put the row back to a retriable 'failed'.
    let releasedStale = 0;
    try {
      const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const retrying = await base44.asServiceRole.entities.FaxLog.filter(
        { status: 'retrying' }, '-created_date', 20,
      ).catch(() => []);
      for (const fax of Array.isArray(retrying) ? retrying : []) {
        if (fax.retry_claimed_at && fax.retry_claimed_at < staleCutoff) {
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'failed',
            retry_claimed_by: null,
            failure_reason: fax.failure_reason || 'Retry attempt was interrupted before completing',
          }).catch(() => {});
          releasedStale++;
        }
      }
    } catch (err) {
      console.error('stale retry-claim release failed:', err?.message);
    }

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
      return Response.json({ success: true, checked: 0, updated: 0, released_stale_retries: releasedStale });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey } = telnyxCreds;

    if (!apiKey) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "credentials") }, { status: 400 });
    }

    // Per-sender agency retry policy (cached). Newest-row-wins would apply
    // another tenant's budget/disable flag to this fax's failure path.
    const agencyCfgCache = new Map();
    const resolveCfgForSender = async (sentBy) => {
      let agencyName = '';
      if (sentBy) {
        const [sender] = await base44.asServiceRole.entities.User
          .filter({ email: sentBy }, undefined, 1).catch(() => []);
        agencyName = sender?.agency_name || '';
      }
      const cacheKey = agencyName || '__default__';
      if (agencyCfgCache.has(cacheKey)) return agencyCfgCache.get(cacheKey);
      const resolved = (await resolveFaxRetryConfig(base44, agencyName)) || {};
      agencyCfgCache.set(cacheKey, resolved);
      return resolved;
    };

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
          let notifyClaimField = null;
          const notifyClaimToken = `poll:${fax.id}:${newStatus}:${Date.now()}`;
          if (newStatus === 'delivered' && fax.sent_by && !fax.delivery_confirmation_sent) {
            update.delivery_confirmation_sent = true;
            update.delivery_notify_claimed_by = notifyClaimToken;
            notifyType = 'fax_delivered';
            notifyClaimField = 'delivery_notify_claimed_by';
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
            const cfg = await resolveCfgForSender(fax.sent_by);
            const retryCfg = faxRetryConfig(cfg);
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
                update.failure_notify_claimed_by = notifyClaimToken;
                notifyClaimField = 'failure_notify_claimed_by';
              }
              update.final_failure_notified = true;
            }
          }
          // 'sent' is a non-terminal progress state, not delivery — don't notify the
          // sender it was 'fax_delivered'. The delivered/failed branches above own the
          // sender notification when a terminal state is reached.

          await base44.asServiceRole.entities.FaxLog.update(fax.id, update);

          if (notifyType && notifyClaimField) {
            const claimCheck = await base44.asServiceRole.entities.FaxLog
              .filter({ id: fax.id }, '-created_date', 1).catch(() => []);
            if (!claimCheck[0] || claimCheck[0][notifyClaimField] !== notifyClaimToken) {
              return;
            }
            try {
              await base44.asServiceRole.entities.Notification.create({
                user_email: fax.sent_by,
                type: notifyType,
                title: notifyType === 'fax_failed' ? 'Fax Failed' : 'Fax Status Update',
                message: getNotificationMessage(newStatus, { ...fax, ...update }),
                metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
                is_read: false
              });
            } catch (err) {
              console.error('Failed to create fax notification:', err.message);
              // Release stamp so a later poller/webhook run can retry the notify.
              if (notifyType === 'fax_delivered') {
                await base44.asServiceRole.entities.FaxLog.update(fax.id, {
                  delivery_confirmation_sent: false,
                  delivery_notify_claimed_by: '',
                }).catch(() => {});
              } else {
                await base44.asServiceRole.entities.FaxLog.update(fax.id, {
                  final_failure_notified: false,
                  failure_notify_claimed_by: '',
                }).catch(() => {});
              }
            }
          }

          updated++;
        }
      } catch (error) {
        console.error('Error checking fax status:', error.message);
      }
    }));

    return Response.json({ success: true, checked: faxesToCheck.length, updated, released_stale_retries: releasedStale });
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