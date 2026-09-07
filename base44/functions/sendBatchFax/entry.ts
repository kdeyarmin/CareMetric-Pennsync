import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
  return null;
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

async function faxCapabilityMac(secret: string, capability: Record<string, any>) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const payload = JSON.stringify([
    capability.version, capability.action, capability.resource_id, capability.claim_id,
    capability.issued_at, capability.expires_at, capability.nonce,
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign(
    'HMAC', key, new TextEncoder().encode(payload),
  ));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function verifyFaxInternalCapability(
  value: unknown,
  action: string,
  resourceId: string,
  claimId: string,
) {
  if (!plainObject(value)
    || Object.keys(value).some((key) => ![
      'version', 'action', 'resource_id', 'claim_id', 'issued_at', 'expires_at', 'nonce', 'mac',
    ].includes(key))
    || value.version !== 1 || value.action !== action
    || value.resource_id !== resourceId || value.claim_id !== claimId
    || !exactIdentifier(value.nonce) || !Number.isSafeInteger(value.issued_at)
    || !Number.isSafeInteger(value.expires_at) || !/^[a-f0-9]{64}$/.test(String(value.mac || ''))) {
    return false;
  }
  const now = Date.now();
  if (value.issued_at > now + 5_000 || value.expires_at < now
    || value.expires_at <= value.issued_at || value.expires_at - value.issued_at > 300_000) return false;
  const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (secret.length < 32) return false;
  const expected = await faxCapabilityMac(secret, value);
  return timingSafeEqualStr(String(value.mac), expected);
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

const BATCH_BODY_BYTES = 50_000;
const BATCH_EXACT_LIMIT = 10;
const BATCH_MEMBERSHIP_LIMIT = 100;
const BATCH_SIGNED_URL_TTL_SECONDS = 15 * 60;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const FAX_TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const AGENCY_WIDE_FAX_ROLES = new Set(['agency_admin', 'manager']);
const REFERRAL_FAX_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

class PublicError extends Error {
  status: number;
  code: string;
  dispatchStarted: boolean;

  constructor(status: number, message: string, code = 'fax_batch_rejected', dispatchStarted = false) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
    this.dispatchStarted = dispatchStarted;
  }
}

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 200 || value.trim() !== value
    || value.startsWith('$') || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  return email && email.includes('@') && !/\s/.test(email) ? email : null;
}

function boundedLabel(value: unknown, max = 300) {
  if (value == null) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text.length <= max && !/[\u0000-\u001f\u007f]/.test(text) ? text : null;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  if (!reason || reason.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(reason)) {
    return null;
  }
  return reason;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactPrivateFileUri(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value
    || /[\u0000-\u0020\u007f]/.test(value)) return null;
  return value.startsWith('private/') || value.startsWith('private://') ? value : null;
}

function exactHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.toString() : null;
  } catch { return null; }
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (plainObject(value)) {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function transitionRequestKey(key: string, requestId: string) {
  return `${key}:${requestId}`;
}

function assignmentLifecycleIsCoherent(row: Record<string, any>, status: string, action: string) {
  if (action === 'grant') {
    return status === 'active'
      && row.version === 1
      && row.activated_at === row.last_transition_at
      && row.suspended_at == null;
  }
  if (action === 'activate') {
    return status === 'active'
      && row.version >= 3
      && row.version % 2 === 1
      && validInstant(row.suspended_at)
      && row.activated_at === row.last_transition_at;
  }
  if (action === 'suspend') {
    return status === 'suspended'
      && row.version >= 2
      && row.version % 2 === 0
      && row.suspended_at === row.last_transition_at;
  }
  if (action === 'revoke') {
    return status === 'revoked'
      && row.version >= 2
      && row.revoked_at === row.last_transition_at
      && row.revocation_reason === row.last_transition_reason;
  }
  return false;
}

async function sha256Text(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizePriority(value: unknown) {
  const normalized = String(value || 'normal').toLowerCase();
  if (normalized === 'urgent' || normalized === 'high') return 'urgent';
  if (normalized === 'low') return 'low';
  return 'normal';
}

function normalizeRecipients(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_BATCH_RECIPIENTS) {
    throw new PublicError(400, `to_numbers must contain 1-${MAX_BATCH_RECIPIENTS} destinations`, 'invalid_recipients');
  }
  const recipients = value.map((item) => normalizeFaxDest(item));
  if (recipients.some((item) => !item)) {
    throw new PublicError(400, 'Every fax destination must be a valid phone number', 'invalid_recipients');
  }
  const exact = recipients as string[];
  if (new Set(exact).size !== exact.length) {
    throw new PublicError(400, 'Duplicate fax destinations are not allowed', 'duplicate_recipients');
  }
  return exact;
}

async function parseBatchRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed', 'method_not_allowed');
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > BATCH_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large', 'request_too_large');
  }
  const raw = await req.text().catch(() => '');
  if (!raw || new TextEncoder().encode(raw).byteLength > BATCH_BODY_BYTES) {
    throw new PublicError(raw ? 413 : 400, raw ? 'Request body is too large' : 'Invalid request', raw ? 'request_too_large' : 'invalid_request');
  }
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid request', 'invalid_request'); }
  if (!plainObject(body)) throw new PublicError(400, 'Invalid request', 'invalid_request');
  const action = body.action;
  if (action === 'dispatch_scheduled') {
    if (Object.keys(body).some((key) => !['action', 'scheduled_fax_id', 'dispatch_attempt_id', 'capability'].includes(key))) {
      throw new PublicError(400, 'Invalid scheduled dispatch request', 'invalid_request');
    }
    const scheduledFaxId = exactIdentifier(body.scheduled_fax_id);
    const dispatchAttemptId = exactIdentifier(body.dispatch_attempt_id);
    if (!scheduledFaxId || !dispatchAttemptId || !await verifyFaxInternalCapability(
      body.capability, action, scheduledFaxId, dispatchAttemptId,
    )) {
      throw new PublicError(401, 'Unauthorized scheduled dispatch', 'unauthorized');
    }
    return { action, scheduledFaxId, dispatchAttemptId };
  }
  if (action === 'dispatch_retry') {
    if (Object.keys(body).some((key) => !['action', 'fax_log_id', 'retry_claim_id', 'capability'].includes(key))) {
      throw new PublicError(400, 'Invalid retry dispatch request', 'invalid_request');
    }
    const faxLogId = exactIdentifier(body.fax_log_id);
    const retryClaimId = exactIdentifier(body.retry_claim_id);
    if (!faxLogId || !retryClaimId || !await verifyFaxInternalCapability(
      body.capability, action, faxLogId, retryClaimId,
    )) {
      throw new PublicError(401, 'Unauthorized retry dispatch', 'unauthorized');
    }
    return { action, faxLogId, retryClaimId };
  }
  if (action !== 'send' && action !== 'schedule') {
    throw new PublicError(400, 'action must be send or schedule', 'invalid_request');
  }
  const allowed = new Set([
    'action', 'agency_id', 'document_id', 'to_numbers', 'client_request_id',
    'scheduled_time', 'document_name', 'cover_page_details', 'priority',
  ]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    throw new PublicError(400, 'Request contains unsupported fields', 'invalid_request');
  }
  const agencyId = exactIdentifier(body.agency_id);
  const documentId = exactIdentifier(body.document_id);
  const clientRequestId = exactIdentifier(body.client_request_id);
  const documentName = boundedLabel(body.document_name);
  const recipients = normalizeRecipients(body.to_numbers);
  if (!agencyId || !documentId || !clientRequestId || documentName === null
    || (body.cover_page_details != null && !plainObject(body.cover_page_details))) {
    throw new PublicError(400, 'Fax batch request is invalid', 'invalid_request');
  }
  let scheduledTime: string | null = null;
  if (action === 'schedule') {
    if (!validInstant(body.scheduled_time)) {
      throw new PublicError(400, 'scheduled_time is invalid', 'invalid_schedule_time');
    }
    scheduledTime = new Date(body.scheduled_time).toISOString();
    const timestamp = Date.parse(scheduledTime);
    if (timestamp < Date.now() - 60_000 || timestamp > Date.now() + 366 * 24 * 60 * 60 * 1000) {
      throw new PublicError(400, 'scheduled_time is outside the allowed window', 'invalid_schedule_time');
    }
  } else if (Object.hasOwn(body, 'scheduled_time')) {
    throw new PublicError(400, 'scheduled_time is only valid for schedule', 'invalid_request');
  }
  return {
    action, agencyId, documentId, clientRequestId, recipients, scheduledTime,
    documentName, coverPageDetails: body.cover_page_details || null,
    priority: normalizePriority(body.priority),
  };
}

