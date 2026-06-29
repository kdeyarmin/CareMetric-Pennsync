import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * handleTelnyxStatusWebhook — the single inbound webhook for the whole Telnyx
 * integration: messaging (inbound SMS + delivery status), fax status, and voice
 * (Call Control inbound IVR + outbound masked-bridge + call status). Telnyx POSTs
 * a JSON envelope `{ data: { event_type, payload } }` and signs it with Ed25519:
 *   signed message = `${telnyx-timestamp}|${rawBody}`
 *   header `telnyx-signature-ed25519` = base64(signature)
 * verified against the account's Ed25519 PUBLIC key (Portal → Keys & Credentials).
 *
 * Fails closed: a webhook without a valid signature (or with a stale timestamp)
 * is rejected 401, because these events mutate delivery state for PHI-bearing
 * messages/faxes/calls and drive auto-replies / call routing. Value-mapping logic
 * mirrors src/components/integrations/telnyx/telnyxUtils.js (drift-guarded by
 * base44/functions/telnyxInlineParity.test.js).
 *
 * Replaces the former Twilio handlers: handleTwilioInboundSms, handleTwilioSmsStatus,
 * handleTwilioFaxWebhook, handleTwilioVoiceCall, handleTwilioVoicemail, handleTwilioCallStatus.
 */

// ---- credential resolution (inlined; parity-guarded) ----
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

// ---- value mapping (mirrors telnyxUtils.js) ----
function mapMessageStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued': case 'sending': return 'queued';
    case 'sent': return 'sent';
    case 'delivered': case 'webhook_delivered': return 'delivered';
    case 'sending_failed': case 'delivery_failed': case 'expired': case 'failed': return 'failed';
    default: return null;
  }
}
function mapFaxStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued': return 'queued';
    case 'media.processed': case 'originated': case 'sending': return 'sending';
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'failed': case 'cancelled': case 'canceled': return 'failed';
    default: return null;
  }
}
function mapCallStatus(eventType) {
  switch (String(eventType || '').toLowerCase()) {
    case 'call.initiated': return 'ringing';
    case 'call.answered': case 'call.bridged': return 'in_progress';
    case 'call.hangup': return 'completed';
    default: return null;
  }
}
// Monotonic rank so a late/out-of-order call event can't regress a terminal
// CallLog status. Mirrors the CALL_RANK guard the former handleTwilioCallStatus
// enforced.
// 'failed' (a missed/failed call) is terminal and ranks above 'completed' so the
// trailing call.hangup event (which maps to 'completed') can't regress a call we
// deliberately marked missed/failed back to a normal completion.
const CALL_RANK = { ringing: 1, in_progress: 2, completed: 3, failed: 4 };

// Best-effort call duration (seconds) from a Call Control hangup payload's
// start/end timestamps. Returns null when they're missing/unparseable.
function callDurationSecs(payload) {
  const start = Date.parse(payload?.start_time || '');
  const end = Date.parse(payload?.end_time || '');
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function extractTelnyxEvent(body) {
  const b = body || {};
  const data = b.data || b;
  const payload = data.payload || {};
  return { eventType: data.event_type || b.event_type || null, id: payload.id || data.id || null, payload };
}
function buildSignedPayload(timestamp, rawBody) {
  return `${String(timestamp ?? '')}|${String(rawBody ?? '')}`;
}
function isFreshTimestamp(timestamp, nowMs = Date.now(), toleranceSeconds = 300) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs / 1000 - ts) <= toleranceSeconds;
}

// ---- fax retry policy (source of truth: src/components/fax/faxRetry.js;
// drift-guarded by base44/functions/faxRetryInlineParity.test.js). Mirrors the
// policy used by autoRetryFailedFaxes so a failed fax gets a consistent
// next_retry_at and a PERMANENT failure (bad number, not a fax machine) gives up
// immediately. ----
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

// ---- phone + duty + business-hours helpers (mirror the voice utils) ----
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
// Hour (0–23) at `now` in `timeZone`, or null when it can't be computed.
function dutyHourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, hour12: false, hour: '2-digit' }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}
// At/after the agency's auto-off hour (default 5pm) in the duty timezone. Mirrors
// isPastAutoOffHour in src/components/voice/dutyUtils.js.
function isPastAutoOffHour(settings, now = new Date()) {
  const s = settings || {};
  if (s.auto_off_duty_enabled === false) return false;
  const hour = Number.isFinite(Number(s.auto_off_duty_hour)) ? Number(s.auto_off_duty_hour) : 17;
  const tz = s.duty_timezone || s.business_hours_timezone || 'America/New_York';
  const h = dutyHourInZone(now, tz);
  if (h == null) return false;
  return h >= hour;
}
// Off duty unless explicitly toggled on, before the auto-off hour, and outside a
// scheduled time-off window. Mirrors isOffDutyNow in dutyUtils.js (default-off +
// 5pm auto-end-of-day). `settings` enables the cutoff.
function isOffDutyNow(user, now = new Date(), settings = null) {
  if (!user) return false;
  const s = user.scheduled_off_duty_start ? new Date(user.scheduled_off_duty_start).getTime() : NaN;
  const e = user.scheduled_off_duty_end ? new Date(user.scheduled_off_duty_end).getTime() : NaN;
  if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
    const t = now.getTime();
    const week = 7 * 24 * 60 * 60 * 1000;
    if (user.scheduled_off_duty_recurring && e - s < week) {
      if (t >= s) {
        const delta = ((t - s) % week + week) % week;
        if (delta <= e - s) return true;
      }
    } else if (t >= s && t <= e) {
      return true;
    }
  }
  if (settings && isPastAutoOffHour(settings, now)) return true;
  if (user.duty_status !== 'on_duty') return true;
  // The on-duty toggle expires nightly: if it was set on an earlier calendar day
  // it's stale → off until they toggle on again. (Legacy rows without
  // duty_on_since keep the prior always-on behavior.) Mirrors dutyUtils.js.
  if (user.duty_on_since) {
    const dtz = (settings && (settings.duty_timezone || settings.business_hours_timezone)) || 'America/New_York';
    const dateKey = (d) => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: dtz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
      catch { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    };
    if (dateKey(new Date(user.duty_on_since)) !== dateKey(now)) return true;
  }
  return false;
}
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function wallClockInTimeZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.minute, 10);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  return { weekday: weekday ?? null, minutes: hour * 60 + minute };
}
function dateKeyInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function isAgencyOpen(settings, now = new Date()) {
  const s = settings || {};
  if (s.business_hours_enabled !== true) return true;
  let wc; let dateKey;
  try { wc = wallClockInTimeZone(now, s.business_hours_timezone); dateKey = dateKeyInTimeZone(now, s.business_hours_timezone); }
  catch { wc = wallClockInTimeZone(now, undefined); dateKey = dateKeyInTimeZone(now, undefined); }
  if (Array.isArray(s.business_hours_holidays) && s.business_hours_holidays.includes(dateKey)) return false;
  const day = (s.business_hours || {})[DAY_KEYS[wc.weekday]];
  if (!day || day.enabled === false) return false;
  const open = parseHHMM(day.open); const close = parseHHMM(day.close);
  if (open == null || close == null) return false;
  const m = wc.minutes;
  return open < close ? (m >= open && m < close) : (m >= open || m < close);
}

