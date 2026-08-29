import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

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


// Strict E.164 normalization for the OFFICE FAX `from` number (null when it
// can't normalize). The admin-entered office fax may carry formatting
// ("(724) 465-0441"); Telnyx requires E.164 on `from`, so an unnormalizable
// value must fail loudly rather than fail every send at the provider. Mirrors
// sendFax.
function normalizeFromE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  // Already-+ international is decided FIRST and never falls through to the NANP
  // branches. A 10-digit international number ("+49 89 123456") was otherwise
  // rewritten as an unrelated "+1..." US subscriber, which also slipped past the
  // +1-only international cost control. Mirrors src/components/voice/phoneUtils.js.
  if (String(raw).trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
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


/**
 * Retry a failed fax transmission
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

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

    // Ownership: only the original sender (or an admin-tier user) may resend a PHI fax.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    // Fail closed: a non-admin caller must be the KNOWN sender. FaxLog has no
    // RLS and sent_by is not required, so a legacy/empty sent_by row must not be
    // retryable by any authenticated user — the old `sent_by && …` guard
    // short-circuited to "allowed" whenever sent_by was blank.
    const isOwner = !!originalFax.sent_by && originalFax.sent_by === user.email;
    if (!isOwner && !isPlatformAdmin && !isAgencyScopedAdmin) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    // Agency-scoped admins may only retry faxes sent by staff in their agency.
    if (isAgencyScopedAdmin && originalFax.sent_by !== user.email) {
      if (!user.agency_name || !originalFax.sent_by) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const senders = await base44.asServiceRole.entities.User
        .filter({ email: originalFax.sent_by }, undefined, 5)
        .catch(() => []);
      if (!senders?.[0] || senders[0].agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // Only a FAILED fax may be retried. Without this, a stale UI (or a direct
    // call) can re-fax a document that is queued/in-flight/delivered — a
    // duplicate PHI transmission the claim token below does not prevent (it
    // only guards CONCURRENT retries, not retries of non-failed faxes).
    if (originalFax.status !== 'failed') {
      return Response.json({
        error: `Only failed faxes can be retried (current status: ${originalFax.status || 'unknown'})`,
        success: false
      }, { status: 409 });
    }

    // Honor the admin-configured retry budget (FaxRetryConfig.max_retries) so a
    // manual retry uses the same limit as the auto-retry cron, instead of a
    // separate hardcoded value. Resolve by sender agency — never global newest.
    let senderAgency = user.agency_name || '';
    if (originalFax.sent_by) {
      const [sender] = await base44.asServiceRole.entities.User
        .filter({ email: originalFax.sent_by }, undefined, 1).catch(() => []);
      if (sender?.agency_name) senderAgency = sender.agency_name;
    }
    const retryCfg = (await resolveFaxRetryConfig(base44, senderAgency)) || {};
    // An UNSET max_retries must mean "use the default", not zero: Number(null)
    // and Number('') are both 0, so a config row saved without touching the
    // field would have rejected every manual retry with "Maximum retries (0)
    // exceeded". Only an explicit 0 blocks. Matches faxRetryConfig in
    // src/components/fax/faxRetry.js.
    const rawMax = retryCfg.max_retries;
    const cfgMax = rawMax === null || rawMax === undefined
      || (typeof rawMax === 'string' && rawMax.trim() === '')
      ? NaN
      : Number(rawMax);
    const maxRetries = Number.isFinite(cfgMax) && cfgMax >= 0 ? cfgMax : 3;

    // Check retry limit — coerce undefined retry_count to 0 so max_retries: 0
    // actually blocks (undefined >= 0 is false in JS).
    if ((Number(originalFax.retry_count) || 0) >= maxRetries) {
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

    // Get Telnyx credentials from the in-app IntegrationSecret row. The
    // dashboard-env path was retired; see src/lib/telnyxConfig.spec.js.
    const telnyxCreds = await resolveTelnyxCreds(base44);
    const { apiKey, faxConnectionId } = telnyxCreds;
    // Resolve the from-number the same way sendFax does: transmit from the
    // blind outbound line (outbound_fax_number_e164), presented as the office
    // fax machine; legacy fallback to office_fax_number_e164 as the from.
    const agencySettings = await resolveAgencySettings(base44, senderAgency);
    const officeFaxRaw = (agencySettings?.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (agencySettings?.outbound_fax_number_e164 || '').toString().trim();
    const officeFax = normalizeFromE164(officeFaxRaw);
    const outboundFax = normalizeFromE164(outboundFaxRaw);
    const fromNumber = outboundFax || officeFax;

    if (!apiKey || !faxConnectionId) {
      return Response.json({
        error: telnyxCredsMessage(telnyxCreds, "credentials"),
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

    // Re-verify claim ownership immediately before the provider call. The initial
    // claim+re-read still has a TOCTOU window where a second retry can overwrite
    // claimed_by after we passed the first check; abort if we no longer own it.
    const preSendClaim = await base44.entities.FaxLog.filter({ id: fax_log_id }, '-created_date', 1).catch(() => []);
    if (!preSendClaim[0] || preSendClaim[0].retry_claimed_by !== runId) {
      return Response.json({ error: 'A retry for this fax is already in progress', success: false }, { status: 409 });
    }

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