function validateMembership(row: Record<string, any>, expected: Record<string, any>) {
  const email = canonicalEmail(row?.user_email_normalized);
  if (!exactIdentifier(row?.id) || row.id !== expected.membershipId
    || row.agency_id !== expected.agencyId || row.user_id !== expected.userId
    || row.membership_key !== `${expected.agencyId}:${expected.userId}`
    || !email || row.user_email_normalized !== email || email !== expected.email
    || row.status !== 'active' || !FAX_TENANT_ROLES.has(String(row.tenant_role || ''))
    || !Number.isSafeInteger(row.version) || row.version < 1
    || (expected.membershipVersion != null && row.version !== expected.membershipVersion)
    || (expected.tenantRole && row.tenant_role !== expected.tenantRole)) {
    throw new PublicError(409, 'Fax tenant membership is unavailable', 'fax_authority_unavailable');
  }
  return row;
}

async function loadInteractiveAuthority(base44: Record<string, any>, agencyId: string) {
  const user = await base44.auth.me().catch(() => null);
  const userId = exactIdentifier(user?.id);
  const email = canonicalEmail(user?.email);
  if (!user) throw new PublicError(401, 'Unauthorized', 'unauthorized');
  if (!userId || !email || user.role !== 'user' || user.is_active === false
    || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden', 'forbidden');
  }
  const rows = requireRows(await base44.asServiceRole.entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: userId }, undefined, BATCH_EXACT_LIMIT,
  ), 'AgencyMembership.filter');
  if (rows.length !== 1 || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)) {
    throw new PublicError(409, 'Fax tenant membership is ambiguous', 'fax_authority_unavailable');
  }
  const membershipId = exactIdentifier(rows[0]?.id);
  if (!membershipId) throw new PublicError(409, 'Fax tenant membership is unavailable', 'fax_authority_unavailable');
  const membership = validateMembership(rows[0], { agencyId, userId, email, membershipId });
  return { user, userId, email, agencyId, membershipId, membershipVersion: membership.version, tenantRole: membership.tenant_role };
}

function unwrapFunctionResult(value: unknown) {
  return plainObject(value) && Object.hasOwn(value, 'data') ? value.data : value;
}

async function loadInteractiveDelivery(base44: Record<string, any>, authority: Record<string, any>, documentId: string) {
  const response = await base44.functions.invoke('getAuthorizedDocument', {
    agency_id: authority.agencyId, document_id: documentId, purpose: 'fax',
  });
  const data = unwrapFunctionResult(response);
  const document = plainObject(data) ? data.document : null;
  const scope = plainObject(data) ? data.scope : null;
  const delivery = plainObject(data) ? data.delivery : null;
  const downloadUrl = exactHttpsUrl(delivery?.download_url);
  if (!plainObject(data) || data.success !== true || data.purpose !== 'fax'
    || !plainObject(document) || document.id !== documentId || document.file_type !== 'application/pdf'
    || !Number.isSafeInteger(document.file_size) || document.file_size < 1
    || !plainObject(scope) || scope.agency_id !== authority.agencyId
    || scope.membership_id !== authority.membershipId || scope.membership_version !== authority.membershipVersion
    || scope.tenant_role !== authority.tenantRole || !downloadUrl
    || delivery.expires_in_seconds !== BATCH_SIGNED_URL_TTL_SECONDS) {
    throw new PublicError(409, 'Private document fax authority is unavailable', 'fax_authority_unavailable');
  }
  return { document, scope, downloadUrl };
}

async function loadAgencyConfiguration(entities: Record<string, any>, agencyId: string) {
  const agencies = requireRows(await entities.Agency.filter({ id: agencyId }, undefined, BATCH_EXACT_LIMIT), 'Agency.filter');
  if (agencies.length !== 1 || agencies[0]?.id !== agencyId
    || !ENABLED_AGENCY_STATUSES.has(String(agencies[0]?.status || ''))
    || !exactIdentifier(agencies[0]?.agency_code)) {
    throw new PublicError(409, 'Agency fax configuration is unavailable', 'fax_authority_unavailable');
  }
  const agency = agencies[0];
  const sameCode = requireRows(await entities.Agency.filter(
    { agency_code: agency.agency_code }, undefined, BATCH_EXACT_LIMIT,
  ), 'Agency.filter');
  if (sameCode.length !== 1 || sameCode[0]?.id !== agencyId) {
    throw new PublicError(409, 'Agency fax configuration is ambiguous', 'fax_authority_unavailable');
  }
  const settingsRows = requireRows(await entities.AgencySettings.filter(
    { agency_code: agency.agency_code }, undefined, BATCH_EXACT_LIMIT,
  ), 'AgencySettings.filter');
  if (settingsRows.length !== 1 || settingsRows[0]?.agency_code !== agency.agency_code
    || (settingsRows[0]?.agency_id != null && settingsRows[0].agency_id !== agencyId)
    || !exactIdentifier(settingsRows[0]?.id) || !validInstant(settingsRows[0]?.updated_date)) {
    throw new PublicError(409, 'Agency fax settings are unavailable', 'fax_authority_unavailable');
  }
  const settings = settingsRows[0];
  const officeFax = normalizeFromE164(settings.office_fax_number_e164);
  const outboundFax = normalizeFromE164(settings.outbound_fax_number_e164);
  const fromNumber = outboundFax || officeFax;
  if (!fromNumber) throw new PublicError(500, 'No valid outbound fax number is configured', 'fax_configuration_unavailable');
  return { agency, settings, officeFax, fromNumber };
}

async function loadExactTelnyxCredentials(entities: Record<string, any>) {
  const rows = requireRows(await entities.IntegrationSecret.filter(
    { provider: 'telnyx', is_active: true }, undefined, BATCH_EXACT_LIMIT,
  ), 'IntegrationSecret.filter');
  if (rows.length !== 1 || rows.some((row) => row?.provider !== 'telnyx'
    || row?.is_active !== true || !exactIdentifier(row?.id))) {
    throw new PublicError(500, 'Fax integration is not configured uniquely', 'fax_configuration_unavailable');
  }
  const apiKey = typeof rows[0].api_key === 'string' ? rows[0].api_key.trim() : '';
  const connectionId = exactIdentifier(rows[0].fax_connection_id);
  if (!apiKey || !connectionId || !validInstant(rows[0]?.updated_date)) {
    throw new PublicError(500, 'Fax integration is not configured', 'fax_configuration_unavailable');
  }
  return {
    apiKey,
    connectionId,
    secretId: rows[0].id,
    updatedAt: rows[0].updated_date,
  };
}

async function loadExactOutboundFaxBinding(
  entities: Record<string, any>,
  authority: Record<string, any>,
  credentials: Record<string, any>,
) {
  const rows = requireRows(await entities.TelecomDestinationBinding.filter({
    provider: 'telnyx',
    integration_secret_id: credentials.secretId,
    destination_e164: authority.fromNumber,
    status: 'active',
  }, undefined, BATCH_EXACT_LIMIT), 'TelecomDestinationBinding.filter');
  if (rows.length !== 1) {
    throw new PublicError(409, 'Outbound fax sender binding is unavailable', 'fax_sender_binding_unavailable');
  }
  const row = rows[0];
  const expectedKey = `telnyx:${credentials.secretId}:${authority.fromNumber}`;
  if (!exactIdentifier(row?.id) || row.provider !== 'telnyx'
    || row.integration_secret_id !== credentials.secretId
    || row.destination_e164 !== authority.fromNumber
    || row.binding_key !== expectedKey || row.agency_id !== authority.agencyId
    || row.fax_connection_id !== credentials.connectionId
    || !exactIdentifier(row.provider_number_id) || !exactIdentifier(row.phone_number_id)
    || row.status !== 'active' || !['manual', 'telnyx_purchase', 'legacy_backfill'].includes(row.source)
    || !Number.isSafeInteger(row.version) || row.version < 1
    || !validInstant(row.created_at) || !validInstant(row.activated_at)
    || !validInstant(row.last_transition_at) || row.revoked_at != null
    || row.revocation_reason != null) {
    throw new PublicError(409, 'Outbound fax sender binding is invalid', 'fax_sender_binding_unavailable');
  }
  return row;
}

