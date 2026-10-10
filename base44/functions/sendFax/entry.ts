import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
// <<<BEGIN SHARED HELPER: outboundDeliveryGate — generated, edit base44/_shared/backendHelpers.mjs>>>
const OUTBOUND_DELIVERY_RELEASE_ENV = 'OUTBOUND_DELIVERY_RELEASE';
const OUTBOUND_DELIVERY_RELEASE_VALUE = 'enabled-v1';
function outboundDeliveryReleased() {
  return Deno.env.get(OUTBOUND_DELIVERY_RELEASE_ENV)
    === OUTBOUND_DELIVERY_RELEASE_VALUE;
}
function outboundDeliveryPausedResponse(channel = 'outbound') {
  return Response.json({
    error: 'Outbound delivery is disabled in this environment.',
    code: 'OUTBOUND_DELIVERY_RELEASE_PAUSED',
    channel,
    retryable: false,
  }, {
    status: 503,
    headers: { 'Cache-Control': 'no-store' },
  });
}
// <<<END SHARED HELPER: outboundDeliveryGate>>>

/**
 * sendFax — outbound fax via the Telnyx Programmable Fax API. Idempotent on a
 * recent identical send, logs to the FaxLog entity (telnyx_fax_id stores the
 * provider fax id), and never echoes PHI-bearing provider detail to the client.
 *
 * Telnyx faxes require a Programmable Fax connection id (the in-app
 * fax_connection_id on IntegrationSecret) and a from number on that connection
 * (the in-app AgencySettings.outbound_fax_number_e164 — the single blind
 * transmission line; office_fax_number_e164 is the office machine recipients
 * are told to reply to).
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

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

// <<<BEGIN SHARED HELPER: faxProviderCorrelation — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/fax/faxProviderCorrelation.js.
const FAX_CLIENT_STATE_VERSION = "pennsync.fax.v1";
const FAX_CLIENT_STATE_KINDS = ["outbound","office_forward"];
function exactFaxCorrelationId(value) {
  if (typeof value !== "string" || !value || value.length > 200
    || value.trim() !== value || value.startsWith("$")) return null;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 32 || code === 127) return null;
  }
  return value;
}
function encodeFaxClientState(kind, id) {
  const exact = exactFaxCorrelationId(id);
  if (!FAX_CLIENT_STATE_KINDS.includes(kind) || !exact) return null;
  const bytes = new TextEncoder().encode(JSON.stringify({ v: FAX_CLIENT_STATE_VERSION, k: kind, id: exact }));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function decodeFaxClientState(value) {
  if (typeof value !== "string" || !value || value.length > 2048) return null;
  let parsed;
  try {
    const binary = atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    parsed = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)
    || parsed.v !== FAX_CLIENT_STATE_VERSION || !FAX_CLIENT_STATE_KINDS.includes(parsed.k)) return null;
  const id = exactFaxCorrelationId(parsed.id);
  return id ? { kind: parsed.k, id } : null;
}
function faxEventProviderId(payload) {
  const faxId = payload && typeof payload === "object" ? payload.fax_id : undefined;
  const legacyId = payload && typeof payload === "object" ? payload.id : undefined;
  if (faxId == null && legacyId == null) return { present: false, id: null };
  if (faxId != null && legacyId != null && faxId !== legacyId) return { present: true, id: null };
  return { present: true, id: exactFaxCorrelationId(faxId != null ? faxId : legacyId) };
}
function faxStatusWebhookUrl(requestUrl, selfName) {
  if (typeof selfName !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(selfName)) return null;
  let url;
  try {
    url = new URL(String(requestUrl));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const segments = url.pathname.replace(/\/+$/, "").split("/");
  if (segments.length < 2 || segments[segments.length - 1] !== selfName) return null;
  segments[segments.length - 1] = "handleTelnyxStatusWebhook";
  return `${url.origin}${segments.join("/")}`;
}
// <<<END SHARED HELPER: faxProviderCorrelation>>>

// <<<BEGIN SHARED HELPER: faxOrigination — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated from src/components/fax/faxOrigination.js.
const FAX_ORIGINATION_UNVERIFIED = "office_fax_number_unverified";
const FAX_ORIGINATION_UNAVAILABLE = "office_fax_verification_unavailable";
function faxOriginationPlan(officeE164, blindE164) {
  const office = typeof officeE164 === "string" && officeE164 ? officeE164 : null;
  const blind = typeof blindE164 === "string" && blindE164 ? blindE164 : null;
  if (!blind) return { from: office, office: null, lookup: false };
  if (!office || office === blind) return { from: blind, office: null, lookup: false };
  return { from: blind, office, lookup: true };
}
function isVerifiedOriginationRecord(body, officeE164) {
  const data = body && typeof body === "object" && !Array.isArray(body) ? body.data : null;
  return !!data && typeof data === "object" && !Array.isArray(data)
    && typeof officeE164 === "string" && !!officeE164
    && data.phone_number === officeE164
    && typeof data.verified_at === "string"
    && Number.isFinite(Date.parse(data.verified_at));
}
const FAX_ORIGINATION_LOOKUP_TIMEOUT_MS = 5000;
const faxOriginationLookups = new WeakMap();
async function resolveFaxOrigination(req, apiKey, officeE164, blindE164) {
  const plan = faxOriginationPlan(officeE164, blindE164);
  if (!plan.lookup) return { from: plan.from, officeVerified: null, warning: null };
  const key = typeof apiKey === 'string' ? apiKey.trim() : '';
  if (!key) return { from: plan.from, officeVerified: false, warning: FAX_ORIGINATION_UNAVAILABLE };
  const cache = req && typeof req === 'object' ? (faxOriginationLookups.get(req) || new Map()) : new Map();
  if (req && typeof req === 'object') faxOriginationLookups.set(req, cache);
  const cacheKey = key + '|' + plan.office;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let result;
  try {
    const response = await fetch(
      'https://api.telnyx.com/v2/verified_numbers/' + encodeURIComponent(plan.office),
      {
        headers: { Authorization: 'Bearer ' + key },
        signal: AbortSignal.timeout(FAX_ORIGINATION_LOOKUP_TIMEOUT_MS),
      },
    );
    const body = response.ok ? await response.json().catch(() => null) : null;
    if (!response.ok) await response.text().catch(() => '');
    if (response.ok && isVerifiedOriginationRecord(body, plan.office)) {
      result = { from: plan.office, officeVerified: true, warning: null };
    } else if (response.ok || response.status === 404) {
      result = { from: plan.from, officeVerified: false, warning: FAX_ORIGINATION_UNVERIFIED };
    } else {
      result = { from: plan.from, officeVerified: false, warning: FAX_ORIGINATION_UNAVAILABLE };
    }
  } catch {
    result = { from: plan.from, officeVerified: false, warning: FAX_ORIGINATION_UNAVAILABLE };
  }
  cache.set(cacheKey, result);
  return result;
}
// <<<END SHARED HELPER: faxOrigination>>>

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
  // Unnormalizable → null, as in sendBatchFax and sendAuthorizedReferralFax. It
  // used to fall back to the raw string, leaving only the destination gate
  // below between a malformed number and the provider.
  return null;
}

// Strict E.164 normalization for the OFFICE FAX `from` number (null when it
// can't normalize, like normalizeFaxDest above). The admin-entered office fax
// may carry formatting ("(724) 465-0441"); Telnyx requires E.164 on `from`, so
// an unnormalizable value must fail loudly rather than fail every send at the
// provider.
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
// blind outbound line.
function officeFaxDisplayName(officeE164) {
  const d = String(officeE164 || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return `Office Fax ${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

// ---- cost controls (mirrors src/components/voice/costControls.js) ----
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
  } catch {
    // Do NOT collapse this into "not configured". A failed read (this invocation
    // path carries no service token, entity 404, 401/403, rate limit, platform
    // blip) is a completely different problem from an unconfigured integration,
    // and reporting them identically is what sent operators chasing a credential
    // they had already entered correctly.
    readError = 'credential_store_unavailable';
    // The catch used to be bare, so an unreadable credential row left no
    // server-side breadcrumb at all — the only signal was a misleading
    // "not configured" reply. Log it; unattended runs have nowhere else to say so.
    console.error('resolveTelnyxCreds: Telnyx credential lookup failed');
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
    return `Could not read Telnyx ${label} — the credential store is temporarily unavailable. This is NOT a missing-key result, so re-entering it will not help. Retry and check the function's credential-store access if it persists.`;
  }
  return `Telnyx ${label} not configured — add the API key in Admin › Telnyx (it is stored on the IntegrationSecret row; TELNYX_* environment variables are not read).`;
}
// <<<END SHARED HELPER: resolveTelnyxCreds>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // The current payload carries only an allowlisted URL, not an immutable
    // DocumentTenantBinding identity. Withhold provider transmission until the
    // fax broker can authorize a service-owned document binding.
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({
        error: 'Fax sending is restricted to the protected platform owner pending document-binding migration',
        code: 'fax_document_authority_migration_pending',
      }, { status: 503 });
    }

    const { file_url, to_number, document_name, to_name, patient_id } = await req.json();
    if (!file_url || !to_number) {
      return Response.json({ error: 'Missing required fields: file_url, to_number' }, { status: 400 });
    }

    // If the client linked a patient_id, verify access so FaxLog rows cannot be
    // attributed to an arbitrary chart.
    let linkedPatientId = patient_id || null;
    if (linkedPatientId) {
      const [claimed] = await base44.asServiceRole.entities.Patient
        .filter({ id: linkedPatientId }, '', 1).catch(() => []);
      if (!claimed) {
        return Response.json({ error: 'Patient not found' }, { status: 404 });
      }
      const isAssigned = Array.isArray(claimed.assigned_nurses)
        && claimed.assigned_nurses.includes(user.email);
      if (!isProtectedSuperAdmin(user) && claimed.created_by !== user.email && !isAssigned) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

    // SSRF guard: file_url becomes Telnyx's media_url, so an arbitrary
    // client-supplied URL would make the fax provider fetch (and transmit) any
    // reachable document. Only app-storage https URLs are allowed.
    if (!isSafeFetchUrl(file_url)) {
      return Response.json({ error: 'Invalid or disallowed file_url' }, { status: 400 });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, faxConnectionId } = telnyxCreds;
    // Outbound faxes are sent FROM the office fax machine's number
    // (office_fax_number_e164, e.g. +17244650444) when Telnyx has it as a
    // Verified Number (resolveFaxOrigination, below), so a receiving machine's
    // redial reaches the office. Until it is verified they TRANSMIT from the
    // single "blind" Telnyx fax line (AgencySettings.outbound_fax_number_e164)
    // and are PRESENTED as the office machine only through the caller-id display
    // name and the cover sheet. Legacy fallback: with no outbound line set, the
    // office number itself is the technical from (pre-split behavior).
    const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
    const officeFaxRaw = (agencySettings?.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (agencySettings?.outbound_fax_number_e164 || '').toString().trim();
    const officeFax = normalizeFromE164(officeFaxRaw);
    const outboundFax = normalizeFromE164(outboundFaxRaw);
    const fromNumber = outboundFax || officeFax;

    // Cost control: block premium/blocked/international fax destinations by default.
    const faxDest = normalizeFaxDest(to_number);
    const destAllowed = isAllowedDestination(faxDest, agencySettings || {});
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }

    if (!apiKey || !faxConnectionId) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "fax credentials") }, { status: 500 });
    }
    if (outboundFaxRaw && !outboundFax) {
      return Response.json({
        error: `Outbound fax number "${outboundFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650441).`,
      }, { status: 500 });
    }
    if (!fromNumber) {
      return Response.json({
        error: officeFaxRaw
          ? `Office fax number "${officeFaxRaw}" is not a valid phone number — re-enter it in Agency Settings (E.164, e.g. +17244650444).`
          : 'No outbound fax number configured. Set the outbound fax line (and office fax number) in Agency Settings.',
      }, { status: 500 });
    }

    if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax');

    // Idempotency: a double-submit would otherwise create a second FaxLog and
    // send + charge the same PHI fax twice. Telnyx Fax has no client idempotency
    // key, so de-dupe on a recent identical (recipient + document + sender) send.
    const recentCutoff = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    const recent = await base44.asServiceRole.entities.FaxLog
      .filter({ to_number: faxDest, document_url: file_url, sent_by: user.email }, '-created_date', 5)
      .catch(() => []);
    const dupe = (recent || []).find((f) => f.created_date && f.created_date >= recentCutoff && f.status !== 'failed');
    if (dupe) {
      return Response.json({ success: true, deduped: true, fax_id: dupe.id, status: dupe.status });
    }

    // The office number when Telnyx has verified it, else exactly fromNumber.
    const origination = await resolveFaxOrigination(req, apiKey, officeFax, outboundFax);
    const sendFrom = origination.from || fromNumber;

    // All caller-controlled inputs and tenant-sensitive patient/destination
    // checks have passed above. Use the service role only for the authorized
    // FaxLog write so entity RLS cannot strand a valid outbound transmission.
    const faxLog = await base44.asServiceRole.entities.FaxLog.create({
      from_number: sendFrom,
      // Store and send the NORMALIZED E.164 destination (what was validated),
      // not the raw user input — Telnyx rejects/misroutes non-E164 numbers and a
      // raw-vs-normalized mismatch weakened the dedupe key. Mirrors sendBatchFax.
      to_number: faxDest,
      to_name: to_name || null,
      document_url: file_url,
      document_name: document_name || 'Fax',
      status: 'queued',
      patient_id: linkedPatientId,
      sent_by: user.email,
    });

    // The status webhook is this function's sibling: derive it from this
    // request's own URL, but only when the request provably reached sendFax by
    // name over https (faxStatusWebhookUrl). Otherwise omit the override and
    // Telnyx uses the Fax Application's webhook_event_url, which the setup
    // runbook points at the same handleTelnyxStatusWebhook function.
    const statusWebhookUrl = faxStatusWebhookUrl(req.url, 'sendFax');
    const payload = {
      connection_id: faxConnectionId,
      from: sendFrom,
      to: faxDest,
      media_url: file_url,
      quality: 'high',
    };
    // Present the office fax number as the caller-id name (masks the blind line
    // when the office number is not verified yet; harmless when it is the from).
    const displayName = officeFaxDisplayName(officeFax);
    if (displayName) payload.from_display_name = displayName;
    if (statusWebhookUrl) payload.webhook_url = statusWebhookUrl;
    // Telnyx echoes client_state on every fax.* webhook for this fax, so the
    // status webhook can name this row even before telnyx_fax_id is persisted
    // below. A sendFax row is a legacy URL row with no tenant or document
    // authority; the webhook acknowledges its events without writing, rather
    // than refusing them and having Telnyx redeliver them for nothing.
    const clientState = encodeFaxClientState('outbound', faxLog.id);
    if (clientState) payload.client_state = clientState;

    let telnyxResponse;
    try {
      telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (netErr) {
      await base44.asServiceRole.entities.FaxLog.update(faxLog.id, {
        status: 'failed',
        failure_reason: `Network error reaching Telnyx: ${netErr.message}`,
      }).catch(() => {});
      return Response.json({ error: 'Failed to reach fax provider' }, { status: 502 });
    }

    const telnyxData = await telnyxResponse.json().catch(() => ({}));

    if (!telnyxResponse.ok) {
      const firstErr = Array.isArray(telnyxData?.errors) ? telnyxData.errors[0] : null;
      // Log provider detail server-side; never echo it (recipient number / URL is PHI).
      console.error('Telnyx fax send error', { status: telnyxResponse.status, code: firstErr?.code });
      await base44.asServiceRole.entities.FaxLog.update(faxLog.id, {
        status: 'failed',
        failure_reason: firstErr?.detail || firstErr?.title || 'Fax send failed',
      });
      return Response.json({ error: 'Fax provider rejected the request', log_id: faxLog.id }, { status: telnyxResponse.status });
    }

    const faxId = telnyxData?.data?.id || null;
    // Telnyx has ACCEPTED the fax (2xx) and charged for it. A throw while writing
    // the telnyx id / status must not surface as "send failed" (the outer catch
    // returns 500) — that both misreports a transmitted PHI fax and strands the
    // row 'queued' with no telnyx_fax_id, which the DLR webhook and pollers can't
    // reconcile. Log and continue to the success response (mirrors sendBatchFax).
    try {
      // Service-role write (like sendBatchFax): persisting the provider id is the
      // only way the DLR webhook / pollers can reconcile this row, so it must not
      // be subject to the caller's RLS on this critical post-charge path.
      await base44.asServiceRole.entities.FaxLog.update(faxLog.id, { telnyx_fax_id: faxId, status: 'sending' });
    } catch (bookkeepErr) {
      // Status-only log (no ids) — keeps retained backend logs identifier-free.
      console.error('sendFax: fax accepted by Telnyx but FaxLog bookkeeping failed:', bookkeepErr?.message);
    }

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'fax_sent',
      details: {
        provider: 'telnyx',
        direction: 'outbound',
      },
      page: 'fax',
      entity_type: 'FaxLog',
      entity_id: faxLog.id,
      status: 'accepted',
      user_agent: req.headers.get('user-agent') || 'unknown',
    }).catch(() => {});

    return Response.json({
      success: true,
      fax_sid: faxId,
      log_id: faxLog.id,
      status: telnyxData?.data?.status || 'sending',
      message: 'Fax sent successfully',
      // Non-PHI: the office number is not (or could not be confirmed as) a
      // Telnyx Verified Number, so this fax went from the blind line.
      ...(origination.warning ? { origination_warning: origination.warning } : {}),
    });
  } catch (error) {
    console.error('sendTelnyxFax error:', error?.message);
    return Response.json({ error: 'Failed to send fax' }, { status: 500 });
  }
});