// ---- urgent-keyword detection (mirrors src/components/voice/urgentKeywords.js) ----
// <<<BEGIN SHARED HELPER: urgentKeywords — generated, edit base44/_shared/backendHelpers.mjs>>>
const DEFAULT_URGENT_KEYWORDS = ["emergency", "urgent", "911", "chest pain", "can't breathe", "cant breathe", "trouble breathing", "short of breath", "suicidal", "kill myself", "overdose", "bleeding", "fell", "fall", "fallen", "passed out", "unconscious", "stroke", "seizure", "severe pain", "help me", "not breathing", "unresponsive"];
// <<<END SHARED HELPER: urgentKeywords>>>
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function detectUrgency(text, extra = []) {
  // Normalize curly apostrophes to straight so a smart-quote "can't breathe"
  // (common from phone keyboards/autocorrect) still escalates.
  const s = String(text || '').replace(/[‘’]/g, "'");
  if (!s.trim()) return { urgent: false, matches: [] };
  const extras = (Array.isArray(extra) ? extra : []).map((k) => String(k || '').toLowerCase().trim()).filter(Boolean);
  const all = [...new Set([...DEFAULT_URGENT_KEYWORDS, ...extras])];
  const matches = [];
  for (const kw of all) {
    if (!kw) continue;
    if (new RegExp(`\\b${escapeRe(kw)}\\b`, 'i').test(s)) matches.push(kw);
  }
  return { urgent: matches.length > 0, matches };
}