async function loadBindingSnapshot(entities: Record<string, any>, agencyId: string, documentId: string) {
  const rows = requireRows(await entities.DocumentTenantBinding.filter(
    { agency_id: agencyId, document_id: documentId }, undefined, BATCH_EXACT_LIMIT,
  ), 'DocumentTenantBinding.filter');
  if (rows.length !== 1 || rows.some((row) => row?.agency_id !== agencyId || row?.document_id !== documentId)) {
    throw new PublicError(409, 'Private document binding is unavailable', 'fax_authority_unavailable');
  }
  const binding = rows[0];
  const patientId = binding.patient_id == null ? null : exactIdentifier(binding.patient_id);
  const creatorEmail = canonicalEmail(binding.created_by_user_email_normalized);
  const fileUri = exactPrivateFileUri(binding.file_uri);
  if (!exactIdentifier(binding.id) || binding.version !== 2 || binding.storage_mode !== 'private'
    || !fileUri || binding.file_type !== 'application/pdf'
    || !Number.isSafeInteger(binding.file_size) || binding.file_size < 1
    || !/^[a-f0-9]{64}$/.test(String(binding.content_sha256 || ''))
    || !exactIdentifier(binding.created_by_user_id) || !creatorEmail
    || binding.created_by_user_email_normalized !== creatorEmail
    || binding.document_created_by_email_normalized !== creatorEmail
    || !exactIdentifier(binding.membership_id) || !Number.isSafeInteger(binding.membership_version)
    || binding.membership_version < 1 || !exactIdentifier(binding.client_request_id)
    || !['patient_document', 'referral'].includes(binding.purpose)
    || (binding.patient_id != null && !patientId)
    || (binding.purpose === 'patient_document' && !patientId)
    || !validInstant(binding.created_at) || !validInstant(binding.last_verified_at)) {
    throw new PublicError(409, 'Private document binding is invalid', 'fax_authority_unavailable');
  }
  const expectedBindingKey = await sha256Text(`${agencyId}\u0000${binding.created_by_user_id}\u0000${binding.client_request_id}`);
  if (binding.binding_key !== expectedBindingKey) {
    throw new PublicError(409, 'Private document binding is invalid', 'fax_authority_unavailable');
  }
  const documents = requireRows(await entities.Document.filter({ id: documentId }, undefined, BATCH_EXACT_LIMIT), 'Document.filter');
  const document = documents[0];
  const expectedCategory = binding.purpose === 'referral' ? 'referral' : 'other';
  if (documents.length !== 1 || document?.id !== documentId || document.file_url != null
    || document.title !== binding.file_name || document.file_name !== binding.file_name
    || document.file_type !== binding.file_type || document.file_size !== binding.file_size
    || document.category !== expectedCategory || (document.patient_id ?? null) !== patientId
    || canonicalEmail(document.uploaded_by) !== creatorEmail || document.uploaded_by !== creatorEmail
    || canonicalEmail(document.created_by) !== creatorEmail || document.created_by !== creatorEmail
    || document.document_date !== String(binding.created_at).slice(0, 10)
    || !sameValue(document.tags, [binding.purpose])
    || document.is_sensitive !== true || !validInstant(document.updated_date)) {
    throw new PublicError(409, 'Private document integrity check failed', 'fax_authority_unavailable');
  }
  const bindingMemberships = requireRows(await entities.AgencyMembership.filter(
    { id: binding.membership_id }, undefined, BATCH_EXACT_LIMIT,
  ), 'AgencyMembership.filter');
  if (bindingMemberships.length !== 1 || bindingMemberships[0]?.id !== binding.membership_id
    || bindingMemberships[0]?.agency_id !== agencyId
    || bindingMemberships[0]?.user_id !== binding.created_by_user_id
    || bindingMemberships[0]?.membership_key !== `${agencyId}:${binding.created_by_user_id}`
    || canonicalEmail(bindingMemberships[0]?.user_email_normalized) !== creatorEmail
    || !FAX_TENANT_ROLES.has(String(bindingMemberships[0]?.tenant_role || ''))
    || !['active', 'suspended', 'revoked'].includes(String(bindingMemberships[0]?.status || ''))
    || !Number.isSafeInteger(bindingMemberships[0]?.version)
    || bindingMemberships[0].version < binding.membership_version) {
    throw new PublicError(409, 'Private document binding membership is invalid', 'fax_authority_unavailable');
  }
  return { binding, document, patientId, fileUri, creatorEmail };
}

async function loadExactRetryReferral(entities: Record<string, any>, authority: Record<string, any>) {
  if (!exactIdentifier(authority.referralId) || !REFERRAL_FAX_ROLES.has(authority.tenantRole)) {
    throw new PublicError(409, 'Referral fax authority is unavailable', 'fax_authority_unavailable');
  }
  const rows = requireRows(await entities.Referral.filter({
    id: authority.referralId, agency_id: authority.agencyId,
  }, undefined, BATCH_EXACT_LIMIT), 'Referral.filter');
  if (rows.length !== 1 || rows[0]?.id !== authority.referralId
    || rows[0]?.agency_id !== authority.agencyId || rows[0]?.archived_at != null
    || rows[0]?.status === 'declined' || !Number.isSafeInteger(rows[0]?.version)
    || rows[0].version < 1 || !validInstant(rows[0]?.updated_date)
    || !plainObject(rows[0]?.follow_up_requests)
    || !['open', 'sent'].includes(rows[0].follow_up_requests.status)
    || rows[0].follow_up_requests.portal_link_active !== true
    || !exactIdentifier(rows[0].follow_up_requests.portal_token_id)) {
    throw new PublicError(409, 'Referral fax authority is unavailable', 'fax_authority_unavailable');
  }
  return rows[0];
}

function validateCareTeamAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const id = exactIdentifier(row?.id);
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string'
    ? row.last_transition_action
    : '';
  const suspendedAt = row?.suspended_at;
  const revokedAt = row?.revoked_at;
  const revocationReason = row?.revocation_reason;
  if (
    !id
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.email
    || row.assignee_membership_id !== authority.membershipId
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || row.assignee_membership_version_at_enablement !== authority.membershipVersion
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (suspendedAt != null && !validInstant(suspendedAt))
    || (status === 'suspended' && !validInstant(suspendedAt))
    || (revokedAt != null && !validInstant(revokedAt))
    || (status === 'revoked' && (
      !validInstant(revokedAt) || !boundedReason(revocationReason)
    ))
    || (status !== 'revoked' && (revokedAt != null || revocationReason != null))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || !assignmentLifecycleIsCoherent(row, status, action)
    || !requestId
    || row.last_transition_request_key !== transitionRequestKey(key, requestId)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(
      409,
      'Scheduled fax patient access is no longer active',
      'fax_authority_unavailable',
    );
  }
  return row;
}

async function validateInternalAccess(
  entities: Record<string, any>,
  authority: Record<string, any>,
  binding: Record<string, any>,
  referral: Record<string, any> | null,
) {
  if (binding.binding.purpose === 'referral') {
    if (!referral || binding.patientId !== null) {
      throw new PublicError(409, 'Referral document provenance is unavailable', 'fax_authority_unavailable');
    }
    return { referral: { id: referral.id, version: referral.version, updated_date: referral.updated_date } };
  }
  if (!binding.patientId) {
    if (AGENCY_WIDE_FAX_ROLES.has(authority.tenantRole)
      || (binding.binding.created_by_user_id === authority.userId && binding.creatorEmail === authority.email)) return null;
    throw new PublicError(409, 'Scheduled fax document access is no longer active', 'fax_authority_unavailable');
  }
  const patients = requireRows(await entities.Patient.filter(
    { id: binding.patientId, agency_id: authority.agencyId }, undefined, BATCH_EXACT_LIMIT,
  ), 'Patient.filter');
  if (patients.length !== 1 || patients[0]?.id !== binding.patientId
    || patients[0]?.agency_id !== authority.agencyId || patients[0]?.is_sample === true
    || patients[0]?.is_archived === true || !validInstant(patients[0]?.updated_date)) {
    throw new PublicError(409, 'Scheduled fax patient access is unavailable', 'fax_authority_unavailable');
  }
  const patient = patients[0];
  if (AGENCY_WIDE_FAX_ROLES.has(authority.tenantRole)
    || (patient.created_by_user_id === authority.userId
      && canonicalEmail(patient.created_by_user_email_normalized) === authority.email)) return patient;
  const key = assignmentKey(authority.agencyId, binding.patientId, authority.userId);
  const assignments = requireRows(await entities.PatientCareTeamAssignment.filter({
    assignment_key: key,
    agency_id: authority.agencyId,
    patient_id: binding.patientId,
    user_id: authority.userId,
  }, undefined, BATCH_EXACT_LIMIT), 'PatientCareTeamAssignment.filter');
  if (assignments.length !== 1) {
    throw new PublicError(409, 'Scheduled fax patient access is no longer active', 'fax_authority_unavailable');
  }
  const assignment = validateCareTeamAssignmentIntegrity(
    assignments[0],
    binding.patientId,
    authority,
  );
  if (assignment.status !== 'active') {
    throw new PublicError(409, 'Scheduled fax patient access is no longer active', 'fax_authority_unavailable');
  }
  return { patient, assignment };
}

