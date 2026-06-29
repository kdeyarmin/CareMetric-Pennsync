import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * redriveFailedSms — cron "outbox" that re-sends outbound texts which Telnyx
 * reported as failed for a TRANSIENT reason (timeout / network / 429 / 5xx).
 * Configure a schedule (e.g. every 10 minutes) in the Base44 dashboard.
 * Enable only ONE schedule.
 *
 * Redrive only fires on rows Telnyx reported as failed, so re-sending is
 * appropriate. Telnyx has no client idempotency key, so we can't rely on
 * provider dedupe — double-send is prevented by the claim+re-read and by only
 * redriving rows Telnyx explicitly reported failed (not ambiguous network errors).
 * An attempt cap, an escalating backoff between attempts, and an age ceiling
 * guarantee a stuck message eventually settles into a terminal 'failed' state
 * instead of looping.
 *
 * Permanent failures (opt-out, invalid number, auth, kill switch) are never
 * retried. Bodies are never written to the audit log.
 */

const SEND_TIMEOUT_MS = 15000;
const BATCH_LIMIT = 100;

// ---- redrive eligibility (mirrors src/components/messaging/smsRedrive.js) ----
const TRANSIENT_FAILURE_PATTERNS = [
  /timed out/i, /timeout/i, /network/i, /unreachable/i, /temporar/i,
  /\b(429|500|502|503|504)\b/, /rate.?limit/i, /failed to reach/i,
  /connection/i, /EAI_AGAIN/i, /ECONN/i, /ETIMEDOUT/i, /socket/i,
];
const PERMANENT_FAILURE_PATTERNS = [
  /opted out/i, /opt.?out/i, /unsubscrib/i, /invalid/i, /\b(400|401|403|404|422)\b/,
  /blocked/i, /blacklist/i, /not configured/i, /disabled/i, /too long/i, /consent/i,
];
function isTransientFailureReason(reason) {
  const s = String(reason || '');
  if (!s.trim()) return false;
  if (PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s))) return false;
  return TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(s));
}
function shouldRedriveSms(row, now = Date.now(), maxAttempts = 4, baseGapMs = 60_000, maxAgeMs = 24 * 60 * 60 * 1000) {
  if (!row || row.status !== 'failed' || row.direction !== 'outbound') return false;
  const attempts = Number(row.retry_count) || 0;
  if (attempts >= maxAttempts) return false;
  if (!isTransientFailureReason(row.failure_reason)) return false;
  const created = new Date(row.created_date).getTime();
  if (!Number.isFinite(created)) return false;
  if (now - created > maxAgeMs) return false;
  const last = row.last_retry_at ? new Date(row.last_retry_at).getTime() : created;
  const requiredGap = baseGapMs * 2 ** attempts;
  if (Number.isFinite(last) && now - last < requiredGap) return false;
  return true;
}

async function getAgencyConfig(base44) {
  const settings = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
  const s = settings[0] || {};
  return {
    settings: s,
    smsEnabled: s.sms_messaging_enabled ?? true,
  };
}

