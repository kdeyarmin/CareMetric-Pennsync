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

// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

/**
 * dispatchScheduledSms — cron job that sends due ScheduledSms rows. Configure a
 * schedule (e.g. every 5 minutes) for this function in the Base44 dashboard.
 *
 * For each pending row whose send_at has passed it: claims the row (pending ->
 * sending) so overlapping runs don't double-send, re-checks the agency kill
 * switch and the patient's opt-out at send time, sends via Telnyx Messages API,
 * records an SmsMessage in the nurse's thread, and marks the ScheduledSms
 * sent/failed. Bodies are never written to the audit log.
 */

const SEND_TIMEOUT_MS = 15000;
const BATCH_LIMIT = 100;
// Scheduled sends still pending this long after their send_at when the dispatcher
// runs (e.g. after cron downtime) are expired instead of delivered — a day-late
// reminder is worse than none. Mirrors redriveFailedSms' 24h ceiling.
const MAX_SCHEDULE_AGE_MS = 24 * 60 * 60 * 1000;

async function getAgencyConfig(base44, agencyHint) {
  // Prefer a settings row matching the nurse/agency when multi-tenant rows exist.
  let settings = [];
  if (agencyHint) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: agencyHint }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: agencyHint }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    const newest = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 5).catch(() => []);
    if ((newest || []).length > 1) {
      return { settings: {}, smsEnabled: false, missingAgencySettings: true };
    }
    settings = (newest || []).slice(0, 1);
  }
  const s = settings[0] || {};
  return {
    settings: s,
    smsEnabled: s.sms_messaging_enabled ?? true,
  };
}

// ---- transient-failure retry policy (mirrors src/components/voice/telnyxRetry.js) ----
// Telnyx has no client idempotency key for a message-create request, so we retry only a
// status that proves the send was not processed (408/425/429/503). 500/502/504
// can follow an accepted message, and a THROWN error (a timeout above all) can
// follow a request Telnyx received; neither is retried — a blind retry could
// double-text. Held to telnyxRetry.js by telnyxRetryInlineParity.test.js.
// Capped at 2 attempts here so a batch of up to BATCH_LIMIT rows stays bounded;
// a row that still fails is retried on the next cron tick only if re-queued.
const MAX_SEND_ATTEMPTS = 2;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 503]);
function isRetryableStatus(status) {
  return RETRYABLE_STATUSES.has(Number(status));
}
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

async function sendOnce(apiKey, messagingProfileId, from, to, body, webhookUrl) {
  const url = `https://api.telnyx.com/v2/messages`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    const payload = { from, to, text: body };
    if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
    if (webhookUrl) payload.webhook_url = webhookUrl;
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data, retryAfter: resp.headers.get('retry-after') };
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelnyx(apiKey, messagingProfileId, from, to, body, webhookUrl) {
  for (let attempt = 1; attempt <= MAX_SEND_ATTEMPTS; attempt++) {
    let result;
    try {
      result = await sendOnce(apiKey, messagingProfileId, from, to, body, webhookUrl);
    } catch (err) {
      // Do NOT retry thrown network errors — a blind retry could double-text.
      throw err;
    }
    if (result.ok || !isRetryableStatus(result.status) || attempt === MAX_SEND_ATTEMPTS) {
      return { ok: result.ok, status: result.status, data: result.data };
    }
    const fromHeader = parseRetryAfter(result.retryAfter ?? null);
    await sleep(fromHeader != null ? Math.min(fromHeader, 4000) : backoffDelayMs(attempt));
  }
  throw new Error('sendTelnyx exhausted attempts');
}

