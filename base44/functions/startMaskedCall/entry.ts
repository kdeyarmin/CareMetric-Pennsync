import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
 * startMaskedCall — outbound click-to-call masking (nurse -> patient) via the
 * Telnyx Call Control API.
 *
 * Flow: ring the nurse's personal cell first (`to` = cell, caller id = work
 * number), with answering-machine detection. The patient leg is bridged only
 * once Telnyx's `call.machine.detection.ended` says a person (or not_sure)
 * answered: handleTelnyxStatusWebhook reads the encoded `client_state` and issues
 * a Call Control `transfer` to the patient presenting the WORK number as caller
 * id, so the patient never sees the cell. A `machine` verdict — the nurse's own
 * voicemail picked up — hangs up instead, so a patient is never transferred into
 * a nurse's personal voicemail.
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

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

// <<<BEGIN SHARED HELPER: patientCareTeamAccess — generated, edit base44/_shared/backendHelpers.mjs>>>
async function callerMayAccessPatient(base44, user, patient) {
  if (!user || !patient || typeof patient !== 'object') return false;
  if (user.role === 'admin') return true;
  const claims = await withTrustedClaims(base44, user);
  const agencyId = claims && claimIdentifier(claims.agency_id) ? claims.agency_id : null;
  if (!agencyId || patient.agency_id !== agencyId || !claimIdentifier(patient.id)) return false;
  if (claims.account_type === 'agency_admin' || claims.is_manager === true) return true;
  if (claimIdentifier(patient.created_by_user_id) && patient.created_by_user_id === user.id) return true;
  try {
    const rows = await base44.asServiceRole.entities.PatientCareTeamAssignment.filter(
      { agency_id: agencyId, patient_id: patient.id, user_id: user.id, status: 'active' },
      undefined,
      2,
    );
    return Array.isArray(rows) && rows.some((row) => row && row.agency_id === agencyId
      && row.patient_id === patient.id && row.user_id === user.id && row.status === 'active');
  } catch {
    return false;
  }
}
// <<<END SHARED HELPER: patientCareTeamAccess>>>

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

/**
 * The presented caller id must be an active, service-owned
 * TelecomDestinationBinding of the current Telnyx credential. The caller's
 * work number only names which one; the binding says which agency owns it.
 */