async function loadInternalAuthority(entities: Record<string, any>, expected: Record<string, any>) {
  const membershipRows = requireRows(await entities.AgencyMembership.filter(
    { id: expected.membershipId }, undefined, BATCH_EXACT_LIMIT,
  ), 'AgencyMembership.filter');
  if (membershipRows.length !== 1 || membershipRows[0]?.id !== expected.membershipId) {
    throw new PublicError(409, 'Fax tenant membership is unavailable', 'fax_authority_unavailable');
  }
  const membership = validateMembership(membershipRows[0], expected);
  const users = requireRows(await entities.User.filter({ id: expected.userId }, undefined, BATCH_EXACT_LIMIT), 'User.filter');
  if (users.length !== 1 || users[0]?.id !== expected.userId
    || canonicalEmail(users[0]?.email) !== expected.email || users[0]?.is_active === false
    || users[0]?.disabled === true || users[0]?.is_service === true || users[0]?.is_verified === false) {
    throw new PublicError(409, 'Fax authorizing user is unavailable', 'fax_authority_unavailable');
  }
  const agency = await loadAgencyConfiguration(entities, expected.agencyId);
  const binding = await loadBindingSnapshot(entities, expected.agencyId, expected.documentId);
  if ((expected.patientId ?? null) !== binding.patientId
    || (expected.bindingId && binding.binding.id !== expected.bindingId)
    || (expected.bindingVersion != null && binding.binding.version !== expected.bindingVersion)
    || (expected.contentSha256 && binding.binding.content_sha256 !== expected.contentSha256)) {
    throw new PublicError(409, 'Scheduled fax document provenance changed', 'fax_authority_unavailable');
  }
  const referral = expected.referralId
    ? await loadExactRetryReferral(entities, expected)
    : null;
  if ((binding.binding.purpose === 'referral') !== !!referral) {
    throw new PublicError(409, 'Fax document purpose is not bound to its authority', 'fax_authority_unavailable');
  }
  const access = await validateInternalAccess(entities, expected, binding, referral);
  const snapshot = {
    membership: { id: membership.id, version: membership.version, status: membership.status, role: membership.tenant_role, updated_date: membership.updated_date },
    user: { id: users[0].id, email: canonicalEmail(users[0].email), is_active: users[0].is_active, disabled: users[0].disabled, is_verified: users[0].is_verified },
    agency: { id: agency.agency.id, status: agency.agency.status, settings_id: agency.settings.id, settings_updated_date: agency.settings.updated_date },
    binding: { id: binding.binding.id, version: binding.binding.version, content_sha256: binding.binding.content_sha256 },
    document: { id: binding.document.id, updated_date: binding.document.updated_date },
    access,
  };
  return { ...expected, ...agency, ...binding, snapshot };
}

async function createInternalDelivery(base44: Record<string, any>, expected: Record<string, any>) {
  const initial = await loadInternalAuthority(base44.asServiceRole.entities, expected);
  const signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
    file_uri: initial.fileUri, expires_in: BATCH_SIGNED_URL_TTL_SECONDS,
  });
  const downloadUrl = exactHttpsUrl(signed?.signed_url);
  if (!downloadUrl) throw new Error('Private file signing failed');
  const final = await loadInternalAuthority(base44.asServiceRole.entities, expected);
  if (!sameValue(final.snapshot, initial.snapshot)) {
    throw new PublicError(409, 'Fax authority changed during private-file signing', 'fax_authority_unavailable');
  }
  return { ...final, downloadUrl };
}

function submissionAuthoritySnapshot(authority: Record<string, any>) {
  return {
    agencyId: authority.agencyId,
    documentId: authority.documentId,
    userId: authority.userId,
    email: authority.email,
    membershipId: authority.membershipId,
    membershipVersion: authority.membershipVersion,
    tenantRole: authority.tenantRole,
    patientId: authority.patientId ?? null,
    referralId: authority.referralId ?? null,
    fromNumber: authority.fromNumber,
    officeFax: authority.officeFax,
    settingsId: authority.settings?.id,
    settingsUpdatedAt: authority.settings?.updated_date,
    document: authority.document,
    bindingId: authority.binding?.id ?? authority.bindingId ?? null,
    bindingVersion: authority.binding?.version ?? authority.bindingVersion ?? null,
    contentSha256: authority.binding?.content_sha256 ?? authority.contentSha256 ?? null,
    internalSnapshot: authority.snapshot ?? null,
  };
}

async function refreshSubmissionAuthority(base44: Record<string, any>, authority: Record<string, any>) {
  let refreshed;
  if (authority.snapshot) {
    refreshed = await createInternalDelivery(base44, {
      agencyId: authority.agencyId,
      documentId: authority.documentId,
      userId: authority.userId,
      email: authority.email,
      membershipId: authority.membershipId,
      membershipVersion: authority.membershipVersion,
      tenantRole: authority.tenantRole,
      patientId: authority.patientId ?? null,
      bindingId: authority.binding?.id ?? authority.bindingId,
      bindingVersion: authority.binding?.version ?? authority.bindingVersion,
      contentSha256: authority.binding?.content_sha256 ?? authority.contentSha256,
      ...(authority.referralId ? { referralId: authority.referralId } : {}),
    });
  } else {
    const current = await loadInteractiveAuthority(base44, authority.agencyId);
    const delivery = await loadInteractiveDelivery(base44, current, authority.documentId);
    const agency = await loadAgencyConfiguration(base44.asServiceRole.entities, authority.agencyId);
    const binding = await loadBindingSnapshot(
      base44.asServiceRole.entities, authority.agencyId, authority.documentId,
    );
    refreshed = {
      ...current,
      ...agency,
      ...binding,
      documentId: authority.documentId,
      patientId: delivery.document.patient_id ?? null,
      document: delivery.document,
      downloadUrl: delivery.downloadUrl,
    };
  }
  if (!sameValue(submissionAuthoritySnapshot(refreshed), submissionAuthoritySnapshot(authority))) {
    throw new PublicError(409, 'Fax authority changed before provider submission', 'fax_authority_unavailable');
  }
  return refreshed;
}

function successfulExactUpdate(value: unknown) {
  return plainObject(value) && value.success === true && value.updated === 1 && value.has_more === false;
}

async function loadExactFaxLog(entities: Record<string, any>, id: string) {
  const rows = requireRows(await entities.FaxLog.filter({ id }, undefined, BATCH_EXACT_LIMIT), 'FaxLog.filter');
  return rows.length === 1 && rows[0]?.id === id ? rows[0] : null;
}

function matchingPriorAttempt(row: Record<string, any>, attempt: Record<string, any>) {
  return row?.agency_id === attempt.agencyId && row?.document_id === attempt.documentId
    && row?.to_number === attempt.toNumber && row?.sent_by_user_id === attempt.userId
    && row?.sent_by_membership_id === attempt.membershipId
    && row?.sent_by_membership_version === attempt.membershipVersion
    && row?.batch_request_key === attempt.requestKey && row?.batch_recipient_key === attempt.recipientKey
    && (row?.scheduled_fax_id ?? null) === (attempt.scheduledFaxId ?? null)
    && (row?.retry_of_fax_log_id ?? null) === (attempt.retrySourceId ?? null)
    && row?.provider === 'telnyx'
    && row?.integration_secret_id === attempt.credentials.secretId
    && row?.integration_secret_updated_at === attempt.credentials.updatedAt
    && row?.fax_connection_id === attempt.credentials.connectionId
    && row?.sender_telecom_binding_id === attempt.senderBinding.id
    && row?.sender_telecom_binding_version === attempt.senderBinding.version
    && row?.sender_provider_number_id === attempt.senderBinding.provider_number_id
    && row?.sender_settings_id === attempt.settings.id
    && row?.sender_settings_updated_at === attempt.settings.updated_date
    && row?.document_binding_id === attempt.binding.id
    && row?.document_binding_version === attempt.binding.version
    && row?.document_content_sha256 === attempt.binding.content_sha256
    && row?.document_url == null && exactIdentifier(row?.provider_submission_attempt_id);
}