// ---- send outcome: failure_reason format + accepted status (smsRedrive.js) ----
// <<<BEGIN SHARED HELPER: telnyxSmsOutcome — generated, edit base44/_shared/backendHelpers.mjs>>>
// Generated verbatim from src/components/messaging/smsRedrive.js and
// src/components/voice/telnyxRetry.js.
const TELNYX_OPT_OUT_ERROR_CODE = "40300";
const CONNECT_PHASE_FAILURE = /\b(?:ECONNREFUSED|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH|ENETUNREACH)\b|getaddrinfo|dns error|failed to lookup address|tcp connect error|client error \(Connect\)|connection refused/i;
function connectionNeverOpened(err) {
  if (!err || err.name === "AbortError" || err.name === "TimeoutError") return false;
  const cause = err.cause && typeof err.cause === "object" ? err.cause : {};
  return [err.code, err.message, cause.code, cause.message]
    .some((part) => typeof part === "string" && CONNECT_PHASE_FAILURE.test(part));
}
function telnyxErrorCode(errors) {
  const first = Array.isArray(errors) ? errors[0] : null;
  const raw = first && (typeof first.code === "string" || typeof first.code === "number")
    ? String(first.code).trim() : "";
  return /^\d{1,10}$/.test(raw) ? raw : null;
}
function telnyxErrorsInclude(errors, code) {
  return Array.isArray(errors) && errors.some((error) => !!error
    && (typeof error.code === "string" || typeof error.code === "number")
    && String(error.code).trim() === code);
}
function telnyxApiFailureReason(httpStatus, errors) {
  const status = Number(httpStatus);
  const shown = Number.isInteger(status) && status >= 100 && status <= 599 ? status : 0;
  const first = Array.isArray(errors) ? errors[0] : null;
  const detail = String((first && (first.detail || first.title)) || "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return `Telnyx API error: HTTP ${shown}, code ${telnyxErrorCode(errors) || "none"}${detail ? `: ${detail}` : ""}`;
}
function telnyxTransportFailureReason(err, timeoutMs) {
  if (err && (err.name === "AbortError" || err.name === "TimeoutError")) {
    return `Outcome unknown: Telnyx did not answer within ${timeoutMs} ms, so the text may have been sent. Not retried automatically.`;
  }
  if (connectionNeverOpened(err)) {
    return "Connection never opened: Telnyx could not be reached, so the text was not sent.";
  }
  return "Outcome unknown: the connection to Telnyx failed after the request may have been sent. Not retried automatically.";
}
function telnyxDeliveryFailureReason(errors) {
  const first = Array.isArray(errors) ? errors[0] : null;
  const detail = String((first && (first.detail || first.title)) || "")
    .replace(/\s+/g, " ").trim().slice(0, 300);
  return `Telnyx delivery failed: code ${telnyxErrorCode(errors) || "none"}${detail ? `: ${detail}` : ""}`;
}
function telnyxSendStatus(responseBody) {
  const to = responseBody && responseBody.data && Array.isArray(responseBody.data.to)
    ? responseBody.data.to[0] : null;
  const status = String((to && to.status) || "").toLowerCase();
  return status === "queued" || status === "sending" || status === "" ? "queued" : "sent";
}
// <<<END SHARED HELPER: telnyxSmsOutcome>>>

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

// ---- TCPA quiet hours (mirrors src/components/voice/quietHours.js) ----
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
  } catch {
    return null;
  }
}
/** TCPA quiet-hours check in the RECIPIENT's timezone. Fails open when unknown. */
function quietHoursCheck(toNumber, now, settings) {
  const startHour = Number(settings?.tcpa_quiet_start_hour ?? 8);
  const endHour = Number(settings?.tcpa_quiet_end_hour ?? 21);
  const tz = tzForNumber(toNumber);
  if (!tz) return { allowed: true, reason: 'unknown_timezone' };
  const h = hourInZone(now, tz);
  if (h == null) return { allowed: true, reason: 'unknown_timezone' };
  // Allowed contact window; supports a window that wraps past midnight
  // (start > end). Mirrors quietHoursCheck in sendSms / isWithinQuietHours.
  const allowed = startHour === endHour ? true
    : startHour < endHour ? (h >= startHour && h < endHour)
      : (h >= startHour || h < endHour);
  return { allowed, reason: allowed ? 'within_hours' : 'quiet_hours' };
}

// ---- cost controls (mirrors sendSms / src/components/voice/costControls.js) ----
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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