// ---- Ed25519 signature verification ----
function base64ToBytes(b64) {
  try {
    const bin = atob(String(b64).trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
async function verifyTelnyxSignature(rawBody, signatureB64, timestamp, publicKeyB64) {
  if (!publicKeyB64 || !signatureB64 || !timestamp) return false;
  if (!isFreshTimestamp(timestamp)) return false;
  const pubBytes = base64ToBytes(publicKeyB64);
  const sigBytes = base64ToBytes(signatureB64);
  if (!pubBytes || !sigBytes) return false;
  try {
    const key = await crypto.subtle.importKey('raw', pubBytes, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(buildSignedPayload(timestamp, rawBody));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, data);
  } catch (err) {
    console.error('Telnyx signature verify error:', err?.message);
    return false;
  }
}

// client_state is base64(JSON) used to carry routing/bridge intent across the
// asynchronous Call Control event stream.
function encodeClientState(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeClientState(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

// ---- Call Control command helper ----
// Returns { ok, status } so callers can fall back on failure instead of
// silently stranding a live (billed) call leg.
// TODO(verify): confirm Call Control action paths/field names against the live
// Telnyx v2 API for your account (answer/transfer/speak/hangup/record_start).
async function callCommand(apiKey, callControlId, command, payload = {}) {
  try {
    const resp = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${command}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) console.error(`Call Control ${command} -> HTTP ${resp.status}`);
    await resp.body?.cancel?.().catch(() => {});
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    console.error(`Call Control ${command} failed:`, err?.message);
    return { ok: false, status: 0 };
  }
}
const SPEAK_DEFAULTS = { voice: 'female', language: 'en-US' };

// ---- Telnyx outbound SMS (auto-reply) ----
async function sendAutoReply(apiKey, messagingProfileId, from, to, text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const payload = { from, to, text };
    if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
    return await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('auto-reply send failed:', err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getAgencyConfig(base44) {
  const settings = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
  const s = settings[0] || {};
  return {
    settings: s,
    mainOffice: s.main_office_number_e164 || '',
    defaultOffDuty: s.default_off_duty_template || '',
    smsEnabled: s.sms_messaging_enabled ?? true,
    afterHoursReplyEnabled: s.after_hours_sms_auto_reply_enabled !== false,
    afterHoursReply: s.after_hours_sms_auto_reply || '',
    urgentEscalationEnabled: s.urgent_escalation_enabled !== false,
    urgentKeywords: Array.isArray(s.urgent_keywords) ? s.urgent_keywords : [],
    voicemailEnabled: s.voicemail_enabled === true,
    voicemailGreeting: s.voicemail_greeting || '',
    afterHoursAction: s.after_hours_call_action || 'transfer',
    afterHoursTransfer: s.after_hours_transfer_number_e164 || s.main_office_number_e164 || '',
    afterHoursGreeting: s.after_hours_call_greeting || '',
  };
}

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const HELP_WORDS = ['HELP', 'INFO'];

// ============================ MESSAGING ============================
// Monotonic rank so a late/out-of-order delivery webhook can't downgrade a
// terminal state (e.g. a re-delivered 'sending' arriving after 'sent'). Mirrors
// the SMS_RANK guard the former handleTwilioSmsStatus enforced.
const SMS_RANK = { queued: 1, sent: 2, delivered: 3, failed: 3 };

async function handleOutboundMessageStatus(base44, payload) {
  const providerId = payload?.id;
  const recipientStatus = payload?.to?.[0]?.status || payload?.status;
  const mapped = mapMessageStatus(recipientStatus);
  if (!providerId) return Response.json({ success: true, skipped: 'no message id' });
  if (!mapped) return Response.json({ success: true, skipped: 'unknown status', status: recipientStatus });

  const rows = await base44.asServiceRole.entities.SmsMessage.filter({ provider_message_id: providerId }, '-created_date', 1).catch(() => []);
  if (!rows.length) return Response.json({ success: false, message: 'SmsMessage not found' });
  const row = rows[0];
  // Forward-only: ignore an unchanged or out-of-order (lower-rank) transition.
  if ((SMS_RANK[mapped] || 0) <= (SMS_RANK[row.status] || 0)) {
    return Response.json({ success: true, status: row.status, deduped: true });
  }
  const update = { status: mapped };
  if (mapped === 'failed') {
    const err = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    update.failure_reason = err?.detail || err?.title || 'Delivery failed';
  }
  await base44.asServiceRole.entities.SmsMessage.update(row.id, update);

  // Tell the sending nurse when their text could not be delivered (parity with
  // the outbound fax-failed notification). Once per row.
  if (mapped === 'failed' && row.nurse_email && !row.failure_notified) {
    await base44.asServiceRole.entities.SmsMessage.update(row.id, { failure_notified: true }).catch(() => {});
    await base44.asServiceRole.entities.Notification.create({
      user_email: row.nurse_email,
      title: '⚠️ Text not delivered',
      message: `Your text to ${row.to_number} could not be delivered (${update.failure_reason}). Verify the number and try again.`,
      type: 'sms_failed', priority: 'high', metadata: { related_entity: 'SmsMessage', related_entity_id: row.id }, is_read: false,
    }).catch((err) => console.error('Failed to send sms failure notification:', err));
  }
  return Response.json({ success: true, status: mapped });
}

async function handleInboundMessage(base44, apiKey, messagingProfileId, payload) {
  const source = payload?.from?.phone_number || payload?.from;
  const destination = Array.isArray(payload?.to) ? payload.to[0]?.phone_number : payload?.to;
  const text = String(payload?.text || '');
  const providerMessageId = payload?.id || null;
  if (!source || !destination) return Response.json({ success: true, skipped: 'missing parties' });

  const config = await getAgencyConfig(base44);
  const patientNum = normalizeE164(source) || source;
  const workNum = normalizeE164(destination) || destination;

  // Resolve the nurse who owns this work number.
  let nurse = null;
  for (const variant of phoneVariants(workNum)) {
    const matches = await base44.asServiceRole.entities.User.filter({ work_phone_number: variant }).catch(() => []);
    if (matches.length > 0) { nurse = matches[0]; break; }
  }
  if (!nurse) {
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: 'system', action: 'sms_received_unresolved',
      details: { destination: workNum, timestamp: new Date().toISOString() }, status: 'failure',
    }).catch(() => {});
    return Response.json({ success: true, skipped: 'unresolved work number' });
  }

  // Idempotency: Telnyx may re-deliver. If we already stored this id, ack.
  if (providerMessageId) {
    const dup = await base44.asServiceRole.entities.SmsMessage
      .filter({ provider_message_id: providerMessageId }, '-created_date', 1).catch(() => []);
    if (dup.length > 0) return Response.json({ success: true, deduped: true });
  }

  // Resolve patient (best effort).
  let patientId = null;
  for (const variant of phoneVariants(patientNum)) {
    const m = await base44.asServiceRole.entities.Patient.filter({ phone: variant }).catch(() => []);
    if (m.length > 0) { patientId = m[0].id; break; }
  }

  const keyword = text.trim().toUpperCase();
  const sendReply = (msg) =>
    apiKey ? sendAutoReply(apiKey, messagingProfileId, workNum, patientNum, msg) : Promise.resolve(null);
  const recordConsent = (status, sourceTag) =>
    base44.asServiceRole.entities.SmsConsent.create({
      patient_id: patientId, phone_e164: patientNum, consent_status: status,
      consent_source: sourceTag, captured_by: null, captured_at: new Date().toISOString(),
      notes: `Inbound keyword "${keyword}" to ${nurse.email}`,
    }).catch((err) => console.error('consent write failed:', err));

  // Always store the inbound message.
  const inboundRow = await base44.asServiceRole.entities.SmsMessage.create({
    direction: 'inbound', from_number: patientNum, to_number: workNum, body: text,
    nurse_email: nurse.email, patient_id: patientId, thread_id: getThreadId(patientNum, workNum),
    status: 'received', provider_message_id: providerMessageId, is_read: false, consent_checked: false,
  });

  // Opt-out status — FAIL-CLOSED: if the ledger can't be read, assume opted-out.
  let priorOptedOut = true;
  try {
    const consents = await base44.asServiceRole.entities.SmsConsent.filter({ phone_e164: patientNum }, '-captured_at', 1);
    priorOptedOut = consents[0]?.consent_status === 'opted_out';
  } catch {
    priorOptedOut = true;
  }
  const smsEnabled = config.smsEnabled !== false;

  // --- Keyword handling FIRST (TCPA, legally required) ---
  if (STOP_WORDS.includes(keyword)) {
    await recordConsent('opted_out', 'keyword_stop');
    await sendReply('You have been unsubscribed and will no longer receive texts from your care team. Reply START to opt back in.');
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: 'system', action: 'sms_opt_out', entity_type: 'SmsMessage', entity_id: inboundRow.id,
      details: { phone: patientNum, nurse_email: nurse.email, patient_id: patientId }, status: 'success',
    }).catch(() => {});
    return Response.json({ success: true, opted_out: true });
  }
  if (START_WORDS.includes(keyword)) {
    await recordConsent('opted_in', 'keyword_start');
    await sendReply('You are now subscribed to texts from your care team. Reply STOP to opt out, HELP for help.');
  } else if (HELP_WORDS.includes(keyword)) {
    if (!priorOptedOut && smsEnabled) {
      const office = config.mainOffice ? ` or call our office at ${config.mainOffice}` : '';
      await sendReply(`This is your home-health care team. Reply STOP to unsubscribe${office}.`);
    }
  }

  // --- Automatic after-hours / off-duty reply (only ever one) ---
  // Off duty = toggled off, after the 5pm auto-off, or a scheduled window.
  const offDuty = isOffDutyNow(nurse, new Date(), config.settings);
  const agencyClosed = !isAgencyOpen(config.settings);
  if (agencyClosed && config.afterHoursReplyEnabled && !priorOptedOut && smsEnabled) {
    const office = config.mainOffice || 'the main office';
    const msg = (config.afterHoursReply || config.defaultOffDuty ||
      `Thanks for your message. Our office is currently closed. For anything urgent, please call ${office}. We'll reply during business hours.`)
      .replace(/\{office\}/gi, office);
    await sendReply(msg);
  } else if (offDuty && !priorOptedOut && smsEnabled) {
    const office = config.mainOffice || '724-465-0440';
    const msg = (nurse.off_duty_message || config.defaultOffDuty ||
      `Thank you for your text, but I am currently not working. Please contact the office at ${office}.`)
      .replace(/\{office\}/gi, office);
    await sendReply(msg);
  }

  // --- Urgent-keyword escalation ---
  const urgency = config.urgentEscalationEnabled ? detectUrgency(text, config.urgentKeywords) : { urgent: false, matches: [] };
  if (urgency.urgent) {
    await base44.asServiceRole.entities.Notification.create({
      user_email: nurse.email, title: '🚨 Possibly urgent patient text',
      message: `A text from ${patientNum} may need immediate attention (flagged: ${urgency.matches.slice(0, 3).join(', ')}). Review now.`,
      type: 'sms_urgent', priority: 'critical', metadata: { related_entity: 'SmsMessage', related_entity_id: inboundRow.id }, is_read: false,
    }).catch((err) => console.error('urgent notification failed:', err));
  }

  // --- Notify the nurse in-app ---
  await base44.asServiceRole.entities.Notification.create({
    user_email: nurse.email, title: '💬 New text message', message: `You have a new text from ${patientNum}.`,
    type: 'sms_received', priority: 'medium', metadata: { related_entity: 'SmsMessage', related_entity_id: inboundRow.id }, is_read: false,
  }).catch((err) => console.error('notification failed:', err));

  // Audit — never log message body.
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: 'system', action: 'sms_received', entity_type: 'SmsMessage', entity_id: inboundRow.id,
    details: {
      from_number: patientNum, to_number: workNum, nurse_email: nurse.email, patient_id: patientId,
      thread_id: inboundRow.thread_id, body_length: text.length, off_duty: offDuty, agency_closed: agencyClosed, urgent: urgency.urgent,
    }, status: 'success',
  }).catch(() => {});

  return Response.json({ success: true, received: true });
}

