import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * sendSms — outbound SMS from a nurse's dedicated work number to a patient, sent
 * via the Telnyx Messaging API. The patient only ever sees the nurse's work
 * number (`from`); the nurse's personal cell is never exposed; refuses to send to
 * numbers that have opted out (TCPA) or during the recipient's TCPA quiet hours;
 * the message body is never written to the audit log (PHI minimization) — only
 * its length and the thread id are recorded. Logs to the same SmsMessage entity
 * that handleTelnyxStatusWebhook writes inbound messages to, under a thread id
 * computed the same way, so both directions of a conversation thread together.
 */

// ---- inline helpers (single-file Deno deploy; do not rely on imports) ----
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

function getThreadId(a, b) {
  const na = normalizeE164(a) || a;
  const nb = normalizeE164(b) || b;
  return [na, nb].sort().join('|');
}

function phoneVariants(value) {
  const d = (value || '').replace(/[^\d]/g, '');
  const ten = d.slice(-10);
  if (ten.length !== 10) return value ? [value] : [];
  const a = ten.slice(0, 3), b = ten.slice(3, 6), c = ten.slice(6);
  const variants = [value, `+1${ten}`, `1${ten}`, ten, `(${a}) ${b}-${c}`, `${a}-${b}-${c}`, `${a}.${b}.${c}`];
  return variants.filter((v, i) => variants.indexOf(v) === i);
}

async function getAgencyConfig(base44, user) {
  // Prefer the caller's agency settings row when multi-tenant rows exist.
  // Newest-row fallback is only safe for single-tenant (≤1 settings row).
  let settings = [];
  if (user?.agency_name) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: user.agency_name }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: user.agency_name }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    const newest = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 5).catch(() => []);
    // Multi-tenant miss (with or without an agency hint): do not apply another
    // agency's SMS policy / quiet hours. Single-tenant (≤1 row) may use it.
    if ((newest || []).length > 1) {
      return { settings: {}, smsEnabled: false, missingAgencySettings: true };
    }
    settings = (newest || []).slice(0, 1);
  }
  const s = settings[0] || {};
  return { settings: s, smsEnabled: s.sms_messaging_enabled ?? true };
}

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

// <<<BEGIN SHARED HELPER: telnyxSmsAuthority — generated, edit base44/_shared/backendHelpers.mjs>>>
const TELNYX_SMS_BINDING_SCAN_LIMIT = 500;
const TELNYX_SMS_CONSENT_SCAN_LIMIT = 500;

function normalizeTelnyxSmsE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

const boundedTelnyxAuthorityId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized
    && normalized === value
    && normalized.length <= 200
    && !normalized.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
};

const isCanonicalTelnyxAuthorityEmail = (value) => {
  if (typeof value !== 'string' || value.length > 254) return false;
  const normalized = value.trim().toLowerCase();
  return value === normalized && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized);
};

function telnyxSmsConsentKey(authority, recipientE164) {
  return [
    'telnyx',
    authority.integrationSecretId,
    authority.messagingProfileId,
    authority.agencyId,
    recipientE164,
  ].join(':');
}

