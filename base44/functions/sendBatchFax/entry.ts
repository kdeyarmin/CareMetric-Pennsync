import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Resolve Telnyx credentials from the in-app IntegrationSecret row with
 * provider 'telnyx'.
 */
// Largest batch accepted in a single call — bounds fan-out/cost per request.
const MAX_BATCH_RECIPIENTS = 50;

// <<<BEGIN SHARED HELPER: isSafeFetchUrl — generated, edit base44/_shared/backendHelpers.mjs>>>
// SSRF guard: only fetch https URLs on the app's own storage/app hosts, never
// internal IPs / metadata. The allowlist is hardcoded (always-on, fail-closed)
// rather than env-configured; add a host here if file storage ever moves.
const FILE_URL_ALLOWED_HOSTS = ['qtrypzzcjebvfcihiynt.supabase.co', 'base44.app', 'base44.io'];
function isSafeFetchUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (['localhost', '0.0.0.0', '127.0.0.1', '::1', '169.254.169.254'].includes(host)) return false;
  if (host.endsWith('.internal') || host.endsWith('.local')) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = +m[1], b = +m[2];
    if (a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false;
  }
  if (!FILE_URL_ALLOWED_HOSTS.some((h) => host === h || host.endsWith('.' + h))) return false;
  return true;
}
// <<<END SHARED HELPER: isSafeFetchUrl>>>

// ---- destination normalization + cost controls (mirrors sendFax) ----
function normalizeFaxDest(raw) {
  if (!raw) return '';
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return String(raw).trim();
}
// Strict E.164 normalization for the OFFICE FAX `from` number (null when it
// can't normalize — unlike normalizeFaxDest, which falls back to the raw
// string). The admin-entered office fax may carry formatting ("(724) 465-0441");
// Telnyx requires E.164 on `from`, so an unnormalizable value must fail loudly
// rather than fail every send at the provider. Mirrors sendFax.
function normalizeFromE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

