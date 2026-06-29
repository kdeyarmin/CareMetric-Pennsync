import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Resolve Telnyx credentials: prefer env vars, then the in-app IntegrationSecret
 * row with provider 'telnyx'. Mirrors the SMS/voice handlers so fax functions work
 * for agencies that store credentials in-app rather than in the dashboard env.
 */
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = pick(Deno.env.get('TELNYX_API_KEY'));
  let publicKey = pick(Deno.env.get('TELNYX_PUBLIC_KEY'));
  let messagingProfileId = pick(Deno.env.get('TELNYX_MESSAGING_PROFILE_ID'));
  let voiceConnectionId = pick(Deno.env.get('TELNYX_VOICE_CONNECTION_ID')) || pick(Deno.env.get('TELNYX_CONNECTION_ID'));
  let faxConnectionId = pick(Deno.env.get('TELNYX_FAX_CONNECTION_ID'));
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' });
    const rec = rows?.[0] || {};
    if (!apiKey) apiKey = pick(rec.api_key);
    if (!publicKey) publicKey = pick(rec.public_key);
    if (!messagingProfileId) messagingProfileId = pick(rec.messaging_profile_id);
    if (!voiceConnectionId) voiceConnectionId = pick(rec.voice_connection_id);
    if (!faxConnectionId) faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

/**
 * Re-dispatches failed faxes whose config-aware backoff window (set by the
 * status webhook) has elapsed. Called every few minutes by a scheduled
 * automation; enable ONE schedule. Honors the admin's FaxRetryConfig (max
 * retries / auto-retry switch) and claims each fax with a per-run token before
 * re-sending, so overlapping runs can't double-send the same document (the
 * Telnyx Fax API has no idempotency key). Sends a final-failure notice only when
 * retries are exhausted.
 */