// ============================ FAX ============================
async function handleFaxEvent(base44, payload) {
  const providerId = payload?.id;
  const mapped = mapFaxStatus(payload?.status);
  if (!providerId) return Response.json({ success: true, skipped: 'no fax id' });
  if (!mapped) return Response.json({ success: true, skipped: 'unknown status', status: payload?.status });

  const rows = await base44.asServiceRole.entities.FaxLog.filter({ telnyx_fax_id: providerId }).catch(() => []);
  if (!rows.length) return Response.json({ success: false, message: 'FaxLog not found' });
  const faxLog = rows[0];
  // Idempotency: Telnyx re-delivers webhooks. If the status is unchanged, ack
  // without re-running side effects (critically, without re-bumping retry_count).
  if (mapped === faxLog.status) return Response.json({ success: true, status: mapped, deduped: true });

  const update = {
    status: mapped,
    // Don't let a legitimate 0-page report fall through to the old value.
    pages: Number.isFinite(payload?.page_count) ? payload.page_count : faxLog.pages,
    failure_reason: null,
    next_retry_at: null,
  };

  let exhaustedNow = false;
  if (mapped === 'failed') {
    const failureReason = payload?.failure_reason || payload?.failover?.failure_reason || 'Fax delivery failed';
    // Honor the admin FaxRetryConfig: schedule a retry or give up (and notify once).
    const cfgRows = await base44.asServiceRole.entities.FaxRetryConfig.list('-created_date', 1).catch(() => []);
    const cfg = cfgRows[0] || {};
    const maxRetries = faxRetryConfig(cfg).maxRetries;
    const plan = planFaxRetry({
      retryCount: faxLog.retry_count || 0,
      errorCode: payload?.failure_code || payload?.error_code,
      errorMessage: failureReason,
      priority: faxLog.priority || 'normal',
      config: cfg,
    });
    // Only schedule a retry the cron will actually honor. planFaxRetry plans a
    // retry whenever attempts < maxRetries (nextRetryCount = attempts + 1), but the
    // cron's isFaxRetryDue refuses any fax whose retry_count >= maxRetries — so a
    // planned retry with nextRetryCount === maxRetries would be written yet never
    // re-sent AND never notified (stranded forever). Treat that boundary case as
    // exhausted so the sender is told the fax failed.
    if (plan.willRetry && plan.nextRetryCount < maxRetries) {
      update.next_retry_at = plan.nextRetryAt;
      update.retry_count = plan.nextRetryCount;
    } else {
      exhaustedNow = !faxLog.final_failure_notified;
      update.final_failure_notified = true;
      // Record that we reached the retry cap even though no further send is scheduled.
      if (plan.willRetry) update.retry_count = plan.nextRetryCount;
    }
    update.failure_reason = failureReason;
  }

  await base44.asServiceRole.entities.FaxLog.update(faxLog.id, update);

  // Tell the sender when a fax was delivered successfully (parity with the old
  // handleTwilioFaxWebhook). Guarded by delivery_confirmation_sent so a
  // re-delivered webhook can't double-notify.
  if (mapped === 'delivered' && faxLog.sent_by && !faxLog.delivery_confirmation_sent) {
    await base44.asServiceRole.entities.FaxLog.update(faxLog.id, { delivery_confirmation_sent: true }).catch(() => {});
    const recipientName = faxLog.to_name ? `${faxLog.to_name} (${faxLog.to_number})` : faxLog.to_number;
    await base44.asServiceRole.entities.Notification.create({
      user_email: faxLog.sent_by,
      title: '✅ Fax delivered',
      message: `Your fax to ${recipientName} was delivered successfully (${update.pages || faxLog.pages || 'N/A'} pages).`,
      type: 'fax_delivered', priority: 'medium', metadata: { related_entity: 'FaxLog', related_entity_id: faxLog.id },
      is_read: false, action_url: `/SendFax?tab=logs&fax_id=${faxLog.id}`,
    }).catch((err) => console.error('Failed to send fax delivered notification:', err));
  }

  // Tell the sender when a fax has permanently failed (no retries left).
  if (exhaustedNow && faxLog.sent_by) {
    const recipient = faxLog.to_name ? `${faxLog.to_name} (${faxLog.to_number})` : faxLog.to_number;
    await base44.asServiceRole.entities.Notification.create({
      user_email: faxLog.sent_by,
      title: '❌ Fax failed',
      message: `"${faxLog.document_name || 'Your document'}" to ${recipient} could not be delivered (${update.failure_reason}). Verify the number and resend.`,
      type: 'fax_failed', priority: 'high', metadata: { related_entity: 'FaxLog', related_entity_id: faxLog.id },
      is_read: false, action_url: `/SendFax?fax_id=${faxLog.id}`,
    }).catch((err) => console.error('Failed to send fax failure notification:', err));
  }
  return Response.json({ success: true, status: mapped });
}