// Fax caller-id display name shown to the receiving machine (Telnyx
// from_display_name allows only letters, numbers, spaces and -_~!.+): presents
// the OFFICE fax number so recipients dial the office machine back, not the
// blind outbound line. Mirrors sendFax.
function officeFaxDisplayName(officeE164) {
  const d = String(officeE164 || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return `Office Fax ${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

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

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function isInternalInvoke(body) {
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expected) return false;
  return timingSafeEqualStr(String(body?.internal_secret || '').trim(), expected);
}

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    // NOTE: from_number is intentionally NOT read from the body. Every fax goes
    // out from the single shared office number (resolved server-side below) so a
    // caller can't spoof the agency's caller-ID or misroute reply/DLR traffic.
    const body = await req.json();
    const internalOk = isInternalInvoke(body);
    if (!user && !internalOk) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { file_url, to_numbers, document_name, patient_id, cover_page_details, priority, from_name, sent_by: bodySentBy } = body;
    // Scheduled-fax cron has no session; attribute FaxLog.sent_by to the
    // ScheduledFax creator (or a stable system marker) so DLR notifications still route.
    const senderEmail = user?.email || (typeof bodySentBy === 'string' && bodySentBy.trim() ? bodySentBy.trim() : 'scheduler@system');

    const normalizedRecipients = Array.isArray(to_numbers)
      ? to_numbers.map((num) => typeof num === 'string' ? num.trim() : '').filter(Boolean)
      : [];

    if (!file_url || normalizedRecipients.length === 0) {
      return Response.json({
        error: 'Missing required fields: file_url, to_numbers'
      }, { status: 400 });
    }

    if (normalizedRecipients.length > MAX_BATCH_RECIPIENTS) {
      return Response.json({
        error: `Too many recipients: ${normalizedRecipients.length} (max ${MAX_BATCH_RECIPIENTS} per batch).`
      }, { status: 400 });
    }

    // SSRF guard: file_url becomes Telnyx's media_url for every recipient, so an
    // arbitrary client-supplied URL would make the fax provider fetch (and
    // transmit) any reachable document. Only app-storage https URLs are allowed.
    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Resolve the shared office fax number server-side (AgencySettings, else env),
    // identical to sendFax — never trust a caller-supplied from_number.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const agencySettings = settingsRows[0] || {};
    // Transmit from the single blind outbound line; present the office fax
    // machine's number (display name + cover sheet) so replies go straight to
    // the office. Legacy fallback: office number as the technical from.
    const officeFaxRaw = (agencySettings.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (agencySettings.outbound_fax_number_e164 || '').toString().trim();
    const officeFax = normalizeFromE164(officeFaxRaw);
    const outboundFax = normalizeFromE164(outboundFaxRaw);
    const telnyxFromNumber = outboundFax || officeFax;

    if (!apiKey || !faxConnectionId) {
      return Response.json({ error: 'Telnyx credentials not configured' }, { status: 500 });
    }
    if (outboundFaxRaw && !outboundFax) {
      return Response.json({
        error: `Outbound fax number "${outboundFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650441).`,
      }, { status: 500 });
    }
    if (!telnyxFromNumber) {
      return Response.json({
        error: officeFaxRaw
          ? `Office fax number "${officeFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650444).`
          : 'No outbound fax number configured. Set the outbound fax line (and office fax number) in Agency Settings.',
      }, { status: 500 });
    }
    const faxFromDisplayName = officeFaxDisplayName(officeFax);

    // AI Priority Analysis (uses the resolved office number, not a spoofable one).
    let finalPriority = priority || 'normal';
    if (!priority) {
      try {
        const analysisResult = await base44.functions.invoke('analyzeFaxPriority', {
          document_name,
          cover_page_details,
          to_number: normalizedRecipients[0],
          from_number: telnyxFromNumber,
          from_name
        });
        finalPriority = analysisResult.data.priority || 'normal';
      } catch (error) {
        console.error('Priority analysis failed:', error);
      }
    }

    // FaxLog.priority only accepts urgent/normal/low, but the input param and
    // analyzeFaxPriority can yield 'high' (and other) values that Base44 would
    // silently drop on the FaxLog.create below. Normalize to a valid enum member.
    const FAXLOG_PRIORITY = { urgent: 'urgent', high: 'urgent', normal: 'normal', medium: 'normal', low: 'low' };
    finalPriority = FAXLOG_PRIORITY[String(finalPriority).toLowerCase()] || 'normal';

    const results = [];
    const estimatedCostPerPage = 10;
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();

    for (const rawTo of normalizedRecipients) {
      try {
        // Cost control: block premium/blocked/international destinations by default.
        const to_number = normalizeFaxDest(rawTo);
        const destAllowed = isAllowedDestination(to_number, agencySettings);
        if (!destAllowed.allowed) {
          results.push({ to_number: rawTo, success: false, error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason });
          continue;
        }

        // Idempotency: skip a recent identical (recipient + document + sender) send
        // so a double-submit doesn't fax + charge the same PHI document twice.
        const recent = await base44.asServiceRole.entities.FaxLog
          .filter({ to_number, document_url: file_url, sent_by: senderEmail }, '-created_date', 5)
          .catch(() => []);
        const dupe = (recent || []).find((f) => f.created_date && f.created_date >= recentCutoff && f.status !== 'failed');
        if (dupe) {
          results.push({ to_number, success: true, deduped: true, fax_id: dupe.id });
          continue;
        }

        const faxLog = await base44.asServiceRole.entities.FaxLog.create({
          from_number: telnyxFromNumber,
          to_number,
          document_url: file_url,
          document_name: document_name || 'Batch Fax',
          status: 'queued',
          patient_id: patient_id || null,
          sent_by: senderEmail,
          cover_page_details: cover_page_details || null,
          priority: finalPriority,
          estimated_cost: estimatedCostPerPage
        });

        // Attach the delivery-status webhook so scheduled/batch faxes get real-time
        // DLR callbacks into handleTelnyxStatusWebhook, exactly like sendFax /
        // retryFailedFax. Without it, every scheduled fax stays 'sending' until a
        // polling reconciler happens to catch it (or forever, if polling is off).
        // Derive the functions base from this request's own URL — every backend
        // function (including handleTelnyxStatusWebhook) is served from the same
        // base, so the status-webhook peer is one path segment over. Replaces the
        // retired FUNCTIONS_BASE_URL secret; non-https (local dev) derives nothing.
        const functionsBaseUrl = (() => {
          try {
            const u = new URL(req.url);
            return u.protocol === 'https:' ? (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/[^/]+$/, '') : '';
          } catch { return ''; }
        })();
        const telnyxPayload = {
          connection_id: faxConnectionId,
          from: telnyxFromNumber,
          to: to_number,
          media_url: file_url,
          quality: 'high'
        };
        // Mask the blind line: present the office fax number as the caller-id name.
        if (faxFromDisplayName) telnyxPayload.from_display_name = faxFromDisplayName;
        if (functionsBaseUrl) telnyxPayload.webhook_url = `${functionsBaseUrl}/handleTelnyxStatusWebhook`;

        const telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(telnyxPayload)
        });

        const telnyxData = await telnyxResponse.json().catch(() => ({}));

        if (telnyxResponse.ok) {
          await base44.entities.FaxLog.update(faxLog.id, {
            telnyx_fax_id: telnyxData?.data?.id,
            status: 'sending'
          });
          results.push({ to_number, success: true, fax_id: telnyxData?.data?.id });
        } else {
          const failureReason = telnyxData?.errors?.[0]?.detail || telnyxData?.errors?.[0]?.title || 'Failed to send';
          await base44.entities.FaxLog.update(faxLog.id, {
            status: 'failed',
            failure_reason: failureReason
          });
          results.push({ to_number, success: false, error: failureReason });
        }
      } catch (error) {
        results.push({ to_number: rawTo, success: false, error: error.message });
      }
    }

    const successCount = results.filter(r => r.success).length;

    return Response.json({
      success: true,
      message: `Sent ${successCount}/${normalizedRecipients.length} faxes`,
      results,
      total: normalizedRecipients.length,
      successful: successCount,
      failed: normalizedRecipients.length - successCount
    });

  } catch (error) {
    console.error('sendBatchFax failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});