async function resolveActiveTelnyxSmsBinding(base44, input) {
  const integrationSecretId = boundedTelnyxAuthorityId(input?.integrationSecretId);
  const messagingProfileId = boundedTelnyxAuthorityId(input?.messagingProfileId);
  const hasClaimedMessagingProfile = Object.prototype.hasOwnProperty.call(input || {}, 'claimedMessagingProfileId');
  const claimedMessagingProfileId = hasClaimedMessagingProfile
    ? boundedTelnyxAuthorityId(input.claimedMessagingProfileId)
    : messagingProfileId;
  const destinationE164 = normalizeTelnyxSmsE164(input?.destinationE164);
  if (input?.integrationProvider !== 'telnyx'
    || input?.integrationIsActive !== true
    || (input?.requireClaimedProfile === true && !hasClaimedMessagingProfile)
    || !integrationSecretId || input?.integrationSecretId !== integrationSecretId
    || !messagingProfileId || input?.messagingProfileId !== messagingProfileId
    || !claimedMessagingProfileId
    || (hasClaimedMessagingProfile && input?.claimedMessagingProfileId !== claimedMessagingProfileId)
    || claimedMessagingProfileId !== messagingProfileId || !destinationE164) {
    return { ok: false, reason: 'invalid_sms_binding_input' };
  }

  // Re-read the service-owned credential at the authority boundary. Exactly one
  // active Telnyx integration may own SMS routing; a stale selection or two
  // concurrently-active credential rows cannot be resolved safely.
  let integrationRows;
  try {
    integrationRows = await base44.asServiceRole.entities.IntegrationSecret.filter({
      provider: 'telnyx',
      is_active: true,
    }, undefined, 2);
  } catch {
    return { ok: false, reason: 'sms_integration_read_failed' };
  }
  if (!Array.isArray(integrationRows) || integrationRows.length !== 1) {
    return { ok: false, reason: 'sms_integration_ambiguous' };
  }
  const activeIntegration = integrationRows[0];
  if (activeIntegration?.id !== integrationSecretId
    || activeIntegration?.provider !== 'telnyx'
    || activeIntegration?.is_active !== true
    || activeIntegration?.messaging_profile_id !== messagingProfileId) {
    return { ok: false, reason: 'sms_integration_integrity_failed' };
  }

  let rows;
  try {
    rows = await base44.asServiceRole.entities.TelecomDestinationBinding.filter({
      provider: 'telnyx',
      integration_secret_id: integrationSecretId,
      messaging_profile_id: messagingProfileId,
      status: 'active',
    }, undefined, TELNYX_SMS_BINDING_SCAN_LIMIT + 1);
  } catch {
    return { ok: false, reason: 'sms_binding_read_failed' };
  }
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > TELNYX_SMS_BINDING_SCAN_LIMIT) {
    return { ok: false, reason: rows?.length ? 'sms_binding_scan_ambiguous' : 'sms_binding_not_found' };
  }

  const agencies = new Set();
  const bindingIds = new Set();
  const bindingKeys = new Set();
  const bindingDestinations = new Set();
  const profileBindingProvenance = [];
  const exactDestinations = [];
  for (const row of rows) {
    const rowId = boundedTelnyxAuthorityId(row?.id);
    const agencyId = boundedTelnyxAuthorityId(row?.agency_id);
    const providerNumberId = boundedTelnyxAuthorityId(row?.provider_number_id);
    const phoneNumberId = boundedTelnyxAuthorityId(row?.phone_number_id);
    const creatorId = boundedTelnyxAuthorityId(row?.created_by_user_id);
    const transitionActorId = boundedTelnyxAuthorityId(row?.last_transition_by_user_id);
    const transitionRequestId = boundedTelnyxAuthorityId(row?.last_transition_request_id);
    const transitionRequestKey = boundedTelnyxAuthorityId(row?.last_transition_request_key);
    const transitionAction = typeof row?.last_transition_action === 'string'
      ? row.last_transition_action
      : '';
    const transitionReason = typeof row?.last_transition_reason === 'string'
      ? row.last_transition_reason.trim()
      : '';
    const rowDestination = normalizeTelnyxSmsE164(row?.destination_e164);
    const createdAtMs = Date.parse(row?.created_at || '');
    const activatedAtMs = Date.parse(row?.activated_at || '');
    const transitionedAtMs = Date.parse(row?.last_transition_at || '');
    const hasSuspendedAt = row?.suspended_at != null;
    const suspendedAtMs = hasSuspendedAt ? Date.parse(row.suspended_at) : null;
    const hasRevokedAt = row?.revoked_at != null;
    const hasRevocationReason = row?.revocation_reason != null;
    const expectedKey = rowDestination
      ? `telnyx:${integrationSecretId}:${rowDestination}`
      : null;
    const expectedTransitionRequestKey = expectedKey && transitionRequestId
      ? `${expectedKey}:${transitionRequestId}`
      : null;
    const isInitialActiveBinding = transitionAction === 'bind'
      && row?.version === 1
      && !hasSuspendedAt
      && createdAtMs === activatedAtMs
      && activatedAtMs === transitionedAtMs
      && creatorId === transitionActorId
      && row?.created_by_user_email_normalized === row?.last_transition_by_email_normalized;
    const isReactivatedBinding = transitionAction === 'activate'
      && Number.isSafeInteger(row?.version) && row.version >= 2
      && hasSuspendedAt && Number.isFinite(suspendedAtMs)
      && createdAtMs <= suspendedAtMs && suspendedAtMs < activatedAtMs
      && activatedAtMs === transitionedAtMs;
    if (!rowId || row?.id !== rowId
      || !agencyId || row?.agency_id !== agencyId
      || !providerNumberId || row?.provider_number_id !== providerNumberId
      || !phoneNumberId || row?.phone_number_id !== phoneNumberId
      || !creatorId || row?.created_by_user_id !== creatorId
      || !transitionActorId || row?.last_transition_by_user_id !== transitionActorId
      || !transitionRequestId || row?.last_transition_request_id !== transitionRequestId
      || !transitionRequestKey || row?.last_transition_request_key !== transitionRequestKey
      || !isCanonicalTelnyxAuthorityEmail(row?.created_by_user_email_normalized)
      || !isCanonicalTelnyxAuthorityEmail(row?.last_transition_by_email_normalized)
      || row?.provider !== 'telnyx'
      || row?.integration_secret_id !== integrationSecretId
      || row?.messaging_profile_id !== messagingProfileId
      || typeof row?.sms_inbound_enabled !== 'boolean'
      || typeof row?.sms_outbound_enabled !== 'boolean'
      || typeof row?.voice_inbound_enabled !== 'boolean'
      || typeof row?.fax_inbound_enabled !== 'boolean'
      || (row.voice_inbound_enabled === true
        && (!boundedTelnyxAuthorityId(row?.voice_connection_id)
          || row.voice_connection_id !== boundedTelnyxAuthorityId(row.voice_connection_id)))
      || (row.fax_inbound_enabled === true
        && (!boundedTelnyxAuthorityId(row?.fax_connection_id)
          || row.fax_connection_id !== boundedTelnyxAuthorityId(row.fax_connection_id)))
      || row?.status !== 'active'
      || !['manual', 'telnyx_purchase', 'legacy_backfill'].includes(row?.source)
      || (!isInitialActiveBinding && !isReactivatedBinding)
      || !transitionReason || row?.last_transition_reason !== transitionReason
      || transitionReason.length > 500
      || transitionRequestKey !== expectedTransitionRequestKey
      || !Number.isFinite(createdAtMs) || !Number.isFinite(activatedAtMs)
      || !Number.isFinite(transitionedAtMs)
      || createdAtMs > activatedAtMs || activatedAtMs > transitionedAtMs
      || hasRevokedAt || hasRevocationReason
      || row?.destination_e164 !== rowDestination
      || row?.binding_key !== expectedKey
      || !Number.isSafeInteger(row?.version) || row.version < 1) {
      return { ok: false, reason: 'sms_binding_integrity_failed' };
    }
    if (bindingIds.has(rowId)
      || bindingKeys.has(row.binding_key)
      || bindingDestinations.has(rowDestination)) {
      return { ok: false, reason: 'sms_binding_identity_ambiguous' };
    }
    bindingIds.add(rowId);
    bindingKeys.add(row.binding_key);
    bindingDestinations.add(rowDestination);
    agencies.add(agencyId);
    profileBindingProvenance.push({
      bindingId: rowId,
      bindingKey: row.binding_key,
      destinationE164: rowDestination,
    });
    if (rowDestination === destinationE164) exactDestinations.push(row);
  }
  if (agencies.size !== 1) return { ok: false, reason: 'sms_profile_cross_tenant' };
  if (exactDestinations.length !== 1) {
    return { ok: false, reason: exactDestinations.length ? 'sms_destination_ambiguous' : 'sms_destination_not_found' };
  }

  const binding = exactDestinations[0];
  if (input?.requireInbound === true && binding.sms_inbound_enabled !== true) {
    return { ok: false, reason: 'sms_inbound_not_enabled' };
  }
  if (input?.requireOutbound === true && binding.sms_outbound_enabled !== true) {
    return { ok: false, reason: 'sms_outbound_not_enabled' };
  }
  return {
    ok: true,
    binding,
    bindingId: binding.id,
    bindingKey: binding.binding_key,
    agencyId: binding.agency_id,
    integrationSecretId,
    messagingProfileId,
    destinationE164,
    profileBindingProvenance,
  };
}