// ============================ VOICE ============================
// ---- find-me-follow-me ringdown (mirrors src/components/voice/onCall.js) ----
const RING_TIMEOUT_SECS_DEFAULT = 20;
function buildRingdown(opts) {
  const { primary = null, others = [], office = null, maxTargets = 4 } = opts || {};
  const seen = new Set();
  const out = [];
  const push = (num, kind) => {
    const n = String(num || '').trim();
    if (!n || seen.has(n)) return;
    seen.add(n);
    out.push({ to: n, kind });
  };
  push(primary, 'primary');
  for (const o of Array.isArray(others) ? others : []) push(o, 'backup');
  push(office, 'office');
  const cap = Number.isFinite(maxTargets) && maxTargets > 0 ? maxTargets : 4;
  return out.slice(0, cap);
}
const UNANSWERED_CAUSES = new Set([
  'no_answer', 'no_user_response', 'user_busy', 'call_rejected', 'timeout',
  'normal_temporary_failure', 'unallocated_number', 'recovery_on_timer_expire', 'originator_cancel',
]);
function isUnansweredHangup(cause) {
  return UNANSWERED_CAUSES.has(String(cause || '').toLowerCase());
}

// Other on-duty nurses' cells (for the ringdown backup list), excluding the
// primary nurse and anyone without a cell.
async function otherOnDutyCells(base44, config, primaryEmail) {
  const users = await base44.asServiceRole.entities.User.list('full_name', 500).catch(() => []);
  const now = new Date();
  const cells = [];
  for (const u of Array.isArray(users) ? users : []) {
    if (!u || u.email === primaryEmail) continue;
    if (!u.personal_cell_e164) continue;
    if (isOffDutyNow(u, now, config.settings)) continue; // only currently on-duty
    cells.push(u.personal_cell_e164);
  }
  return cells;
}

