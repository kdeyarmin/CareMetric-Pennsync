import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * startMaskedCall — outbound click-to-call masking (via Telnyx) (nurse -> patient) via the
 * Telnyx Call Control API. Mirrors startMaskedCall (the Twilio path).
 *
 * Flow: ring the nurse's personal cell first (`to` = cell, caller id = work
 * number). The patient leg is bridged when the nurse answers: the answered-leg
 * `call.answered` webhook (handleTelnyxStatusWebhook) reads the encoded
 * `client_state` and issues a Call Control `transfer` to the patient presenting
 * the WORK number as caller id, so the patient never sees the cell.
 *
 * Origination is NON-idempotent: a thrown network error is NOT retried (the call
 * may already be in flight). Only explicit retryable HTTP statuses are retried.
 */

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

function phoneVariants(value) {
  const d = (value || '').replace(/[^\d]/g, '');
  const ten = d.slice(-10);
  if (ten.length !== 10) return value ? [value] : [];
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  const variants = [value, `+1${ten}`, `1${ten}`, ten, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
  return variants.filter((v, i) => variants.indexOf(v) === i);
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

// ---- transient-failure retry policy (origination is NOT idempotent) ----
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
async function originateWithRetry(
  attemptFn,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await attemptFn(attempt);
    if (result.ok || !isRetryableStatus(result.status) || attempt === maxAttempts) {
      return { ...result, attempts: attempt };
    }
    const fromHeader = parseRetryAfter(result.retryAfter ?? null);
    await sleep(fromHeader != null ? Math.min(fromHeader, 4000) : backoffDelayMs(attempt));
  }
  throw new Error('originateWithRetry exhausted attempts');
}

// Telnyx echoes `client_state` (base64) back on every webhook for the call, so we
// stash the bridge target + presented caller id there for handleTelnyxStatusWebhook.
function encodeClientState(obj) {
  const json = JSON.stringify(obj);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { patient_id, to_number } = await req.json();

    const workNumber = user.work_phone_number;
    const nurseCell = user.personal_cell_e164;
    if (!workNumber || !nurseCell) {
      return Response.json({ error: 'Your account needs both a work number and a personal cell on file. Ask an admin to provision them.' }, { status: 400 });
    }

    let destination = normalizeE164(to_number);
    let resolvedPatientId = patient_id || null;
    if (!destination && patient_id) {
      const p = await base44.asServiceRole.entities.Patient.filter({ id: patient_id }).catch(() => []);
      destination = normalizeE164(p[0]?.phone);
    }
    if (!destination) {
      return Response.json({ error: 'Could not determine a valid patient phone number' }, { status: 400 });
    }
    if (!resolvedPatientId) {
      for (const v of phoneVariants(destination)) {
        const m = await base44.asServiceRole.entities.Patient.filter({ phone: v }).catch(() => []);
        if (m.length > 0) { resolvedPatientId = m[0].id; break; }
      }
    }

    const { apiKey, voiceConnectionId } = await resolveTelnyxCreds(base44);
    if (!apiKey || !voiceConnectionId) {
      return Response.json({ error: 'Telnyx Voice credentials not configured' }, { status: 500 });
    }

    // Cost control: block premium/blocked/international destinations by default.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const destAllowed = isAllowedDestination(destination, settingsRows[0] || {});
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }

    const callLog = await base44.entities.CallLog.create({
      direction: 'outbound',
      from_number: nurseCell,
      to_number: destination,
      displayed_number: workNumber,
      nurse_email: user.email,
      patient_id: resolvedPatientId,
      call_mode: 'outbound_clicktocall',
      status: 'initiated',
      sent_by: user.email,
    });

    // Bridge instructions for the answered-leg webhook: dial the patient,
    // presenting the work number as caller id. Tagged so the webhook only acts on
    // calls it originated.
    const clientState = encodeClientState({
      t: 'masked_bridge',
      bridge_to: destination,
      caller_id: workNumber,
      call_log_id: callLog.id,
    });

    const telnyxUrl = 'https://api.telnyx.com/v2/calls';
    const ORIGINATE_TIMEOUT_MS = 15000;
    const functionsBase = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');

    let result;
    try {
      result = await originateWithRetry(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ORIGINATE_TIMEOUT_MS);
        try {
          const payload = {
            connection_id: voiceConnectionId,
            to: nurseCell,
            from: workNumber,
            client_state: clientState,
            timeout_secs: 30,
          };
          if (functionsBase) payload.webhook_url = `${functionsBase}/handleTelnyxStatusWebhook`;
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
        ? `Timed out after ${ORIGINATE_TIMEOUT_MS} ms reaching Telnyx`
        : `Network error reaching Telnyx: ${netErr.message}`;
      await base44.entities.CallLog.update(callLog.id, { status: 'failed', failure_reason: reason }).catch(() => {});
      return Response.json(
        { error: aborted ? 'Telnyx Voice API timed out' : 'Failed to reach Telnyx Voice API', details: netErr.message },
        { status: aborted ? 504 : 502 },
      );
    }

    const data = result.data || {};
    if (!result.ok) {
      const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
      await base44.entities.CallLog.update(callLog.id, {
        status: 'failed',
        failure_reason: firstErr?.detail || firstErr?.title || `Telnyx Voice API error (${result.status})`,
      });
      return Response.json({ error: 'Telnyx Voice API error', details: data }, { status: result.status });
    }

    // Call Control returns call_control_id + call_leg_id; persist the leg id as
    // the provider call id so status webhooks can find this row.
    const providerCallId = data?.data?.call_control_id || data?.data?.call_leg_id || null;
    await base44.entities.CallLog.update(callLog.id, { provider_call_id: providerCallId });

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'call_initiated',
      entity_type: 'CallLog',
      entity_id: callLog.id,
      details: {
        provider: 'telnyx',
        to_number: destination,
        displayed_number: workNumber,
        patient_id: resolvedPatientId,
        provider_call_id: providerCallId,
        timestamp: new Date().toISOString(),
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, call_id: callLog.id, provider_call_id: providerCallId });
  } catch (error) {
    console.error('startTelnyxCall error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});