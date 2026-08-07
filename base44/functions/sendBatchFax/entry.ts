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
  // Already-+ international is decided FIRST and never falls through to the NANP
  // branches. A 10-digit international number ("+49 89 123456") was otherwise
  // rewritten as an unrelated "+1..." US subscriber, which also slipped past the
  // +1-only international cost control. Mirrors src/components/voice/phoneUtils.js.
  if (String(raw).trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
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

// <<<BEGIN SHARED HELPER: isAllowedDestination — generated, edit base44/_shared/backendHelpers.mjs>>>
// Cost-control destination gate. Single source of truth is the frontend
// src/components/voice/costControls.js — this copy is generated from it verbatim.
const PREMIUM_AREA_CODES = new Set(["900", "976"]);
function isAllowedDestination(e164, settings = {}) {
  const s = settings || {};
  const e = String(e164 || "").trim();
  const isNanp = /^\+1\d{10}$/.test(e);

  if (isNanp) {
    const areaCode = e.slice(2, 5);
    if (PREMIUM_AREA_CODES.has(areaCode)) return { allowed: false, reason: "premium_number_blocked" };
    const blocked = Array.isArray(s.blocked_area_codes) ? s.blocked_area_codes.map((a) => String(a).replace(/[^\d]/g, "")) : [];
    if (blocked.includes(areaCode)) return { allowed: false, reason: "blocked_area_code" };
    return { allowed: true, reason: "allowed" };
  }

  // A +1-prefixed number that isn't exactly 10 NANP digits is malformed, not
  // international — never let the international toggle dial/text a broken US number.
  if (/^\+1/.test(e)) return { allowed: false, reason: "invalid_destination" };

  // Not a +1 NANP number → treat as international.
  if (!/^\+\d{8,15}$/.test(e)) return { allowed: false, reason: "invalid_destination" };
  if (s.allow_international === true) return { allowed: true, reason: "international_allowed" };
  return { allowed: false, reason: "international_blocked" };
}
// <<<END SHARED HELPER: isAllowedDestination>>>

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
    // Interactive callers: refuse deactivated accounts (offboarded sessions
    // otherwise keep writing FaxLog PHI until the cookie dies).
    if (user && user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
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

    // If the client linked a patient_id, verify access so FaxLog rows cannot be
    // attributed to an arbitrary chart (parity with sendFax).
    let linkedPatientId = patient_id || null;
    if (linkedPatientId && user) {
      const [claimed] = await base44.asServiceRole.entities.Patient
        .filter({ id: linkedPatientId }, '', 1).catch(() => []);
      if (!claimed) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      const isSuperAdmin = user.account_type === 'super_admin';
      const isAgencyScopedAdmin =
        user.account_type === 'agency_admin'
        || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
      const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
      const isAssigned = Array.isArray(claimed.assigned_nurses)
        && claimed.assigned_nurses.includes(user.email);
      if (!isPlatformAdmin && !isAgencyScopedAdmin && claimed.created_by !== user.email && !isAssigned) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (isAgencyScopedAdmin) {
        if (!user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        const agencyUsers = await base44.asServiceRole.entities.User
          .list('-created_date', 5000).catch(() => []);
        const agencyEmails = new Set(
          (agencyUsers || [])
            .filter((u) => u.agency_name === user.agency_name && u.email)
            .map((u) => u.email),
        );
        const inAgency = (claimed.created_by && agencyEmails.has(claimed.created_by))
          || (Array.isArray(claimed.assigned_nurses)
            && claimed.assigned_nurses.some((e) => agencyEmails.has(e)));
        if (!inAgency) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    } else if (linkedPatientId && !user) {
      // Internal/scheduler path: keep the id but do not invent access for a
      // caller-supplied chart without a session — clear it.
      linkedPatientId = null;
    }

    // SSRF guard: file_url becomes Telnyx's media_url for every recipient, so an
    // arbitrary client-supplied URL would make the fax provider fetch (and
    // transmit) any reachable document. Only app-storage https URLs are allowed.
    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, faxConnectionId } = telnyxCreds;
    // Resolve the shared office fax number server-side (AgencySettings, else env),
    // identical to sendFax — never trust a caller-supplied from_number.
    // Resolve fax settings from the attributed sender (session user, or
    // ScheduledFax creator via body.sent_by for internal cron invokes).
    let senderAgency = user?.agency_name || '';
    if (!senderAgency && senderEmail && senderEmail !== 'scheduler@system') {
      const [sender] = await base44.asServiceRole.entities.User
        .filter({ email: senderEmail }, undefined, 1).catch(() => []);
      senderAgency = sender?.agency_name || '';
    }
    const agencySettings = (await resolveAgencySettings(base44, senderAgency)) || {};
    // Transmit from the single blind outbound line; present the office fax
    // machine's number (display name + cover sheet) so replies go straight to
    // the office. Legacy fallback: office number as the technical from.
    const officeFaxRaw = (agencySettings.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (agencySettings.outbound_fax_number_e164 || '').toString().trim();
    const officeFax = normalizeFromE164(officeFaxRaw);
    const outboundFax = normalizeFromE164(outboundFaxRaw);
    const telnyxFromNumber = outboundFax || officeFax;

    if (!apiKey || !faxConnectionId) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "credentials") }, { status: 500 });
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
          patient_id: linkedPatientId,
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

        // Bookkeeping uses the service role (matching the create above): the
        // scheduled-fax cron invokes this function with NO user session, so a
        // user-scoped update would be rejected by RLS AFTER Telnyx already
        // accepted the fax — reporting a transmitted PHI fax as failed and
        // stranding the row 'queued' with no telnyx_fax_id (unreconcilable by
        // the DLR webhook and both pollers). A bookkeeping failure after a 2xx
        // must also not be reported as a send failure, so it's caught here.
        if (telnyxResponse.ok) {
          try {
            await base44.asServiceRole.entities.FaxLog.update(faxLog.id, {
              telnyx_fax_id: telnyxData?.data?.id,
              status: 'sending'
            });
          } catch (postErr) {
            console.error('sendBatchFax post-send bookkeeping failed:', postErr);
          }
          results.push({ to_number, success: true, fax_id: telnyxData?.data?.id });
        } else {
          const failureReason = telnyxData?.errors?.[0]?.detail || telnyxData?.errors?.[0]?.title || 'Failed to send';
          await base44.asServiceRole.entities.FaxLog.update(faxLog.id, {
            status: 'failed',
            failure_reason: failureReason
          }).catch((err) => console.error('sendBatchFax failure bookkeeping failed:', err));
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