// Decide how an inbound call to a work number should be routed. Mirrors the
// routing in the former handleTwilioVoiceCall (agency hours > off-duty > masked
// bridge), returning a provider-neutral action the Call Control flow executes.
async function decideInboundRouting(base44, config, workNum) {
  const agencyClosed = !isAgencyOpen(config.settings);

  let nurse = null;
  for (const variant of (workNum ? phoneVariants(workNum) : [])) {
    const matches = await base44.asServiceRole.entities.User.filter({ work_phone_number: variant }).catch(() => []);
    if (matches.length > 0) { nurse = matches[0]; break; }
  }
  if (!nurse) {
    return config.mainOffice
      ? { action: 'bridge', to: config.mainOffice, callerId: workNum || config.mainOffice, nurse: null }
      : { action: 'hangup', greeting: 'We are unable to connect your call at this time. Please try again later.', nurse: null };
  }

  if (agencyClosed) {
    const office = config.afterHoursTransfer || config.mainOffice || 'the main office';
    if (config.afterHoursAction === 'voicemail' && config.voicemailEnabled) {
      const greeting = (config.afterHoursGreeting || config.voicemailGreeting ||
        'Our office is currently closed. Please leave a message after the tone and we will return your call.').replace(/\{office\}/gi, office);
      return { action: 'voicemail', greeting, nurse };
    }
    if (config.afterHoursAction === 'hangup' || (!config.afterHoursTransfer && !config.mainOffice)) {
      const greeting = (config.afterHoursGreeting || 'Our office is currently closed. Please call back during business hours.').replace(/\{office\}/gi, office);
      return { action: 'hangup', greeting, nurse };
    }
    const greeting = (config.afterHoursGreeting || 'Our office is currently closed. Please hold while we connect you.').replace(/\{office\}/gi, office);
    const target = config.afterHoursTransfer || config.mainOffice;
    return { action: 'greet_transfer', greeting, to: target, callerId: workNum, nurse };
  }

  // Off duty = toggled off, after the 5pm auto-off, or a scheduled window.
  if (isOffDutyNow(nurse, new Date(), config.settings)) {
    const office = config.mainOffice || '724-465-0440';
    const greeting = (nurse.off_duty_message ||
      'Thank you for your call, I am not working right now. Please hold while I connect you to Penn Home Health.').replace(/\{office\}/gi, office);
    // Speak the message, then connect them to the office so they don't have to
    // redial; if no office number is configured, just play the message and end.
    if (config.mainOffice) return { action: 'greet_transfer', greeting, to: config.mainOffice, callerId: workNum, nurse };
    return { action: 'hangup', greeting, nurse };
  }

  // On duty: find-me-follow-me ringdown — ring the nurse's cell first, then any
  // other on-duty nurse, then the office. Caller id = the work number on every
  // leg so the patient never sees a personal cell.
  const others = await otherOnDutyCells(base44, config, nurse.email);
  const maxTargets = Number.isFinite(Number(config.settings?.ringdown_max)) ? Number(config.settings.ringdown_max) : 4;
  const targets = buildRingdown({ primary: nurse.personal_cell_e164, others, office: config.mainOffice, maxTargets });
  if (targets.length > 0) {
    return { action: 'ringdown', targets, to: targets[0].to, callerId: workNum, nurse };
  }
  return { action: 'hangup', greeting: 'We are unable to connect your call at this time. Please try again later.', nurse };
}

async function logInboundCall(base44, callControlId, callerNum, workNum, route) {
  if (!callControlId) return;
  const existing = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return;
  // Label the call accurately: a call to a de-provisioned/unowned work number
  // (no nurse) must NOT be mislabeled as an off-duty transfer.
  const callMode = !route.nurse ? 'unresolved'
    : route.action === 'voicemail' ? 'voicemail'
      : (route.action === 'ringdown' || (route.action === 'bridge' && route.nurse?.personal_cell_e164)) ? 'masked_bridge'
        : 'office_transfer';
  const logRow = await base44.asServiceRole.entities.CallLog.create({
    direction: 'inbound', from_number: callerNum, to_number: route.to || '', displayed_number: workNum,
    nurse_email: route.nurse?.email || null, call_mode: callMode, status: 'ringing', provider_call_id: callControlId,
  }).catch(() => null);
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: 'system', action: 'inbound_call_received', entity_type: 'CallLog', entity_id: logRow?.id,
    details: { call_mode: callMode, nurse_email: route.nurse?.email || null, provider_call_id: callControlId }, status: 'success',
  }).catch(() => {});
}