async function loadLatestScopedSmsConsent(base44, authority, rawRecipient) {
  if (!authority?.ok) return { ok: false, reason: 'sms_binding_required' };
  const phoneE164 = normalizeTelnyxSmsE164(rawRecipient);
  if (!phoneE164) return { ok: false, reason: 'invalid_sms_consent_recipient' };
  const consentKey = telnyxSmsConsentKey(authority, phoneE164);
  let rows;
  try {
    rows = await base44.asServiceRole.entities.SmsConsent.filter({
      consent_key: consentKey,
      provider: 'telnyx',
      integration_secret_id: authority.integrationSecretId,
      messaging_profile_id: authority.messagingProfileId,
      agency_id: authority.agencyId,
      phone_e164: phoneE164,
    }, '-captured_at', TELNYX_SMS_CONSENT_SCAN_LIMIT + 1);
  } catch {
    return { ok: false, reason: 'sms_consent_read_failed' };
  }
  if (!Array.isArray(rows) || rows.length > TELNYX_SMS_CONSENT_SCAN_LIMIT) {
    return { ok: false, reason: 'sms_consent_read_invalid' };
  }
  for (const row of rows) {
    const provenanceMatches = Array.isArray(authority.profileBindingProvenance)
      && authority.profileBindingProvenance.some((candidate) =>
        row?.destination_binding_id === candidate.bindingId
        && row?.destination_binding_key === candidate.bindingKey
        && row?.destination_e164 === candidate.destinationE164);
    const source = typeof row?.consent_source === 'string' ? row.consent_source : '';
    const status = typeof row?.consent_status === 'string' ? row.consent_status : '';
    const isKeywordStop = source === 'keyword_stop';
    const isKeywordStart = source === 'keyword_start';
    const isKeyword = isKeywordStop || isKeywordStart;
    const providerEventId = boundedTelnyxAuthorityId(row?.provider_event_id);
    const providerMessageId = boundedTelnyxAuthorityId(row?.provider_message_id);
    const capturedAtMs = Date.parse(row?.captured_at || '');
    const occurredAtMs = Date.parse(row?.provider_event_occurred_at || '');
    const capturedBy = isCanonicalTelnyxAuthorityEmail(row?.captured_by)
      ? row.captured_by
      : null;
    const manualSourceMatches = (source === 'manual_opt_in' && status === 'opted_in')
      || (source === 'manual_opt_out' && status === 'opted_out')
      || (source === 'admin_manual' && ['opted_in', 'opted_out', 'unknown'].includes(status));
    const keywordSourceMatches = isKeyword
      && status === (isKeywordStop ? 'opted_out' : 'opted_in')
      && (row?.captured_by ?? null) === null
      && !!providerEventId && row?.provider_event_id === providerEventId
      && !!providerMessageId && row?.provider_message_id === providerMessageId
      && Number.isFinite(occurredAtMs)
      && row?.provider_event_occurred_at === row?.captured_at;
    const manualProvenanceMatches = manualSourceMatches
      && !!capturedBy
      && row?.captured_by === capturedBy
      && row?.provider_event_id == null
      && row?.provider_message_id == null
      && row?.provider_event_occurred_at == null;
    if (row?.consent_key !== consentKey
      || row?.provider !== 'telnyx'
      || row?.integration_secret_id !== authority.integrationSecretId
      || row?.messaging_profile_id !== authority.messagingProfileId
      || row?.agency_id !== authority.agencyId
      || row?.phone_e164 !== phoneE164
      || !provenanceMatches
      || !Number.isFinite(capturedAtMs)
      || (!keywordSourceMatches && !manualProvenanceMatches)) {
      return { ok: false, reason: 'sms_consent_integrity_failed' };
    }
  }
  for (let index = 1; index < rows.length; index += 1) {
    const newest = Date.parse(rows[index - 1].captured_at);
    const runnerUp = Date.parse(rows[index].captured_at);
    if (newest <= runnerUp) {
      return { ok: false, reason: newest === runnerUp
        ? 'sms_consent_latest_ambiguous'
        : 'sms_consent_order_invalid' };
    }
  }
  const newestKeyword = rows.find((row) =>
    row.consent_source === 'keyword_stop' || row.consent_source === 'keyword_start');
  const keywordStopActive = newestKeyword?.consent_source === 'keyword_stop';
  return {
    ok: true,
    row: rows[0] || null,
    effectiveStatus: keywordStopActive ? 'opted_out' : (rows[0]?.consent_status || 'unknown'),
    keywordStopActive,
    phoneE164,
    consentKey,
  };
}
// <<<END SHARED HELPER: telnyxSmsAuthority>>>

