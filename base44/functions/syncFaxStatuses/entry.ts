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

// ---- fax retry policy (source of truth: src/components/fax/faxRetry.js) ----
// DEPRECATED FUNCTION NOTE: syncFaxStatuses overlaps pollFaxStatuses. It used to
// declare EVERY Telnyx-reported failure permanent, which conflicted with the
// retry-aware webhook + pollFaxStatuses (a fax the retry system wanted to retry
// could be finalized here). This block is copied verbatim from pollFaxStatuses
// so whichever poller an operator schedules plans retries identically. Prefer
// scheduling pollFaxStatuses; this remains only so an existing schedule is safe.
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
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
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form round-trip.
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

    // Authorization: privileged status-sync job (service-role FaxLog reads/writes
    // + Telnyx API calls, no end user). A real scheduler runs unauthenticated and
    // passes; a logged-in non-admin is always rejected.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey } = telnyxCreds;
    if (!apiKey) {
      console.warn('Telnyx credentials not configured. Skipping fax status sync.');
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "credentials") }, { status: 500 });
    }

    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const pendingFaxes = await base44.asServiceRole.entities.FaxLog.filter({
      created_date: { '$gte': twentyFourHoursAgo }
    }, '-created_date', 200);

    const nonFinalFaxes = pendingFaxes.filter((f) =>
      f.telnyx_fax_id && ['queued', 'sending', 'sent'].includes(f.status)
    );

    console.log(`Found ${nonFinalFaxes.length} pending faxes to sync.`);

    // Load the admin retry policy ONCE so a Telnyx-reported failure schedules a
    // retry instead of being declared final (mirrors pollFaxStatuses).
    const cfgRows = await base44.asServiceRole.entities.FaxRetryConfig.list('-created_date', 1).catch(() => []);
    const cfg = cfgRows[0] || {};
    const retryCfg = faxRetryConfig(cfg);

    let updatedCount = 0;

    for (const faxLog of nonFinalFaxes) {
      try {
        const telnyxResponse = await fetch(`https://api.telnyx.com/v2/faxes/${faxLog.telnyx_fax_id}`, {
          headers: {
            'Authorization': `Bearer ${apiKey}`
          }
        });

        if (!telnyxResponse.ok) {
          const errorText = await telnyxResponse.text();
          console.error('Telnyx API error during fax status sync:', errorText);
          continue;
        }

        const telnyxData = await telnyxResponse.json();

        const currentTelnyxStatus = telnyxData?.data?.status;
        const newStatus = mapFaxStatus(currentTelnyxStatus, faxLog.status);

        if (newStatus !== faxLog.status) {
          console.log(`Updating fax status from ${faxLog.status} to ${newStatus}`);
          const update = {
            status: newStatus,
            pages: telnyxData?.data?.page_count || faxLog.pages,
          };
          let notifyFailure = false;
          if (newStatus === 'failed') {
            // Retry-aware failure handling (mirrors pollFaxStatuses): schedule a
            // retry the autoRetryFailedFaxes cron will honor while retries
            // remain, and only finalize + notify the sender (once, guarded by
            // final_failure_notified) when retries are truly exhausted — instead
            // of declaring every failure permanent and stranding the fax.
            const failureReason = telnyxData?.data?.failure_reason || faxLog.failure_reason || 'Fax delivery failed';
            update.failure_reason = failureReason;
            const plan = planFaxRetry({
              retryCount: faxLog.retry_count || 0,
              errorCode: telnyxData?.data?.failure_code || telnyxData?.data?.error_code,
              errorMessage: failureReason,
              priority: faxLog.priority || 'normal',
              config: cfg,
            });
            if (plan.willRetry) {
              update.next_retry_at = plan.nextRetryAt;
              update.retry_count = plan.nextRetryCount;
            } else {
              notifyFailure = retryCfg.notifyOnFinalFailure && faxLog.sent_by && !faxLog.final_failure_notified;
              update.final_failure_notified = true;
            }
          } else if (newStatus === 'delivered') {
            update.failure_reason = null;
          }
          await base44.asServiceRole.entities.FaxLog.update(faxLog.id, update);

          if (notifyFailure) {
            const recipient = faxLog.to_name ? `${faxLog.to_name} (${faxLog.to_number})` : faxLog.to_number;
            await base44.asServiceRole.entities.Notification.create({
              user_email: faxLog.sent_by,
              type: 'fax_failed',
              title: '❌ Fax failed',
              message: `"${faxLog.document_name || 'Your document'}" to ${recipient} could not be delivered (${update.failure_reason}).`,
              priority: 'high',
              metadata: { related_entity: 'FaxLog', related_entity_id: faxLog.id },
              is_read: false
            }).catch((err) => console.error('Failed to send fax failure notification:', err.message));
          }
          updatedCount++;
        }
      } catch (error) {
        console.error('Error processing fax status:', error?.message || error);
      }
    }

    console.log(`Fax status sync completed. Updated ${updatedCount} faxes.`);
    return Response.json({
      success: true,
      message: `Fax statuses synced. ${updatedCount} updated.`,
      checked: nonFinalFaxes.length,
      updated: updatedCount
    });

  } catch (error) {
    console.error('Fax status sync function error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

function mapFaxStatus(currentStatus, fallbackStatus) {
  const statusMap = {
    queued: 'queued',
    'media.processed': 'sending',
    originated: 'sending',
    sending: 'sending',
    sent: 'sent',
    delivered: 'delivered',
    failed: 'failed',
    cancelled: 'failed',
    canceled: 'failed'
  };

  // Unknown Telnyx status: fall back to the current status (a no-op write).
  return statusMap[currentStatus] || fallbackStatus;
}