async function handleCallEvent(base44, apiKey, eventType, payload) {
  const callControlId = payload?.call_control_id;
  const state = decodeClientState(payload?.client_state);
  const direction = String(payload?.direction || '').toLowerCase(); // 'incoming' | 'outgoing'

  // --- OUTBOUND masked bridge: nurse leg answered → dial the patient (caller id = work number). ---
  if (eventType === 'call.answered' && state?.t === 'masked_bridge' && callControlId && apiKey) {
    const r = await callCommand(apiKey, callControlId, 'transfer', { to: state.bridge_to, from: state.caller_id });
    if (!r.ok) {
      // Don't leave the nurse connected to dead air: tell them, hang up, and mark
      // the call failed so the log reflects that the patient was never reached.
      await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: 'We could not connect your call. Please try again later.' });
      await callCommand(apiKey, callControlId, 'hangup', {});
      if (state.call_log_id) {
        await base44.asServiceRole.entities.CallLog.update(state.call_log_id, { status: 'failed', failure_reason: 'Bridge transfer to the patient failed' }).catch(() => {});
      }
    }
    return Response.json({ success: true, bridged: r.ok });
  }

  // --- INBOUND IVR state machine (Call Control) ---
  if (apiKey && callControlId) {
    // Step 1: a fresh inbound call rings in. Answer it first (consistent with the
    // outbound path), carrying the routing decision forward in client_state.
    if (eventType === 'call.initiated' && direction === 'incoming' && !state) {
      const config = await getAgencyConfig(base44);
      const callerNum = normalizeE164(payload?.from) || payload?.from || '';
      const workNum = normalizeE164(payload?.to) || payload?.to || '';
      const route = await decideInboundRouting(base44, config, workNum);
      await logInboundCall(base44, callControlId, callerNum, workNum, route);
      await callCommand(apiKey, callControlId, 'answer', {
        client_state: encodeClientState({ t: 'inbound_ivr', action: route.action, greeting: route.greeting || '', to: route.to || null, callerId: route.callerId || null, targets: route.targets || null }),
      });
      return Response.json({ success: true, inbound: route.action });
    }

    // --- RINGDOWN advance: a dialed leg went unanswered → roll to the next
    // target on the original caller leg (a_leg). A plain caller hangup carries a
    // different client_state, so this only fires on a callee no-answer. ---
    if (eventType === 'call.hangup' && state?.t === 'ringdown' && state.a_leg && isUnansweredHangup(payload?.hangup_cause)) {
      const next = (Number(state.idx) || 0) + 1;
      const hasNext = Array.isArray(state.targets) && state.targets[next];
      if (hasNext) {
        await startRingdown(apiKey, state.a_leg, state.targets, state.callerId, next);
      } else {
        // Ringdown exhausted: nobody answered. Mark the inbound call as missed
        // BEFORE hanging up the caller leg. The CallLog status enum has no
        // 'no_answer', so use 'failed' — every missed-call consumer (callbackQueue,
        // comms dashboard, phone analytics, call history) already treats 'failed'
        // as a missed call. Without this the trailing call.hangup maps to
        // 'completed' and the missed call silently vanishes from the callback queue.
        const inboundLogs = await base44.asServiceRole.entities.CallLog
          .filter({ provider_call_id: state.a_leg }, '-created_date', 1).catch(() => []);
        if (inboundLogs.length && inboundLogs[0].status !== 'failed') {
          await base44.asServiceRole.entities.CallLog.update(inboundLogs[0].id, {
            status: 'failed',
            failure_reason: 'No answer — all on-call targets were unavailable',
          }).catch(() => {});
        }
        await callCommand(apiKey, state.a_leg, 'hangup', {});
      }
      return Response.json({ success: true, ringdown_advance: next, exhausted: !hasNext });
    }

    // Step 2: the inbound call we answered is now live → ring the targets
    // (find-me-follow-me), or speak the greeting then continue once it finishes.
    if (eventType === 'call.answered' && state?.t === 'inbound_ivr') {
      if (state.action === 'ringdown') {
        await startRingdown(apiKey, callControlId, state.targets || [], state.callerId, 0);
        return Response.json({ success: true, inbound_ivr: 'ringdown' });
      }
      const greeting = String(state.greeting || '').slice(0, 320);
      const next = encodeClientState({ t: 'inbound_after_greet', action: state.action, to: state.to || null, callerId: state.callerId || null, targets: state.targets || null });
      if (greeting) {
        await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: greeting, client_state: next });
      } else {
        // No greeting (e.g. a plain transfer) → act immediately.
        await continueAfterGreeting(base44, apiKey, callControlId, state.action, state.to, state.callerId, state.targets);
      }
      return Response.json({ success: true, inbound_ivr: state.action });
    }

    // Safety net: if call.initiated was lost (webhooks are at-least-once and can
    // drop), the first event we see for an inbound call may be call.answered with
    // no routing state. Re-derive the route and act so the call is never stranded
    // on a silent answered leg.
    if (eventType === 'call.answered' && direction === 'incoming' && !state) {
      const config = await getAgencyConfig(base44);
      const workNum = normalizeE164(payload?.to) || payload?.to || '';
      const route = await decideInboundRouting(base44, config, workNum);
      if (route.action === 'ringdown') {
        await startRingdown(apiKey, callControlId, route.targets || [], route.callerId, 0);
        return Response.json({ success: true, inbound_recovered: 'ringdown' });
      }
      const greeting = String(route.greeting || '').slice(0, 320);
      if (greeting) {
        const next = encodeClientState({ t: 'inbound_after_greet', action: route.action, to: route.to || null, callerId: route.callerId || null, targets: route.targets || null });
        await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: greeting, client_state: next });
      } else {
        await continueAfterGreeting(base44, apiKey, callControlId, route.action, route.to, route.callerId, route.targets);
      }
      return Response.json({ success: true, inbound_recovered: route.action });
    }

    // Step 3: greeting finished → execute the deferred action.
    if (eventType === 'call.speak.ended' && state?.t === 'inbound_after_greet') {
      await continueAfterGreeting(base44, apiKey, callControlId, state.action, state.to, state.callerId, state.targets);
      return Response.json({ success: true, after_greet: state.action });
    }

    // Live voicemail transcription (final segments) → append to the CallLog.
    if (eventType === 'call.transcription') {
      const td = payload?.transcription_data || {};
      const isFinal = td.is_final === true || td.status === 'completed';
      const text = td.transcript || td.text;
      if (isFinal && text) await appendVoicemailTranscript(base44, callControlId, text);
      return Response.json({ success: true, transcription: Boolean(isFinal && text) });
    }

    // Voicemail recording finished → persist it (port of handleTwilioVoicemail).
    if (eventType === 'call.recording.saved') {
      await saveVoicemail(base44, payload);
      return Response.json({ success: true, voicemail_saved: true });
    }
  }

  // --- Best-effort CallLog status update for any call event. ---
  const mapped = mapCallStatus(eventType);
  if (mapped) {
    let rows = callControlId
      ? await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => [])
      : [];
    if (!rows.length && state?.call_log_id) {
      rows = await base44.asServiceRole.entities.CallLog.filter({ id: state.call_log_id }).catch(() => []);
    }
    if (rows.length) {
      const cur = rows[0];
      const patch = {};
      // Forward-only so an out-of-order event can't regress a terminal call.
      if ((CALL_RANK[mapped] || 0) > (CALL_RANK[cur.status] || 0)) patch.status = mapped;
      // Capture the call duration on hangup (from the Call Control timestamps)
      // so call logs and any length-based reporting aren't blank.
      if (eventType === 'call.hangup') {
        const dur = callDurationSecs(payload);
        if (dur != null && dur !== cur.duration_seconds) patch.duration_seconds = dur;
      }
      if (Object.keys(patch).length) {
        await base44.asServiceRole.entities.CallLog.update(cur.id, patch).catch(() => {});
      }
    }
  }
  return Response.json({ success: true, event: eventType, status: mapped });
}

