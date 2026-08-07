import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * startMaskedCall — outbound click-to-call masking (nurse -> patient) via the
 * Telnyx Call Control API.
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

function phoneVariants(value) {
  const d = (value || '').replace(/[^\d]/g, '');
  const ten = d.slice(-10);
  if (ten.length !== 10) return value ? [value] : [];
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  const variants = [value, `+1${ten}`, `1${ten}`, ten, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

// ---- cost controls (mirrors src/components/voice/costControls.js) ----
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

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
    case 'invalid_destination': return "That doesn't look like a valid phone number.";
    default: return "That destination isn't allowed.";
  }
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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id, to_number } = await req.json();

    const workNumber = user.work_phone_number;
    const nurseCell = user.personal_cell_e164;
    if (!workNumber || !nurseCell) {
      return Response.json({ error: 'Your account needs both a work number and a personal cell on file. Ask an admin to provision them.' }, { status: 400 });
    }

    let destination = normalizeE164(to_number);
    let resolvedPatientId = patient_id || null;
    let resolvedPatient = null;
    // Platform-wide: super_admin or role:admin without agency. Facility admins
    // with an agency are scoped like agency_admin (parity with updateScopedPatientAlert).
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    let agencyEmailSet = null;
    const loadAgencyEmails = async () => {
      if (agencyEmailSet) return agencyEmailSet;
      if (!isAgencyScopedAdmin) return null;
      if (!user.agency_name) {
        agencyEmailSet = new Set();
        return agencyEmailSet;
      }
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000)
        .catch(() => []);
      agencyEmailSet = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      return agencyEmailSet;
    };
    const canAccessPatient = async (p) => {
      if (!p) return false;
      if (isPlatformAdmin) return true;
      if (isAgencyScopedAdmin) {
        const emails = await loadAgencyEmails();
        if (!emails || emails.size === 0) return false;
        if (p.created_by && emails.has(p.created_by)) return true;
        return Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => emails.has(e));
      }
      if (p.created_by === user.email) return true;
      return Array.isArray(p.assigned_nurses) && p.assigned_nurses.includes(user.email);
    };

    if (!destination && patient_id) {
      const p = await base44.asServiceRole.entities.Patient.filter({ id: patient_id }, undefined, 5000).catch(() => []);
      resolvedPatient = p[0] || null;
      if (!(await canAccessPatient(resolvedPatient))) {
        return Response.json({ error: 'Forbidden: no access to this patient' }, { status: 403 });
      }
      destination = normalizeE164(resolvedPatient?.phone);
      resolvedPatientId = resolvedPatient?.id || null;
    }
    if (!destination) {
      return Response.json({ error: 'Could not determine a valid patient phone number' }, { status: 400 });
    }
    if (!resolvedPatientId) {
      for (const v of phoneVariants(destination)) {
        const m = await base44.asServiceRole.entities.Patient.filter({ phone: v }, undefined, 5000).catch(() => []);
        if (m.length > 0) {
          if (!(await canAccessPatient(m[0]))) {
            return Response.json({ error: 'Forbidden: no access to this patient' }, { status: 403 });
          }
          resolvedPatientId = m[0].id;
          resolvedPatient = m[0];
          break;
        }
      }
    } else if (!resolvedPatient) {
      // Client passed patient_id + to_number — still verify access to the named patient.
      const p = await base44.asServiceRole.entities.Patient.filter({ id: resolvedPatientId }, undefined, 1).catch(() => []);
      if (!(await canAccessPatient(p[0]))) {
        return Response.json({ error: 'Forbidden: no access to this patient' }, { status: 403 });
      }
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, voiceConnectionId } = telnyxCreds;
    if (!apiKey || !voiceConnectionId) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "Voice credentials") }, { status: 500 });
    }

    // Cost control: block premium/blocked/international destinations by default.
    const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
    const destAllowed = isAllowedDestination(destination, agencySettings || {});
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
    // Derive the functions base from this request's own URL — every backend
    // function (including handleTelnyxStatusWebhook) is served from the same
    // base, so the status-webhook peer is one path segment over. Replaces the
    // retired FUNCTIONS_BASE_URL secret; non-https (local dev) derives nothing.
    const functionsBase = (() => {
      try {
        const u = new URL(req.url);
        return u.protocol === 'https:' ? (u.origin + u.pathname).replace(/\/+$/, '').replace(/\/[^/]+$/, '') : '';
      } catch { return ''; }
    })();

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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});