// ---- fax retry policy (mirrors src/components/fax/faxRetry.js) ----
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ''} ${errorMessage ?? ''}`.trim();
  if (!s) return 'transient';
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? 'permanent' : 'transient';
}
function faxRetryConfig(config) {
  const c = config || {};
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: Number.isFinite(c.max_retries) ? Math.max(0, c.max_retries) : 3,
    baseDelayMinutes: Number.isFinite(c.retry_delay_minutes) && c.retry_delay_minutes > 0 ? c.retry_delay_minutes : 15,
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
function isFaxRetryDue(fax, now, config) {
  const c = faxRetryConfig(config);
  if (!c.enabled) return false;
  if (!fax || fax.status !== 'failed') return false;
  if (!fax.next_retry_at) return false;
  if (!fax.document_url) return false;
  // >= so the budget is spent at retry_count === maxRetries (matches
  // planFaxRetry's `attempts >= maxRetries`); `>` allowed one extra send/charge.
  if ((Number(fax.retry_count) || 0) >= c.maxRetries) return false;
  const t = new Date(fax.next_retry_at).getTime();
  return Number.isFinite(t) && now >= t;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const runId = crypto.randomUUID();

    const cfgRows = await base44.asServiceRole.entities.FaxRetryConfig.list('-created_date', 1).catch(() => []);
    const cfg = cfgRows[0] || {};
    const c = faxRetryConfig(cfg);
    if (!c.enabled) {
      return Response.json({ success: true, retried: 0, skipped: 0, note: 'Auto-retry disabled in FaxRetryConfig.' });
    }

    // Get all faxes that are failed and have a scheduled next_retry_at
    const allFailed = await base44.asServiceRole.entities.FaxLog.filter(
      { status: 'failed' },
      '-updated_date',
      200
    );

    const now = new Date();
    let retriedCount = 0;
    let skippedCount = 0;

    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Resolve the office fax from-number the same way sendFax does: prefer the
    // in-app AgencySettings.office_fax_number_e164, else the TELNYX_FAX_NUMBER env.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const officeFax = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const fromNumber = officeFax || Deno.env.get('TELNYX_FAX_NUMBER');
    // Include the same DLR webhook sendFax uses so the retried fax reports status.
    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const webhookUrl = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;

    if (!apiKey || !faxConnectionId || !fromNumber) {
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 500 });
    }

    for (const fax of allFailed) {
      if (!isFaxRetryDue(fax, now.getTime(), cfg)) {
        skippedCount++;
        continue;
      }

      // Claim with a per-run token, then RE-READ to confirm we own it. Flipping
      // to 'queued' also removes it from a second run's failed-filter, so two
      // overlapping runs can't both re-send the same document.
      try {
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          status: 'queued', retry_claimed_by: runId, next_retry_at: null,
        });
      } catch {
        skippedCount++;
        continue;
      }
      const check = await base44.asServiceRole.entities.FaxLog.filter({ id: fax.id }, '-updated_date', 1).catch(() => []);
      if (!check[0] || check[0].retry_claimed_by !== runId) {
        skippedCount++;
        continue;
      }

      // Attempt the retry via Telnyx
      try {
        const retryPayload = {
          connection_id: faxConnectionId,
          from: fromNumber,
          to: fax.to_number,
          media_url: fax.document_url,
          quality: 'high'
        };
        if (webhookUrl) retryPayload.webhook_url = webhookUrl;
        const telnyxResp = await fetch('https://api.telnyx.com/v2/faxes', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(retryPayload)
        });

        if (telnyxResp.ok) {
          const telnyxData = await telnyxResp.json();
          // Reset status to queued with new Telnyx fax id — webhook will update from here
          await base44.asServiceRole.entities.FaxLog.update(fax.id, {
            status: 'queued',
            telnyx_fax_id: telnyxData?.data?.id,
            next_retry_at: null,
            failure_reason: null,
            retry_claimed_by: null,
          });
          retriedCount++;
          console.log(`Retry attempt ${fax.retry_count} dispatched for fax ${fax.id} → new fax id ${telnyxData?.data?.id}`);
        } else {
          const errText = await telnyxResp.text();
          console.error(`Telnyx error on retry for fax ${fax.id}:`, errText);
          // Telnyx rejected the re-send — a permanent rejection, so stop now.
          await base44.asServiceRole.entities.FaxLog.update(fax.id, { status: 'failed', retry_claimed_by: null }).catch(() => {});
          await handleRetryExhausted(base44, fax, `Telnyx rejected retry: ${errText}`, c.maxRetries, c.notifyOnFinalFailure);
        }
      } catch (err) {
        console.error(`Network error retrying fax ${fax.id}:`, err.message);
        // Transient: restore to failed and reschedule (within budget) using the
        // SAME config-aware, priority-scaled backoff as the webhook; otherwise
        // exhaust + notify.
        const attempts = Number(fax.retry_count) || 0;
        const within = attempts < c.maxRetries;
        const delayMin = nextRetryDelayMinutes(attempts, cfg, fax.priority || 'normal');
        await base44.asServiceRole.entities.FaxLog.update(fax.id, {
          status: 'failed',
          retry_claimed_by: null,
          next_retry_at: within ? new Date(now.getTime() + delayMin * 60000).toISOString() : null,
        }).catch(() => {});
        if (!within) await handleRetryExhausted(base44, fax, err.message, c.maxRetries, c.notifyOnFinalFailure);
      }
    }

    return Response.json({
      success: true,
      retried: retriedCount,
      skipped: skippedCount,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('autoRetryFailedFaxes error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

/**
 * Mark fax as permanently failed and notify user (only called when all retries exhausted).
 */
async function handleRetryExhausted(base44, fax, reason, maxRetries = 3, notify = true) {
  if (fax.final_failure_notified || !notify) {
    await base44.asServiceRole.entities.FaxLog.update(fax.id, {
      next_retry_at: null, final_failure_notified: true, failure_reason: reason || fax.failure_reason,
    }).catch(() => {});
    return;
  }
  const MAX_RETRIES = maxRetries;

  await base44.asServiceRole.entities.FaxLog.update(fax.id, {
    next_retry_at: null,
    final_failure_notified: true,
    failure_reason: reason || fax.failure_reason
  });

  if (!fax.sent_by) return;

  const docName = fax.document_name || 'your document';
  const recipient = fax.to_name ? `${fax.to_name} (${fax.to_number})` : fax.to_number;

  // In-app notification
  try {
    await base44.asServiceRole.entities.Notification.create({
      user_email: fax.sent_by,
      title: '❌ Fax Failed — All Retries Exhausted',
      message: `"${docName}" to ${recipient} could not be delivered after ${MAX_RETRIES} attempts.`,
      type: 'fax_failed',
      priority: 'high',
      metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
      is_read: false,
      action_url: `/send-fax?fax_id=${fax.id}`
    });
  } catch (e) {
    console.error('Failed to create in-app notification:', e.message);
  }

  // Email notification
  try {
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: fax.sent_by,
      subject: `❌ Fax Failed After ${MAX_RETRIES} Attempts`,
      body: `Your fax could not be delivered after ${MAX_RETRIES} automatic retry attempts.\n\nDocument: ${docName}\nRecipient: ${recipient}\nLast Error: ${fax.failure_reason || reason || 'Unknown'}\n\nPlease verify the recipient fax number and resend manually from the Fax Center.`
    });
  } catch (e) {
    console.error('Failed to send final failure email:', e.message);
  }
}