function priorAttemptResult(row: Record<string, any>, toNumber: string) {
  if (row.provider_submission_state === 'accepted') {
    return { to_number: toNumber, success: true, accepted: true, deduped: true, log_id: row.id };
  }
  if (row.provider_submission_state === 'rejected') {
    return { to_number: toNumber, success: false, rejected: true, deduped: true, log_id: row.id };
  }
  return { to_number: toNumber, success: true, requires_reconciliation: true, deduped: true, log_id: row.id };
}

async function transitionAttempt(entities: Record<string, any>, created: Record<string, any>, changes: Record<string, any>) {
  let result = null;
  try {
    result = await entities.FaxLog.updateMany({
      id: created.id,
      provider_submission_state: 'pending',
      provider_submission_attempt_id: created.provider_submission_attempt_id,
      updated_date: created.updated_date,
    }, { $set: changes });
  } catch {
    // The response can be lost after commit. Readback below is authoritative.
  }
  const row = await loadExactFaxLog(entities, created.id).catch(() => null);
  if (successfulExactUpdate(result) && row && Object.entries(changes).every(([key, value]) => sameValue(row[key], value))) return row;
  // The mutation response can be lost after the write commits. Exact readback is
  // authoritative and prevents a false failure from inviting another fax.
  if (row && Object.entries(changes).every(([key, value]) => sameValue(row[key], value))) return row;
  return null;
}

function providerSubmissionDefinitelyRejected(response: Response) {
  return response.status >= 400 && response.status < 500
    && ![408, 409, 425].includes(response.status);
}

async function submitOneFax(
  base44: Record<string, any>,
  req: Request,
  authority: Record<string, any>,
  toNumber: string,
  requestKey: string,
  opts: Record<string, any> = {},
) {
  const entities = base44.asServiceRole.entities;
  const recipientKey = await sha256Text(`${requestKey}\u0000${toNumber}`);
  const destination = isAllowedDestination(toNumber, authority.settings);
  if (!destination.allowed) {
    return { to_number: toNumber, success: false, rejected: true, reason: destination.reason };
  }
  const credentials = await loadExactTelnyxCredentials(entities);
  const senderBinding = await loadExactOutboundFaxBinding(entities, authority, credentials);
  if (authority.providerAuthority && (
    authority.providerAuthority.provider !== 'telnyx'
    || authority.providerAuthority.integrationSecretId !== credentials.secretId
    || authority.providerAuthority.integrationSecretUpdatedAt !== credentials.updatedAt
    || authority.providerAuthority.connectionId !== credentials.connectionId
    || authority.providerAuthority.senderBindingId !== senderBinding.id
    || authority.providerAuthority.senderBindingVersion !== senderBinding.version
    || authority.providerAuthority.providerNumberId !== senderBinding.provider_number_id
    || authority.providerAuthority.settingsId !== authority.settings.id
    || authority.providerAuthority.settingsUpdatedAt !== authority.settings.updated_date
  )) {
    throw new PublicError(409, 'Fax retry provider authority changed', 'fax_authority_unavailable');
  }
  const attempt = {
    ...authority, toNumber, requestKey, recipientKey, credentials, senderBinding,
    scheduledFaxId: opts.scheduledFaxId || null,
    retrySourceId: opts.retrySourceId || null,
  };
  const prior = requireRows(await entities.FaxLog.filter(
    { batch_recipient_key: recipientKey }, '-created_date', BATCH_EXACT_LIMIT,
  ), 'FaxLog.filter');
  if (prior.length > 1 || prior.some((row) => row?.batch_recipient_key !== recipientKey)) {
    throw new PublicError(409, 'Fax batch recipient identity is ambiguous', 'fax_identity_ambiguous');
  }
  if (prior.length === 1) {
    if (!matchingPriorAttempt(prior[0], attempt)) {
      throw new PublicError(409, 'Fax batch recipient identity is invalid', 'fax_identity_ambiguous');
    }
    return priorAttemptResult(prior[0], toNumber);
  }

  const submissionAttemptId = crypto.randomUUID();
  const retryGeneration = Number.isSafeInteger(opts.retryGeneration) ? opts.retryGeneration : 0;
  const createPayload = {
    agency_id: authority.agencyId,
    ...(authority.referralId ? { referral_id: authority.referralId } : {}),
    document_id: authority.documentId,
    document_binding_id: authority.binding.id,
    document_binding_version: authority.binding.version,
    document_content_sha256: authority.binding.content_sha256,
    from_number: authority.fromNumber,
    to_number: toNumber,
    document_name: opts.documentName || authority.document?.file_name || authority.binding?.file_name || 'Batch Fax',
    status: 'queued',
    provider: 'telnyx',
    provider_submission_state: 'pending',
    provider_submission_attempt_id: submissionAttemptId,
    patient_id: authority.patientId || null,
    sent_by: authority.email,
    sent_by_user_id: authority.userId,
    sent_by_membership_id: authority.membershipId,
    sent_by_membership_version: authority.membershipVersion,
    priority: opts.priority || 'normal',
    cover_page_details: opts.coverPageDetails || null,
    retry_count: retryGeneration,
    retry_generation: retryGeneration,
    batch_request_key: requestKey,
    batch_recipient_key: recipientKey,
    integration_secret_id: credentials.secretId,
    integration_secret_updated_at: credentials.updatedAt,
    fax_connection_id: credentials.connectionId,
    sender_telecom_binding_id: senderBinding.id,
    sender_telecom_binding_version: senderBinding.version,
    sender_provider_number_id: senderBinding.provider_number_id,
    sender_settings_id: authority.settings.id,
    sender_settings_updated_at: authority.settings.updated_date,
    ...(opts.scheduledFaxId ? { scheduled_fax_id: opts.scheduledFaxId } : {}),
    ...(opts.retrySourceId ? { retry_of_fax_log_id: opts.retrySourceId } : {}),
    retry_claimed_by: null,
    retry_claimed_at: null,
    retry_claimed_by_user_id: null,
  };
  let created;
  try {
    created = await entities.FaxLog.create(createPayload);
  } catch {
    const recovered = await entities.FaxLog.filter(
      { batch_recipient_key: recipientKey }, '-created_date', BATCH_EXACT_LIMIT,
    ).catch(() => null);
    if (Array.isArray(recovered) && recovered.length === 1
      && matchingPriorAttempt(recovered[0], attempt)
      && recovered[0]?.provider_submission_attempt_id === submissionAttemptId) {
      return priorAttemptResult(recovered[0], toNumber);
    }
    throw new PublicError(
      503,
      'Fax submission ownership requires reconciliation',
      'fax_log_create_ambiguous',
      true,
    );
  }
  const faxLogId = exactIdentifier(created?.id);
  if (!faxLogId) {
    throw new PublicError(503, 'Fax submission ownership requires reconciliation', 'fax_log_create_ambiguous', true);
  }
  const durable = await loadExactFaxLog(entities, faxLogId).catch(() => null);
  if (!durable || !matchingPriorAttempt(durable, attempt)
    || durable.provider_submission_state !== 'pending'
    || durable.provider_submission_attempt_id !== submissionAttemptId
    || durable.status !== 'queued' || !validInstant(durable.updated_date)) {
    throw new PublicError(503, 'Fax submission ownership requires reconciliation', 'fax_log_create_ambiguous', true);
  }
  const uniqueAttempts = requireRows(await entities.FaxLog.filter(
    { batch_recipient_key: recipientKey }, '-created_date', BATCH_EXACT_LIMIT,
  ), 'FaxLog.filter');
  if (uniqueAttempts.length !== 1 || uniqueAttempts[0]?.id !== faxLogId
    || uniqueAttempts[0]?.provider_submission_attempt_id !== submissionAttemptId) {
    await transitionAttempt(entities, durable, {
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      failure_reason: 'Concurrent fax identity is ambiguous; no submission is permitted from this attempt',
    });
    throw new PublicError(
      409,
      'Fax batch recipient identity became ambiguous',
      'fax_identity_ambiguous',
      true,
    );
  }

  let finalAuthority;
  let finalCredentials;
  let finalSenderBinding;
  try {
    finalAuthority = await refreshSubmissionAuthority(base44, authority);
    finalCredentials = await loadExactTelnyxCredentials(entities);
    finalSenderBinding = await loadExactOutboundFaxBinding(entities, finalAuthority, finalCredentials);
    if (!sameValue(finalCredentials, credentials)
      || !sameValue(finalSenderBinding, senderBinding)) {
      throw new PublicError(409, 'Fax provider authority changed before submission', 'fax_authority_unavailable');
    }
  } catch (error) {
    await transitionAttempt(entities, durable, {
      status: 'failed',
      provider_submission_state: 'rejected',
      failure_reason: 'Fax authority changed before provider submission',
    });
    throw new PublicError(
      error instanceof PublicError ? error.status : 409,
      error instanceof PublicError ? error.message : 'Fax authority changed before provider submission',
      error instanceof PublicError ? error.code : 'fax_authority_unavailable',
      true,
    );
  }

  const requestUrl = new URL(req.url);
  const functionsBase = requestUrl.protocol === 'https:'
    ? (requestUrl.origin + requestUrl.pathname).replace(/\/+$/, '').replace(/\/[^/]+$/, '')
    : '';
  const payload: Record<string, any> = {
    connection_id: finalCredentials.connectionId,
    from: finalAuthority.fromNumber,
    to: toNumber,
    media_url: finalAuthority.downloadUrl,
    quality: 'high',
  };
  const displayName = officeFaxDisplayName(finalAuthority.officeFax);
  if (displayName) payload.from_display_name = displayName;
  if (functionsBase) payload.webhook_url = `${functionsBase}/handleTelnyxStatusWebhook`;

  let response: Response;
  try {
    response = await fetch('https://api.telnyx.com/v2/faxes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${finalCredentials.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    const stored = await transitionAttempt(entities, durable, {
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      failure_reason: 'Provider submission outcome is unknown; reconcile before any resend',
    });
    return { to_number: toNumber, success: true, requires_reconciliation: true, log_id: faxLogId, local_state_verified: !!stored };
  }

  const rawProvider = await response.text().catch(() => '');
  let provider: Record<string, any> = {};
  try { provider = rawProvider ? JSON.parse(rawProvider) : {}; } catch { provider = {}; }
  const providerFaxId = exactIdentifier(provider?.data?.id);
  if (response.ok && providerFaxId) {
    const acceptedAt = new Date().toISOString();
    const stored = await transitionAttempt(entities, durable, {
      telnyx_fax_id: providerFaxId,
      status: 'sending',
      provider_submission_state: 'accepted',
      provider_accepted_at: acceptedAt,
      failure_reason: null,
    });
    if (stored) return { to_number: toNumber, success: true, accepted: true, log_id: faxLogId };
    await transitionAttempt(entities, durable, {
      telnyx_fax_id: providerFaxId,
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      failure_reason: 'Provider accepted the fax but local confirmation failed; reconcile before resend',
    });
    return { to_number: toNumber, success: true, requires_reconciliation: true, log_id: faxLogId };
  }
  if (providerSubmissionDefinitelyRejected(response)) {
    const stored = await transitionAttempt(entities, durable, {
      status: 'failed',
      provider_submission_state: 'rejected',
      failure_reason: boundedLabel(provider?.errors?.[0]?.title) || 'Fax provider rejected the request',
    });
    return stored
      ? { to_number: toNumber, success: false, rejected: true, log_id: faxLogId }
      : { to_number: toNumber, success: true, requires_reconciliation: true, log_id: faxLogId };
  }
  const stored = await transitionAttempt(entities, durable, {
    ...(providerFaxId ? { telnyx_fax_id: providerFaxId } : {}),
    status: 'submission_unknown',
    provider_submission_state: 'indeterminate',
    failure_reason: 'Provider submission outcome is unknown; reconcile before any resend',
  });
  return { to_number: toNumber, success: true, requires_reconciliation: true, log_id: faxLogId, local_state_verified: !!stored };
}