// Resolve an outbound number to a patient the CALLER may access. The read is
// service-role (RLS bypassed), so every candidate must be re-authorized before
// it is linked — otherwise a nurse texting a number that also appears on another
// agency's chart (shared landline, family member, stale data) would write their
// message body into that foreign chart. Mirrors scheduleSms, whose canAccessPatient
// gate on phone-resolved patients is pinned by securityGuardrails.test.js.
async function resolvePatientId(base44, e164, canAccessPatient) {
  for (const variant of phoneVariants(e164)) {
    const matches = await base44.asServiceRole.entities.Patient.filter({ phone: variant }, undefined, 5000).catch(() => []);
    for (const match of matches || []) {
      if (match?.id && await canAccessPatient(match)) return match.id;
    }
  }
  return null;
}

// ---- transient-failure retry policy (mirrors src/components/voice/telnyxRetry.js) ----
// We only retry on explicit retryable HTTP statuses and never on a THROWN network
// error for a send — a blind retry could double-text the patient.
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
async function sendWithRetry(
  attemptFn,
  maxAttempts = 3,
) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let result;
    try {
      result = await attemptFn(attempt);
    } catch (err) {
      throw err; // never retry a thrown network error — could double-text.
    }
    if (result.ok || !isRetryableStatus(result.status) || attempt === maxAttempts) {
      return { ...result, attempts: attempt };
    }
    const fromHeader = parseRetryAfter(result.retryAfter ?? null);
    await sleep(fromHeader != null ? Math.min(fromHeader, 4000) : backoffDelayMs(attempt));
  }
  throw new Error('sendWithRetry exhausted attempts');
}