function monthStartISO(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Released 2026-10-08 (owner decision) and scheduled by the "Dispatch
// Scheduled SMS" workflow. At send time every row re-proves, from
// service-owned sources only: its sending number is still an active,
// outbound-enabled TelecomDestinationBinding; the nurse who scheduled it still
// holds an active membership in that line's agency; and the recipient's
// consent in that binding's scope (a provider STOP wins) is opted_in. The
// legacy phone-only SmsConsent lookup is gone.
const normalizeDispatchEmail = (value) => String(value || '').trim().toLowerCase();

Deno.serve(async (req) => {
  if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('sms');

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Authorization: privileged cron job (service-role reads/writes + billable Telnyx sends, no end user). Only admins or the configured scheduler secret may invoke it.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, messagingProfileId } = telnyxCreds;

    // Bail out BEFORE claiming any row when Telnyx credentials are unavailable.
    // This guard used to sit inside the per-row loop and call fail(), which set
    // status 'failed' permanently — and since this cron only ever reads
    // status:'pending', every appointment and medication reminder that came due
    // during a credential outage was destroyed: restoring the key sent none of
    // them, and the nurse's own pending list (ScheduledSmsList) silently dropped
    // them with no failure indicator. A missing/unreadable credential is an
    // agency-wide infrastructure problem, not a per-message one, so leave the
    // queue untouched and let the next run send it. Rows that genuinely go stale
    // are still expired by the MAX_SCHEDULE_AGE_MS check below, so this cannot
    // requeue forever.
    if (!apiKey) {
      const reason = telnyxCredsMessage(telnyxCreds, 'SMS credentials');
      console.error(`dispatchScheduledSms: no dispatch attempted — ${reason}`);
      return Response.json({ success: false, error: reason, processed: 0, sent: 0, failed: 0, skipped: 0 }, { status: 500 });
    }

    // Resolve agency config PER ROW from the sending nurse. A single unhinted
    // getAgencyConfig() returns smsEnabled:false whenever more than one tenant's
    // AgencySettings row exists (the normal multi-tenant state), which used to
    // fail() every due reminder on every tick — the same queue-destruction hazard
    // the credential guard above fixed. Cache the nurse->agency and agency->config
    // lookups so the loop stays cheap.
    const nurseAgencyCache = new Map();
    const agencyConfigCache = new Map();
    const resolveRowConfig = async (nurseEmail) => {
      const key = String(nurseEmail || '');
      let agencyName = nurseAgencyCache.get(key);
      if (agencyName === undefined) {
        const [u] = key
          ? await base44.asServiceRole.entities.User.filter({ email: key }, undefined, 1).catch(() => [])
          : [];
        agencyName = String(u?.agency_name || '').trim();
        nurseAgencyCache.set(key, agencyName);
      }
      if (!agencyConfigCache.has(agencyName)) {
        agencyConfigCache.set(agencyName, await getAgencyConfig(base44, agencyName));
      }
      return agencyConfigCache.get(agencyName);
    };
    // The monthly-cap cohort is sendSms's: the sending LINE's agency, counted as
    // rows stamped with that agency_id plus rows written by its active members
    // (AgencyMembership, service-owned). It used to be every User whose
    // self-editable agency_name matched the nurse's, so one edited profile could
    // move a nurse's texts into another agency's count. Null when the
    // memberships cannot be read (the row is released, not sent uncapped).
    const agencyCohortCache = new Map();
    const resolveAgencyCohort = async (agencyId) => {
      if (agencyCohortCache.has(agencyId)) return agencyCohortCache.get(agencyId);
      let rows;
      try {
        rows = await base44.asServiceRole.entities.AgencyMembership
          .filter({ agency_id: agencyId, status: 'active' }, undefined, 5001);
      } catch {
        rows = null;
      }
      const cohort = Array.isArray(rows) && rows.length <= 5000
        ? new Set(rows
          .filter((member) => member?.agency_id === agencyId && member?.status === 'active')
          .map((member) => normalizeDispatchEmail(member?.user_email_normalized))
          .filter(Boolean))
        : null;
      agencyCohortCache.set(agencyId, cohort);
      return cohort;
    };
    // A unique id for THIS cron run, used to claim rows (see the claim below).
    const runId = crypto.randomUUID();

    // Sending-line authority per from_number and membership per (agency, nurse),
    // each resolved once per run.
    const lineAuthorityCache = new Map();
    const resolveLineAuthority = async (fromNumber) => {
      const key = String(fromNumber || '');
      if (!lineAuthorityCache.has(key)) {
        lineAuthorityCache.set(key, await resolveActiveTelnyxSmsBinding(base44, {
          integrationSecretId: telnyxCreds?.record?.id,
          integrationProvider: telnyxCreds?.record?.provider,
          integrationIsActive: telnyxCreds?.record?.is_active === true,
          messagingProfileId,
          destinationE164: key,
          requireOutbound: true,
        }));
      }
      return lineAuthorityCache.get(key);
    };
    const membershipCache = new Map();
    const nurseIsActiveMember = async (agencyId, nurseEmail) => {
      const email = normalizeDispatchEmail(nurseEmail);
      const key = `${agencyId}|${email}`;
      if (!membershipCache.has(key)) {
        const rows = email
          ? await base44.asServiceRole.entities.AgencyMembership
            .filter({ agency_id: agencyId, user_email_normalized: email, status: 'active' }, undefined, 2)
            .catch(() => null)
          : [];
        membershipCache.set(key, Array.isArray(rows) ? rows.some((row) => row?.agency_id === agencyId
          && row?.user_email_normalized === email && row?.status === 'active') : null);
      }
      return membershipCache.get(key);
    };

    // Reconcile terminal delivery status via the DLR webhook (mirrors sendSms).
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
    const statusCallback = functionsBaseUrl ? `${functionsBaseUrl}/handleTelnyxStatusWebhook` : undefined;

    const nowIso = new Date().toISOString();
    // Pending rows that are due. (Base44 filter operators may vary; fetch a
    // batch of pending rows and filter by time in code to stay portable.)
    const pending = await base44.asServiceRole.entities.ScheduledSms
      .filter({ status: 'pending' }, 'send_at', BATCH_LIMIT).catch(() => []);
    const due = pending.filter((r) => r.send_at && r.send_at <= nowIso);

    const result = { processed: 0, sent: 0, failed: 0, skipped: 0 };

    for (const row of due) {
      // Claim with a per-run token, then RE-READ to confirm we still own it.
      // This read-after-write check makes overlapping runs far safer than a bare
      // status flip (the loser sees the winner's token and skips). Since Telnyx
      // has no client idempotency key, the claim+re-read is the primary
      // double-send prevention — we do NOT retry thrown network errors either.
      try {
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'sending', claimed_by: runId, claimed_at: new Date().toISOString(),
        });
      } catch {
        result.skipped++;
        continue;
      }
      const claimCheck = await base44.asServiceRole.entities.ScheduledSms
        .filter({ id: row.id }, '-created_date', 1).catch(() => []);
      if (!claimCheck[0] || claimCheck[0].claimed_by !== runId) {
        result.skipped++;
        continue;
      }
      // A cancel can race the claim two ways: it can land between the due-list
      // fetch and the claim (the claim then overwrites status 'canceled' back to
      // 'sending' — but canceled_at survives), or between the claim and this
      // re-read (claimed_by still matches). Either way the user explicitly
      // canceled; honoring the send would text a patient after a cancel.
      // canceled_at is the reliable signal because the claim never clears it.
      if (claimCheck[0].canceled_at || claimCheck[0].status === 'canceled') {
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'canceled', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        result.skipped++;
        continue;
      }
      result.processed++;

      const fail = async (reason) => {
        result.failed++;
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'failed', failure_reason: reason, attempts: (row.attempts || 0) + 1,
        }).catch(() => {});
      };

      // Expire sends that are too stale to be relevant (e.g. after cron downtime)
      // rather than blasting every overdue reminder at once on resume.
      const sendAtMs = Date.parse(row.send_at);
      if (Number.isFinite(sendAtMs) && Date.now() - sendAtMs > MAX_SCHEDULE_AGE_MS) {
        await fail('Scheduled send expired (older than 24h) before dispatch');
        continue;
      }

      // Resolve THIS row's agency config from the nurse who scheduled it.
      const cfg = await resolveRowConfig(row.nurse_email);
      if (cfg.missingAgencySettings) {
        // Could not resolve this row's agency among multiple tenant rows — an
        // agency-resolution problem, not a per-message one. Release the claim to
        // pending so a later run (or a corrected agency mapping) can send it,
        // instead of destroying the reminder. Staleness is still bounded by the
        // MAX_SCHEDULE_AGE_MS expiry above.
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'pending', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        result.skipped++;
        continue;
      }
      const settings = cfg.settings;
      if (!cfg.smsEnabled) { await fail('SMS messaging disabled for the agency'); continue; }

      // Cost control: block premium/blocked/international destinations by default
      // (mirrors sendSms). A blocked destination is terminal — fail the row.
      const destAllowed = isAllowedDestination(row.to_number, settings);
      if (!destAllowed.allowed) { await fail(`Destination blocked at send time: ${destAllowed.reason}`); continue; }

      // The sending number must still be an active, outbound-enabled agency
      // line, and the nurse who scheduled the text must still belong to it.
      const lineAuthority = await resolveLineAuthority(row.from_number);
      if (!lineAuthority?.ok) { await fail('Sending line is no longer an active agency texting line'); continue; }
      const stillMember = await nurseIsActiveMember(lineAuthority.agencyId, row.nurse_email);
      if (stillMember === null) {
        // Membership could not be read: an infrastructure problem, not a
        // per-message one. Release the claim; staleness is bounded above.
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'pending', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        result.skipped++;
        continue;
      }
      if (!stillMember) { await fail('The scheduling user no longer has an active agency membership'); continue; }

      // Cost control: enforce the optional monthly outbound-SMS cap for the
      // LINE's agency, counted exactly as sendSms counts it (rows stamped with
      // the agency, or written by its active members). Counting every tenant's
      // outbound rows made one busy agency trip every other agency's cap. When
      // the cap is already reached — or the cohort cannot be read — leave the row
      // pending so a later run (next month / after the cap is raised) can pick
      // it up rather than failing a scheduled reminder outright.
      const monthlyCap = Number(settings?.monthly_sms_cap);
      if (Number.isFinite(monthlyCap) && monthlyCap > 0) {
        const since = monthStartISO();
        const agencyId = lineAuthority.agencyId;
        const cohort = await resolveAgencyCohort(agencyId);
        const agencyNurseEmails = cohort ? new Set(cohort).add(normalizeDispatchEmail(row.nurse_email)) : null;
        const recentOutbound = agencyNurseEmails
          ? await base44.asServiceRole.entities.SmsMessage
            .filter({ direction: 'outbound' }, '-created_date', Math.min(Math.max(monthlyCap * 20, monthlyCap), 5000))
            .catch(() => [])
          : [];
        const sentThisMonth = (Array.isArray(recentOutbound) ? recentOutbound : [])
          .filter((m) => m.created_date && m.created_date >= since)
          .filter((m) => m.agency_id === agencyId
            || agencyNurseEmails.has(normalizeDispatchEmail(m.nurse_email)))
          .length;
        if (!agencyNurseEmails || sentThisMonth >= monthlyCap) {
          await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
            status: 'pending', claimed_by: '', claimed_at: null,
          }).catch(() => {});
          result.skipped++;
          continue;
        }
      }

      // Re-check consent at send time in the bound scope. Require explicit
      // opted_in — unknown/missing is not sufficient for TCPA. A consent read
      // that cannot be verified releases the row rather than sending.
      const scopedConsent = await loadLatestScopedSmsConsent(base44, lineAuthority, row.to_number);
      if (!scopedConsent.ok) {
        await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
          status: 'pending', claimed_by: '', claimed_at: null,
        }).catch(() => {});
        result.skipped++;
        continue;
      }
      if (scopedConsent.effectiveStatus === 'opted_out') {
        await fail('Recipient opted out before the scheduled send');
        continue;
      }
      if (scopedConsent.effectiveStatus !== 'opted_in') { await fail('No texting consent on file at send time'); continue; }

      // TCPA quiet hours (recipient timezone). When enabled and the recipient is
      // in their quiet hours, leave the row pending to retry on a later run.
      if (settings?.tcpa_quiet_hours_enabled !== false) {
        const q = quietHoursCheck(row.to_number, new Date(), settings);
        if (!q.allowed) {
          await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
            status: 'pending', claimed_by: '', claimed_at: null,
          }).catch(() => {});
          result.skipped++;
          continue;
        }
      }

      // The deterministic `sched-${row.id}` clientMessageId is kept in the
      // SmsMessage record for our own tracking but is NOT sent to Telnyx —
      // Telnyx has no client idempotency key. Double-send is prevented by the
      // claim+re-read above and by not retrying thrown network errors.
      const clientMessageId = `sched-${row.id}`;
      let resp;
      try {
        resp = await sendTelnyx(apiKey, messagingProfileId, lineAuthority.destinationE164, row.to_number, row.body, statusCallback);
      } catch (netErr) {
        // A timeout may have been accepted ("Outcome unknown"); only a
        // connection that never opened says the text was not sent.
        await fail(telnyxTransportFailureReason(netErr, SEND_TIMEOUT_MS));
        continue;
      }

      if (!resp.ok) {
        await fail(telnyxApiFailureReason(resp.status, resp.data?.errors));
        continue;
      }

      const providerMessageId = resp.data?.data?.id || null;
      // Record the sent message in the nurse's thread so it shows in their inbox,
      // with the same fields sendSms writes: the status Telnyx answered
      // (accepted is 'queued' until the delivery receipt says more, never a
      // blanket 'sent'), and the provenance redriveFailedSms requires and
      // re-proves — the line's agency and the exact binding it was sent from.
      // Without them a scheduled text was invisible to the redrive, to the
      // agency's monthly cap and to inbound reply attribution.
      const smsRow = await base44.asServiceRole.entities.SmsMessage.create({
        direction: 'outbound',
        from_number: lineAuthority.destinationE164,
        to_number: row.to_number,
        body: row.body,
        nurse_email: row.nurse_email,
        patient_id: row.patient_id || null,
        thread_id: row.thread_id,
        status: telnyxSendStatus(resp.data),
        provider_message_id: providerMessageId,
        client_message_id: clientMessageId,
        is_read: true,
        sent_by: row.nurse_email,
        consent_checked: true,
        agency_id: lineAuthority.agencyId,
        destination_binding_id: lineAuthority.bindingId,
      }).catch(() => { console.error('dispatchScheduledSms: inbox copy write failed'); return null; });

      // Telnyx ACCEPTED the text (accepted, not delivered — the receipt on the
      // SmsMessage says that), so the scheduled row is 'sent' regardless; but if
      // we couldn't write the inbox copy, note it so the gap is visible rather
      // than silently losing the conversation record.
      await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
        status: 'sent',
        provider_message_id: providerMessageId,
        sent_at: new Date().toISOString(),
        sms_message_id: smsRow?.id || null,
        failure_reason: smsRow ? null : 'Sent to patient, but failed to record a copy in the nurse inbox',
        attempts: (row.attempts || 0) + 1,
      }).catch(() => {});

      await base44.asServiceRole.entities.UserActivity.create({
        user_email: row.nurse_email || 'system',
        action: 'scheduled_sms_sent',
        entity_type: 'ScheduledSms',
        entity_id: row.id,
        details: { provider: 'telnyx', direction: 'outbound' },
        status: 'success',
      }).catch(() => {});
      result.sent++;
    }

    return Response.json({ success: true, ...result, checked_at: nowIso });
  } catch {
    console.error('dispatchScheduledSms failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});