// Ring the next find-me-follow-me target on the original caller leg. The dialed
// leg carries the ringdown client_state so an unanswered hangup can advance.
async function startRingdown(apiKey, aLegId, targets, callerId, idx = 0) {
  const list = Array.isArray(targets) ? targets : [];
  const target = list[idx];
  if (!target) { await callCommand(apiKey, aLegId, 'hangup', {}); return; }
  await callCommand(apiKey, aLegId, 'transfer', {
    to: target.to,
    from: callerId || target.to,
    timeout_secs: RING_TIMEOUT_SECS_DEFAULT,
    client_state: encodeClientState({ t: 'ringdown', targets: list, idx, callerId, a_leg: aLegId }),
  });
}

async function continueAfterGreeting(base44, apiKey, callControlId, action, to, callerId, targets = null) {
  // Find-me-follow-me: ring the targets in order on the caller leg.
  if (action === 'ringdown') {
    await startRingdown(apiKey, callControlId, targets || (to ? [{ to, kind: 'primary' }] : []), callerId, 0);
    return;
  }
  // A plain bridge and a greet-then-transfer both end in a transfer; unify them
  // and fall back gracefully if the transfer fails so the caller is never left on
  // a silent, open (billed) leg.
  if ((action === 'greet_transfer' || action === 'bridge') && to) {
    const r = await callCommand(apiKey, callControlId, 'transfer', { to, from: callerId || to });
    if (!r.ok) {
      await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: 'We are unable to connect your call at this time. Please try again later.' });
      await callCommand(apiKey, callControlId, 'hangup', {});
    }
  } else if (action === 'voicemail') {
    // Bound the recording so a silent/abandoned line can't leave a billed leg
    // open indefinitely (matches the old 120s voicemail cap). TODO(verify):
    // record_start field names (format/channels/max_length_secs) against the API.
    await callCommand(apiKey, callControlId, 'record_start', {
      format: 'mp3', channels: 'single', max_length_secs: 120,
      client_state: encodeClientState({ t: 'voicemail' }),
    });
    // Restore the voicemail transcription the old handler captured. Best-effort:
    // transcripts arrive on call.transcription events. TODO(verify): transcription_start
    // field names against the live API.
    await callCommand(apiKey, callControlId, 'transcription_start', { language: 'en', client_state: encodeClientState({ t: 'voicemail' }) });
  } else {
    await callCommand(apiKey, callControlId, 'hangup', {});
  }
}

async function appendVoicemailTranscript(base44, callControlId, text) {
  if (!callControlId) return;
  const rows = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (!rows.length) return;
  const existing = rows[0].voicemail_transcription ? `${rows[0].voicemail_transcription} ` : '';
  await base44.asServiceRole.entities.CallLog.update(rows[0].id, {
    voicemail_transcription: `${existing}${text}`.slice(0, 4000),
    has_voicemail: true,
  }).catch(() => {});
}

async function saveVoicemail(base44, payload) {
  const callControlId = payload?.call_control_id;
  const recordingUrl = payload?.recording_urls?.mp3 || payload?.recording_urls?.wav || payload?.public_recording_urls?.mp3 || null;
  const durationSecs = Number.isFinite(payload?.recording_duration_secs) ? payload.recording_duration_secs : null;
  if (!callControlId) return;
  const rows = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (!rows.length) return;
  const row = rows[0];
  await base44.asServiceRole.entities.CallLog.update(row.id, {
    voicemail_url: recordingUrl || row.voicemail_url || null,
    voicemail_duration_seconds: durationSecs ?? row.voicemail_duration_seconds ?? null,
    has_voicemail: true,
    status: 'completed',
  }).catch(() => {});
  // Notify once (a recording.saved redelivery shouldn't re-alert).
  if (row.nurse_email && !row.voicemail_notified) {
    await base44.asServiceRole.entities.CallLog.update(row.id, { voicemail_notified: true }).catch(() => {});
    const preview = row.voicemail_transcription ? ` "${String(row.voicemail_transcription).slice(0, 120)}"` : '';
    await base44.asServiceRole.entities.Notification.create({
      user_email: row.nurse_email, title: '📞 New voicemail',
      message: `New voicemail from ${row.from_number || 'a caller'}.${preview}`,
      type: 'voicemail', priority: 'medium', metadata: { related_entity: 'CallLog', related_entity_id: row.id }, is_read: false,
    }).catch(() => {});
  }
}

// ============================ ENTRY ============================
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { apiKey, publicKey, messagingProfileId } = await resolveTelnyxCreds(base44);

    // Read the raw body ONCE — signature is over the exact bytes.
    const rawBody = await req.text();
    const signature = req.headers.get('telnyx-signature-ed25519');
    const timestamp = req.headers.get('telnyx-timestamp');

    if (!(await verifyTelnyxSignature(rawBody, signature, timestamp, publicKey))) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body = {};
    try { body = JSON.parse(rawBody); } catch { /* leave empty */ }
    const { eventType, payload } = extractTelnyxEvent(body);

    if (!eventType) return Response.json({ success: true, skipped: 'no event type' });

    if (eventType === 'message.received') return await handleInboundMessage(base44, apiKey, messagingProfileId, payload);
    if (eventType.startsWith('message.')) return await handleOutboundMessageStatus(base44, payload);
    if (eventType.startsWith('fax.')) return await handleFaxEvent(base44, payload);
    if (eventType.startsWith('call.')) return await handleCallEvent(base44, apiKey, eventType, payload);

    return Response.json({ success: true, skipped: 'unhandled event', event: eventType });
  } catch (error) {
    // Don't echo raw error text (may contain PHI such as numbers/URLs).
    console.error('handleTelnyxStatusWebhook error:', error?.message);
    return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
});