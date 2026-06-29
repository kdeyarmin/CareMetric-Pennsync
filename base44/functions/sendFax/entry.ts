import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * sendFax — outbound fax via the Telnyx Programmable Fax API. Mirrors
 * sendFax (the Twilio path): idempotent on a recent identical send, logs to the
 * same FaxLog entity (the existing telnyx_fax_id field stores the provider fax
 * id), and never echoes PHI-bearing provider detail to the client.
 *
 * Telnyx faxes require a Programmable Fax connection id (TELNYX_FAX_CONNECTION_ID
 * or the in-app fax_connection_id) and a from number on that connection
 * (TELNYX_FAX_NUMBER or the in-app TELNYX_FAX_NUMBER env).
 */

function normalizeFaxDest(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return String(raw).trim();
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
    case 'invalid_destination': return "That doesn't look like a valid fax number.";
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { file_url, to_number, document_name, to_name, patient_id } = await req.json();
    if (!file_url || !to_number) {
      return Response.json({ error: 'Missing required fields: file_url, to_number' }, { status: 400 });
    }

    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Every user faxes from the SINGLE shared office fax number so the office
    // number is what recipients see (and reply-to) — incoming faxes therefore go
    // straight to the office, never to an individual. Configurable in-app via
    // AgencySettings.office_fax_number_e164, else the TELNYX_FAX_NUMBER env.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const officeFax = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const fromNumber = officeFax || Deno.env.get('TELNYX_FAX_NUMBER');

    // Cost control: block premium/blocked/international fax destinations by default.
    const faxDest = normalizeFaxDest(to_number);
    const destAllowed = isAllowedDestination(faxDest, settingsRows[0] || {});
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }

    if (!apiKey || !faxConnectionId || !fromNumber) {
      return Response.json({ error: 'Telnyx fax credentials not configured' }, { status: 500 });
    }

    // Idempotency: a double-submit would otherwise create a second FaxLog and
    // send + charge the same PHI fax twice. Telnyx Fax has no client idempotency
    // key, so de-dupe on a recent identical (recipient + document + sender) send.
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const recent = await base44.asServiceRole.entities.FaxLog
      .filter({ to_number, document_url: file_url, sent_by: user.email }, '-created_date', 5)
      .catch(() => []);
    const dupe = (recent || []).find((f) => f.created_date && f.created_date >= recentCutoff && f.status !== 'failed');
    if (dupe) {
      return Response.json({ success: true, deduped: true, fax_id: dupe.id, status: dupe.status });
    }

    const faxLog = await base44.entities.FaxLog.create({
      from_number: fromNumber,
      to_number,
      to_name: to_name || null,
      document_url: file_url,
      document_name: document_name || 'Fax',
      status: 'queued',
      patient_id: patient_id || null,
      sent_by: user.email,
    });

    const functionsBaseUrl = (Deno.env.get('FUNCTIONS_BASE_URL') || '').trim().replace(/\/+$/, '');
    const payload = {
      connection_id: faxConnectionId,
      from: fromNumber,
      to: to_number,
      media_url: file_url,
      quality: 'high',
    };
    if (functionsBaseUrl) payload.webhook_url = `${functionsBaseUrl}/handleTelnyxStatusWebhook`;

    let telnyxResponse;
    try {
      telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      await base44.entities.FaxLog.update(faxLog.id, {
        status: 'failed',
        failure_reason: `Network error reaching Telnyx: ${netErr.message}`,
      }).catch(() => {});
      return Response.json({ error: 'Failed to reach fax provider' }, { status: 502 });
    }

    const telnyxData = await telnyxResponse.json().catch(() => ({}));

    if (!telnyxResponse.ok) {
      const firstErr = Array.isArray(telnyxData?.errors) ? telnyxData.errors[0] : null;
      // Log provider detail server-side; never echo it (recipient number / URL is PHI).
      console.error('Telnyx fax send error', { status: telnyxResponse.status, code: firstErr?.code, log_id: faxLog.id });
      await base44.entities.FaxLog.update(faxLog.id, {
        status: 'failed',
        failure_reason: firstErr?.detail || firstErr?.title || 'Fax send failed',
      });
      return Response.json({ error: 'Fax provider rejected the request', log_id: faxLog.id }, { status: telnyxResponse.status });
    }

    const faxId = telnyxData?.data?.id || null;
    await base44.entities.FaxLog.update(faxLog.id, { telnyx_fax_id: faxId, status: 'sending' });

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'fax_sent',
      details: {
        provider: 'telnyx',
        to_number,
        from_number: fromNumber,
        fax_sid: faxId,
        log_id: faxLog.id,
        timestamp: new Date().toISOString(),
      },
      page: 'fax',
      user_agent: req.headers.get('user-agent') || 'unknown',
    }).catch(() => {});

    return Response.json({
      success: true,
      fax_sid: faxId,
      log_id: faxLog.id,
      status: telnyxData?.data?.status || 'sending',
      message: 'Fax sent successfully',
    });
  } catch (error) {
    console.error('sendTelnyxFax error:', error?.message);
    return Response.json({ error: 'Failed to send fax' }, { status: 500 });
  }
});