async function findExactSchedule(entities: Record<string, any>, id: string) {
  const rows = requireRows(await entities.ScheduledFax.filter({ id }, undefined, BATCH_EXACT_LIMIT), 'ScheduledFax.filter');
  return rows.length === 1 && rows[0]?.id === id ? rows[0] : null;
}

async function createSchedule(base44: Record<string, any>, input: Record<string, any>) {
  const authority = await loadInteractiveAuthority(base44, input.agencyId);
  const initialDelivery = await loadInteractiveDelivery(base44, authority, input.documentId);
  const binding = await loadBindingSnapshot(base44.asServiceRole.entities, input.agencyId, input.documentId);
  if (binding.binding.purpose !== 'patient_document') {
    throw new PublicError(
      409,
      'Referral documents must use the referral fax workflow',
      'referral_fax_authority_required',
    );
  }
  if ((initialDelivery.document.patient_id ?? null) !== binding.patientId) {
    throw new PublicError(409, 'Private document fax authority changed', 'fax_authority_unavailable');
  }
  if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax');
  const sender = await loadAgencyConfiguration(base44.asServiceRole.entities, input.agencyId);
  const credentials = await loadExactTelnyxCredentials(base44.asServiceRole.entities);
  const senderBinding = await loadExactOutboundFaxBinding(
    base44.asServiceRole.entities,
    { agencyId: input.agencyId, fromNumber: sender.fromNumber },
    credentials,
  );
  const scheduleKey = await sha256Text(`${input.agencyId}\u0000${authority.userId}\u0000${input.clientRequestId}`);
  const existing = requireRows(await base44.asServiceRole.entities.ScheduledFax.filter(
    { schedule_key: scheduleKey }, '-created_date', BATCH_EXACT_LIMIT,
  ), 'ScheduledFax.filter');
  if (existing.length > 1 || existing.some((row) => row?.schedule_key !== scheduleKey)) {
    throw new PublicError(409, 'Scheduled fax identity is ambiguous', 'fax_identity_ambiguous');
  }
  if (existing.length === 1) {
    const row = existing[0];
    const expectedDocumentName = input.documentName || initialDelivery.document.file_name;
    if (row.client_request_id !== input.clientRequestId
      || row.agency_id !== input.agencyId || row.document_id !== input.documentId
      || row.authorized_by_user_id !== authority.userId
      || row.authorization_version !== 1
      || row.document_binding_id !== binding.binding.id
      || row.document_binding_version !== binding.binding.version
      || row.document_content_sha256 !== binding.binding.content_sha256
      || row.provider !== 'telnyx'
      || row.integration_secret_id !== credentials.secretId
      || row.integration_secret_updated_at !== credentials.updatedAt
      || row.fax_connection_id !== credentials.connectionId
      || row.sender_number_e164 !== sender.fromNumber
      || row.sender_telecom_binding_id !== senderBinding.id
      || row.sender_telecom_binding_version !== senderBinding.version
      || row.sender_provider_number_id !== senderBinding.provider_number_id
      || row.sender_settings_id !== sender.settings.id
      || row.sender_settings_updated_at !== sender.settings.updated_date
      || row.authorized_by_email_normalized !== authority.email
      || row.authorized_by_membership_id !== authority.membershipId
      || row.authorized_by_membership_version !== authority.membershipVersion
      || row.authorized_tenant_role !== authority.tenantRole
      || (row.patient_id ?? null) !== binding.patientId
      || !sameValue(row.to_numbers, input.recipients)
      || row.scheduled_time !== input.scheduledTime
      || row.document_name !== expectedDocumentName
      || !sameValue(row.cover_page_details ?? null, input.coverPageDetails)
      || row.priority !== input.priority
      || row.document_url != null || row.from_number != null) {
      throw new PublicError(409, 'Scheduled fax request identity was reused with different data', 'fax_identity_conflict');
    }
    return { success: true, scheduled: true, deduped: true, scheduled_fax_id: row.id, status: row.status };
  }
  const row = await base44.asServiceRole.entities.ScheduledFax.create({
    schedule_key: scheduleKey,
    client_request_id: input.clientRequestId,
    authorization_version: 1,
    agency_id: input.agencyId,
    document_id: input.documentId,
    document_binding_id: binding.binding.id,
    document_binding_version: binding.binding.version,
    document_content_sha256: binding.binding.content_sha256,
    provider: 'telnyx',
    integration_secret_id: credentials.secretId,
    integration_secret_updated_at: credentials.updatedAt,
    fax_connection_id: credentials.connectionId,
    sender_number_e164: sender.fromNumber,
    sender_telecom_binding_id: senderBinding.id,
    sender_telecom_binding_version: senderBinding.version,
    sender_provider_number_id: senderBinding.provider_number_id,
    sender_settings_id: sender.settings.id,
    sender_settings_updated_at: sender.settings.updated_date,
    authorized_by_user_id: authority.userId,
    authorized_by_email_normalized: authority.email,
    authorized_by_membership_id: authority.membershipId,
    authorized_by_membership_version: authority.membershipVersion,
    authorized_tenant_role: authority.tenantRole,
    patient_id: binding.patientId,
    scheduled_time: input.scheduledTime,
    to_numbers: input.recipients,
    document_name: input.documentName || initialDelivery.document.file_name,
    cover_page_details: input.coverPageDetails,
    priority: input.priority,
    status: 'pending',
    accepted_count: 0,
    failed_count: 0,
    unknown_count: 0,
  });
  const id = exactIdentifier(row?.id);
  if (!id) throw new Error('ScheduledFax.create returned no exact id');
  const durable = await findExactSchedule(base44.asServiceRole.entities, id);
  if (!durable || durable.schedule_key !== scheduleKey || durable.status !== 'pending'
    || durable.document_url != null || durable.from_number != null
    || durable.document_binding_id !== binding.binding.id
    || durable.authorized_by_membership_id !== authority.membershipId
    || durable.integration_secret_id !== credentials.secretId
    || durable.sender_telecom_binding_id !== senderBinding.id) {
    throw new Error('ScheduledFax could not be verified');
  }
  const uniqueSchedules = requireRows(await base44.asServiceRole.entities.ScheduledFax.filter(
    { schedule_key: scheduleKey }, '-created_date', BATCH_EXACT_LIMIT,
  ), 'ScheduledFax.filter');
  if (uniqueSchedules.length !== 1 || uniqueSchedules[0]?.id !== id) {
    await base44.asServiceRole.entities.ScheduledFax.updateMany(
      { id, status: 'pending', updated_date: durable.updated_date },
      { $set: { status: 'blocked', last_error_code: 'duplicate_schedule_key' } },
    ).catch(() => null);
    throw new PublicError(409, 'Scheduled fax identity became ambiguous', 'fax_identity_ambiguous');
  }
  const finalAuthority = await loadInteractiveAuthority(base44, input.agencyId);
  const finalDelivery = await loadInteractiveDelivery(base44, finalAuthority, input.documentId);
  if (!sameValue(finalAuthority, authority) || !sameValue(finalDelivery.document, initialDelivery.document)) {
    await base44.asServiceRole.entities.ScheduledFax.updateMany(
      { id, status: 'pending', updated_date: durable.updated_date },
      { $set: { status: 'blocked', last_error_code: 'fax_authority_changed' } },
    ).catch(() => null);
    throw new PublicError(409, 'Fax authority changed while scheduling', 'fax_authority_unavailable');
  }
  return { success: true, scheduled: true, deduped: false, scheduled_fax_id: id, status: 'pending' };
}