/**
 * Resolve Telnyx credentials: prefer env vars, then the in-app IntegrationSecret
 * row with provider 'telnyx'. Either path configures the integration, so the
 * Base44 dashboard env is optional.
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

async function sendTelnyx(apiKey, messagingProfileId, from, to, body, webhookUrl) {
  const url = `https://api.telnyx.com/v2/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const payload = { from, to, text: body };
    if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
    if (webhookUrl) payload.webhook_url = webhookUrl;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

// ---- TCPA quiet hours (mirrors src/components/voice/quietHours.js) ----
// <<<BEGIN SHARED HELPER: areaCodeTimezone — generated, edit base44/_shared/backendHelpers.mjs>>>
const AREA_CODE_TIMEZONE = {
  201: "America/New_York",
  202: "America/New_York",
  203: "America/New_York",
  205: "America/Chicago",
  206: "America/Los_Angeles",
  207: "America/New_York",
  208: "America/Denver",
  209: "America/Los_Angeles",
  210: "America/Chicago",
  212: "America/New_York",
  213: "America/Los_Angeles",
  214: "America/Chicago",
  215: "America/New_York",
  216: "America/New_York",
  217: "America/Chicago",
  218: "America/Chicago",
  220: "America/New_York",
  223: "America/New_York",
  224: "America/Chicago",
  225: "America/Chicago",
  228: "America/Chicago",
  234: "America/New_York",
  239: "America/New_York",
  240: "America/New_York",
  251: "America/Chicago",
  253: "America/Los_Angeles",
  254: "America/Chicago",
  256: "America/Chicago",
  262: "America/Chicago",
  267: "America/New_York",
  272: "America/New_York",
  276: "America/New_York",
  279: "America/Los_Angeles",
  281: "America/Chicago",
  290: "America/New_York",
  301: "America/New_York",
  302: "America/New_York",
  303: "America/Denver",
  304: "America/New_York",
  305: "America/New_York",
  307: "America/Denver",
  309: "America/Chicago",
  310: "America/Los_Angeles",
  312: "America/Chicago",
  314: "America/Chicago",
  316: "America/Chicago",
  318: "America/Chicago",
  319: "America/Chicago",
  320: "America/Chicago",
  321: "America/New_York",
  323: "America/Los_Angeles",
  324: "America/New_York",
  330: "America/New_York",
  331: "America/Chicago",
  334: "America/Chicago",
  337: "America/Chicago",
  339: "America/New_York",
  341: "America/Los_Angeles",
  346: "America/Chicago",
  347: "America/New_York",
  351: "America/New_York",
  352: "America/New_York",
  360: "America/Los_Angeles",
  361: "America/Chicago",
  385: "America/Denver",
  386: "America/New_York",
  401: "America/New_York",
  402: "America/Chicago",
  404: "America/New_York",
  405: "America/Chicago",
  406: "America/Denver",
  407: "America/New_York",
  408: "America/Los_Angeles",
  409: "America/Chicago",
  410: "America/New_York",
  412: "America/New_York",
  413: "America/New_York",
  414: "America/Chicago",
  415: "America/Los_Angeles",
  417: "America/Chicago",
  419: "America/New_York",
  424: "America/Los_Angeles",
  425: "America/Los_Angeles",
  430: "America/Chicago",
  432: "America/Chicago",
  434: "America/New_York",
  435: "America/Denver",
  440: "America/New_York",
  442: "America/Los_Angeles",
  443: "America/New_York",
  447: "America/Chicago",
  469: "America/Chicago",
  470: "America/New_York",
  475: "America/New_York",
  478: "America/New_York",
  479: "America/Chicago",
  480: "America/Phoenix",
  484: "America/New_York",
  501: "America/Chicago",
  502: "America/New_York",
  503: "America/Los_Angeles",
  504: "America/Chicago",
  505: "America/Denver",
  507: "America/Chicago",
  508: "America/New_York",
  509: "America/Los_Angeles",
  510: "America/Los_Angeles",
  512: "America/Chicago",
  513: "America/New_York",
  515: "America/Chicago",
  516: "America/New_York",
  517: "America/New_York",
  518: "America/New_York",
  520: "America/Phoenix",
  530: "America/Los_Angeles",
  540: "America/New_York",
  541: "America/Los_Angeles",
  551: "America/New_York",
  559: "America/Los_Angeles",
  561: "America/New_York",
  562: "America/Los_Angeles",
  563: "America/Chicago",
  564: "America/New_York",
  567: "America/New_York",
  570: "America/New_York",
  571: "America/New_York",
  573: "America/Chicago",
  575: "America/Denver",
  580: "America/Chicago",
  585: "America/New_York",
  601: "America/Chicago",
  602: "America/Phoenix",
  605: "America/Chicago",
  607: "America/New_York",
  608: "America/Chicago",
  610: "America/New_York",
  612: "America/Chicago",
  614: "America/New_York",
  617: "America/New_York",
  618: "America/Chicago",
  619: "America/Los_Angeles",
  620: "America/Chicago",
  623: "America/Phoenix",
  626: "America/Los_Angeles",
  628: "America/Los_Angeles",
  630: "America/Chicago",
  631: "America/New_York",
  636: "America/Chicago",
  641: "America/Chicago",
  646: "America/New_York",
  650: "America/Los_Angeles",
  651: "America/Chicago",
  657: "America/Los_Angeles",
  660: "America/Chicago",
  661: "America/Los_Angeles",
  667: "America/New_York",
  669: "America/Los_Angeles",
  678: "America/New_York",
  680: "America/New_York",
  682: "America/Chicago",
  689: "America/New_York",
  703: "America/New_York",
  707: "America/Los_Angeles",
  708: "America/Chicago",
  712: "America/Chicago",
  713: "America/Chicago",
  714: "America/Los_Angeles",
  715: "America/Chicago",
  716: "America/New_York",
  717: "America/New_York",
  718: "America/New_York",
  719: "America/Denver",
  720: "America/Denver",
  724: "America/New_York",
  727: "America/New_York",
  731: "America/Chicago",
  732: "America/New_York",
  737: "America/Chicago",
  740: "America/New_York",
  743: "America/New_York",
  747: "America/Los_Angeles",
  754: "America/New_York",
  757: "America/New_York",
  760: "America/Los_Angeles",
  763: "America/Chicago",
  769: "America/Chicago",
  770: "America/New_York",
  772: "America/New_York",
  773: "America/Chicago",
  774: "America/New_York",
  775: "America/Los_Angeles",
  779: "America/Chicago",
  781: "America/New_York",
  785: "America/Chicago",
  786: "America/New_York",
  801: "America/Denver",
  803: "America/New_York",
  804: "America/New_York",
  805: "America/Los_Angeles",
  808: "Pacific/Honolulu",
  810: "America/New_York",
  813: "America/New_York",
  814: "America/New_York",
  815: "America/Chicago",
  816: "America/Chicago",
  817: "America/Chicago",
  818: "America/Los_Angeles",
  820: "America/Los_Angeles",
  828: "America/New_York",
  830: "America/Chicago",
  831: "America/Los_Angeles",
  832: "America/Chicago",
  843: "America/New_York",
  845: "America/New_York",
  847: "America/Chicago",
  848: "America/New_York",
  856: "America/New_York",
  857: "America/New_York",
  858: "America/Los_Angeles",
  859: "America/New_York",
  862: "America/New_York",
  863: "America/New_York",
  864: "America/New_York",
  870: "America/Chicago",
  872: "America/Chicago",
  878: "America/New_York",
  901: "America/Chicago",
  903: "America/Chicago",
  904: "America/New_York",
  907: "America/Anchorage",
  908: "America/New_York",
  909: "America/Los_Angeles",
  910: "America/New_York",
  912: "America/New_York",
  913: "America/Chicago",
  914: "America/New_York",
  915: "America/Denver",
  916: "America/Los_Angeles",
  918: "America/Chicago",
  919: "America/New_York",
  920: "America/Chicago",
  925: "America/Los_Angeles",
  928: "America/Phoenix",
  929: "America/New_York",
  934: "America/New_York",
  936: "America/Chicago",
  937: "America/New_York",
  940: "America/Chicago",
  941: "America/New_York",
  947: "America/New_York",
  949: "America/Los_Angeles",
  951: "America/Los_Angeles",
  952: "America/Chicago",
  954: "America/New_York",
  956: "America/Chicago",
  959: "America/New_York",
  970: "America/Denver",
  971: "America/Los_Angeles",
  972: "America/Chicago",
  979: "America/Chicago",
  980: "America/New_York",
  984: "America/New_York",
  989: "America/New_York",
};
// <<<END SHARED HELPER: areaCodeTimezone>>>
function tzForNumber(raw) {
  const d = String(raw || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return AREA_CODE_TIMEZONE[Number(ten.slice(0, 3))] || null;
}
function hourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit' }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}
/** TCPA quiet-hours check in the RECIPIENT's timezone. Fails open when unknown. */
function quietHoursCheck(toNumber, now, settings) {
  const startHour = Number(settings?.tcpa_quiet_start_hour ?? 8);
  const endHour = Number(settings?.tcpa_quiet_end_hour ?? 21);
  const tz = tzForNumber(toNumber);
  if (!tz) return { allowed: true, reason: 'unknown_timezone' };
  const h = hourInZone(now, tz);
  if (h == null) return { allowed: true, reason: 'unknown_timezone' };
  // Allowed contact window; supports a window that wraps past midnight
  // (start > end), e.g. quiet hours 21:00–08:00. Mirrors dispatchScheduledSms /
  // sendSms — without this, a wrap-around config makes the allowed window
  // evaluate as empty and NO failed text is ever redriven.
  const allowed = startHour === endHour ? true
    : startHour < endHour ? (h >= startHour && h < endHour)
      : (h >= startHour || h < endHour);
  return { allowed, reason: allowed ? 'within_hours' : 'quiet_hours' };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged cron job (service-role reads/writes + billable
    // Telnyx re-sends, no end user). Opt-in lockdown mirroring pollFaxStatuses —
    // a real scheduler runs unauthenticated and still passes while no secret is
    // configured; once INTERNAL_FN_SECRET is set it must present the header, and
    // a logged-in non-admin is always rejected.
    const me = await base44.auth.me().catch(() => null);
    const isAdmin = me?.role === 'admin';
    const internalSecret = Deno.env.get('INTERNAL_FN_SECRET');
    if (internalSecret) {
      if (!isAdmin && req.headers.get('x-internal-secret') !== internalSecret) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    } else if (me && !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const { apiKey, messagingProfileId } = await resolveTelnyxCreds(base44);
    const { settings, smsEnabled } = await getAgencyConfig(base44);
    const runId = crypto.randomUUID();
    const now = Date.now();
    // Reconcile terminal delivery status via the DLR webhook (mirrors sendSms) —
    // without it a redriven message that later fails delivery is never retried
    // again and never surfaces a failed-delivery notification.
    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const statusCallback = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;

    const result = { scanned: 0, redriven: 0, recovered: 0, failed: 0, skipped: 0 };

    if (!apiKey || smsEnabled === false) {
      return Response.json({ success: true, ...result, note: 'Telnyx SMS not configured or disabled — nothing redriven.' });
    }

    const failedRows = await base44.asServiceRole.entities.SmsMessage
      .filter({ status: 'failed', direction: 'outbound' }, '-created_date', BATCH_LIMIT).catch(() => []);
    result.scanned = failedRows.length;

    for (const row of failedRows) {
      if (!shouldRedriveSms(row, now)) continue;
      // Opt-out can have changed since the failure — re-check, fail closed.
      let optedOut = true;
      try {
        const consents = await base44.asServiceRole.entities.SmsConsent
          .filter({ phone_e164: row.to_number }, '-captured_at', 1);
        optedOut = consents[0]?.consent_status === 'opted_out';
      } catch {
        optedOut = true;
      }
      if (optedOut) continue;

      // TCPA quiet hours (recipient timezone): a text that failed during the day
      // must not be redriven into the recipient's quiet hours. Skip for now; a
      // later run during allowed hours will pick it up.
      if (settings?.tcpa_quiet_hours_enabled === true) {
        const q = quietHoursCheck(row.to_number, new Date(), settings);
        if (!q.allowed) { result.skipped++; continue; }
      }

      // Claim with a run token WITHOUT changing status — the row stays 'failed'
      // so a crash mid-send can never strand it as a terminal 'queued' (a later
      // run re-scans it once the backoff gap passes). retry_count/last_retry_at
      // advance here so the attempt is counted and the gap is enforced; the
      // re-read confirms ownership against overlapping runs. Telnyx has no client
      // idempotency key, but redrive only fires on rows Telnyx explicitly reported
      // as failed, so re-sending is appropriate; we can't rely on provider dedupe.
      const attempts = (Number(row.retry_count) || 0) + 1;
      try {
        await base44.asServiceRole.entities.SmsMessage.update(row.id, {
          retry_count: attempts, last_retry_at: new Date().toISOString(), redrive_claimed_by: runId,
        });
      } catch {
        result.skipped++;
        continue;
      }
      const check = await base44.asServiceRole.entities.SmsMessage.filter({ id: row.id }, '-created_date', 1).catch(() => []);
      if (!check[0] || check[0].redrive_claimed_by !== runId) { result.skipped++; continue; }
      result.redriven++;

      // The original client_message_id is kept for our own tracking but is NOT
      // sent to Telnyx — Telnyx has no client idempotency key.
      const clientMessageId = row.client_message_id || `redrive-${row.id}`;
      let resp;
      try {
        resp = await sendTelnyx(apiKey, messagingProfileId, row.from_number, row.to_number, row.body, statusCallback);
      } catch (netErr) {
        const aborted = netErr?.name === 'AbortError';
        result.failed++;
        await base44.asServiceRole.entities.SmsMessage.update(row.id, {
          status: 'failed', redrive_claimed_by: null,
          failure_reason: aborted ? 'Timed out reaching Telnyx (redrive)' : `Network error reaching Telnyx (redrive): ${netErr.message}`,
        }).catch(() => {});
        continue;
      }

      if (!resp.ok) {
        result.failed++;
        await base44.asServiceRole.entities.SmsMessage.update(row.id, {
          status: 'failed', redrive_claimed_by: null,
          failure_reason: resp.data?.errors?.[0]?.detail || resp.data?.errors?.[0]?.title || `Telnyx API error (${resp.status}) (redrive)`,
        }).catch(() => {});
        continue;
      }

      result.recovered++;
      // Map Telnyx recipient status: 'delivered' → 'delivered', everything else
      // (queued/sending/sent/'') → 'sent' (matches the original non-delivered→sent).
      const providerStatus = (resp.data?.data?.to?.[0]?.status || '').toLowerCase();
      const mappedStatus = providerStatus === 'delivered' ? 'delivered' : 'sent';
      await base44.asServiceRole.entities.SmsMessage.update(row.id, {
        provider_message_id: resp.data?.data?.id || row.provider_message_id || null,
        status: mappedStatus,
        failure_reason: null,
        client_message_id: clientMessageId,
        redrive_claimed_by: null,
      }).catch(() => {});

      await base44.asServiceRole.entities.UserActivity.create({
        user_email: row.sent_by || row.nurse_email || 'system',
        action: 'sms_redriven',
        entity_type: 'SmsMessage',
        entity_id: row.id,
        details: { to_number: row.to_number, attempt: attempts, provider_message_id: resp.data?.data?.id || null },
        status: 'success',
      }).catch(() => {});
    }

    return Response.json({ success: true, ...result, checked_at: new Date(now).toISOString() });
  } catch (error) {
    console.error('redriveFailedSms error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});