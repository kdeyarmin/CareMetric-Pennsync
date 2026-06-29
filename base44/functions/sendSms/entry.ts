import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * sendSms — outbound SMS (via Telnyx) from a nurse's dedicated work number to a patient,
 * sent via the Telnyx Messaging API. Behaviorally identical to sendSms (the
 * Twilio path): the patient only ever sees the nurse's work number (`from`); the
 * nurse's personal cell is never exposed; refuses to send to numbers that have
 * opted out (TCPA) or during the recipient's TCPA quiet hours; the message body
 * is never written to the audit log (PHI minimization) — only its length and the
 * thread id are recorded. Logs to the same SmsMessage entity so Telnyx and Twilio
 * messages thread together.
 */

// ---- inline helpers (single-file Deno deploy; do not rely on imports) ----
function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

function getThreadId(a, b) {
  const na = normalizeE164(a) || a;
  const nb = normalizeE164(b) || b;
  return [na, nb].sort().join('|');
}

function phoneVariants(value) {
  const d = (value || '').replace(/[^\d]/g, '');
  const ten = d.slice(-10);
  if (ten.length !== 10) return value ? [value] : [];
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  const variants = [value, `+1${ten}`, `1${ten}`, ten, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

async function getAgencyConfig(base44) {
  const settings = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
  const s = settings[0] || {};
  return { settings: s, smsEnabled: s.sms_messaging_enabled ?? true };
}

/**
 * Resolve Telnyx credentials + resource ids env-first, then the in-app
 * IntegrationSecret row (provider 'telnyx'). Inlined identically across the
 * Telnyx functions; drift guarded by telnyxCredsInlineParity.test.js.
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

async function resolvePatientId(base44, e164) {
  for (const variant of phoneVariants(e164)) {
    const matches = await base44.asServiceRole.entities.Patient.filter({ phone: variant }).catch(() => []);
    if (matches.length > 0) return matches[0].id;
  }
  return null;
}

// ---- transient-failure retry policy (mirrors src/components/voice/twilioRetry.js) ----
// We only retry on explicit retryable HTTP statuses and never on a THROWN network
// error for a send — a blind retry could double-text the patient.
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
function isRetryableStatus(status) { return RETRYABLE_STATUSES.has(Number(status)); }
function parseRetryAfter(headerValue, nowMs = Date.now()) {
  if (headerValue == null) return null;
  const raw = String(headerValue).trim();
  if (raw === '') return null;
  if (/^\d+$/.test(raw)) return Number(raw) * 1000;
  const dateMs = Date.parse(raw);
  if (!Number.isNaN(dateMs)) return Math.max(0, dateMs - nowMs);
  return null;
}
function backoffDelayMs(attempt, baseMs = 300, maxMs = 4000) {
  const n = Math.max(1, Number(attempt) || 1);
  const exp = Math.min(maxMs, baseMs * 2 ** (n - 1));
  return Math.round(exp / 2 + Math.random() * (exp / 2));
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function sendWithRetry(
  attemptFn,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result;
    try {
      result = await attemptFn(attempt);
    } catch (err) {
      throw err; // never retry a thrown network error — could double-text.
    }
    if (result.ok || !isRetryableStatus(result.status) || attempt === maxAttempts) {
      return { ...result, attempts: attempt };
    }
    const fromHeader = parseRetryAfter(result.retryAfter ?? null);
    await sleep(fromHeader != null ? Math.min(fromHeader, 4000) : backoffDelayMs(attempt));
  }
  throw new Error('sendWithRetry exhausted attempts');
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
  } catch { return null; }
}
function quietHoursCheck(toNumber, now, settings) {
  const startHour = Number(settings?.tcpa_quiet_start_hour ?? 8);
  const endHour = Number(settings?.tcpa_quiet_end_hour ?? 21);
  const tz = tzForNumber(toNumber);
  if (!tz) return { allowed: true, reason: 'unknown_timezone' };
  const h = hourInZone(now, tz);
  if (h == null) return { allowed: true, reason: 'unknown_timezone' };
  // Allowed contact window; supports a window that wraps past midnight
  // (start > end). Mirrors isWithinQuietHours in src/components/voice/quietHours.js.
  const allowed = startHour === endHour ? true
    : startHour < endHour ? (h >= startHour && h < endHour)
      : (h >= startHour || h < endHour);
  return { allowed, reason: allowed ? 'within_hours' : 'quiet_hours' };
}

// ---- cost controls (mirrors src/components/voice/costControls.js) ----
const PREMIUM_AREA_CODES = new Set(['900', '976']);
function isAllowedDestination(e164, settings = {}) {
  const s = settings || {};
  const e = String(e164 || '').trim();
  if (/^\+1\d{10}$/.test(e)) {
    const areaCode = e.slice(2, 5);
    if (PREMIUM_AREA_CODES.has(areaCode)) return { allowed: false, reason: 'premium_number_blocked' };
    const blocked = Array.isArray(s.blocked_area_codes) ? s.blocked_area_codes.map((a) => String(a).replace(/[^\d]/g, '')) : [];
    if (blocked.includes(areaCode)) return { allowed: false, reason: 'blocked_area_code' };
    return { allowed: true, reason: 'allowed' };
  }
  if (!/^\+\d{8,15}$/.test(e)) return { allowed: false, reason: 'invalid_destination' };
  if (s.allow_international === true) return { allowed: true, reason: 'international_allowed' };
  return { allowed: false, reason: 'international_blocked' };
}
function blockedReasonMessage(reason) {
  switch (reason) {
    case 'premium_number_blocked': return 'Premium-rate numbers (900/976) are blocked.';
    case 'blocked_area_code': return "That area code is blocked by your agency's policy.";
    case 'international_blocked': return 'International destinations are blocked. Ask an admin to enable international sending.';
    case 'invalid_destination': return "That doesn't look like a valid phone number.";
    default: return "That destination isn't allowed.";
  }
}
function monthStartISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { to_number, body, patient_id, media_urls } = await req.json();
    if (!to_number || !body) {
      return Response.json({ error: 'Missing required fields: to_number, body' }, { status: 400 });
    }
    if (typeof body !== 'string') {
      return Response.json({ error: 'Message body must be a string' }, { status: 400 });
    }
    if (body.length > 1600) {
      return Response.json({ error: 'Message is too long (max 1600 characters).' }, { status: 400 });
    }
    // Optional MMS attachments (Telnyx sends an MMS when media_urls is set). Cap
    // the count and require https URLs so a bad payload can't fan out or SSRF.
    let mediaUrls = null;
    if (media_urls != null) {
      if (!Array.isArray(media_urls) || media_urls.length > 10 || !media_urls.every((u) => typeof u === 'string' && /^https:\/\//i.test(u))) {
        return Response.json({ error: 'media_urls must be an array of up to 10 https URLs.' }, { status: 400 });
      }
      mediaUrls = media_urls;
    }

    const fromNumber = user.work_phone_number;
    if (!fromNumber) {
      return Response.json({ error: 'No work number assigned to your account. Ask an admin to provision one.' }, { status: 400 });
    }

    const destination = normalizeE164(to_number);
    if (!destination) {
      return Response.json({ error: 'Invalid destination phone number' }, { status: 400 });
    }

    const { apiKey, messagingProfileId } = await resolveTelnyxCreds(base44);
    const { settings, smsEnabled } = await getAgencyConfig(base44);
    if (!apiKey) {
      return Response.json({ error: 'Telnyx SMS credentials not configured' }, { status: 500 });
    }
    if (!smsEnabled) {
      return Response.json({ error: 'SMS messaging is disabled for this agency' }, { status: 403 });
    }

    // Cost control: block premium/blocked/international destinations by default.
    const destAllowed = isAllowedDestination(destination, settings);
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }

    // Cost control: enforce an optional monthly outbound-SMS cap. We pull the
    // newest `cap` outbound rows (equality filter only — Base44 has no range
    // query) and count how many fall in the current month; if that already meets
    // the cap, we're at the limit.
    const monthlyCap = Number(settings?.monthly_sms_cap);
    if (Number.isFinite(monthlyCap) && monthlyCap > 0) {
      const since = monthStartISO();
      const recentOutbound = await base44.asServiceRole.entities.SmsMessage
        .filter({ direction: 'outbound' }, '-created_date', monthlyCap)
        .catch(() => []);
      const sentThisMonth = (Array.isArray(recentOutbound) ? recentOutbound : [])
        .filter((m) => m.created_date && m.created_date >= since).length;
      if (sentThisMonth >= monthlyCap) {
        return Response.json({ error: 'This agency has reached its monthly text-message limit. Ask an admin to raise the cap.', reason: 'monthly_cap_reached' }, { status: 429 });
      }
    }

    // TCPA: refuse to text a number that has opted out.
    const consents = await base44.asServiceRole.entities.SmsConsent
      .filter({ phone_e164: destination }, '-captured_at', 1).catch(() => []);
    const consentStatus = consents[0]?.consent_status || 'unknown';
    if (consentStatus === 'opted_out') {
      return Response.json({ error: 'This patient has opted out of text messages (replied STOP).' }, { status: 403 });
    }

    // TCPA quiet hours (recipient timezone). Hard block when enabled.
    if (settings?.tcpa_quiet_hours_enabled === true) {
      const q = quietHoursCheck(destination, new Date(), settings);
      if (!q.allowed) {
        return Response.json(
          { error: "It's outside the recipient's allowed texting hours (TCPA quiet hours). Schedule this text for daytime in their timezone instead.", reason: q.reason },
          { status: 403 },
        );
      }
    }

    const resolvedPatientId = patient_id || await resolvePatientId(base44, destination);
    const clientMessageId = crypto.randomUUID();

    // Log the message before sending so we always have a record.
    const smsRow = await base44.entities.SmsMessage.create({
      direction: 'outbound',
      from_number: fromNumber,
      to_number: destination,
      body,
      nurse_email: user.email,
      patient_id: resolvedPatientId || null,
      thread_id: getThreadId(fromNumber, destination),
      status: 'queued',
      client_message_id: clientMessageId,
      is_read: true,
      sent_by: user.email,
      consent_checked: consentStatus === 'opted_in',
    });

    // Send via the Telnyx Messages API. Bounded by an AbortController timeout.
    // Only retries on explicit retryable HTTP statuses — never on a thrown
    // network error (Telnyx has no client idempotency key for messages, so a
    // blind retry could double-text).
    const telnyxUrl = 'https://api.telnyx.com/v2/messages';
    const SEND_TIMEOUT_MS = 15000;
    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const webhookUrl = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;
    let result;
    try {
      result = await sendWithRetry(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
        try {
          const payload = { from: fromNumber, to: destination, text: body };
          if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
          if (mediaUrls) payload.media_urls = mediaUrls; // MMS
          if (webhookUrl) payload.webhook_url = webhookUrl;
          const resp = await fetch(telnyxUrl, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          const data = await resp.json().catch(() => ({}));
          return { ok: resp.ok, status: resp.status, data, retryAfter: resp.headers.get('retry-after') };
        } finally {
          clearTimeout(timer);
        }
      });
    } catch (netErr) {
      const aborted = netErr?.name === 'AbortError';
      const reason = aborted
        ? `Timed out after ${SEND_TIMEOUT_MS} ms reaching Telnyx`
        : `Network error reaching Telnyx: ${netErr.message}`;
      await base44.entities.SmsMessage.update(smsRow.id, { status: 'failed', failure_reason: reason }).catch(() => {});
      return Response.json(
        { error: aborted ? 'Telnyx SMS API timed out' : 'Failed to reach Telnyx SMS API', details: netErr.message },
        { status: aborted ? 504 : 502 },
      );
    }

    const data = result.data || {};

    if (!result.ok) {
      // Telnyx error envelope: { errors: [{ detail, title, code }] }.
      const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
      await base44.entities.SmsMessage.update(smsRow.id, {
        status: 'failed',
        failure_reason: firstErr?.detail || firstErr?.title || `Telnyx API error (${result.status})`,
      });
      return Response.json({ error: 'Telnyx SMS API error', details: data }, { status: result.status });
    }

    // Telnyx success envelope: { data: { id, to: [{ status }], ... } }.
    const messageId = data?.data?.id || null;
    const recipientStatus = (data?.data?.to?.[0]?.status || '').toLowerCase();
    await base44.entities.SmsMessage.update(smsRow.id, {
      provider_message_id: messageId,
      status: recipientStatus === 'queued' || recipientStatus === 'sending' || recipientStatus === '' ? 'queued' : 'sent',
    });

    // Audit — never log the message body (HIPAA). Length + thread only.
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'sms_sent',
      entity_type: 'SmsMessage',
      entity_id: smsRow.id,
      details: {
        provider: 'telnyx',
        to_number: destination,
        from_number: fromNumber,
        patient_id: resolvedPatientId || null,
        thread_id: smsRow.thread_id,
        body_length: String(body).length,
        provider_message_id: messageId,
        timestamp: new Date().toISOString(),
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, message_id: smsRow.id, provider_message_id: messageId, status: 'sent' });
  } catch (error) {
    console.error('sendTelnyxSms error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});