function validateScheduledRow(row: Record<string, any>, id: string, dispatchAttemptId: string) {
  const recipients = normalizeRecipients(row?.to_numbers);
  const expected = {
    agencyId: exactIdentifier(row?.agency_id),
    documentId: exactIdentifier(row?.document_id),
    userId: exactIdentifier(row?.authorized_by_user_id),
    email: canonicalEmail(row?.authorized_by_email_normalized),
    membershipId: exactIdentifier(row?.authorized_by_membership_id),
    membershipVersion: row?.authorized_by_membership_version,
    tenantRole: row?.authorized_tenant_role,
    patientId: row?.patient_id == null ? null : exactIdentifier(row.patient_id),
    bindingId: exactIdentifier(row?.document_binding_id),
    bindingVersion: row?.document_binding_version,
    contentSha256: row?.document_content_sha256,
    senderNumber: normalizeFromE164(row?.sender_number_e164),
    providerAuthority: {
      provider: row?.provider,
      integrationSecretId: exactIdentifier(row?.integration_secret_id),
      integrationSecretUpdatedAt: row?.integration_secret_updated_at,
      connectionId: exactIdentifier(row?.fax_connection_id),
      senderBindingId: exactIdentifier(row?.sender_telecom_binding_id),
      senderBindingVersion: row?.sender_telecom_binding_version,
      providerNumberId: exactIdentifier(row?.sender_provider_number_id),
      settingsId: exactIdentifier(row?.sender_settings_id),
      settingsUpdatedAt: row?.sender_settings_updated_at,
    },
  };
  if (row?.id !== id || row.status !== 'processing' || row.claimed_by !== dispatchAttemptId
    || row.dispatch_attempt_id !== dispatchAttemptId || row.authorization_version !== 1
    || !exactIdentifier(row.schedule_key) || !exactIdentifier(row.client_request_id)
    || !expected.agencyId || !expected.documentId || !expected.userId || !expected.email
    || !expected.membershipId || !Number.isSafeInteger(expected.membershipVersion)
    || expected.membershipVersion < 1 || !FAX_TENANT_ROLES.has(String(expected.tenantRole || ''))
    || (row.patient_id != null && !expected.patientId) || !expected.bindingId
    || expected.bindingVersion !== 2 || !/^[a-f0-9]{64}$/.test(String(expected.contentSha256 || ''))
    || !expected.senderNumber || expected.senderNumber !== row.sender_number_e164
    || expected.providerAuthority.provider !== 'telnyx'
    || !expected.providerAuthority.integrationSecretId
    || !validInstant(expected.providerAuthority.integrationSecretUpdatedAt)
    || !expected.providerAuthority.connectionId || !expected.providerAuthority.senderBindingId
    || !Number.isSafeInteger(expected.providerAuthority.senderBindingVersion)
    || expected.providerAuthority.senderBindingVersion < 1
    || !expected.providerAuthority.providerNumberId || !expected.providerAuthority.settingsId
    || !validInstant(expected.providerAuthority.settingsUpdatedAt)
    || row.document_url != null || row.from_number != null || row.canceled_at != null
    || !validInstant(row.claimed_at) || !validInstant(row.updated_date)) {
    throw new PublicError(409, 'Scheduled fax provenance is unavailable', 'fax_authority_unavailable');
  }
  return { row, recipients, expected };
}

async function dispatchScheduled(base44: Record<string, any>, req: Request, input: Record<string, any>) {
  const row = await findExactSchedule(base44.asServiceRole.entities, input.scheduledFaxId);
  if (!row) throw new PublicError(409, 'Scheduled fax identity is ambiguous', 'fax_identity_ambiguous');
  const scheduled = validateScheduledRow(row, input.scheduledFaxId, input.dispatchAttemptId);
  const expectedKey = await sha256Text(`${scheduled.expected.agencyId}\u0000${scheduled.expected.userId}\u0000${row.client_request_id}`);
  if (expectedKey !== row.schedule_key) throw new PublicError(409, 'Scheduled fax provenance is invalid', 'fax_authority_unavailable');
  const results = [];
  for (let index = 0; index < scheduled.recipients.length; index += 1) {
    const toNumber = scheduled.recipients[index];
    try {
      const delivery = await createInternalDelivery(base44, scheduled.expected);
      results.push(await submitOneFax(base44, req, {
        ...scheduled.expected,
        ...delivery,
        downloadUrl: delivery.downloadUrl,
      }, toNumber, row.schedule_key, {
        scheduledFaxId: row.id,
        documentName: boundedLabel(row.document_name) || delivery.document.file_name,
        coverPageDetails: plainObject(row.cover_page_details) ? row.cover_page_details : null,
        priority: normalizePriority(row.priority),
      }));
    } catch (error) {
      if (results.length === 0 && !(error instanceof PublicError && error.dispatchStarted)) throw error;
      for (const remaining of scheduled.recipients.slice(index)) {
        results.push({
          to_number: remaining,
          success: true,
          requires_reconciliation: true,
          dispatch_started: error instanceof PublicError && error.dispatchStarted,
          reason: 'Batch dispatch was interrupted; review durable recipient attempts before resending',
        });
      }
      break;
    }
  }
  return summarizeResults(results, scheduled.recipients.length, { scheduled_fax_id: row.id });
}