// ---- TCPA quiet hours (mirrors src/components/voice/quietHours.js) ----
// <<<BEGIN SHARED HELPER: areaCodeTimezone — generated, edit base44/_shared/backendHelpers.mjs>>>
const AREA_CODE_TIMEZONE = {
  201: "America/New_York",
  202: "America/New_York",
  203: "America/New_York",
  205: "America/Chicago",
  206: "America/Los_Angeles",
  207: "America/New_York",
  208: "America/Denver",
  209: "America/Los_Angeles",
  210: "America/Chicago",
  212: "America/New_York",
  213: "America/Los_Angeles",
  214: "America/Chicago",
  215: "America/New_York",
  216: "America/New_York",
  217: "America/Chicago",
  218: "America/Chicago",
  220: "America/New_York",
  223: "America/New_York",
  224: "America/Chicago",
  225: "America/Chicago",
  228: "America/Chicago",
  234: "America/New_York",
  239: "America/New_York",
  240: "America/New_York",
  251: "America/Chicago",
  253: "America/Los_Angeles",
  254: "America/Chicago",
  256: "America/Chicago",
  262: "America/Chicago",
  267: "America/New_York",
  272: "America/New_York",
  276: "America/New_York",
  279: "America/Los_Angeles",
  281: "America/Chicago",
  290: "America/New_York",
  301: "America/New_York",
  302: "America/New_York",
  303: "America/Denver",
  304: "America/New_York",
  305: "America/New_York",
  307: "America/Denver",
  309: "America/Chicago",
  310: "America/Los_Angeles",
  312: "America/Chicago",
  314: "America/Chicago",
  316: "America/Chicago",
  318: "America/Chicago",
  319: "America/Chicago",
  320: "America/Chicago",
  321: "America/New_York",
  323: "America/Los_Angeles",
  324: "America/New_York",
  330: "America/New_York",
  331: "America/Chicago",
  334: "America/Chicago",
  337: "America/Chicago",
  339: "America/New_York",
  341: "America/Los_Angeles",
  346: "America/Chicago",
  347: "America/New_York",
  351: "America/New_York",
  352: "America/New_York",
  360: "America/Los_Angeles",
  361: "America/Chicago",
  385: "America/Denver",
  386: "America/New_York",
  401: "America/New_York",
  402: "America/Chicago",
  404: "America/New_York",
  405: "America/Chicago",
  406: "America/Denver",
  407: "America/New_York",
  408: "America/Los_Angeles",
  409: "America/Chicago",
  410: "America/New_York",
  412: "America/New_York",
  413: "America/New_York",
  414: "America/Chicago",
  415: "America/Los_Angeles",
  417: "America/Chicago",
  419: "America/New_York",
  424: "America/Los_Angeles",
  425: "America/Los_Angeles",
  430: "America/Chicago",
  432: "America/Chicago",
  434: "America/New_York",
  435: "America/Denver",
  440: "America/New_York",
  442: "America/Los_Angeles",
  443: "America/New_York",
  447: "America/Chicago",
  469: "America/Chicago",
  470: "America/New_York",
  475: "America/New_York",
  478: "America/New_York",
  479: "America/Chicago",
  480: "America/Phoenix",
  484: "America/New_York",
  501: "America/Chicago",
  502: "America/New_York",
  503: "America/Los_Angeles",
  504: "America/Chicago",
  505: "America/Denver",
  507: "America/Chicago",
  508: "America/New_York",
  509: "America/Los_Angeles",
  510: "America/Los_Angeles",
  512: "America/Chicago",
  513: "America/New_York",
  515: "America/Chicago",
  516: "America/New_York",
  517: "America/New_York",
  518: "America/New_York",
  520: "America/Phoenix",
  530: "America/Los_Angeles",
  540: "America/New_York",
  541: "America/Los_Angeles",
  551: "America/New_York",
  559: "America/Los_Angeles",
  561: "America/New_York",
  562: "America/Los_Angeles",
  563: "America/Chicago",
  564: "America/Los_Angeles",
  567: "America/New_York",
  570: "America/New_York",
  571: "America/New_York",
  573: "America/Chicago",
  575: "America/Denver",
  580: "America/Chicago",
  585: "America/New_York",
  601: "America/Chicago",
  602: "America/Phoenix",
  605: "America/Chicago",
  607: "America/New_York",
  608: "America/Chicago",
  610: "America/New_York",
  612: "America/Chicago",
  614: "America/New_York",
  617: "America/New_York",
  618: "America/Chicago",
  619: "America/Los_Angeles",
  620: "America/Chicago",
  623: "America/Phoenix",
  626: "America/Los_Angeles",
  628: "America/Los_Angeles",
  630: "America/Chicago",
  631: "America/New_York",
  636: "America/Chicago",
  641: "America/Chicago",
  646: "America/New_York",
  650: "America/Los_Angeles",
  651: "America/Chicago",
  657: "America/Los_Angeles",
  660: "America/Chicago",
  661: "America/Los_Angeles",
  667: "America/New_York",
  669: "America/Los_Angeles",
  678: "America/New_York",
  680: "America/New_York",
  682: "America/Chicago",
  689: "America/New_York",
  703: "America/New_York",
  707: "America/Los_Angeles",
  708: "America/Chicago",
  712: "America/Chicago",
  713: "America/Chicago",
  714: "America/Los_Angeles",
  715: "America/Chicago",
  716: "America/New_York",
  717: "America/New_York",
  718: "America/New_York",
  719: "America/Denver",
  720: "America/Denver",
  724: "America/New_York",
  727: "America/New_York",
  731: "America/Chicago",
  732: "America/New_York",
  737: "America/Chicago",
  740: "America/New_York",
  743: "America/New_York",
  747: "America/Los_Angeles",
  754: "America/New_York",
  757: "America/New_York",
  760: "America/Los_Angeles",
  763: "America/Chicago",
  769: "America/Chicago",
  770: "America/New_York",
  772: "America/New_York",
  773: "America/Chicago",
  774: "America/New_York",
  775: "America/Los_Angeles",
  779: "America/Chicago",
  781: "America/New_York",
  785: "America/Chicago",
  786: "America/New_York",
  801: "America/Denver",
  803: "America/New_York",
  804: "America/New_York",
  805: "America/Los_Angeles",
  808: "Pacific/Honolulu",
  810: "America/New_York",
  813: "America/New_York",
  814: "America/New_York",
  815: "America/Chicago",
  816: "America/Chicago",
  817: "America/Chicago",
  818: "America/Los_Angeles",
  820: "America/Los_Angeles",
  828: "America/New_York",
  830: "America/Chicago",
  831: "America/Los_Angeles",
  832: "America/Chicago",
  843: "America/New_York",
  845: "America/New_York",
  847: "America/Chicago",
  848: "America/New_York",
  856: "America/New_York",
  857: "America/New_York",
  858: "America/Los_Angeles",
  859: "America/New_York",
  862: "America/New_York",
  863: "America/New_York",
  864: "America/New_York",
  870: "America/Chicago",
  872: "America/Chicago",
  878: "America/New_York",
  901: "America/Chicago",
  903: "America/Chicago",
  904: "America/New_York",
  907: "America/Anchorage",
  908: "America/New_York",
  909: "America/Los_Angeles",
  910: "America/New_York",
  912: "America/New_York",
  913: "America/Chicago",
  914: "America/New_York",
  915: "America/Denver",
  916: "America/Los_Angeles",
  918: "America/Chicago",
  919: "America/New_York",
  920: "America/Chicago",
  925: "America/Los_Angeles",
  928: "America/Phoenix",
  929: "America/New_York",
  934: "America/New_York",
  936: "America/Chicago",
  937: "America/New_York",
  940: "America/Chicago",
  941: "America/New_York",
  947: "America/New_York",
  949: "America/Los_Angeles",
  951: "America/Los_Angeles",
  952: "America/Chicago",
  954: "America/New_York",
  956: "America/Chicago",
  959: "America/New_York",
  970: "America/Denver",
  971: "America/Los_Angeles",
  972: "America/Chicago",
  979: "America/Chicago",
  980: "America/New_York",
  984: "America/New_York",
  989: "America/New_York",
};
// <<<END SHARED HELPER: areaCodeTimezone>>>
function tzForNumber(raw) {
  const d = String(raw || '').replace(/[^\d]/g, '');
  const ten = d.length === 11 && d.startsWith('1') ? d.slice(1) : d;
  if (ten.length !== 10) return null;
  return AREA_CODE_TIMEZONE[Number(ten.slice(0, 3))] || null;
}
function hourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, hour: '2-digit' }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch { return null; }
}
function quietHoursCheck(toNumber, now, settings) {
  const startHour = Number(settings?.tcpa_quiet_start_hour ?? 8);
  const endHour = Number(settings?.tcpa_quiet_end_hour ?? 21);
  const tz = tzForNumber(toNumber);
  if (!tz) return { allowed: true, reason: 'unknown_timezone' };
  const h = hourInZone(now, tz);
  if (h == null) return { allowed: true, reason: 'unknown_timezone' };
  // Allowed contact window; supports a window that wraps past midnight
  // (start > end). Mirrors isWithinQuietHours in src/components/voice/quietHours.js.
  const allowed = startHour === endHour ? true
    : startHour < endHour ? (h >= startHour && h < endHour)
      : (h >= startHour || h < endHour);
  return { allowed, reason: allowed ? 'within_hours' : 'quiet_hours' };
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
function blockedReasonMessage(reason) {
  switch (reason) {
    case 'premium_number_blocked': return 'Premium-rate numbers (900/976) are blocked.';
    case 'blocked_area_code': return "That area code is blocked by your agency's policy.";
    case 'international_blocked': return 'International destinations are blocked. Ask an admin to enable international sending.';
    case 'invalid_destination': return "That doesn't look like a valid phone number.";
    default: return "That destination isn't allowed.";
  }
}
function monthStartISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    // The exact provider destination is checked against a service-owned binding
    // below, but selecting that destination still begins with a mutable custom
    // User field. Keep general caller enablement paused; only the protected
    // platform owner may cause a provider send until caller-to-binding assignment
    // is itself service-owned.
    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({
        error: 'SMS sending is restricted to the protected platform owner pending telecom-binding migration',
        code: 'telecom_authority_migration_pending',
      }, { status: 503 });
    }

    const { to_number, body, patient_id, media_urls } = await req.json();
    if (!to_number || !body) {
      return Response.json({ error: 'Missing required fields: to_number, body' }, { status: 400 });
    }
    if (typeof body !== 'string') {
      return Response.json({ error: 'Message body must be a string' }, { status: 400 });
    }
    if (body.length > 1600) {
      return Response.json({ error: 'Message is too long (max 1600 characters).' }, { status: 400 });
    }
    // Optional MMS attachments (Telnyx sends an MMS when media_urls is set). Cap
    // the count and require https URLs so a bad payload can't fan out or SSRF.
    let mediaUrls = null;
    if (media_urls != null) {
      if (!Array.isArray(media_urls) || media_urls.length > 10 || !media_urls.every((u) => typeof u === 'string' && /^https:\/\//i.test(u))) {
        return Response.json({ error: 'media_urls must be an array of up to 10 https URLs.' }, { status: 400 });
      }
      mediaUrls = media_urls;
    }

    const fromNumber = user.work_phone_number;
    if (!fromNumber) {
      return Response.json({ error: 'No work number assigned to your account. Ask an admin to provision one.' }, { status: 400 });
    }

    const destination = normalizeE164(to_number);
    if (!destination) {
      return Response.json({ error: 'Invalid destination phone number' }, { status: 400 });
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, messagingProfileId } = telnyxCreds;
    const smsAuthority = await resolveActiveTelnyxSmsBinding(base44, {
      integrationSecretId: telnyxCreds?.record?.id,
      integrationProvider: telnyxCreds?.record?.provider,
      integrationIsActive: telnyxCreds?.record?.is_active === true,
      messagingProfileId,
      destinationE164: fromNumber,
      requireOutbound: true,
    });
    if (!smsAuthority.ok) {
      return Response.json({
        error: 'SMS sending is unavailable pending an exact service-owned destination binding',
        code: 'telecom_authority_migration_pending',
      }, { status: 503 });
    }
    const boundFromNumber = smsAuthority.destinationE164;
    const { settings, smsEnabled } = await getAgencyConfig(base44, user);
    if (!apiKey) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "SMS credentials") }, { status: 500 });
    }
    if (!smsEnabled) {
      return Response.json({ error: 'SMS messaging is disabled for this agency' }, { status: 403 });
    }

    // Cost control: block premium/blocked/international destinations by default.
    const destAllowed = isAllowedDestination(destination, settings);
    if (!destAllowed.allowed) {
      return Response.json({ error: blockedReasonMessage(destAllowed.reason), reason: destAllowed.reason }, { status: 403 });
    }

    // Cost control: enforce an optional monthly outbound-SMS cap for THIS
    // agency. Counting every tenant's outbound rows made one busy agency trip
    // every other agency's cap. Scope by nurse_email ∈ caller's agency when known.
    const monthlyCap = Number(settings?.monthly_sms_cap);
    if (Number.isFinite(monthlyCap) && monthlyCap > 0) {
      const since = monthStartISO();
      let agencyNurseEmails = null;
      if (user.agency_name) {
        const agencyUsers = await base44.asServiceRole.entities.User
          .filter({ agency_name: user.agency_name }, '-created_date', 5000)
          .catch(() => []);
        agencyNurseEmails = new Set(
          (Array.isArray(agencyUsers) ? agencyUsers : []).map((u) => u?.email).filter(Boolean)
        );
        agencyNurseEmails.add(user.email);
      }
      const fetchLimit = agencyNurseEmails
        ? Math.min(Math.max(monthlyCap * 20, monthlyCap), 5000)
        : monthlyCap;
      const recentOutbound = await base44.asServiceRole.entities.SmsMessage
        .filter({ direction: 'outbound' }, '-created_date', fetchLimit)
        .catch(() => []);
      const sentThisMonth = (Array.isArray(recentOutbound) ? recentOutbound : [])
        .filter((m) => m.created_date && m.created_date >= since)
        .filter((m) => !agencyNurseEmails || (m.nurse_email && agencyNurseEmails.has(m.nurse_email))
          || m.sent_by === user.email)
        .length;
      if (sentThisMonth >= monthlyCap) {
        return Response.json({ error: 'This agency has reached its monthly text-message limit. Ask an admin to raise the cap.', reason: 'monthly_cap_reached' }, { status: 429 });
      }
    }

    // TCPA: refuse to text without prior express consent on file. Opted-out is
    // blocked; so is `unknown` / missing — care messaging without recorded
    // consent is still a TCPA risk. Staff must record opt-in (or the patient
    // must text START) before outbound texts.
    const scopedConsent = await loadLatestScopedSmsConsent(base44, smsAuthority, destination);
    if (!scopedConsent.ok) {
      return Response.json({
        error: 'SMS consent could not be verified in the bound tenant scope',
        reason: 'consent_scope_unavailable',
      }, { status: 503 });
    }
    const consentStatus = scopedConsent.effectiveStatus;
    if (consentStatus === 'opted_out') {
      return Response.json({ error: 'This patient has opted out of text messages (replied STOP).' }, { status: 403 });
    }
    if (consentStatus !== 'opted_in') {
      return Response.json({
        error: 'No texting consent is on file for this number. Record opt-in before sending.',
        reason: 'consent_required',
      }, { status: 403 });
    }

    // TCPA quiet hours (recipient timezone). Hard block when enabled.
    // Missing settings rows default to enabled (schema default is true) so a
    // fresh agency without AgencySettings configured still gets TCPA protection.
    if (settings?.tcpa_quiet_hours_enabled !== false) {
      const q = quietHoursCheck(destination, new Date(), settings);
      if (!q.allowed) {
        return Response.json(
          { error: "It's outside the recipient's allowed texting hours (TCPA quiet hours). Schedule this text for daytime in their timezone instead.", reason: q.reason },
          { status: 403 },
        );
      }
    }

    // Caller-access predicate for a service-role-fetched patient. Same tiers as
    // scheduleSms: platform admin / creator / assigned nurse pass directly; an
    // agency-scoped admin passes only when the chart belongs to their agency
    // (fails closed without an agency_name).
    const canAccessPatient = async (claimed) => {
      if (!claimed) return false;
      if (claimed.agency_id !== smsAuthority.agencyId) return false;
      const isAssigned = Array.isArray(claimed.assigned_nurses)
        && claimed.assigned_nurses.includes(user.email);
      return isProtectedSuperAdmin(user)
        || claimed.created_by === user.email
        || isAssigned;
    };

    // Prefer phone→patient resolution (only to a chart the caller can access).
    // If the client supplied a patient_id, verify it matches the destination
    // phone (or that the caller can access that chart) so SMS history cannot be
    // linked to the wrong — or another tenant's — patient.
    let resolvedPatientId = await resolvePatientId(base44, destination, canAccessPatient);
    if (patient_id) {
      if (resolvedPatientId && resolvedPatientId !== patient_id) {
        return Response.json({
          error: 'patient_id does not match the destination phone number',
          reason: 'patient_phone_mismatch',
        }, { status: 400 });
      }
      if (!resolvedPatientId) {
        const [claimed] = await base44.asServiceRole.entities.Patient
          .filter({ id: patient_id }, '', 1).catch(() => []);
        if (!claimed) {
          return Response.json({ error: 'Patient not found' }, { status: 404 });
        }
        if (!(await canAccessPatient(claimed))) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
        // Phone didn't resolve but caller has access — keep the explicit link.
        resolvedPatientId = patient_id;
      } else {
        resolvedPatientId = patient_id;
      }
    }
    const clientMessageId = crypto.randomUUID();

    // Log the message before sending so we always have a record.
    const smsRow = await base44.asServiceRole.entities.SmsMessage.create({
      direction: 'outbound',
      from_number: boundFromNumber,
      to_number: destination,
      body,
      nurse_email: user.email,
      patient_id: resolvedPatientId || null,
      thread_id: getThreadId(boundFromNumber, destination),
      status: 'queued',
      client_message_id: clientMessageId,
      is_read: true,
      sent_by: user.email,
      consent_checked: consentStatus === 'opted_in',
    });

    // Send via the Telnyx Messages API. Bounded by an AbortController timeout.
    // Only retries on explicit retryable HTTP statuses — never on a thrown
    // network error (Telnyx has no client idempotency key for messages, so a
    // blind retry could double-text).
    const telnyxUrl = 'https://api.telnyx.com/v2/messages';
    const SEND_TIMEOUT_MS = 15000;
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
    const webhookUrl = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;
    let result;
    try {
      result = await sendWithRetry(async () => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
        try {
          const payload = { from: boundFromNumber, to: destination, text: body };
          if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
          if (mediaUrls) payload.media_urls = mediaUrls; // MMS
          if (webhookUrl) payload.webhook_url = webhookUrl;
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
        ? `Timed out after ${SEND_TIMEOUT_MS} ms reaching Telnyx`
        : `Network error reaching Telnyx: ${netErr.message}`;
      await base44.asServiceRole.entities.SmsMessage
        .update(smsRow.id, { status: 'failed', failure_reason: reason }).catch(() => {});
      return Response.json(
        { error: aborted ? 'Telnyx SMS API timed out' : 'Failed to reach Telnyx SMS API', details: netErr.message },
        { status: aborted ? 504 : 502 },
      );
    }

    const data = result.data || {};

    if (!result.ok) {
      // Telnyx error envelope: { errors: [{ detail, title, code }] }.
      const firstErr = Array.isArray(data?.errors) ? data.errors[0] : null;
      await base44.asServiceRole.entities.SmsMessage.update(smsRow.id, {
        status: 'failed',
        failure_reason: firstErr?.detail || firstErr?.title || `Telnyx API error (${result.status})`,
      });
      return Response.json({ error: 'Telnyx SMS API error', details: data }, { status: result.status });
    }

    // Telnyx success envelope: { data: { id, to: [{ status }], ... } }.
    const messageId = data?.data?.id || null;
    const recipientStatus = (data?.data?.to?.[0]?.status || '').toLowerCase();
    await base44.asServiceRole.entities.SmsMessage.update(smsRow.id, {
      provider_message_id: messageId,
      status: recipientStatus === 'queued' || recipientStatus === 'sending' || recipientStatus === '' ? 'queued' : 'sent',
    });

    // Keep delivery identifiers, endpoints, patient linkage, and message
    // characteristics on SmsMessage. UserActivity only needs a correlation key
    // plus a non-identifying outcome category.
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'sms_sent',
      entity_type: 'SmsMessage',
      entity_id: smsRow.id,
      details: {
        provider: 'telnyx',
        direction: 'outbound',
      },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, message_id: smsRow.id, provider_message_id: messageId, status: 'sent' });
  } catch (error) {
    console.error('sendTelnyxSms error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
