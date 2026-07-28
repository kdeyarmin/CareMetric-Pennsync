import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Strict E.164 normalization for the OFFICE FAX `from` number (null when it
// can't normalize). The admin-entered office fax may carry formatting
// ("(724) 465-0441"); Telnyx requires E.164 on `from`, so an unnormalizable
// value must fail loudly rather than fail every send at the provider. Mirrors
// sendFax.
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

/**
 * Retry a failed fax transmission
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { fax_log_id } = await req.json();

    if (!fax_log_id) {
      return Response.json({ error: 'fax_log_id required' }, { status: 400 });
    }

    // Fetch the original fax log
    const faxLogs = await base44.entities.FaxLog.filter({ id: fax_log_id }, undefined, 5000);
    if (faxLogs.length === 0) {
      return Response.json({ error: 'FaxLog not found' }, { status: 404 });
    }

    const originalFax = faxLogs[0];

    // Ownership: only the original sender (or an admin) may resend a PHI fax.
    if (originalFax.sent_by && originalFax.sent_by !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Honor the admin-configured retry budget (FaxRetryConfig.max_retries) so a
    // manual retry uses the same limit as the auto-retry cron, instead of a
    // separate hardcoded value. Falls back to 3 when no config row exists.
    const retryCfgRows = await base44.asServiceRole.entities.FaxRetryConfig
      .list('-created_date', 1).catch(() => []);
    const cfgMax = Number(retryCfgRows?.[0]?.max_retries);
    const maxRetries = Number.isFinite(cfgMax) && cfgMax >= 0 ? cfgMax : 3;

    // Check retry limit
    if (originalFax.retry_count >= maxRetries) {
      return Response.json({
        error: `Maximum retries (${maxRetries}) exceeded`,
        success: false
      }, { status: 400 });
    }

    // SSRF guard: re-validate the STORED document URL before handing it back to
    // Telnyx as media_url — a tampered or legacy row must not aim the fax
    // provider at an arbitrary/internal host.
    if (!isSafeFetchUrl(originalFax.document_url)) {
      return Response.json({
        error: 'Invalid or disallowed stored document URL',
        success: false
      }, { status: 400 });
    }

    // Get Telnyx credentials (env, then in-app IntegrationSecret)
    const { apiKey, faxConnectionId } = await resolveTelnyxCreds(base44);
    // Resolve the from-number the same way sendFax does: transmit from the
    // blind outbound line (outbound_fax_number_e164), presented as the office
    // fax machine; legacy fallback to office_fax_number_e164 as the from.
    const settingsRows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
    const officeFaxRaw = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (settingsRows[0]?.outbound_fax_number_e164 || '').toString().trim();
    const officeFax = normalizeFromE164(officeFaxRaw);
    const outboundFax = normalizeFromE164(outboundFaxRaw);
    const fromNumber = outboundFax || officeFax;

    if (!apiKey || !faxConnectionId) {
      return Response.json({
        error: 'Telnyx credentials not configured',
        success: false
      }, { status: 500 });
    }
    if (outboundFaxRaw && !outboundFax) {
      return Response.json({
        error: `Outbound fax number "${outboundFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650441).`,
        success: false
      }, { status: 500 });
    }
    if (!fromNumber) {
      return Response.json({
        error: officeFaxRaw
          ? `Office fax number "${officeFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650444).`
          : 'No outbound fax number configured. Set the outbound fax line (and office fax number) in Agency Settings.',
        success: false
      }, { status: 500 });
    }

    // Claim the fax for retry BEFORE sending so two concurrent retries (e.g. a
    // double-click, or a manual retry racing the cron) can't both fax the PHI and
    // double-charge. Flip failed -> retrying with a token, then re-read; if we
    // don't own the claim, another retry is already in flight. (Telnyx's Fax API
    // has no client idempotency key, so this claim is the double-send guard.)
    const runId = crypto.randomUUID();
    try {
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retrying',
        retry_claimed_by: runId,
        retry_claimed_at: new Date().toISOString(),
      });
    } catch {
      return Response.json({ error: 'Could not claim fax for retry', success: false }, { status: 409 });
    }
    const claimCheck = await base44.entities.FaxLog.filter({ id: fax_log_id }, '-created_date', 1).catch(() => []);
    if (!claimCheck[0] || claimCheck[0].retry_claimed_by !== runId) {
      return Response.json({ error: 'A retry for this fax is already in progress', success: false }, { status: 409 });
    }

    // Release the claim back to a retriable 'failed' state if the send doesn't go
    // through, so a transient error doesn't strand the fax in 'retrying'.
    const releaseClaim = () => base44.entities.FaxLog.update(fax_log_id, {
      status: 'failed',
      retry_claimed_by: null,
    }).catch(() => {});

    const telnyxUrl = `https://api.telnyx.com/v2/faxes`;
    // Include the same DLR webhook sendFax uses so the retried fax reports status.
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
    const retryPayload = {
      connection_id: faxConnectionId,
      from: fromNumber,
      to: originalFax.to_number,
      media_url: originalFax.document_url,
      quality: 'high',
    };
    // Mask the blind line: present the office fax number as the caller-id name.
    const displayName = officeFaxDisplayName(officeFax);
    if (displayName) retryPayload.from_display_name = displayName;
    if (functionsBaseUrl) retryPayload.webhook_url = `${functionsBaseUrl}/handleTelnyxStatusWebhook`;

    // Re-send the fax
    let telnyxResponse;
    try {
      telnyxResponse = await fetch(telnyxUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(retryPayload)
      });
    } catch (sendErr) {
      await releaseClaim();
      throw sendErr;
    }

    if (!telnyxResponse.ok) {
      const errorData = await telnyxResponse.text();
      console.error('Telnyx error:', errorData);
      await releaseClaim();
      return Response.json({
        error: 'Failed to send fax via Telnyx',
        success: false
      }, { status: telnyxResponse.status });
    }

    // Bookkeeping AFTER a successful Telnyx send. If any of these steps throws
    // (json parse, FaxLog.create, the final update), we must NOT fall through to
    // the outer catch and leave the original stranded in 'retrying' with a live
    // claim — that orphans an already-sent fax and blocks future retries. The
    // fax was accepted, so we also must NOT releaseClaim() back to 'failed'
    // (that would re-send and double-fax). Settle the original to 'retried'.
    let faxData;
    let newFaxLog = null;
    try {
      faxData = await telnyxResponse.json();

      // Create new FaxLog record for retry
      newFaxLog = await base44.entities.FaxLog.create({
        from_number: originalFax.from_number,
        to_number: originalFax.to_number,
        to_name: originalFax.to_name,
        document_url: originalFax.document_url,
        document_name: originalFax.document_name + ' (Retry)',
        status: 'queued',
        telnyx_fax_id: faxData?.data?.id,
        pages: originalFax.pages,
        cover_page_details: originalFax.cover_page_details,
        patient_id: originalFax.patient_id,
        sent_by: user.email,
        priority: originalFax.priority,
        retry_count: (originalFax.retry_count || 0) + 1,
        estimated_cost: originalFax.estimated_cost
      });

      // Update original fax to mark it as retried (clears the transient claim).
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retried',
        retry_claimed_by: null,
        failure_reason: `Retry attempt #${(originalFax.retry_count || 0) + 1} initiated`
      });
    } catch (postErr) {
      console.error('retryFailedFax post-send bookkeeping failed:', postErr);
      // Settle the claim so the already-sent fax isn't orphaned in 'retrying'.
      await base44.entities.FaxLog.update(fax_log_id, {
        status: 'retried',
        retry_claimed_by: null,
        failure_reason: 'Retry was sent to Telnyx, but follow-up logging failed.'
      }).catch(() => {});
      return Response.json({
        success: true,
        fax_id: faxData?.data?.id,
        twilio_fax_id: faxData?.data?.id, // deprecated alias, kept for back-compat
        warning: 'Fax retry was sent, but recording the new log entry failed.'
      });
    }

    return Response.json({
      success: true,
      new_fax_log_id: newFaxLog.id,
      fax_id: faxData?.data?.id,
      twilio_fax_id: faxData?.data?.id, // deprecated alias, kept for back-compat
      retry_count: (originalFax.retry_count || 0) + 1,
      message: `Fax retry #${(originalFax.retry_count || 0) + 1} queued for ${originalFax.to_number}`
    });
  } catch (error) {
    console.error('Retry fax error:', error);
    return Response.json({
      error: 'Failed to retry fax',
      success: false
    }, { status: 500 });
  }
});