async function resolveCallerLineBinding(base44, telnyxCreds, workNumber) {
  const secretId = telnyxCreds?.record?.id;
  if (typeof secretId !== 'string' || !secretId || telnyxCreds?.record?.provider !== 'telnyx'
    || telnyxCreds?.record?.is_active !== true || !workNumber) return null;
  let rows;
  try {
    rows = await base44.asServiceRole.entities.TelecomDestinationBinding.filter({
      provider: 'telnyx',
      integration_secret_id: secretId,
      destination_e164: workNumber,
      status: 'active',
    }, undefined, 2);
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  if (row?.provider !== 'telnyx' || row.integration_secret_id !== secretId
    || row.destination_e164 !== workNumber || row.status !== 'active'
    || row.binding_key !== `telnyx:${secretId}:${workNumber}`
    || row.revoked_at != null || !claimIdentifier(row.agency_id)) return null;
  return row;
}

async function bindingAgencyName(base44, agencyId) {
  let rows;
  try {
    rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
  } catch {
    rows = [];
  }
  const agency = Array.isArray(rows) && rows.length === 1 && rows[0]?.id === agencyId ? rows[0] : null;
  return typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
}

/*
 * Released to every agency member 2026-10-08 (owner decision). Authority, from
 * protected sources only:
 *   - the caller is the protected platform owner, or a role-'user' account with
 *     one active service-owned AgencyMembership (withTrustedClaims), decided
 *     before the body is read;
 *   - the caller id presented to the patient is the caller's work number only
 *     when it is an active TelecomDestinationBinding in the caller's agency;
 *   - a chart (named or resolved from the number) must be in that agency and
 *     open to the caller under callerMayAccessPatient (built-in admin,
 *     agency_admin/manager, chart creator, or an active care-team assignment);
 *   - both legs (the caller's own cell and the patient) pass the agency's
 *     destination cost controls, with settings from the binding's agency.
 */
Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const caller = await base44.auth.me();
    const user = await withTrustedClaims(base44, caller);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const owner = isProtectedSuperAdmin(user);
    const memberAgencyId = user.role === 'user' && claimIdentifier(user.agency_id) ? user.agency_id : null;
    if (!owner && !memberAgencyId) {
      return Response.json({
        error: 'An active agency membership is required to place calls.',
        code: 'agency_membership_required',
      }, { status: 403 });
    }

    const requestBody = await req.json().catch(() => null);
    if (!requestBody || typeof requestBody !== 'object' || Array.isArray(requestBody)) {
      return Response.json({ error: 'Invalid request body' }, { status: 400 });
    }
    const { patient_id, to_number } = requestBody;
    if (patient_id != null && (typeof patient_id !== 'string' || !claimIdentifier(patient_id))) {
      return Response.json({ error: 'patient_id is invalid' }, { status: 400 });
    }

    const workNumber = normalizeE164(user.work_phone_number);
    const nurseCell = normalizeE164(user.personal_cell_e164);
    if (!workNumber || !nurseCell) {
      return Response.json({ error: 'Your account needs both a work number and a personal cell on file. Ask an admin to provision them.' }, { status: 400 });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, voiceConnectionId } = telnyxCreds;
    if (!apiKey || !voiceConnectionId) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "Voice credentials") }, { status: 500 });
    }
    const line = await resolveCallerLineBinding(base44, telnyxCreds, workNumber);
    if (!line) {
      return Response.json({
        error: 'Calling is unavailable until your work number is an active agency line.',
        code: 'telecom_authority_migration_pending',
      }, { status: 503 });
    }
    if (memberAgencyId && line.agency_id !== memberAgencyId) {
      return Response.json({ error: 'Your work number belongs to a different agency.' }, { status: 403 });
    }
    const agencyId = line.agency_id;

    let destination = normalizeE164(to_number);
    let resolvedPatientId = patient_id || null;
    let resolvedPatient = null;
    // The chart must be in the line's agency and open to the caller; the
    // retired creator-email / assigned_nurses checks are gone.
    const canAccessPatient = async (p) => {
      if (!p?.id || p.agency_id !== agencyId) return false;
      return callerMayAccessPatient(base44, caller, p);
    };

    if (patient_id) {
      const p = await base44.asServiceRole.entities.Patient.filter({ id: patient_id }, undefined, 2).catch(() => []);
      resolvedPatient = Array.isArray(p) && p.length === 1 && p[0]?.id === patient_id ? p[0] : null;
      if (!(await canAccessPatient(resolvedPatient))) {
        return Response.json({ error: 'Forbidden: no access to this patient' }, { status: 403 });
      }
      if (!destination) destination = normalizeE164(resolvedPatient?.phone);
      resolvedPatientId = resolvedPatient.id;
    }
    if (!destination) {
      return Response.json({ error: 'Could not determine a valid patient phone number' }, { status: 400 });
    }
    if (!resolvedPatientId) {
      // A number that belongs to a chart in this agency may be called only by
      // someone that chart is open to.
      for (const v of phoneVariants(destination)) {
        const m = await base44.asServiceRole.entities.Patient
          .filter({ phone: v, agency_id: agencyId }, undefined, 10).catch(() => []);
        const inAgency = (Array.isArray(m) ? m : []).filter((row) => row?.agency_id === agencyId);
        if (inAgency.length > 0) {
          if (!(await canAccessPatient(inAgency[0]))) {
            return Response.json({ error: 'Forbidden: no access to this patient' }, { status: 403 });
          }
          resolvedPatientId = inAgency[0].id;
          resolvedPatient = inAgency[0];
          break;
        }
      }
    }

    // Cost control: block premium/blocked/international destinations by default,
    // for the patient leg and for the caller's own cell leg alike.
    const agencySettings = await resolveAgencySettings(base44, await bindingAgencyName(base44, agencyId));
    const destAllowed = isAllowedDestination(destination, agencySettings || {});
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }
    const cellAllowed = isAllowedDestination(nurseCell, agencySettings || {});
    if (!cellAllowed.allowed) {
      return Response.json({ error: `Your personal cell cannot be dialed: ${blockedReasonMessage(cellAllowed.reason)}`, reason: cellAllowed.reason }, { status: 403 });
    }

    if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('voice');

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
    // calls it originated; amd tells it to wait for the detection verdict.
    const clientState = encodeClientState({
      t: 'masked_bridge',
      bridge_to: destination,
      caller_id: workNumber,
      call_log_id: callLog.id,
      amd: true,
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
            // Standard detection: one call.machine.detection.ended (human |
            // machine | not_sure) per answer. total_analysis_time_millis bounds
            // the analysis, so the verdict — not_sure when undecided — arrives
            // within five seconds and the nurse is never left on an answered
            // leg waiting for one; the bridge that follows is well inside the
            // app's 30 s first-command timeout. Same configuration as the
            // webhook's ringdown.
            answering_machine_detection: 'detect',
            answering_machine_detection_config: { total_analysis_time_millis: 5000 },
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

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'call_initiated',
      entity_type: 'CallLog',
      entity_id: callLog.id,
      details: {
        provider: 'telnyx',
        direction: 'outbound',
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, call_id: callLog.id, provider_call_id: providerCallId });
  } catch (error) {
    console.error('startTelnyxCall error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