function validateRetrySource(row: Record<string, any>, id: string, retryClaimId: string) {
  const expected = {
    agencyId: exactIdentifier(row?.agency_id), documentId: exactIdentifier(row?.document_id),
    referralId: exactIdentifier(row?.referral_id),
    bindingId: exactIdentifier(row?.document_binding_id),
    bindingVersion: row?.document_binding_version,
    contentSha256: row?.document_content_sha256,
    userId: exactIdentifier(row?.sent_by_user_id), email: canonicalEmail(row?.sent_by),
    membershipId: exactIdentifier(row?.sent_by_membership_id),
    membershipVersion: row?.sent_by_membership_version, tenantRole: '',
    patientId: row?.patient_id == null ? null : exactIdentifier(row.patient_id),
    providerAuthority: {
      provider: row?.provider,
      integrationSecretId: exactIdentifier(row?.integration_secret_id),
      integrationSecretUpdatedAt: row?.integration_secret_updated_at,
      connectionId: exactIdentifier(row?.fax_connection_id),
      senderBindingId: exactIdentifier(row?.sender_telecom_binding_id),
      senderBindingVersion: row?.sender_telecom_binding_version,
      providerNumberId: exactIdentifier(row?.sender_provider_number_id),
      settingsId: exactIdentifier(row?.sender_settings_id),
      settingsUpdatedAt: row?.sender_settings_updated_at,
    },
  };
  if (row?.id !== id || row.status !== 'retrying' || row.retry_claimed_by !== retryClaimId
    || row.retry_claimed_by_user_id !== expected.userId || !validInstant(row.retry_claimed_at)
    || !expected.agencyId || !expected.referralId || !expected.documentId
    || !expected.bindingId || expected.bindingVersion !== 2
    || !/^[a-f0-9]{64}$/.test(String(expected.contentSha256 || ''))
    || expected.providerAuthority.provider !== 'telnyx'
    || !expected.providerAuthority.integrationSecretId
    || !validInstant(expected.providerAuthority.integrationSecretUpdatedAt)
    || !expected.providerAuthority.connectionId
    || !expected.providerAuthority.senderBindingId
    || !Number.isSafeInteger(expected.providerAuthority.senderBindingVersion)
    || expected.providerAuthority.senderBindingVersion < 1
    || !expected.providerAuthority.providerNumberId
    || !expected.providerAuthority.settingsId
    || !validInstant(expected.providerAuthority.settingsUpdatedAt)
    || !expected.userId || !expected.email || !expected.membershipId
    || !Number.isSafeInteger(expected.membershipVersion) || expected.membershipVersion < 1
    || (row.patient_id != null && !expected.patientId) || row.document_url != null
    || row.provider_submission_state !== 'accepted' || row.provider_terminal_status !== 'failed'
    || !exactIdentifier(row.provider_submission_attempt_id) || !exactIdentifier(row.telnyx_fax_id)
    || !validInstant(row.provider_accepted_at) || !validInstant(row.provider_terminal_at)
    || !Number.isSafeInteger(row.retry_generation) || row.retry_generation < 0
    || !Number.isSafeInteger(row.retry_count) || row.retry_count < row.retry_generation
    || !validInstant(row.updated_date)) {
    throw new PublicError(409, 'Automatic fax retry provenance is unavailable', 'fax_authority_unavailable');
  }
  return { row, expected };
}

async function dispatchRetry(base44: Record<string, any>, req: Request, input: Record<string, any>) {
  const source = await loadExactFaxLog(base44.asServiceRole.entities, input.faxLogId);
  if (!source) throw new PublicError(409, 'Fax retry identity is ambiguous', 'fax_identity_ambiguous');
  const retry = validateRetrySource(source, input.faxLogId, input.retryClaimId);
  const membershipRows = requireRows(await base44.asServiceRole.entities.AgencyMembership.filter(
    { id: retry.expected.membershipId }, undefined, BATCH_EXACT_LIMIT,
  ), 'AgencyMembership.filter');
  if (membershipRows.length !== 1) throw new PublicError(409, 'Fax tenant membership is unavailable', 'fax_authority_unavailable');
  retry.expected.tenantRole = membershipRows[0]?.tenant_role;
  const delivery = await createInternalDelivery(base44, retry.expected);
  const toNumber = normalizeFaxDest(source.to_number);
  if (!toNumber || toNumber !== source.to_number) {
    throw new PublicError(409, 'Fax retry destination is invalid', 'fax_authority_unavailable');
  }
  const generation = source.retry_generation + 1;
  const requestKey = await sha256Text(`retry\u0000${source.id}\u0000${generation}`);
  const result = await submitOneFax(base44, req, {
    ...retry.expected, ...delivery, downloadUrl: delivery.downloadUrl,
  }, toNumber, requestKey, {
    retrySourceId: source.id,
    retryGeneration: generation,
    documentName: `${boundedLabel(source.document_name) || delivery.document.file_name} (Retry)`,
    priority: normalizePriority(source.priority),
  });
  return summarizeResults([result], 1, { retry_source_fax_log_id: source.id, retry_generation: generation });
}

function summarizeResults(results: Array<Record<string, any>>, total: number, extra: Record<string, any> = {}) {
  const accepted = results.filter((result) => result.accepted === true).length;
  const failed = results.filter((result) => result.rejected === true).length;
  const unknown = results.filter((result) => result.requires_reconciliation === true).length;
  return {
    success: true,
    dispatch_started: results.some((result) => !!result.log_id || result.dispatch_started === true),
    total,
    successful: accepted,
    accepted,
    failed,
    unknown,
    requires_reconciliation: unknown > 0,
    results,
    ...extra,
  };
}

async function sendInteractive(base44: Record<string, any>, req: Request, input: Record<string, any>) {
  const initialAuthority = await loadInteractiveAuthority(base44, input.agencyId);
  const initialDelivery = await loadInteractiveDelivery(base44, initialAuthority, input.documentId);
  const initialBinding = await loadBindingSnapshot(
    base44.asServiceRole.entities, input.agencyId, input.documentId,
  );
  if (initialDelivery.document.category === 'referral'
    || initialBinding.binding.purpose !== 'patient_document'
    || (initialDelivery.document.patient_id ?? null) !== initialBinding.patientId) {
    throw new PublicError(
      409,
      'Referral documents must use the referral fax workflow',
      'referral_fax_authority_required',
    );
  }
  if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax');
  const requestKey = await sha256Text(`${input.agencyId}\u0000${initialAuthority.userId}\u0000${input.clientRequestId}`);
  const results = [];
  for (let index = 0; index < input.recipients.length; index += 1) {
    const toNumber = input.recipients[index];
    try {
      const authority = await loadInteractiveAuthority(base44, input.agencyId);
      const delivery = await loadInteractiveDelivery(base44, authority, input.documentId);
      const binding = await loadBindingSnapshot(
        base44.asServiceRole.entities, input.agencyId, input.documentId,
      );
      if (!sameValue(authority, initialAuthority)
        || !sameValue(delivery.document, initialDelivery.document)
        || !sameValue(binding, initialBinding)) {
        throw new PublicError(409, 'Fax authority changed during batch preparation', 'fax_authority_unavailable', results.length > 0);
      }
      const agency = await loadAgencyConfiguration(base44.asServiceRole.entities, input.agencyId);
      results.push(await submitOneFax(base44, req, {
        ...authority, ...agency, ...binding, documentId: input.documentId,
        patientId: delivery.document.patient_id ?? null,
        document: delivery.document, downloadUrl: delivery.downloadUrl,
      }, toNumber, requestKey, {
        documentName: input.documentName || delivery.document.file_name,
        coverPageDetails: input.coverPageDetails,
        priority: input.priority,
      }));
    } catch (error) {
      if (results.length === 0 && !(error instanceof PublicError && error.dispatchStarted)) throw error;
      for (const remaining of input.recipients.slice(index)) {
        results.push({
          to_number: remaining,
          success: true,
          requires_reconciliation: true,
          dispatch_started: error instanceof PublicError && error.dispatchStarted,
          reason: 'Batch dispatch was interrupted; review durable recipient attempts before resending',
        });
      }
      break;
    }
  }
  return summarizeResults(results, input.recipients.length, { batch_request_key: requestKey });
}

Deno.serve(async (req) => {
  try {
    const input = await parseBatchRequest(req);
    if ((input.action === 'dispatch_scheduled' || input.action === 'dispatch_retry')
      && !outboundDeliveryReleased()) {
      return outboundDeliveryPausedResponse('fax');
    }
    const base44 = createClientFromRequest(req);
    let result: Record<string, any> | Response;
    if (input.action === 'schedule') result = await createSchedule(base44, input);
    else if (input.action === 'dispatch_scheduled') result = await dispatchScheduled(base44, req, input);
    else if (input.action === 'dispatch_retry') result = await dispatchRetry(base44, req, input);
    else result = await sendInteractive(base44, req, input);
    if (result instanceof Response) return result;
    return Response.json(result, {
      status: result.requires_reconciliation ? 202 : 200,
      headers: NO_STORE_HEADERS,
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({
        error: error.message,
        code: error.code,
        dispatch_started: error.dispatchStarted,
      }, { status: error.status, headers: NO_STORE_HEADERS });
    }
    // Do not log request/provider detail: it may include destinations or PHI.
    console.error('sendBatchFax failed');
    return Response.json({
      error: 'Internal server error', code: 'fax_batch_internal_error', dispatch_started: false,
    }, { status: 500, headers: NO_STORE_HEADERS });
  }
});
