import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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

// <<<BEGIN SHARED HELPER: faxQueueCreationReservation — generated, edit base44/_shared/backendHelpers.mjs>>>
async function faxQueueCreationKey(kind, resourceKey) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([kind, resourceKey]))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function reserveFaxQueueCreation(entities, agencyId, kind, resourceKey) {
  const key = await faxQueueCreationKey(kind, resourceKey);
  const rows = await entities.Agency.filter({ id: agencyId }, undefined, 2);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== agencyId
    || !['active', 'trial'].includes(rows[0].status)
    || !Number.isFinite(Date.parse(rows[0].updated_date || ''))) return null;
  const agency = rows[0];
  const previous = agency.fax_workflow_reservations;
  if (previous != null && (typeof previous !== 'object' || Array.isArray(previous))) return null;
  const reservations = previous || {};
  if (Object.keys(reservations).length >= 500 || Object.hasOwn(reservations, key)) return null;
  const token = crypto.randomUUID();
  const result = await entities.Agency.updateMany({
    id: agencyId, status: agency.status, updated_date: agency.updated_date,
    fax_workflow_reservations: Object.hasOwn(agency, 'fax_workflow_reservations')
      ? previous : { $exists: false },
  }, { $set: { fax_workflow_reservations: { ...reservations, [key]: token } } }).catch(() => null);
  if (result?.success !== true || result.updated !== 1 || result.has_more !== false) {
    await releaseFaxQueueCreation(entities, { agencyId, key, token }).catch(() => false);
    return null;
  }
  const verified = await entities.Agency.filter({ id: agencyId }, undefined, 2).catch(() => null);
  if (!Array.isArray(verified) || verified.length !== 1 || verified[0]?.id !== agencyId
    || verified[0].fax_workflow_reservations?.[key] !== token) {
    await releaseFaxQueueCreation(entities, { agencyId, key, token }).catch(() => false);
    return null;
  }
  return { agencyId, key, token };
}
async function releaseFaxQueueCreation(entities, reservation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let rows;
    try {
      rows = await entities.Agency.filter({ id: reservation.agencyId }, undefined, 2);
    } catch (error) {
      if (await waitFaxReservationThrottle(error, attempt)) continue;
      return false;
    }
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== reservation.agencyId) return false;
    const row = rows[0];
    const previous = row.fax_workflow_reservations;
    if (previous == null || !Object.hasOwn(previous, reservation.key)) return true;
    if (previous[reservation.key] !== reservation.token) return false;
    const remaining = { ...previous };
    delete remaining[reservation.key];
    let writeError;
    const result = await entities.Agency.updateMany({
      id: row.id, updated_date: row.updated_date, fax_workflow_reservations: previous,
    }, { $set: { fax_workflow_reservations: remaining } }).catch(error => { writeError = error; return null; });
    if (result?.success === true && result.updated === 1 && result.has_more === false) return true;
    if (writeError && Number(writeError.response?.status ?? writeError.status) === 429
      && !await waitFaxReservationThrottle(writeError, attempt)) return false;
    // A different key can change this shared map. Reload without dropping that
    // writer's entry; a lost successful response is also recovered by absence.
  }
  return false;
}
async function waitFaxReservationThrottle(error, attempt) {
  if (Number(error?.response?.status ?? error?.status) !== 429 || attempt >= 4) return false;
  const retryAfterRaw = error?.response?.headers?.['retry-after'] ?? error?.headers?.['retry-after'] ?? 0;
  const retryAfter = Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw)
    : (Date.parse(String(retryAfterRaw)) - Date.now()) / 1000;
  // Longer throttles remain fenced for the next same-key request. Short ones
  // get at most 11 seconds of total backoff; never retry a known longer limit early.
  const delay = Math.min(1000 * 2 ** attempt, 4000);
  if (Number.isFinite(retryAfter) && retryAfter * 1000 > delay) return false;
  await new Promise(resolve => setTimeout(resolve, delay));
  return true;
}
async function releaseRecoveredFaxQueueCreation(entities, agencyId, kind, resourceKey, child) {
  const token = child?.queue_creation_reservation_token;
  if (token == null) return true; // Pre-protocol children have no reservation.
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) return false;
  return releaseFaxQueueCreation(entities, {
    agencyId, key: await faxQueueCreationKey(kind, resourceKey), token,
  });
}
// <<<END SHARED HELPER: faxQueueCreationReservation>>>

/**
 * handleTelnyxStatusWebhook — the single inbound webhook for the whole Telnyx
 * integration: messaging (inbound SMS + delivery status), fax status, and voice
 * (Call Control inbound IVR + outbound masked-bridge + call status). Telnyx POSTs
 * a JSON envelope `{ data: { event_type, payload } }` and signs it with Ed25519:
 *   signed message = `${telnyx-timestamp}|${rawBody}`
 *   header `telnyx-signature-ed25519` = base64(signature)
 * verified against the account's Ed25519 PUBLIC key (Portal → Keys & Credentials).
 *
 * Fails closed: a webhook without a valid signature (or with a stale timestamp)
 * is rejected 401, because these events mutate delivery state for PHI-bearing
 * messages/faxes/calls and drive auto-replies / call routing. Value-mapping logic
 * mirrors src/components/integrations/telnyx/telnyxUtils.js (drift-guarded by
 * base44/functions/telnyxInlineParity.test.js).
 *
 * Replaces the former Twilio handlers: handleTwilioInboundSms, handleTwilioSmsStatus,
 * handleTwilioFaxWebhook, handleTwilioVoiceCall, handleTwilioVoicemail, handleTwilioCallStatus.
 */

// ---- credential resolution (inlined; parity-guarded) ----
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

// Webhook mutations must be bound to one exact, active Telnyx credential row.
// The generic resolver intentionally supports legacy callers by choosing a
// preferred row; that fallback is unsafe for a signed webhook because two
// active rows would make both signature authority and fax provenance ambiguous.
const TELNYX_WEBHOOK_CREDENTIAL_ROW_LIMIT = 2;
async function resolveExactActiveTelnyxWebhookCredentials(base44) {
  let rows;
  try {
    rows = await base44.asServiceRole.entities.IntegrationSecret.filter(
      { provider: 'telnyx', is_active: true },
      undefined,
      TELNYX_WEBHOOK_CREDENTIAL_ROW_LIMIT,
    );
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const record = rows[0];
  const pick = (value) => (typeof value === 'string' && value.trim() === value && value
    ? value
    : null);
  if (record?.provider !== 'telnyx'
    || record?.is_active !== true
    || boundedTelnyxAuthorityId(record?.id) !== record?.id
    || !Number.isFinite(Date.parse(record?.updated_date || ''))
    || !pick(record?.public_key)) return null;
  return {
    apiKey: pick(record.api_key),
    publicKey: pick(record.public_key),
    messagingProfileId: pick(record.messaging_profile_id),
    voiceConnectionId: pick(record.voice_connection_id),
    faxConnectionId: pick(record.fax_connection_id),
    record,
    readError: null,
  };
}

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


// ---- value mapping (mirrors telnyxUtils.js) ----
function mapMessageStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued': case 'sending': return 'queued';
    // delivery_unconfirmed is terminal with no carrier receipt: last-known 'sent'.
    case 'sent': case 'delivery_unconfirmed': return 'sent';
    case 'delivered': case 'webhook_delivered': case 'read': return 'delivered';
    case 'sending_failed': case 'delivery_failed': case 'expired': case 'failed': return 'failed';
    default: return null;
  }
}
function mapFaxStatus(status) {
  switch (String(status || '').toLowerCase()) {
    case 'queued': case 'media.processing': return 'queued';
    case 'media.processed': case 'originated': case 'sending': return 'sending';
    case 'sent': return 'sent';
    case 'delivered': return 'delivered';
    case 'failed': case 'cancelled': case 'canceled': return 'failed';
    default: return null;
  }
}
function mapCallStatus(eventType) {
  switch (String(eventType || '').toLowerCase()) {
    case 'call.initiated': return 'ringing';
    case 'call.answered': case 'call.bridged': return 'in_progress';
    case 'call.hangup': return 'completed';
    default: return null;
  }
}
// Monotonic rank so a late/out-of-order call event can't regress a terminal
// CallLog status. Mirrors the CALL_RANK guard the former handleTwilioCallStatus
// enforced.
// 'failed' (a missed/failed call) is terminal and ranks above 'completed' so the
// trailing call.hangup event (which maps to 'completed') can't regress a call we
// deliberately marked missed/failed back to a normal completion.
const CALL_RANK = { ringing: 1, in_progress: 2, completed: 3, failed: 4 };

// Best-effort call duration (seconds) from a Call Control hangup payload's
// start/end timestamps. Returns null when they're missing/unparseable.
function callDurationSecs(payload) {
  const start = Date.parse(payload?.start_time || '');
  const end = Date.parse(payload?.end_time || '');
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

function extractTelnyxEvent(body) {
  const b = body || {};
  const data = b.data || b;
  const payload = data.payload || {};
  return {
    eventType: data.event_type || b.event_type || null,
    eventId: data.id || null,
    occurredAt: data.occurred_at || null,
    resourceId: payload.id || null,
    // Backward-compatible status-resource alias. Never use this as a webhook
    // replay key; Telnyx envelope data.id is the event identity.
    id: payload.id || null,
    payload,
  };
}
function buildSignedPayload(timestamp, rawBody) {
  return `${String(timestamp ?? '')}|${String(rawBody ?? '')}`;
}
function isFreshTimestamp(timestamp, nowMs = Date.now(), toleranceSeconds = 300) {
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs / 1000 - ts) <= toleranceSeconds;
}

// ---- fax retry policy (source of truth: src/components/fax/faxRetry.js;
// drift-guarded by base44/functions/faxRetryInlineParity.test.js). Mirrors the
// policy used by autoRetryFailedFaxes so a failed fax gets a consistent
// next_retry_at and a PERMANENT failure (bad number, not a fax machine) gives up
// immediately. ----
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
  // Telnyx Fax `failure_reason` codes (OpenAPI spec, checked 2026-10-09) that
  // need a person — a cancellation, a declining receiver, or an account, profile
  // or document problem — and would only fail again on retry. Snake_case, so
  // the prose patterns above never matched them and they fell through to
  // transient, burning the whole backoff schedule.
  /sender_cancel/i, /declin/i, /not_in_service/i, /account_disabled/i,
  /no_outbound_profile/i, /not_in_countries_whitelist/i, /spend_limit_exceeded/i,
  /unverified_(origination|destination)/i, /file_size_limit_exceeded/i,
  /page_count_limit_exceeded/i,
];
// Transient signals win over a coincidental permanent word ("rejected - line
// busy" is retryable). Checked first. Mirrors src/components/fax/faxRetry.js.
const TRANSIENT_FAILURE_PATTERNS = [
  /busy/i, /no.?answer/i, /temporar/i, /timeout/i, /timed out/i,
  /try again/i, /congestion/i, /\b(429|500|502|503|504)\b/,
  // Telnyx `invalid_ecm_response_from_receiver` is a transmission glitch, not a
  // bad number; without this the bare /invalid/ above gives up on it.
  /ecm_response/i,
];
function classifyFaxFailure(errorCode, errorMessage) {
  const s = `${errorCode ?? ''} ${errorMessage ?? ''}`.trim();
  if (!s) return 'transient';
  if (TRANSIENT_FAILURE_PATTERNS.some((re) => re.test(s))) return 'transient';
  return PERMANENT_FAILURE_PATTERNS.some((re) => re.test(s)) ? 'permanent' : 'transient';
}
function numberOrNull(value) {
  // Number(null)/Number("") are both 0, which makes an unset entity field
  // indistinguishable from an explicit zero. Mirrors src/components/fax/faxRetry.js.
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function faxRetryConfig(config) {
  const c = config || {};
  // Coerce first: entity fields can arrive as numeric strings ("5") from a JSON/form
  // round-trip, and Number.isFinite("5") is false — which would silently drop the
  // admin's configured value in favor of the default. Mirrors src/components/fax/faxRetry.js.
  // An unset max_retries must mean "use the default", not 0 retries — see
  // numberOrNull above and src/components/fax/faxRetry.js.
  const maxRetriesNum = numberOrNull(c.max_retries);
  const baseDelayNum = numberOrNull(c.retry_delay_minutes);
  return {
    enabled: c.auto_retry_enabled !== false,
    maxRetries: maxRetriesNum === null ? 3 : Math.max(0, maxRetriesNum),
    baseDelayMinutes: baseDelayNum !== null && baseDelayNum > 0 ? baseDelayNum : 15,
    notifyOnFinalFailure: c.notify_on_final_failure !== false,
    priorityMultiplier: c.priority_multiplier && typeof c.priority_multiplier === 'object' ? c.priority_multiplier : {},
  };
}
function nextRetryDelayMinutes(attempt, config, priority = 'normal', factor = 2, maxMinutes = 360) {
  const c = faxRetryConfig(config);
  const a = Math.max(0, Number(attempt) || 0);
  const mult = Number.isFinite(c.priorityMultiplier[priority]) ? c.priorityMultiplier[priority] : 1;
  const minutes = c.baseDelayMinutes * factor ** a * mult;
  return Math.max(1, Math.min(maxMinutes, Math.round(minutes)));
}
function planFaxRetry(opts) {
  const { retryCount = 0, errorCode, errorMessage, priority = 'normal', config, now = Date.now() } = opts || {};
  const c = faxRetryConfig(config);
  const classification = classifyFaxFailure(errorCode, errorMessage);
  const attempts = Number(retryCount) || 0;
  if (!c.enabled || classification === 'permanent' || attempts >= c.maxRetries) {
    return { willRetry: false, classification, exhausted: true, nextRetryAt: null, nextRetryCount: attempts, delayMinutes: 0 };
  }
  const delayMinutes = nextRetryDelayMinutes(attempts, config, priority);
  return { willRetry: true, classification, exhausted: false, nextRetryAt: new Date(now + delayMinutes * 60000).toISOString(), nextRetryCount: attempts + 1, delayMinutes };
}

// ---- phone + duty + business-hours helpers (mirror the voice utils) ----
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
// Hour (0–23) at `now` in `timeZone`, or null when it can't be computed.
function dutyHourInZone(date, timeZone) {
  try {
    const h = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, hour12: false, hour: '2-digit' }).format(date);
    let n = parseInt(h, 10);
    if (n === 24) n = 0;
    return Number.isNaN(n) ? null : n;
  } catch {
    return null;
  }
}
// At/after the agency's auto-off hour (default 5pm) in the duty timezone. Mirrors
// isPastAutoOffHour in src/components/voice/dutyUtils.js.
function isPastAutoOffHour(settings, now = new Date()) {
  const s = settings || {};
  if (s.auto_off_duty_enabled === false) return false;
  const hour = Number.isFinite(Number(s.auto_off_duty_hour)) ? Number(s.auto_off_duty_hour) : 17;
  const tz = s.duty_timezone || s.business_hours_timezone || 'America/New_York';
  const h = dutyHourInZone(now, tz);
  if (h == null) return false;
  return h >= hour;
}
// Off duty unless explicitly toggled on, before the auto-off hour, and outside a
// scheduled time-off window. Mirrors isOffDutyNow in dutyUtils.js (default-off +
// 5pm auto-end-of-day). `settings` enables the cutoff.
function isOffDutyNow(user, now = new Date(), settings = null) {
  if (!user) return false;
  const s = user.scheduled_off_duty_start ? new Date(user.scheduled_off_duty_start).getTime() : NaN;
  const e = user.scheduled_off_duty_end ? new Date(user.scheduled_off_duty_end).getTime() : NaN;
  if (!Number.isNaN(s) && !Number.isNaN(e) && e > s) {
    const t = now.getTime();
    const week = 7 * 24 * 60 * 60 * 1000;
    if (user.scheduled_off_duty_recurring && e - s < week) {
      if (t >= s) {
        const delta = ((t - s) % week + week) % week;
        if (delta <= e - s) return true;
      }
    } else if (t >= s && t <= e) {
      return true;
    }
  }
  if (settings && isPastAutoOffHour(settings, now)) return true;
  if (user.duty_status !== 'on_duty') return true;
  // The on-duty toggle expires nightly: if it was set on an earlier calendar day
  // it's stale → off until they toggle on again. (Legacy rows without
  // duty_on_since keep the prior always-on behavior.) Mirrors dutyUtils.js.
  if (user.duty_on_since) {
    const dtz = (settings && (settings.duty_timezone || settings.business_hours_timezone)) || 'America/New_York';
    const dateKey = (d) => {
      try { return new Intl.DateTimeFormat('en-CA', { timeZone: dtz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
      catch { return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
    };
    if (dateKey(new Date(user.duty_on_since)) !== dateKey(now)) return true;
  }
  return false;
}
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_INDEX = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
function parseHHMM(value) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const h = Number(m[1]); const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}
function wallClockInTimeZone(date, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', { timeZone: timeZone || undefined, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const parts = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  let hour = parseInt(parts.hour, 10);
  if (hour === 24) hour = 0;
  const minute = parseInt(parts.minute, 10);
  const weekday = WEEKDAY_INDEX[parts.weekday];
  return { weekday: weekday ?? null, minutes: hour * 60 + minute };
}
function dateKeyInTimeZone(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
function isAgencyOpen(settings, now = new Date()) {
  const s = settings || {};
  if (s.business_hours_enabled !== true) return true;
  let wc; let dateKey;
  try { wc = wallClockInTimeZone(now, s.business_hours_timezone); dateKey = dateKeyInTimeZone(now, s.business_hours_timezone); }
  catch { wc = wallClockInTimeZone(now, undefined); dateKey = dateKeyInTimeZone(now, undefined); }
  if (Array.isArray(s.business_hours_holidays) && s.business_hours_holidays.includes(dateKey)) return false;
  const day = (s.business_hours || {})[DAY_KEYS[wc.weekday]];
  if (!day || day.enabled === false) return false;
  const open = parseHHMM(day.open); const close = parseHHMM(day.close);
  if (open == null || close == null) return false;
  const m = wc.minutes;
  return open < close ? (m >= open && m < close) : (m >= open || m < close);
}

// ---- urgent-keyword detection (mirrors src/components/voice/urgentKeywords.js) ----
// <<<BEGIN SHARED HELPER: urgentKeywords — generated, edit base44/_shared/backendHelpers.mjs>>>
const DEFAULT_URGENT_KEYWORDS = ["emergency", "urgent", "911", "chest pain", "can't breathe", "cant breathe", "trouble breathing", "short of breath", "suicidal", "kill myself", "overdose", "bleeding", "fell", "fall", "fallen", "passed out", "unconscious", "stroke", "seizure", "severe pain", "help me", "not breathing", "unresponsive"];
// <<<END SHARED HELPER: urgentKeywords>>>
function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function detectUrgency(text, extra = []) {
  // Normalize curly apostrophes to straight so a smart-quote "can't breathe"
  // (common from phone keyboards/autocorrect) still escalates.
  const s = String(text || '').replace(/[‘’]/g, "'");
  if (!s.trim()) return { urgent: false, matches: [] };
  const extras = (Array.isArray(extra) ? extra : []).map((k) => String(k || '').toLowerCase().trim()).filter(Boolean);
  const all = [...new Set([...DEFAULT_URGENT_KEYWORDS, ...extras])];
  const matches = [];
  for (const kw of all) {
    if (!kw) continue;
    if (new RegExp(`\\b${escapeRe(kw)}\\b`, 'i').test(s)) matches.push(kw);
  }
  return { urgent: matches.length > 0, matches };
}

// ---- Ed25519 signature verification ----
function base64ToBytes(b64) {
  try {
    const bin = atob(String(b64).trim());
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
async function verifyTelnyxSignature(rawBody, signatureB64, timestamp, publicKeyB64) {
  if (!publicKeyB64 || !signatureB64 || !timestamp) return false;
  if (!isFreshTimestamp(timestamp)) return false;
  const pubBytes = base64ToBytes(publicKeyB64);
  const sigBytes = base64ToBytes(signatureB64);
  if (!pubBytes || !sigBytes) return false;
  try {
    const key = await crypto.subtle.importKey('raw', pubBytes, { name: 'Ed25519' }, false, ['verify']);
    const data = new TextEncoder().encode(buildSignedPayload(timestamp, rawBody));
    return await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, data);
  } catch (err) {
    console.error('Telnyx signature verify error:', err?.message);
    return false;
  }
}

// client_state is base64(JSON) used to carry routing/bridge intent across the
// asynchronous Call Control event stream.
function encodeClientState(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function decodeClientState(b64) {
  if (!b64 || typeof b64 !== 'string') return null;
  const bytes = base64ToBytes(b64);
  if (!bytes) return null;
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
}

// Inbound patient SMS is released (owner decision, 2026-10-08): the dialed
// number, the tenant and the reader all resolve from service-owned records —
// the receiving TelecomDestinationBinding, a chart in its agency, and an active
// member of that agency named by the line's PhoneNumber assignment or the
// thread's server-written outbound row (see handleInboundMessage). Mutable
// User profile fields are no longer read for SMS. Inbound fax crosses only a
// dedicated, exact service-owned destination binding.
//
// Inbound patient CALLS are released (owner decision, 2026-10-08: single
// agency, staff-only, BAAs in place, outbound delivery released). Routing still
// reads the dialed work number's User row to find the nurse, which is the
// mutable-profile dependency the pause existed for; the owner accepted that
// for a single-agency deployment. Every Call Control action remains behind the
// outbound delivery gate in callCommand, and the CallLog rows this writes are
// what fill the Phone Center's Recents and Callbacks tabs.
const INBOUND_PATIENT_SMS_ROUTING_PAUSED = false;
const INBOUND_PATIENT_CALL_ROUTING_PAUSED = false;
const INBOUND_PATIENT_CALL_STATES = new Set([
  'inbound_ivr',
  'inbound_after_greet',
  'ringdown',
  'voicemail',
]);

function isInboundPatientCallEvent(eventType, payload) {
  if (!String(eventType || '').startsWith('call.')) return false;
  if (String(payload?.direction || '').toLowerCase() === 'incoming') return true;
  const state = decodeClientState(payload?.client_state);
  return INBOUND_PATIENT_CALL_STATES.has(String(state?.t || '').toLowerCase());
}

function inboundRoutingPausedResponse(channel) {
  return Response.json({
    error: `Inbound patient ${channel} routing is temporarily unavailable during the service-owned telecom binding migration`,
    code: 'INBOUND_TELECOM_BINDING_MIGRATION_PAUSED',
    retryable: true,
  }, { status: 503, headers: { 'Retry-After': '300' } });
}

// ---- Call Control command helper ----
// Returns { ok, status } so callers can fall back on failure instead of
// silently stranding a live (billed) call leg.
// TODO(verify): confirm Call Control action paths against your live Telnyx
// account if command routing ever changes. Field names for record_start
// (max_length) / transcription_start (transcription_engine_config.language)
// and hangup_cause enum values are verified against Telnyx v2 docs/SDK.
async function callCommand(apiKey, callControlId, command, payload = {}) {
  if (!outboundDeliveryReleased()) return { ok: false, status: 503, paused: true };
  try {
    const resp = await fetch(`https://api.telnyx.com/v2/calls/${encodeURIComponent(callControlId)}/actions/${command}`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) console.error(`Call Control ${command} -> HTTP ${resp.status}`);
    await resp.body?.cancel?.().catch(() => {});
    return { ok: resp.ok, status: resp.status };
  } catch (err) {
    console.error(`Call Control ${command} failed:`, err?.message);
    return { ok: false, status: 0 };
  }
}
const SPEAK_DEFAULTS = { voice: 'female', language: 'en-US' };

// ---- Telnyx outbound SMS (auto-reply) ----
async function sendAutoReply(apiKey, messagingProfileId, from, to, text) {
  if (!outboundDeliveryReleased()) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const payload = { from, to, text };
    if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
    return await fetch('https://api.telnyx.com/v2/messages', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err) {
    console.error('auto-reply send failed:', err?.message);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function getAgencyConfig(base44, agencyHint) {
  // Prefer a settings row matching the nurse/agency when multi-tenant rows exist.
  let rows = [];
  const key = String(agencyHint || '').trim();
  if (key) {
    rows = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1).catch(() => []);
    if (!rows?.length) {
      rows = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1).catch(() => []);
    }
  }
  if (!rows?.length) {
    const newest = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 5).catch(() => []);
    if ((newest || []).length > 1) {
      // Multi-tenant miss (with or without a hint): empty config (safe defaults
      // below) rather than another agency's greetings/transfer targets.
      rows = [];
    } else {
      rows = (newest || []).slice(0, 1);
    }
  }
  const s = rows[0] || {};
  // The office / after-hours numbers become Call Control `transfer` targets, and
  // Telnyx rejects a formatted number — so a stored "(724) 465-0440" would
  // dead-end every after-hours call at the apology fallback. Normalize to E.164
  // at point of use (raw kept only when unnormalizable, preserving the old
  // failure mode for genuine garbage).
  const toE164 = (raw) => normalizeE164(raw) || (raw ? String(raw).trim() : '');
  return {
    settings: s,
    mainOffice: toE164(s.main_office_number_e164),
    // As-entered forms for SPOKEN greetings / reply TEXT ({office} substitution):
    // an admin's "724-465-0440" reads/speaks better than "+17244650440".
    mainOfficeDisplay: String(s.main_office_number_e164 || '').trim(),
    afterHoursTransferDisplay: String(s.after_hours_transfer_number_e164 || s.main_office_number_e164 || '').trim(),
    defaultOffDuty: s.default_off_duty_template || '',
    smsEnabled: s.sms_messaging_enabled ?? true,
    afterHoursReplyEnabled: s.after_hours_sms_auto_reply_enabled !== false,
    afterHoursReply: s.after_hours_sms_auto_reply || '',
    urgentEscalationEnabled: s.urgent_escalation_enabled !== false,
    urgentKeywords: Array.isArray(s.urgent_keywords) ? s.urgent_keywords : [],
    voicemailEnabled: s.voicemail_enabled === true,
    voicemailGreeting: s.voicemail_greeting || '',
    afterHoursAction: s.after_hours_call_action || 'transfer',
    afterHoursTransfer: toE164(s.after_hours_transfer_number_e164 || s.main_office_number_e164),
    afterHoursGreeting: s.after_hours_call_greeting || '',
  };
}

/** Match a dialed/to number to an AgencySettings row (fax/office lines). */
async function resolveAgencySettingsByNumber(base44, e164) {
  const target = normalizeE164(e164);
  if (!target) return null;
  const rows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 200).catch(() => []);
  for (const row of (rows || [])) {
    const candidates = [
      row.office_fax_number_e164,
      row.outbound_fax_number_e164,
      row.main_office_number_e164,
      row.after_hours_transfer_number_e164,
    ];
    if (candidates.some((c) => normalizeE164(c) === target)) return row;
  }
  // Single-tenant: legacy configs often store only the office machine number
  // while the blind Telnyx transmit line is what receives stray fax-backs.
  // With exactly one settings row that fallback is safe; multi-tenant misses
  // must fail closed so PHI is not routed to the wrong office.
  if ((rows || []).length === 1) return rows[0];
  return null;
}

// Text alone never changes consent (only a provider-classified STOP/START
// does, through handleInboundConsentKeyword). These lists only decide which
// texts get no automatic reply (STOP-like) and which get the CTIA HELP answer.
// The FCC's revocation rule (47 CFR 64.1200(a)(10), in force April 2025) names
// stop, quit, end, revoke, opt out, cancel and unsubscribe as revocations; CTIA
// adds STOPALL. A text that says one of them must never draw an after-hours or
// off-duty auto-reply, so match it the way a person types it — "Stop.",
// "opt-out", "Stop all" — not only the bare upper-case word.
const STOP_WORDS = ['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT', 'OPT OUT'];
const HELP_WORDS = ['HELP', 'INFO'];
function isStopLikeText(text) {
  const words = String(text || '').toUpperCase().replace(/[^A-Z]+/g, ' ').trim();
  return STOP_WORDS.includes(words);
}

function providerConsentKeyword(payload) {
  if (String(payload?.direction || '').toLowerCase() !== 'inbound') return null;
  const keyword = String(payload?.autoresponse_type || '').trim().toUpperCase();
  return keyword === 'STOP' || keyword === 'START' ? keyword : null;
}

function keywordConsentMatches(row, expected) {
  return !!row
    && row.consent_key === expected.consent_key
    && row.agency_id === expected.agency_id
    && row.provider === expected.provider
    && row.integration_secret_id === expected.integration_secret_id
    && row.messaging_profile_id === expected.messaging_profile_id
    && row.destination_binding_id === expected.destination_binding_id
    && row.destination_binding_key === expected.destination_binding_key
    && row.destination_e164 === expected.destination_e164
    && (row.patient_id ?? null) === expected.patient_id
    && row.phone_e164 === expected.phone_e164
    && row.consent_status === expected.consent_status
    && row.consent_source === expected.consent_source
    && row.provider_event_id === expected.provider_event_id
    && row.provider_message_id === expected.provider_message_id
    && row.provider_event_occurred_at === expected.provider_event_occurred_at
    && row.captured_at === expected.captured_at
    && (row.captured_by ?? null) === expected.captured_by
    && row.notes === expected.notes;
}

async function handleInboundConsentKeyword(base44, telnyxCreds, event, payload) {
  const keyword = providerConsentKeyword(payload);
  if (!keyword) return null;

  const eventId = boundedTelnyxAuthorityId(event?.eventId);
  const providerMessageId = boundedTelnyxAuthorityId(event?.resourceId);
  const occurredAtMs = Date.parse(event?.occurredAt || '');
  const source = payload?.from?.phone_number || payload?.from;
  const destination = Array.isArray(payload?.to) ? payload.to[0]?.phone_number : payload?.to;
  const phoneE164 = normalizeTelnyxSmsE164(source);
  if (!eventId || !providerMessageId || !phoneE164 || !Number.isFinite(occurredAtMs)
    || (keyword === 'START' && occurredAtMs > Date.now() + 24 * 60 * 60 * 1000)) {
    return inboundRoutingPausedResponse('SMS consent');
  }
  const occurredAt = new Date(occurredAtMs).toISOString();

  const authority = await resolveActiveTelnyxSmsBinding(base44, {
    integrationSecretId: telnyxCreds?.record?.id,
    integrationProvider: telnyxCreds?.record?.provider,
    integrationIsActive: telnyxCreds?.record?.is_active === true,
    messagingProfileId: telnyxCreds?.messagingProfileId,
    claimedMessagingProfileId: payload?.messaging_profile_id,
    requireClaimedProfile: true,
    requireInbound: true,
    destinationE164: destination,
  });
  if (!authority.ok) return inboundRoutingPausedResponse('SMS consent');

  const expected = {
    consent_key: telnyxSmsConsentKey(authority, phoneE164),
    agency_id: authority.agencyId,
    provider: 'telnyx',
    integration_secret_id: authority.integrationSecretId,
    messaging_profile_id: authority.messagingProfileId,
    destination_binding_id: authority.bindingId,
    destination_binding_key: authority.bindingKey,
    destination_e164: authority.destinationE164,
    patient_id: null,
    phone_e164: phoneE164,
    consent_status: keyword === 'STOP' ? 'opted_out' : 'opted_in',
    consent_source: keyword === 'STOP' ? 'keyword_stop' : 'keyword_start',
    captured_by: null,
    captured_at: occurredAt,
    provider_event_id: eventId,
    provider_message_id: providerMessageId,
    provider_event_occurred_at: occurredAt,
    notes: 'Provider-classified Telnyx consent keyword',
  };

  let prior;
  try {
    prior = await base44.asServiceRole.entities.SmsConsent
      .filter({ provider_event_id: eventId }, undefined, 2);
  } catch {
    return inboundRoutingPausedResponse('SMS consent');
  }
  if (!Array.isArray(prior) || prior.length > 1) {
    return inboundRoutingPausedResponse('SMS consent');
  }
  if (prior.length === 1) {
    if (!keywordConsentMatches(prior[0], expected)) {
      return inboundRoutingPausedResponse('SMS consent');
    }
    return Response.json({
      success: true,
      consent_status: expected.consent_status,
      deduped: true,
    });
  }

  try {
    await base44.asServiceRole.entities.SmsConsent.create(expected);
  } catch {
    return inboundRoutingPausedResponse('SMS consent');
  }

  let committed;
  try {
    committed = await base44.asServiceRole.entities.SmsConsent
      .filter({ provider_event_id: eventId }, undefined, 2);
  } catch {
    return inboundRoutingPausedResponse('SMS consent');
  }
  if (!Array.isArray(committed) || committed.length !== 1
    || !keywordConsentMatches(committed[0], expected)) {
    return inboundRoutingPausedResponse('SMS consent');
  }

  // Telnyx sends the carrier-compliant keyword autoresponse. Sending another
  // Messages API request here would be both duplicate and non-idempotent.
  return Response.json({ success: true, consent_status: expected.consent_status });
}

// ============================ MESSAGING ============================
// Monotonic rank so a late/out-of-order delivery webhook can't downgrade a
// terminal state (e.g. a re-delivered 'sending' arriving after 'sent'). Mirrors
// the SMS_RANK guard the former handleTwilioSmsStatus enforced.
const SMS_RANK = { queued: 1, sent: 2, delivered: 3, failed: 3 };

async function handleOutboundMessageStatus(base44, payload) {
  const providerId = payload?.id;
  const recipientStatus = payload?.to?.[0]?.status || payload?.status;
  const mapped = mapMessageStatus(recipientStatus);
  if (!providerId) return Response.json({ success: true, skipped: 'no message id' });
  if (!mapped) return Response.json({ success: true, skipped: 'unknown status', status: recipientStatus });

  const rows = await base44.asServiceRole.entities.SmsMessage.filter({ provider_message_id: providerId }, '-created_date', 1).catch(() => []);
  // 404 (not 200) so Telnyx redelivers: sendSms persists provider_message_id
  // only AFTER the API round-trip, so a fast DLR can race the write. Acking it
  // would lose the status forever — SMS has no poller to reconcile later.
  if (!rows.length) return Response.json({ success: false, message: 'SmsMessage not found' }, { status: 404 });
  const row = rows[0];
  // Forward-only: ignore an unchanged or out-of-order (lower-rank) transition.
  if ((SMS_RANK[mapped] || 0) <= (SMS_RANK[row.status] || 0)) {
    return Response.json({ success: true, status: row.status, deduped: true });
  }
  const update = { status: mapped };
  if (mapped === 'failed') {
    const err = Array.isArray(payload?.errors) ? payload.errors[0] : null;
    update.failure_reason = err?.detail || err?.title || 'Delivery failed';
  }
  await base44.asServiceRole.entities.SmsMessage.update(row.id, update);

  // Tell the sending nurse when their text could not be delivered (parity with
  // the outbound fax-failed notification). Once per row.
  if (mapped === 'failed' && row.nurse_email && !row.failure_notified) {
    await base44.asServiceRole.entities.SmsMessage.update(row.id, { failure_notified: true }).catch(() => {});
    await base44.asServiceRole.entities.Notification.create({
      user_email: row.nurse_email,
      title: '⚠️ Text not delivered',
      message: `Your text to ${row.to_number} could not be delivered (${update.failure_reason}). Verify the number and try again.`,
      type: 'sms_failed', priority: 'high', metadata: { related_entity: 'SmsMessage', related_entity_id: row.id }, is_read: false,
    }).catch((err) => console.error('Failed to send sms failure notification:', err));
  }
  return Response.json({ success: true, status: mapped });
}

// ---- Inbound patient SMS routing (released 2026-10-08, owner decision) ----
// An inbound text is attributed ONLY through service-owned records:
//   - the receiving number must be one exact, active, inbound-enabled
//     TelecomDestinationBinding of the signed messaging profile; its agency is
//     the message's agency and nothing else can move it to another one;
//   - the patient link is a chart in THAT agency whose phone is the sender's
//     (exactly one), or the chart the sender's scoped consent row names;
//   - the reader is a staff member who holds an active membership in THAT
//     agency, found from the line's service-written PhoneNumber assignment or,
//     for a shared line, from the server-written outbound row of the same
//     thread. Self-editable User fields (work_phone_number, agency_name) are
//     never consulted. With no such person the text is stored for the agency
//     (agency_id stamped) and shown to no staff member, rather than guessed.
// SmsMessage is readable only by its nurse_email / sent_by and the built-in
// admin, so a text attributed this way is never shown to another agency.
const INBOUND_SMS_PATIENT_SCAN_LIMIT = 10;
const INBOUND_SMS_THREAD_SCAN_LIMIT = 20;
const normalizeRoutingEmail = (value) => String(value || '').trim().toLowerCase();

function inboundSmsUnavailable(code) {
  return Response.json({
    error: 'Inbound text could not be attributed to an agency line right now',
    code,
    retryable: true,
  }, { status: 503, headers: { 'Retry-After': '300' } });
}

/** The active member of `agencyId` with this address, as their User row. */
async function activeAgencyMember(entities, agencyId, email) {
  const normalized = normalizeRoutingEmail(email);
  if (!normalized) return null;
  let memberships;
  try {
    memberships = await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_email_normalized: normalized, status: 'active' }, undefined, 2,
    );
  } catch {
    return null;
  }
  const membership = Array.isArray(memberships) && memberships.length === 1 ? memberships[0] : null;
  if (!membership || membership.agency_id !== agencyId || membership.status !== 'active'
    || normalizeRoutingEmail(membership.user_email_normalized) !== normalized
    || !boundedTelnyxAuthorityId(membership.user_id)) return null;
  let users;
  try {
    users = await entities.User.filter({ id: membership.user_id }, undefined, 2);
  } catch {
    return null;
  }
  const user = Array.isArray(users) && users.length === 1 ? users[0] : null;
  if (!user || user.id !== membership.user_id || normalizeRoutingEmail(user.email) !== normalized
    || user.is_active === false || user.disabled === true || user.is_service === true) return null;
  return user;
}

/** Who reads an inbound text on this line, from service-owned records only. */
async function resolveInboundSmsReader(entities, authority, threadId) {
  // 1. The person the line is assigned to (PhoneNumber is written only by the
  //    admin-gated provisioning functions).
  let numbers = [];
  try {
    numbers = await entities.PhoneNumber.filter({ e164: authority.destinationE164 }, undefined, 3);
  } catch {
    numbers = [];
  }
  const assigned = (Array.isArray(numbers) ? numbers : []).filter((row) => row?.e164 === authority.destinationE164
    && row.status === 'assigned' && normalizeRoutingEmail(row.assigned_to_email));
  if (assigned.length === 1) {
    const user = await activeAgencyMember(entities, authority.agencyId, assigned[0].assigned_to_email);
    if (user) return { user, basis: 'line_assignment' };
  }
  // 2. A shared line: whoever last texted this person from this line.
  let outbound = [];
  try {
    outbound = await entities.SmsMessage.filter(
      { thread_id: threadId, direction: 'outbound' }, '-created_date', INBOUND_SMS_THREAD_SCAN_LIMIT,
    );
  } catch {
    outbound = [];
  }
  for (const row of Array.isArray(outbound) ? outbound : []) {
    if (row?.thread_id !== threadId || row.direction !== 'outbound'
      || normalizeTelnyxSmsE164(row.from_number) !== authority.destinationE164
      || (row.agency_id != null && row.agency_id !== authority.agencyId)) continue;
    const user = await activeAgencyMember(entities, authority.agencyId, row.sent_by || row.nurse_email);
    if (user) return { user, basis: 'thread' };
  }
  return { user: null, basis: 'unattributed' };
}

/** The sender's chart in the line's agency: one phone match, or the consent row's chart. */
async function resolveInboundSmsPatient(entities, authority, senderE164, consentRow) {
  const ids = new Set();
  for (const variant of phoneVariants(senderE164)) {
    let rows;
    try {
      rows = await entities.Patient.filter(
        { phone: variant, agency_id: authority.agencyId }, undefined, INBOUND_SMS_PATIENT_SCAN_LIMIT,
      );
    } catch {
      rows = [];
    }
    for (const row of Array.isArray(rows) ? rows : []) {
      if (row?.agency_id === authority.agencyId && boundedTelnyxAuthorityId(row.id)
        && normalizeTelnyxSmsE164(row.phone) === senderE164) ids.add(row.id);
    }
  }
  if (ids.size === 1) return [...ids][0];
  if (ids.size > 1) return null;
  const consentPatientId = boundedTelnyxAuthorityId(consentRow?.patient_id);
  if (!consentPatientId) return null;
  let rows;
  try {
    rows = await entities.Patient.filter({ id: consentPatientId, agency_id: authority.agencyId }, undefined, 2);
  } catch {
    return null;
  }
  const patient = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
  return patient?.id === consentPatientId && patient.agency_id === authority.agencyId ? patient.id : null;
}

async function bindingAgencyName(entities, agencyId) {
  let rows;
  try {
    rows = await entities.Agency.filter({ id: agencyId }, undefined, 2);
  } catch {
    return '';
  }
  const agency = Array.isArray(rows) && rows.length === 1 && rows[0]?.id === agencyId ? rows[0] : null;
  return typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
}

async function handleInboundMessage(base44, telnyxCreds, event, payload) {
  const entities = base44.asServiceRole.entities;
  const source = payload?.from?.phone_number || payload?.from;
  const destination = Array.isArray(payload?.to) ? payload.to[0]?.phone_number : payload?.to;
  const text = String(payload?.text || '');
  const providerMessageId = boundedTelnyxAuthorityId(payload?.id) || boundedTelnyxAuthorityId(event?.resourceId);
  if (!source || !destination || !providerMessageId) {
    return Response.json({ success: true, skipped: 'missing parties' });
  }

  // The receiving line decides the agency. An unbound, inbound-disabled or
  // ambiguous line stores nothing and asks Telnyx to retry, so binding the
  // number later still delivers the text.
  const authority = await resolveActiveTelnyxSmsBinding(base44, {
    integrationSecretId: telnyxCreds?.record?.id,
    integrationProvider: telnyxCreds?.record?.provider,
    integrationIsActive: telnyxCreds?.record?.is_active === true,
    messagingProfileId: telnyxCreds?.messagingProfileId,
    claimedMessagingProfileId: payload?.messaging_profile_id,
    requireClaimedProfile: true,
    requireInbound: true,
    destinationE164: destination,
  });
  if (!authority.ok) return inboundSmsUnavailable('INBOUND_SMS_BINDING_UNAVAILABLE');

  const patientNum = normalizeTelnyxSmsE164(source);
  if (!patientNum) return Response.json({ success: true, skipped: 'unsupported sender' });
  const workNum = authority.destinationE164;
  const threadId = getThreadId(patientNum, workNum);

  // Idempotency: Telnyx may re-deliver. If we already stored this id, ack.
  let dup;
  try {
    dup = await entities.SmsMessage.filter({ provider_message_id: providerMessageId }, '-created_date', 1);
  } catch {
    return inboundSmsUnavailable('INBOUND_SMS_STORE_UNAVAILABLE');
  }
  if (Array.isArray(dup) && dup.length > 0) return Response.json({ success: true, deduped: true });

  // Consent in the binding's scope (a provider STOP wins). Unreadable consent
  // is treated as opted out for every reply below.
  const scopedConsent = await loadLatestScopedSmsConsent(base44, authority, patientNum);
  const optedOut = !scopedConsent.ok || scopedConsent.effectiveStatus === 'opted_out';

  const patientId = await resolveInboundSmsPatient(entities, authority, patientNum, scopedConsent.ok ? scopedConsent.row : null);
  const { user: reader, basis } = await resolveInboundSmsReader(entities, authority, threadId);

  // Always store the inbound message, in this agency's thread.
  const inboundRow = await entities.SmsMessage.create({
    direction: 'inbound', from_number: patientNum, to_number: workNum, body: text,
    nurse_email: reader ? reader.email : null, patient_id: patientId, thread_id: threadId,
    status: 'received', provider_message_id: providerMessageId, is_read: false, consent_checked: false,
    agency_id: authority.agencyId, destination_binding_id: authority.bindingId,
  });

  const config = await getAgencyConfig(base44, await bindingAgencyName(entities, authority.agencyId));
  const smsEnabled = config.smsEnabled !== false;
  const keyword = text.trim().toUpperCase();
  const apiKey = telnyxCreds?.apiKey;
  const sendReply = (msg) => (apiKey
    ? sendAutoReply(apiKey, telnyxCreds?.messagingProfileId, workNum, patientNum, msg)
    : Promise.resolve(null));
  // Telnyx answers a keyword itself when it set autoresponse_type; a STOP-like
  // text never gets a reply from us either way.
  const providerAnswered = !!String(payload?.autoresponse_type || '').trim();
  const isHelp = HELP_WORDS.includes(keyword);
  const canReply = !optedOut && smsEnabled && !providerAnswered && !isStopLikeText(text) && !isHelp;

  if (isHelp && smsEnabled && !providerAnswered) {
    // CTIA requires a HELP response regardless of opt-out state; it is
    // informational and carries no PHI.
    const office = config.mainOfficeDisplay ? ` or call our office at ${config.mainOfficeDisplay}` : '';
    await sendReply(`This is your home-health care team. Reply STOP to unsubscribe${office}.`);
  }

  // --- Automatic after-hours / off-duty reply (only ever one) ---
  const offDuty = reader ? isOffDutyNow(reader, new Date(), config.settings) : false;
  const agencyClosed = !isAgencyOpen(config.settings);
  if (canReply) {
    if (agencyClosed && config.afterHoursReplyEnabled) {
      const office = config.mainOfficeDisplay || 'the main office';
      const msg = (config.afterHoursReply || config.defaultOffDuty ||
        `Thanks for your message. Our office is currently closed. For anything urgent, please call ${office}. We'll reply during business hours.`)
        .replace(/\{office\}/gi, office);
      await sendReply(msg);
    } else if (offDuty) {
      const office = config.mainOfficeDisplay || 'the office';
      const msg = (reader.off_duty_message || config.defaultOffDuty ||
        `Thank you for your text, but I am currently not working. Please contact the office at ${office}.`)
        .replace(/\{office\}/gi, office);
      await sendReply(msg);
    }
  }

  // --- Urgent-keyword escalation and in-app notice, to the reader only ---
  const urgency = config.urgentEscalationEnabled ? detectUrgency(text, config.urgentKeywords) : { urgent: false, matches: [] };
  if (reader && urgency.urgent) {
    await entities.Notification.create({
      user_email: reader.email, title: '🚨 Possibly urgent patient text',
      message: `A text from ${patientNum} may need immediate attention (flagged: ${urgency.matches.slice(0, 3).join(', ')}). Review now.`,
      type: 'sms_urgent', priority: 'critical', metadata: { related_entity: 'SmsMessage', related_entity_id: inboundRow.id }, is_read: false,
    }).catch(() => console.error('urgent notification failed'));
  }
  if (reader) {
    await entities.Notification.create({
      user_email: reader.email, title: '💬 New text message', message: `You have a new text from ${patientNum}.`,
      type: 'sms_received', priority: 'medium', metadata: { related_entity: 'SmsMessage', related_entity_id: inboundRow.id }, is_read: false,
    }).catch(() => console.error('notification failed'));
  }

  // SmsMessage holds endpoints, patient linkage, thread, and content metadata.
  // Keep the broad activity stream limited to routing outcome categories.
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: 'system', action: reader ? 'sms_received' : 'sms_received_unresolved',
    entity_type: 'SmsMessage', entity_id: inboundRow.id,
    details: {
      direction: 'inbound', routing: basis, off_duty: offDuty, agency_closed: agencyClosed, urgent: urgency.urgent,
    }, status: reader ? 'success' : 'warning',
  }).catch(() => {});

  return Response.json({ success: true, received: true, routed: basis });
}

// ============================ FAX ============================
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

// Monotonic rank so a late/out-of-order or re-delivered fax webhook can't regress
// a terminal state (e.g. a stale 'sending' from media.processed arriving after
// 'delivered', which would re-open the fax and re-poll/re-send a delivered PHI
// document). Mirrors the SMS_RANK/CALL_RANK guards. 'delivered' and 'failed' are
// both terminal and share the top rank so neither can overwrite the other.
// 'retrying'/'retried' (set by retryFailedFax) must also rank as terminal for
// the ORIGINAL fax id: a redelivered 'failed' webhook for a row already claimed
// by a retry would otherwise pass the guard (unranked -> 0), re-plan a retry,
// and cause a duplicate PHI transmission on top of the in-flight attempt.
const FAX_RANK = { queued: 1, sending: 2, sent: 3, delivered: 4, failed: 4, retrying: 4, retried: 5 };

const INBOUND_FAX_EXACT_ROW_LIMIT = 10;
const INBOUND_FAX_FORWARD_TIMEOUT_MS = 7000;
const OUTBOUND_FAX_EXACT_ROW_LIMIT = 10;
const INBOUND_FAX_NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

function exactInboundFaxHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function inboundFaxUnavailable(status = 503, code = 'INBOUND_FAX_BINDING_UNAVAILABLE') {
  return Response.json(
    { success: false, error: 'Inbound fax routing is temporarily unavailable', code },
    {
      status,
      headers: {
        ...INBOUND_FAX_NO_STORE_HEADERS,
        ...(status === 503 ? { 'Retry-After': '300' } : {}),
      },
    },
  );
}

function successfulInboundFaxUpdate(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
    && value.success === true && value.updated === 1 && value.has_more === false;
}

function outboundFaxHasStatusAuthority(row) {
  const referralAuthority = !!boundedTelnyxAuthorityId(row?.referral_id)
    && !!boundedTelnyxAuthorityId(row?.sent_by_user_id)
    && !!boundedTelnyxAuthorityId(row?.sent_by_membership_id)
    && Number.isSafeInteger(row?.sent_by_membership_version)
    && row.sent_by_membership_version >= 1;
  const bindingAuthority = !!boundedTelnyxAuthorityId(row?.sender_telecom_binding_id)
    && Number.isSafeInteger(row?.sender_telecom_binding_version)
    && row.sender_telecom_binding_version >= 1
    && !!boundedTelnyxAuthorityId(row?.sender_provider_number_id);
  return !!row
    && !!boundedTelnyxAuthorityId(row.id)
    && !!boundedTelnyxAuthorityId(row.agency_id)
    && !!boundedTelnyxAuthorityId(row.document_id)
    && (referralAuthority || bindingAuthority)
    && row.provider === 'telnyx'
    && !!boundedTelnyxAuthorityId(row.integration_secret_id)
    && Number.isFinite(Date.parse(row.integration_secret_updated_at || ''))
    && !!boundedTelnyxAuthorityId(row.fax_connection_id)
    && !!boundedTelnyxAuthorityId(row.sender_settings_id)
    && Number.isFinite(Date.parse(row.sender_settings_updated_at || ''))
    && !!boundedTelnyxAuthorityId(row.telnyx_fax_id)
    && !!boundedTelnyxAuthorityId(row.provider_submission_attempt_id)
    && row.provider_submission_state === 'accepted'
    && Number.isFinite(Date.parse(row.provider_accepted_at || ''))
    && row.document_url == null;
}

function outboundFaxHasRetryAuthority(row) {
  return outboundFaxHasStatusAuthority(row)
    && !!boundedTelnyxAuthorityId(row.referral_id)
    && !!boundedTelnyxAuthorityId(row.sent_by_user_id)
    && !!boundedTelnyxAuthorityId(row.sent_by_membership_id)
    && Number.isSafeInteger(row.sent_by_membership_version)
    && row.sent_by_membership_version >= 1
    && Number.isSafeInteger(row.retry_count)
    && row.retry_count >= 0
    && Number.isSafeInteger(row.retry_generation)
    && row.retry_generation >= 0
    && row.retry_generation <= row.retry_count;
}

// A legacy URL row — written by sendFax, the platform-owner path that is held
// pending the document-binding migration. It stores a caller-supplied document
// URL and records no provider submission attempt, so outboundFaxHasStatusAuthority
// refuses it forever and neither this webhook nor pollFaxStatuses may write it.
// Refusing its events with a 409 only made Telnyx redeliver them; no redelivery
// can make them acceptable, so they are acknowledged without any write. Every
// row the authority senders create has document_url == null and a submission
// attempt id from the moment it exists, so this never matches one of theirs.
function outboundFaxIsUntrackedLegacyRow(row) {
  return !!row
    && (row.document_url != null || !boundedTelnyxAuthorityId(row.provider_submission_attempt_id));
}

// No FaxLog carries this provider id yet. Without a client_state that is the
// sender race (telnyx_fax_id is recorded only after POST /v2/faxes returns), so
// it stays a 404 and Telnyx redelivers. With our client_state the named row
// decides — but only to choose an acknowledgement or a redelivery: a status is
// never written here, because the row's provider identity is not yet recorded
// and outboundFaxHasStatusAuthority requires it.
async function correlateUnrecordedOutboundFaxEvent(base44, providerId, correlation) {
  if (correlation?.kind !== 'outbound') {
    return Response.json({ success: false, message: 'FaxLog not found' }, { status: 404 });
  }
  let rows;
  try {
    rows = await base44.asServiceRole.entities.FaxLog.filter(
      { id: correlation.id },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return Response.json({ success: false, message: 'Fax status temporarily unavailable' }, { status: 503 });
  }
  if (!Array.isArray(rows)) {
    return Response.json({ success: false, message: 'Fax status temporarily unavailable' }, { status: 503 });
  }
  if (rows.length !== 1 || rows[0]?.id !== correlation.id) {
    return Response.json({ success: false, message: 'FaxLog not found' }, { status: 404 });
  }
  const row = rows[0];
  if (row.telnyx_fax_id != null && row.telnyx_fax_id !== providerId) {
    return Response.json({
      success: false,
      message: 'Fax identity conflicts with its client state',
      code: 'FAX_CLIENT_STATE_CONFLICT',
    }, { status: 409 });
  }
  if (row.telnyx_fax_id === providerId) {
    // The id was recorded between the two reads; the redelivery takes the
    // ordinary authorized path.
    return Response.json({ success: false, message: 'Fax status temporarily unavailable' }, { status: 503 });
  }
  if (outboundFaxIsUntrackedLegacyRow(row)) {
    return Response.json({ success: true, skipped: 'untracked_fax_row' });
  }
  if (row.provider_submission_state === 'pending') {
    return Response.json({
      success: false,
      message: 'Fax provider id is not recorded yet',
      code: 'FAX_PROVIDER_ID_NOT_RECORDED',
    }, { status: 404 });
  }
  // The sender gave up on this submission (indeterminate or rejected) while
  // Telnyx reports it. Binding the provider id here would race the retry
  // reconciliation that owns such rows, so leave it to operator reconciliation;
  // the failed delivery stays visible in Telnyx's webhook log.
  return Response.json({
    success: false,
    message: 'Fax submission requires reconciliation',
    code: 'FAX_SUBMISSION_REQUIRES_RECONCILIATION',
  }, { status: 409 });
}

const OUTBOUND_FAX_MAX_RETRY_ATTEMPTS = 10;

function boundedOutboundFaxRetryPolicy(config) {
  const source = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  const unset = (value) => value == null
    || (typeof value === 'string' && value.trim() === '');
  const rawMaxRetries = Number(source.max_retries);
  const rawDelayMinutes = Number(source.retry_delay_minutes);
  // Treat service-owned policy rows as untrusted input too. Malformed values
  // must fail closed instead of authorizing another transmission.
  const valid = (unset(source.max_retries)
      || (Number.isSafeInteger(rawMaxRetries)
        && rawMaxRetries >= 0
        && rawMaxRetries <= OUTBOUND_FAX_MAX_RETRY_ATTEMPTS))
    && (unset(source.retry_delay_minutes)
      || (Number.isFinite(rawDelayMinutes)
        && rawDelayMinutes >= 1
        && rawDelayMinutes <= 360))
    && (source.is_active == null || typeof source.is_active === 'boolean')
    && (source.auto_retry_enabled == null || typeof source.auto_retry_enabled === 'boolean')
    && (source.notify_on_final_failure == null
      || typeof source.notify_on_final_failure === 'boolean');
  const boundedConfig = {
    ...source,
    ...(source.is_active === false ? { auto_retry_enabled: false } : {}),
  };
  return { valid, config: boundedConfig, normalized: faxRetryConfig(boundedConfig) };
}

async function resolveFaxRetryConfigByAgency(base44, agencyId) {
  let exact;
  try {
    exact = await base44.asServiceRole.entities.FaxRetryConfig.filter(
      { agency_id: agencyId },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, config: null };
  }
  if (!Array.isArray(exact) || exact.length > 1
    || exact.some((row) => row?.agency_id !== agencyId)) {
    return { ok: false, config: null };
  }
  if (exact.length === 1) return { ok: true, config: exact[0] };

  let agencies;
  try {
    agencies = await base44.asServiceRole.entities.Agency.filter(
      { id: agencyId },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, config: null };
  }
  if (!Array.isArray(agencies) || agencies.length !== 1 || agencies[0]?.id !== agencyId
    || !boundedTelnyxAuthorityId(agencies[0]?.agency_code)) {
    return { ok: false, config: null };
  }
  let duplicates;
  let legacy;
  try {
    duplicates = await base44.asServiceRole.entities.Agency.filter(
      { agency_code: agencies[0].agency_code },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
    legacy = await base44.asServiceRole.entities.FaxRetryConfig.filter(
      { agency_name: agencies[0].agency_code },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, config: null };
  }
  if (!Array.isArray(duplicates) || duplicates.length !== 1 || duplicates[0]?.id !== agencyId
    || !Array.isArray(legacy) || legacy.length > 1
    || legacy.some((row) => row?.agency_name !== agencies[0].agency_code
      || (row?.agency_id != null && row.agency_id !== agencyId))) {
    return { ok: false, config: null };
  }
  return { ok: true, config: legacy[0] || null };
}

const FAX_NOTIFICATION_EXACT_ROW_LIMIT = 10;
const FAX_NOTIFICATION_MEMBERSHIP_SCAN_LIMIT = 100;
const FAX_NOTIFICATION_MEMBERSHIP_STATUSES = new Set([
  'pending',
  'active',
  'suspended',
  'revoked',
]);
const FAX_NOTIFICATION_TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);

const canonicalFaxNotificationEmail = (value) => {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  return email && email.includes('@') && !/\s/.test(email) ? email : null;
};

const exactFaxNotificationInstant = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value));

const boundedFaxNotificationReason = (value) => {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
};

async function loadActiveOutboundFaxNotificationRecipient(base44, fax) {
  const agencyId = boundedTelnyxAuthorityId(fax?.agency_id);
  const userId = boundedTelnyxAuthorityId(fax?.sent_by_user_id);
  const membershipId = boundedTelnyxAuthorityId(fax?.sent_by_membership_id);
  const sentMembershipVersion = fax?.sent_by_membership_version;
  const senderEmail = canonicalFaxNotificationEmail(fax?.sent_by);
  if (!agencyId || !userId || !membershipId || !senderEmail
    || fax.sent_by !== senderEmail
    || !Number.isSafeInteger(sentMembershipVersion) || sentMembershipVersion < 1) return null;

  const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: userId },
    '-updated_date',
    FAX_NOTIFICATION_MEMBERSHIP_SCAN_LIMIT,
  );
  if (!Array.isArray(rows)
    || rows.length >= FAX_NOTIFICATION_MEMBERSHIP_SCAN_LIMIT
    || rows.length !== 1
    || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)) return null;

  const recipient = rows[0];
  const recipientEmail = canonicalFaxNotificationEmail(recipient?.user_email_normalized);
  const transitionEmail = canonicalFaxNotificationEmail(recipient?.last_transition_by_email_normalized);
  const status = String(recipient?.status || '');
  if (boundedTelnyxAuthorityId(recipient?.id) !== membershipId
    || recipient.id !== membershipId
    || recipient.membership_key !== `${agencyId}:${userId}`
    || recipientEmail !== senderEmail
    || recipient.user_email_normalized !== recipientEmail
    || !FAX_NOTIFICATION_TENANT_ROLES.has(String(recipient.tenant_role || ''))
    || !FAX_NOTIFICATION_MEMBERSHIP_STATUSES.has(status)
    || !boundedTelnyxAuthorityId(recipient.created_by_user_id)
    || !boundedTelnyxAuthorityId(recipient.last_transition_by_user_id)
    || !transitionEmail
    || recipient.last_transition_by_email_normalized !== transitionEmail
    || !exactFaxNotificationInstant(recipient.last_transition_at)
    || !boundedFaxNotificationReason(recipient.last_transition_reason)
    || !Number.isSafeInteger(recipient.version)
    || recipient.version < sentMembershipVersion
    || ((status === 'active' || status === 'suspended')
      && !exactFaxNotificationInstant(recipient.activated_at))
    || (status === 'revoked'
      && (!exactFaxNotificationInstant(recipient.revoked_at)
        || !boundedFaxNotificationReason(recipient.revocation_reason)))) return null;
  return status === 'active' ? recipient : null;
}

function outboundFaxNotificationMessage(kind, fax) {
  const documentName = fax.document_name || 'Document';
  const recipient = fax.to_name || fax.to_number;
  return kind === 'delivery'
    ? `Fax "${documentName}" delivered to ${recipient}`
    : `Fax "${documentName}" failed to ${recipient}. Reason: ${fax.failure_reason || 'Unknown'}`;
}

function outboundFaxNotificationSpec(fax, recipient, kind) {
  const delivered = kind === 'delivery';
  const agencyId = fax.agency_id;
  const dedupeKey = `fax:${agencyId}:${fax.id}:${delivered ? 'delivered' : 'failed'}`;
  return {
    markerField: delivered ? 'delivery_confirmation_sent' : 'final_failure_notified',
    claimField: delivered ? 'delivery_notify_claimed_by' : 'failure_notify_claimed_by',
    claimedAtField: delivered ? 'delivery_notify_claimed_at' : 'failure_notify_claimed_at',
    publicationField: delivered ? 'delivery_notify_publication_state' : 'failure_notify_publication_state',
    dedupeKey,
    payload: {
      agency_id: agencyId,
      dedupe_key: dedupeKey,
      recipient_user_id: recipient.user_id,
      recipient_membership_id: recipient.id,
      recipient_membership_version: recipient.version,
      authority_version: 1,
      authority_state: 'active',
      version: 1,
      user_email: recipient.user_email_normalized,
      title: delivered ? 'Fax Status Update' : 'Fax Failed',
      message: outboundFaxNotificationMessage(kind, fax),
      type: delivered ? 'fax_delivered' : 'fax_failed',
      priority: delivered ? 'medium' : 'high',
      metadata: {
        agency_id: agencyId,
        related_entity: 'FaxLog',
        related_entity_id: fax.id,
        workflow: delivered ? 'fax_delivery_confirmation' : 'fax_final_failure',
      },
      is_read: false,
      dismissed: false,
    },
  };
}

function outboundFaxNotificationMatches(row, spec) {
  return !!row
    && !!boundedTelnyxAuthorityId(row.id)
    && row.agency_id === spec.payload.agency_id
    && row.dedupe_key === spec.dedupeKey
    && row.recipient_user_id === spec.payload.recipient_user_id
    && row.recipient_membership_id === spec.payload.recipient_membership_id
    && row.recipient_membership_version === spec.payload.recipient_membership_version
    && row.authority_version === 1
    && row.authority_state === spec.payload.authority_state
    && Number.isSafeInteger(row.version)
    && row.version >= 1
    && row.user_email === spec.payload.user_email
    && canonicalFaxNotificationEmail(row.user_email) === spec.payload.user_email
    && row.type === spec.payload.type
    && row.title === spec.payload.title
    && row.message === spec.payload.message
    && row.priority === spec.payload.priority
    && row.metadata?.agency_id === spec.payload.metadata.agency_id
    && row.metadata?.related_entity === 'FaxLog'
    && row.metadata?.related_entity_id === spec.payload.metadata.related_entity_id
    && row.metadata?.workflow === spec.payload.metadata.workflow
    && Object.keys(row.metadata || {}).length === Object.keys(spec.payload.metadata).length
    && typeof row.is_read === 'boolean'
    && (row.is_read ? exactFaxNotificationInstant(row.read_at) : row.read_at == null)
    && typeof row.dismissed === 'boolean'
    && (row.dismissed ? exactFaxNotificationInstant(row.dismissed_at) : row.dismissed_at == null)
    && row.action_url == null;
}

async function loadOutboundFaxNotifications(base44, spec) {
  const rows = await base44.asServiceRole.entities.Notification.filter(
    // This purpose key is shared with the poller. A legacy or malformed row
    // that already owns it must remain visible and fail closed; narrowing the
    // query to recipient fields could otherwise hide it and permit a duplicate.
    { dedupe_key: spec.dedupeKey },
    '-created_date',
    FAX_NOTIFICATION_EXACT_ROW_LIMIT,
  );
  if (!Array.isArray(rows) || rows.length > 1
    || rows.some((row) => !outboundFaxNotificationMatches(row, spec))) return null;
  return rows;
}

async function finalizeOutboundFaxNotification(base44, fax, spec, claimToken) {
  const rows = await base44.asServiceRole.entities.FaxLog.filter(
    { id: fax.id },
    undefined,
    OUTBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== fax.id
    || rows[0]?.telnyx_fax_id !== fax.telnyx_fax_id) return false;
  if (rows[0][spec.markerField] === true) return true;
  if (rows[0][spec.claimField] !== claimToken
    || !Number.isFinite(Date.parse(rows[0][spec.claimedAtField] || ''))
    || !Number.isFinite(Date.parse(rows[0]?.updated_date || ''))) return false;
  const result = await base44.asServiceRole.entities.FaxLog.updateMany(
    {
      id: fax.id,
      telnyx_fax_id: fax.telnyx_fax_id,
      status: fax.status,
      [spec.claimField]: claimToken,
      updated_date: rows[0].updated_date,
    },
    { $set: {
      [spec.markerField]: true,
      [spec.claimField]: null,
      [spec.claimedAtField]: null,
    } },
  ).catch(() => null);
  if (successfulInboundFaxUpdate(result)) return true;
  const concurrent = await base44.asServiceRole.entities.FaxLog.filter(
    { id: fax.id },
    undefined,
    OUTBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  return Array.isArray(concurrent) && concurrent.length === 1
    && concurrent[0]?.id === fax.id
    && concurrent[0]?.telnyx_fax_id === fax.telnyx_fax_id
    && concurrent[0]?.[spec.markerField] === true;
}

async function sendClaimedOutboundFaxNotification(base44, fax, kind, claimToken) {
  const recipient = await loadActiveOutboundFaxNotificationRecipient(base44, fax).catch(() => null);
  if (!recipient) return false;
  const spec = outboundFaxNotificationSpec(fax, recipient, kind);
  let existing = await loadOutboundFaxNotifications(base44, spec).catch(() => null);
  if (existing?.length) {
    return finalizeOutboundFaxNotification(base44, fax, spec, claimToken);
  }
  if (existing === null) return false;
  // Shared with the poller: once publication starts, only reconciliation is
  // allowed, including after a lost response or an expired ownership lease.
  if (fax[spec.publicationField] !== 'ready' || fax[spec.claimField] !== claimToken) return false;
  const publication = await base44.asServiceRole.entities.FaxLog.updateMany({
    id: fax.id, agency_id: fax.agency_id, telnyx_fax_id: fax.telnyx_fax_id,
    status: fax.status, updated_date: fax.updated_date,
    [spec.markerField]: false, [spec.claimField]: claimToken, [spec.publicationField]: 'ready',
  }, { $set: { [spec.publicationField]: 'started' } }).catch(() => null);
  if (!successfulInboundFaxUpdate(publication)) return false;
  let created = null;
  try {
    created = await base44.asServiceRole.entities.Notification.create(spec.payload);
  } catch {
    // A create response can be lost after the row committed. Reconcile by the
    // purpose-specific key before ever allowing another notification attempt.
    existing = await loadOutboundFaxNotifications(base44, spec).catch(() => null);
    if (existing?.length) {
      return finalizeOutboundFaxNotification(base44, fax, spec, claimToken);
    }
    return false;
  }
  if (!outboundFaxNotificationMatches(created, spec)) {
    existing = await loadOutboundFaxNotifications(base44, spec).catch(() => null);
    if (!existing?.length) return false;
  }
  return finalizeOutboundFaxNotification(base44, fax, spec, claimToken);
}

async function resolveActiveTelnyxFaxBinding(base44, telnyxCreds, rawDestination) {
  const record = telnyxCreds?.record;
  const integrationSecretId = boundedTelnyxAuthorityId(record?.id);
  const faxConnectionId = boundedTelnyxAuthorityId(telnyxCreds?.faxConnectionId);
  const destinationE164 = normalizeE164(rawDestination);
  if (record?.provider !== 'telnyx'
    || record?.is_active !== true
    || !integrationSecretId || record.id !== integrationSecretId
    || !faxConnectionId || record.fax_connection_id !== faxConnectionId
    || !destinationE164) {
    return { ok: false, reason: 'invalid_fax_binding_input' };
  }

  let activeIntegrations;
  try {
    activeIntegrations = await base44.asServiceRole.entities.IntegrationSecret.filter(
      { provider: 'telnyx', is_active: true },
      undefined,
      2,
    );
  } catch {
    return { ok: false, reason: 'fax_integration_read_failed' };
  }
  if (!Array.isArray(activeIntegrations) || activeIntegrations.length !== 1) {
    return { ok: false, reason: 'fax_integration_ambiguous' };
  }
  const activeIntegration = activeIntegrations[0];
  if (activeIntegration?.id !== integrationSecretId
    || activeIntegration?.provider !== 'telnyx'
    || activeIntegration?.is_active !== true
    || activeIntegration?.fax_connection_id !== faxConnectionId) {
    return { ok: false, reason: 'fax_integration_integrity_failed' };
  }

  let rows;
  try {
    rows = await base44.asServiceRole.entities.TelecomDestinationBinding.filter({
      provider: 'telnyx',
      integration_secret_id: integrationSecretId,
      destination_e164: destinationE164,
      status: 'active',
    }, undefined, INBOUND_FAX_EXACT_ROW_LIMIT);
  } catch {
    return { ok: false, reason: 'fax_binding_read_failed' };
  }
  if (!Array.isArray(rows) || rows.length !== 1) {
    return { ok: false, reason: rows?.length ? 'fax_binding_ambiguous' : 'fax_binding_not_found' };
  }
  const binding = rows[0];
  const bindingId = boundedTelnyxAuthorityId(binding?.id);
  const agencyId = boundedTelnyxAuthorityId(binding?.agency_id);
  const providerNumberId = boundedTelnyxAuthorityId(binding?.provider_number_id);
  const phoneNumberId = boundedTelnyxAuthorityId(binding?.phone_number_id);
  const creatorId = boundedTelnyxAuthorityId(binding?.created_by_user_id);
  const transitionActorId = boundedTelnyxAuthorityId(binding?.last_transition_by_user_id);
  const transitionRequestId = boundedTelnyxAuthorityId(binding?.last_transition_request_id);
  const transitionReason = typeof binding?.last_transition_reason === 'string'
    ? binding.last_transition_reason.trim()
    : '';
  const expectedBindingKey = `telnyx:${integrationSecretId}:${destinationE164}`;
  const expectedTransitionKey = transitionRequestId
    ? `${expectedBindingKey}:${transitionRequestId}`
    : null;
  const createdAt = Date.parse(binding?.created_at || '');
  const activatedAt = Date.parse(binding?.activated_at || '');
  const transitionedAt = Date.parse(binding?.last_transition_at || '');
  const suspendedAt = binding?.suspended_at == null ? null : Date.parse(binding.suspended_at);
  const initialActive = binding?.last_transition_action === 'bind'
    && binding?.version === 1
    && suspendedAt == null
    && createdAt === activatedAt
    && activatedAt === transitionedAt
    && creatorId === transitionActorId
    && binding?.created_by_user_email_normalized === binding?.last_transition_by_email_normalized;
  const reactivated = binding?.last_transition_action === 'activate'
    && Number.isSafeInteger(binding?.version) && binding.version >= 2
    && Number.isFinite(suspendedAt)
    && createdAt <= suspendedAt && suspendedAt < activatedAt
    && activatedAt === transitionedAt;
  if (!bindingId || binding.id !== bindingId
    || !agencyId || binding.agency_id !== agencyId
    || !providerNumberId || binding.provider_number_id !== providerNumberId
    || !phoneNumberId || binding.phone_number_id !== phoneNumberId
    || !creatorId || binding.created_by_user_id !== creatorId
    || !transitionActorId || binding.last_transition_by_user_id !== transitionActorId
    || !transitionRequestId || binding.last_transition_request_id !== transitionRequestId
    || !isCanonicalTelnyxAuthorityEmail(binding?.created_by_user_email_normalized)
    || !isCanonicalTelnyxAuthorityEmail(binding?.last_transition_by_email_normalized)
    || binding?.provider !== 'telnyx'
    || binding?.integration_secret_id !== integrationSecretId
    || binding?.destination_e164 !== destinationE164
    || binding?.binding_key !== expectedBindingKey
    || binding?.fax_connection_id !== faxConnectionId
    || binding?.fax_inbound_enabled !== true
    || typeof binding?.sms_inbound_enabled !== 'boolean'
    || typeof binding?.sms_outbound_enabled !== 'boolean'
    || typeof binding?.voice_inbound_enabled !== 'boolean'
    || binding?.status !== 'active'
    || !['manual', 'telnyx_purchase', 'legacy_backfill'].includes(binding?.source)
    || (!initialActive && !reactivated)
    || !transitionReason || binding.last_transition_reason !== transitionReason
    || transitionReason.length > 500
    || binding?.last_transition_request_key !== expectedTransitionKey
    || !Number.isFinite(createdAt) || !Number.isFinite(activatedAt) || !Number.isFinite(transitionedAt)
    || createdAt > activatedAt || activatedAt > transitionedAt
    || binding?.revoked_at != null || binding?.revocation_reason != null
    || !Number.isSafeInteger(binding?.version) || binding.version < 1) {
    return { ok: false, reason: 'fax_binding_integrity_failed' };
  }

  let agencies;
  try {
    agencies = await base44.asServiceRole.entities.Agency.filter(
      { id: agencyId },
      undefined,
      INBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, reason: 'fax_agency_read_failed' };
  }
  if (!Array.isArray(agencies) || agencies.length !== 1
    || agencies[0]?.id !== agencyId
    || !['active', 'trial'].includes(agencies[0]?.status)
    || !boundedTelnyxAuthorityId(agencies[0]?.agency_code)) {
    return { ok: false, reason: 'fax_agency_unavailable' };
  }
  const agency = agencies[0];
  const duplicateAgencies = await base44.asServiceRole.entities.Agency.filter(
    { agency_code: agency.agency_code },
    undefined,
    INBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(duplicateAgencies) || duplicateAgencies.length !== 1
    || duplicateAgencies[0]?.id !== agencyId) {
    return { ok: false, reason: 'fax_agency_identity_ambiguous' };
  }
  const settingsRows = await base44.asServiceRole.entities.AgencySettings.filter(
    { agency_code: agency.agency_code },
    '-updated_date',
    INBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(settingsRows) || settingsRows.length !== 1
    || settingsRows[0]?.agency_code !== agency.agency_code
    || (settingsRows[0]?.agency_id != null && settingsRows[0].agency_id !== agencyId)) {
    return { ok: false, reason: 'fax_settings_unavailable' };
  }
  return {
    ok: true,
    binding,
    bindingId,
    bindingKey: expectedBindingKey,
    bindingVersion: binding.version,
    integrationSecretId,
    destinationE164,
    agencyId,
    settings: settingsRows[0],
  };
}

function inboundFaxRowMatches(row, authority, providerId, mediaUrl) {
  return !!row
    && boundedTelnyxAuthorityId(row.id) === row.id
    && row.agency_id === authority.agencyId
    && row.ingress_binding_id === authority.bindingId
    && row.ingress_binding_key === authority.bindingKey
    && Number.isSafeInteger(row.ingress_binding_version)
    && row.ingress_binding_version >= 1
    && row.ingress_binding_version <= authority.bindingVersion
    && row.integration_secret_id === authority.integrationSecretId
    && row.received_to_number === authority.destinationE164
    && row.telnyx_fax_id === providerId
    && row.document_url === mediaUrl
    && Number.isSafeInteger(row.version)
    && row.version >= 1
    && Number.isFinite(Date.parse(row.created_date || ''))
    && Number.isFinite(Date.parse(row.updated_date || ''));
}

function sameInboundFaxAuthority(left, right) {
  return left?.ok === true
    && right?.ok === true
    && left.bindingId === right.bindingId
    && left.bindingKey === right.bindingKey
    && left.bindingVersion === right.bindingVersion
    && left.integrationSecretId === right.integrationSecretId
    && left.destinationE164 === right.destinationE164
    && left.agencyId === right.agencyId
    && JSON.stringify(left.binding) === JSON.stringify(right.binding)
    && JSON.stringify(left.settings) === JSON.stringify(right.settings);
}

async function loadExactInboundFax(base44, authority, providerId, mediaUrl) {
  const rows = await base44.asServiceRole.entities.IncomingFax.filter(
    { telnyx_fax_id: providerId },
    undefined,
    INBOUND_FAX_EXACT_ROW_LIMIT,
  );
  if (!Array.isArray(rows) || rows.length > 1) return { ok: false, rows: [] };
  if (rows.some((row) => !inboundFaxRowMatches(row, authority, providerId, mediaUrl))) {
    return { ok: false, rows };
  }
  return { ok: true, rows };
}

async function createInboundFax(base44, authority, payload, providerId, mediaUrl, processingStatus) {
  const sender = normalizeE164(payload?.from) || '';
  const pageCount = Number.isSafeInteger(payload?.page_count) && payload.page_count > 0
    ? payload.page_count
    : undefined;
  const receivedAt = new Date().toISOString();
  const reservation = await reserveFaxQueueCreation(
    base44.asServiceRole.entities, authority.agencyId, 'inbound', providerId,
  );
  if (!reservation) throw new Error('Inbound fax creation is reserved or unconfirmed');
  let creationStarted = false;
  let creationVerified = false;
  try {
    const current = await loadExactInboundFax(base44, authority, providerId, mediaUrl);
    if (!current.ok) throw new Error('Inbound fax creation identity changed');
    if (current.rows.length === 1) return current.rows[0];
    creationStarted = true;
    const created = await base44.asServiceRole.entities.IncomingFax.create({
      agency_id: authority.agencyId,
      queue_creation_reservation_token: reservation.token,
      ingress_binding_id: authority.bindingId,
      ingress_binding_key: authority.bindingKey,
      ingress_binding_version: authority.bindingVersion,
      integration_secret_id: authority.integrationSecretId,
      received_to_number: authority.destinationE164,
      user_email: authority.binding.created_by_user_email_normalized,
      sender_fax_number: sender,
      received_at: receivedAt,
      document_url: mediaUrl,
      ...(pageCount ? { page_count: pageCount } : {}),
      telnyx_fax_id: providerId,
      processing_status: processingStatus,
      processing_notification_state: 'ready',
      status: 'unread',
      version: 1,
    });
    const createdId = boundedTelnyxAuthorityId(created?.id);
    if (!createdId) throw new Error('IncomingFax.create returned no exact id');
    const loaded = await loadExactInboundFax(base44, authority, providerId, mediaUrl);
    if (!loaded.ok || loaded.rows.length !== 1 || loaded.rows[0]?.id !== createdId
      || loaded.rows[0]?.processing_status !== processingStatus
      || loaded.rows[0]?.status !== 'unread'
      || loaded.rows[0]?.received_at !== receivedAt
      || loaded.rows[0]?.processing_notification_state !== 'ready'
      || loaded.rows[0]?.queue_creation_reservation_token !== reservation.token) {
      throw new Error('Inbound fax creation failed verification');
    }
    creationVerified = true;
    return loaded.rows[0];
  } finally {
    if (!creationStarted || creationVerified) {
      if (!await releaseFaxQueueCreation(base44.asServiceRole.entities, reservation).catch(() => false)) {
        throw new Error('Confirmed inbound reservation could not be released');
      }
    }
  }
}

async function claimInboundFaxForward(base44, authority, record) {
  const priorVersion = record.version;
  const claimId = typeof globalThis.crypto?.randomUUID === 'function'
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const claimedAt = new Date().toISOString();
  const result = await base44.asServiceRole.entities.IncomingFax.updateMany(
    {
      id: record.id,
      agency_id: authority.agencyId,
      version: record.version,
      updated_date: record.updated_date,
      processing_status: 'completed',
      status: 'unread',
    },
    {
      $set: {
        status: 'reviewing',
        routed_to: 'office_fax_pending',
        claimed_by: claimId,
        claimed_at: claimedAt,
      },
      $inc: { version: 1 },
    },
  );
  if (!successfulInboundFaxUpdate(result)) return null;
  const loaded = await loadExactInboundFax(
    base44,
    authority,
    record.telnyx_fax_id,
    record.document_url,
  );
  if (!loaded.ok || loaded.rows.length !== 1) {
    throw new Error('Inbound fax forward claim failed verification');
  }
  const claimed = loaded.rows[0];
  if (claimed.id !== record.id
    || claimed.version !== priorVersion + 1
    || claimed.processing_status !== 'completed'
    || claimed.status !== 'reviewing'
    || claimed.routed_to !== 'office_fax_pending'
    || claimed.claimed_by !== claimId
    || claimed.claimed_at !== claimedAt) {
    throw new Error('Inbound fax forward claim failed verification');
  }
  return claimed;
}

async function releaseInboundFaxForwardClaim(base44, authority, record) {
  const result = await base44.asServiceRole.entities.IncomingFax.updateMany(
    {
      id: record.id,
      agency_id: authority.agencyId,
      version: record.version,
      updated_date: record.updated_date,
      processing_status: 'completed',
      status: 'reviewing',
      routed_to: 'office_fax_pending',
      claimed_by: record.claimed_by,
    },
    {
      $set: {
        status: 'unread',
        routed_to: null,
        claimed_by: null,
        claimed_at: null,
      },
      $inc: { version: 1 },
    },
  );
  return successfulInboundFaxUpdate(result);
}

// Signed Telnyx fax ingress. The exact dialed destination is resolved through
// TelecomDestinationBinding before any tenant setting, media row, or forward
// command is touched. Every inbound fax is then passed through to the office
// fax machine: the app receives no faxes (product owner, 2026-10-09). The
// IncomingFax row it writes is only the at-most-once forward record.
async function handleInboundFax(base44, telnyxCreds, payload) {
  // Telnyx names the fax in fax.* payloads as fax_id; payload.id is still read
  // (both must agree when both are present), as handleFaxEvent does.
  const providerId = faxEventProviderId(payload).id;
  const mediaUrl = exactInboundFaxHttpsUrl(payload?.media_url || payload?.original_media_url);
  const receivedOn = normalizeE164(payload?.to);
  if (!providerId || payload?.direction !== 'inbound'
    || !mediaUrl || !receivedOn) {
    return inboundFaxUnavailable(400, 'INVALID_INBOUND_FAX_EVENT');
  }
  let authority = await resolveActiveTelnyxFaxBinding(base44, telnyxCreds, receivedOn);
  if (!authority.ok) return inboundFaxUnavailable();

  const existing = await loadExactInboundFax(base44, authority, providerId, mediaUrl).catch(() => null);
  if (!existing?.ok) return inboundFaxUnavailable(409, 'INBOUND_FAX_IDENTITY_CONFLICT');
  const finalAuthority = await resolveActiveTelnyxFaxBinding(base44, telnyxCreds, receivedOn);
  if (!sameInboundFaxAuthority(authority, finalAuthority)) return inboundFaxUnavailable();
  authority = finalAuthority;
  if (existing.rows.length === 1) {
    const child = existing.rows[0];
    if (['pending', 'processing'].includes(child.processing_status)
      && !['ready', 'started', 'completed'].includes(child.processing_notification_state)) {
      return inboundFaxUnavailable(409, 'INBOUND_FAX_PUBLICATION_STATE_MISSING');
    }
    if (!await releaseRecoveredFaxQueueCreation(base44.asServiceRole.entities,
      authority.agencyId, 'inbound', providerId, child)) {
      return inboundFaxUnavailable(503, 'INBOUND_FAX_RESERVATION_UNCONFIRMED');
    }
  }
  // AgencySettings.fax_receiving_enabled is NO LONGER HONOURED. It used to
  // select in-app ingestion (an IncomingFax row left 'pending' for the
  // processInboundFaxes OCR worker); the product owner wants no incoming faxes
  // in the app (2026-10-09), so every inbound fax takes the office forward
  // below. The field stays in the schema; nothing reads it.
  const officeFax = normalizeE164(authority.settings.office_fax_number_e164);
  if (!telnyxCreds.apiKey || !officeFax || officeFax === receivedOn) {
    return inboundFaxUnavailable(409, 'INBOUND_FAX_FORWARDING_UNAVAILABLE');
  }
  let record = existing.rows[0];
  if (record?.status === 'routed') {
    if (record.processing_status !== 'completed'
      || record.routed_to !== 'office_fax'
      || !Number.isFinite(Date.parse(record.routed_at || ''))) {
      return inboundFaxUnavailable(409, 'INBOUND_FAX_IDENTITY_CONFLICT');
    }
    return Response.json(
      { success: true, deduped: true, forwarded_to_office: true, incoming_fax_id: record.id },
      { headers: INBOUND_FAX_NO_STORE_HEADERS },
    );
  }
  if (!record) {
    record = await createInboundFax(
      base44,
      authority,
      payload,
      providerId,
      mediaUrl,
      'completed',
    );
  } else if (record.processing_status !== 'completed' || record.status !== 'unread') {
    return inboundFaxUnavailable(409, 'INBOUND_FAX_IDENTITY_CONFLICT');
  }

  // Persist signed inbound fax ingress even while forwarding is paused. A 503
  // leaves the unclaimed row replayable without crossing the provider boundary.
  if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax');

  // Telnyx Fax has no client idempotency key. Claim this exact inbound row
  // before the irreversible provider call so overlapping webhook deliveries
  // cannot both forward the same PHI document. An ambiguous post-send failure
  // deliberately leaves the row in `reviewing`; a replay must not blindly send
  // again when the first provider outcome is unknown.
  const claimed = await claimInboundFaxForward(base44, authority, record);
  if (!claimed) return inboundFaxUnavailable(409, 'INBOUND_FAX_FORWARD_ALREADY_CLAIMED');
  record = claimed;
  const preSendAuthority = await resolveActiveTelnyxFaxBinding(base44, telnyxCreds, receivedOn);
  if (!sameInboundFaxAuthority(authority, preSendAuthority)) {
    await releaseInboundFaxForwardClaim(base44, authority, record).catch(() => false);
    return inboundFaxUnavailable();
  }
  authority = preSendAuthority;

  // The forward is a new outbound fax with no FaxLog. Its client_state names the
  // IncomingFax so handleFaxEvent can recognize and acknowledge its fax.* events
  // instead of answering them 404 (no FaxLog) and drawing redeliveries. No
  // webhook_url: those events reach the Fax Application's webhook_event_url,
  // which is this function — the same route the fax.received just took.
  const forwardRequest = {
    connection_id: authority.binding.fax_connection_id,
    from: receivedOn,
    to: officeFax,
    media_url: mediaUrl,
    quality: 'high',
  };
  const forwardClientState = encodeFaxClientState('office_forward', record.id);
  if (forwardClientState) forwardRequest.client_state = forwardClientState;
  let response;
  try {
    response = await fetch('https://api.telnyx.com/v2/faxes', {
      method: 'POST',
      headers: { Authorization: `Bearer ${telnyxCreds.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(forwardRequest),
      // Telnyx times a webhook out after about ten seconds; answer inside it.
      // An abort is an unknown outcome and keeps the claim, like a network error.
      signal: AbortSignal.timeout(INBOUND_FAX_FORWARD_TIMEOUT_MS),
    });
  } catch {
    // The provider may have accepted a request even when the client never saw a
    // response. Preserve the claim for operator reconciliation; auto-release
    // here would turn a harmless webhook retry into a duplicate fax.
    return inboundFaxUnavailable(502, 'INBOUND_FAX_FORWARD_FAILED');
  }
  if (!response.ok) {
    if (response.status < 400 || response.status >= 500 || [408, 409, 425].includes(response.status)) {
      return inboundFaxUnavailable(502, 'INBOUND_FAX_FORWARD_REQUIRES_RECONCILIATION');
    }
    const released = await releaseInboundFaxForwardClaim(base44, authority, record).catch(() => false);
    return released
      ? inboundFaxUnavailable(502, 'INBOUND_FAX_FORWARD_FAILED')
      : inboundFaxUnavailable(503, 'INBOUND_FAX_FORWARD_CONFIRMATION_INTERRUPTED');
  }
  // A 2xx is the provider's acceptance either way; the id is read so the answer
  // (visible in Telnyx's webhook delivery log) names the forward its later
  // fax.* events will carry. No IncomingFax field holds it, so it is not stored,
  // and a missing one is logged without identifiers.
  const forwardBody = await response.json().catch(() => null);
  const forwardFaxId = exactFaxCorrelationId(forwardBody?.data?.id);
  if (!forwardFaxId) console.error('Inbound fax office forward was accepted without a provider fax id');
  const recordVersion = record.version;
  const update = await base44.asServiceRole.entities.IncomingFax.updateMany(
    {
      id: record.id,
      agency_id: authority.agencyId,
      version: recordVersion,
      updated_date: record.updated_date,
      processing_status: 'completed',
      status: 'reviewing',
      routed_to: 'office_fax_pending',
      claimed_by: record.claimed_by,
    },
    {
      $set: {
        status: 'routed',
        routed_to: 'office_fax',
        routed_at: new Date().toISOString(),
        claimed_by: null,
        claimed_at: null,
      },
      $inc: { version: 1 },
    },
  );
  if (!successfulInboundFaxUpdate(update)) {
    return inboundFaxUnavailable(503, 'INBOUND_FAX_FORWARD_CONFIRMATION_INTERRUPTED');
  }
  const verified = await loadExactInboundFax(base44, authority, providerId, mediaUrl);
  if (!verified.ok || verified.rows.length !== 1
    || verified.rows[0]?.id !== record.id
    || verified.rows[0]?.status !== 'routed'
    || verified.rows[0]?.version !== recordVersion + 1) {
    return inboundFaxUnavailable(503, 'INBOUND_FAX_FORWARD_CONFIRMATION_INTERRUPTED');
  }
  return Response.json(
    {
      success: true,
      forwarded_to_office: true,
      incoming_fax_id: record.id,
      ...(forwardFaxId ? { forward_fax_id: forwardFaxId } : {}),
    },
    { headers: INBOUND_FAX_NO_STORE_HEADERS },
  );
}

async function handleFaxEvent(base44, telnyxCreds, payload) {
  // Telnyx names the fax in a fax.* webhook as payload.fax_id (OpenAPI spec,
  // 2026-10-09); this read only payload.id, so every documented status event
  // was acknowledged as 'no fax id' and never reached a row.
  const providerRef = faxEventProviderId(payload);
  const providerId = providerRef.id;
  const mapped = mapFaxStatus(payload?.status);
  if (!providerRef.present) return Response.json({ success: true, skipped: 'no fax id' });
  if (!providerId) {
    return Response.json({ success: false, message: 'Invalid fax id' }, { status: 400 });
  }
  // client_state is set by this app's own POST /v2/faxes and arrives inside the
  // signature-verified body. It identifies a row; it never authorizes a write.
  const correlation = decodeFaxClientState(payload?.client_state);
  if (correlation?.kind === 'office_forward') {
    // The pass-through of a stray inbound fax to the office machine
    // (handleInboundFax). It has no FaxLog and nothing here tracks its outcome,
    // so acknowledge every event instead of answering 404 and having Telnyx
    // redeliver it. A provider failure is logged without identifiers.
    if (mapped === 'failed') console.error('Inbound fax office forward failed at the provider');
    return Response.json({ success: true, skipped: 'office_forward' });
  }
  if (!mapped) return Response.json({ success: true, skipped: 'unknown status', status: payload?.status });

  let rows;
  try {
    rows = await base44.asServiceRole.entities.FaxLog.filter(
      { telnyx_fax_id: providerId },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    );
  } catch {
    return Response.json({ success: false, message: 'Fax status temporarily unavailable' }, { status: 503 });
  }
  if (!Array.isArray(rows)) {
    return Response.json({ success: false, message: 'Fax status temporarily unavailable' }, { status: 503 });
  }
  // Senders write the provider id only after the API call, so a fast status
  // callback can race it; correlateUnrecordedOutboundFaxEvent answers 404 (so
  // Telnyx redelivers) unless the client_state names a row that settles it.
  if (!rows.length) return correlateUnrecordedOutboundFaxEvent(base44, providerId, correlation);
  if (rows.length !== 1 || rows.some((row) => row?.telnyx_fax_id !== providerId)) {
    return Response.json({ success: false, message: 'Fax identity is ambiguous' }, { status: 409 });
  }
  const faxLog = rows[0];
  if (correlation?.kind === 'outbound' && correlation.id !== faxLog.id) {
    return Response.json({
      success: false,
      message: 'Fax identity conflicts with its client state',
      code: 'FAX_CLIENT_STATE_CONFLICT',
    }, { status: 409 });
  }
  if (outboundFaxIsUntrackedLegacyRow(faxLog)) {
    return Response.json({ success: true, skipped: 'untracked_fax_row' });
  }
  if (!outboundFaxHasStatusAuthority(faxLog)
    || !Number.isFinite(Date.parse(faxLog?.updated_date || ''))) {
    return Response.json({ success: false, message: 'Fax identity is incomplete' }, { status: 409 });
  }
  const credential = telnyxCreds?.record;
  if (faxLog.provider !== 'telnyx'
    || faxLog.integration_secret_id !== credential?.id
    || faxLog.integration_secret_updated_at !== credential?.updated_date
    || faxLog.fax_connection_id !== credential?.fax_connection_id
    || boundedTelnyxAuthorityId(credential?.id) !== credential?.id
    || boundedTelnyxAuthorityId(credential?.fax_connection_id) !== credential?.fax_connection_id
    || !Number.isFinite(Date.parse(credential?.updated_date || ''))) {
    return Response.json({ success: false, message: 'Fax provider authority is stale or incomplete' }, { status: 409 });
  }
  // Idempotency + forward-only: ignore an unchanged or out-of-order (lower-rank)
  // transition. Telnyx re-delivers webhooks and can deliver them out of order, so
  // this ack's without re-running side effects (critically, without re-bumping
  // retry_count or re-scheduling a send for an already-terminal fax).
  if ((FAX_RANK[mapped] || 0) <= (FAX_RANK[faxLog.status] || 0)) {
    return Response.json({ success: true, status: faxLog.status, deduped: true });
  }

  const transitionedAt = new Date().toISOString();
  const update = {
    status: mapped,
    // Don't let a legitimate 0-page report fall through to the old value.
    pages: Number.isFinite(payload?.page_count) ? payload.page_count : faxLog.pages,
    failure_reason: null,
    next_retry_at: null,
    provider_submission_state: 'accepted',
    provider_accepted_at: Number.isFinite(Date.parse(faxLog.provider_accepted_at || ''))
      ? faxLog.provider_accepted_at
      : transitionedAt,
    ...(mapped === 'delivered' || mapped === 'failed' ? {
      provider_terminal_status: mapped,
      provider_terminal_at: transitionedAt,
    } : {}),
  };

  let notificationKind = null;
  let notificationClaimToken = null;
  if (mapped === 'delivered' && faxLog.sent_by && !faxLog.delivery_confirmation_sent) {
    notificationKind = 'delivery';
    notificationClaimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `fax-del-${Date.now()}`;
    update.delivery_confirmation_sent = false;
    update.delivery_notify_claimed_by = notificationClaimToken;
    update.delivery_notify_claimed_at = transitionedAt;
    update.delivery_notify_publication_state = 'ready';
  }
  if (mapped === 'failed') {
    const failureReason = payload?.failure_reason || payload?.failover?.failure_reason || 'Fax delivery failed';
    // Only a private-document fax with immutable tenant/member authority may
    // receive a retry schedule. Legacy URL-bearing rows and incomplete rows are
    // terminal: a background worker must never reconstruct and resend them.
    const retryAuthority = outboundFaxHasRetryAuthority(faxLog);
    const retryPolicy = retryAuthority
      ? await resolveFaxRetryConfigByAgency(base44, faxLog.agency_id)
      : { ok: false, config: null };
    const boundedPolicy = boundedOutboundFaxRetryPolicy(retryPolicy.config);
    const cfg = boundedPolicy.config;
    const retryCfg = boundedPolicy.normalized;
    const plan = retryAuthority && retryPolicy.ok && boundedPolicy.valid
      ? planFaxRetry({
        retryCount: faxLog.retry_count || 0,
        // fax.failed carries failure_reason and the more granular
        // internal_failure_reason; there is no failure_code/error_code.
        errorCode: payload?.internal_failure_reason,
        errorMessage: failureReason,
        priority: faxLog.priority || 'normal',
        config: cfg,
      })
      : { willRetry: false };
    // planFaxRetry already encodes the budget (attempts < maxRetries). Schedule
    // whenever it says willRetry — including nextRetryCount === maxRetries, which
    // is the last allowed send (isFaxRetryDue uses `>` so the cron still honors it).
    if (plan.willRetry) {
      update.next_retry_at = plan.nextRetryAt;
      update.retry_count = plan.nextRetryCount;
      if (plan.nextRetryAt) update.retry_submission_state = 'ready';
    } else {
      // If retry authority/policy cannot be proven, notify instead of silently
      // leaving a failed fax in a state that appears eligible for automation.
      const shouldNotify = (retryAuthority && retryPolicy.ok && boundedPolicy.valid
        ? retryCfg.notifyOnFinalFailure
        : true) && !!faxLog.sent_by;
      if (shouldNotify && !faxLog.final_failure_notified) {
        notificationKind = 'failure';
        notificationClaimToken = typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `fax-fail-${Date.now()}`;
        update.final_failure_notified = false;
        update.failure_notify_claimed_by = notificationClaimToken;
        update.failure_notify_claimed_at = transitionedAt;
        update.failure_notify_publication_state = 'ready';
      } else {
        update.final_failure_notified = true;
      }
    }
    update.failure_reason = failureReason;
  }

  // Retry-policy reads above cross multiple await boundaries. Re-prove the
  // provider id still identifies this one unchanged row immediately before the
  // CAS so a concurrently inserted duplicate (including another tenant's row)
  // cannot inherit this signed status event.
  const currentIdentityRows = await base44.asServiceRole.entities.FaxLog.filter(
    { telnyx_fax_id: providerId },
    undefined,
    OUTBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(currentIdentityRows) || currentIdentityRows.length !== 1
    || currentIdentityRows[0]?.id !== faxLog.id
    || currentIdentityRows[0]?.telnyx_fax_id !== providerId
    || currentIdentityRows[0]?.status !== faxLog.status
    || currentIdentityRows[0]?.updated_date !== faxLog.updated_date) {
    return Response.json({ success: false, message: 'Fax identity changed during status processing' }, { status: 409 });
  }

  const transitionResult = await base44.asServiceRole.entities.FaxLog.updateMany(
    {
      id: faxLog.id,
      telnyx_fax_id: providerId,
      status: faxLog.status,
      updated_date: faxLog.updated_date,
    },
    { $set: update },
  ).catch(() => null);
  if (!successfulInboundFaxUpdate(transitionResult)) {
    const concurrent = await base44.asServiceRole.entities.FaxLog.filter(
      { telnyx_fax_id: providerId },
      undefined,
      OUTBOUND_FAX_EXACT_ROW_LIMIT,
    ).catch(() => null);
    if (Array.isArray(concurrent) && concurrent.length === 1
      && concurrent[0]?.telnyx_fax_id === providerId
      && (FAX_RANK[concurrent[0]?.status] || 0) >= (FAX_RANK[mapped] || 0)) {
      return Response.json({ success: true, status: concurrent[0].status, deduped: true });
    }
    return Response.json({ success: false, message: 'Fax status update interrupted' }, { status: 503 });
  }
  const verifiedRows = await base44.asServiceRole.entities.FaxLog.filter(
    { telnyx_fax_id: providerId },
    undefined,
    OUTBOUND_FAX_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(verifiedRows) || verifiedRows.length !== 1
    || verifiedRows[0]?.id !== faxLog.id
    || verifiedRows[0]?.telnyx_fax_id !== providerId
    || verifiedRows[0]?.status !== mapped
    || verifiedRows[0]?.provider_submission_state !== 'accepted'
    || ((mapped === 'delivered' || mapped === 'failed')
      && (verifiedRows[0]?.provider_terminal_status !== mapped
        || !Number.isFinite(Date.parse(verifiedRows[0]?.provider_terminal_at || ''))))) {
    return Response.json({ success: false, message: 'Fax status confirmation interrupted' }, { status: 503 });
  }
  const transitionedFaxLog = verifiedRows[0];

  // The transition owns the notification claim before this irreversible create.
  // If the create response is lost, the purpose-specific Notification key lets
  // the poller reconcile the committed row without creating a duplicate.
  if (notificationKind && notificationClaimToken) {
    const notified = await sendClaimedOutboundFaxNotification(
      base44,
      transitionedFaxLog,
      notificationKind,
      notificationClaimToken,
    ).catch(() => false);
    if (!notified) console.error('Outbound fax notification remains pending for poller recovery');
  }
  return Response.json({ success: true, status: mapped });
}

// ============================ VOICE ============================
// ---- find-me-follow-me ringdown (mirrors src/components/voice/onCall.js) ----
const RING_TIMEOUT_SECS_DEFAULT = 20;
// Dedupe key so two spellings of the same number (e.g. "+12155550100" vs
// "2155550100") count as ONE ringdown target. Mirrors src/components/voice/onCall.js.
function ringdownDedupeKey(n) {
  const digits = String(n).replace(/\D/g, '');
  return digits.length >= 10 ? digits.slice(-10) : String(n).trim().toLowerCase();
}
function buildRingdown(opts) {
  const { primary = null, others = [], office = null, maxTargets = 4 } = opts || {};
  const seen = new Set();
  const out = [];
  const push = (num, kind) => {
    const n = String(num || '').trim();
    if (!n) return;
    const key = ringdownDedupeKey(n);
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ to: n, kind });
  };
  push(primary, 'primary');
  for (const o of Array.isArray(others) ? others : []) push(o, 'backup');
  push(office, 'office');
  const cap = Number.isFinite(maxTargets) && maxTargets > 0 ? maxTargets : 4;
  return out.slice(0, cap);
}
const UNANSWERED_CAUSES = new Set([
  // Telnyx call.hangup HangupCause enum (docs + SDK). Keep in sync with
  // src/components/voice/onCall.js UNANSWERED_HANGUP_CAUSES.
  'no_answer', 'user_busy', 'call_rejected', 'timeout', 'not_found', 'originator_cancel',
]);
function isUnansweredHangup(cause) {
  return UNANSWERED_CAUSES.has(String(cause || '').toLowerCase());
}
// 'failed' when a call.hangup ends a leg that never reached in_progress for an
// unanswered cause; null otherwise (an answered call stays 'completed').
function unansweredHangupStatus(eventType, currentStatus, cause) {
  if (eventType !== 'call.hangup' || !isUnansweredHangup(cause)) return null;
  return (CALL_RANK[currentStatus] || 0) < CALL_RANK.in_progress ? 'failed' : null;
}

// Other on-duty nurses' cells (for the ringdown backup list), excluding the
// primary nurse and anyone without a cell. Scoped to the primary nurse's agency:
// without this filter a patient calling agency A's work number could be bridged
// to agency B's nurse's personal cell (a cross-tenant PHI conversation) in any
// multi-tenant deployment — every sibling read here filters by agency.
async function otherOnDutyCells(base44, config, primaryEmail, primaryAgency) {
  const agency = String(primaryAgency || '').trim();
  // Fail closed: if the primary nurse has no agency, an equality filter would
  // match every OTHER agency-less (legacy/malformed) user and bridge the patient
  // call to their personal cell. An unattributable primary gets no backup ring.
  if (!agency) return [];
  const users = await base44.asServiceRole.entities.User.list('full_name', 5000).catch(() => []);
  const now = new Date();
  const cells = [];
  for (const u of Array.isArray(users) ? users : []) {
    if (!u || u.email === primaryEmail) continue;
    if (!u.personal_cell_e164) continue;
    if (String(u.agency_name || '').trim() !== agency) continue; // same agency only
    if (isOffDutyNow(u, now, config.settings)) continue; // only currently on-duty
    cells.push(u.personal_cell_e164);
  }
  return cells;
}

// Decide how an inbound call to a work number should be routed. Mirrors the
// routing in the former handleTwilioVoiceCall (agency hours > off-duty > masked
// bridge), returning a provider-neutral action the Call Control flow executes.
async function decideInboundRouting(base44, config, workNum) {
  const agencyClosed = !isAgencyOpen(config.settings);

  let nurse = null;
  for (const variant of (workNum ? phoneVariants(workNum) : [])) {
    const matches = await base44.asServiceRole.entities.User.filter({ work_phone_number: variant }, undefined, 5000).catch(() => []);
    if (matches.length > 0) { nurse = matches[0]; break; }
  }
  if (!nurse) {
    return config.mainOffice
      ? { action: 'bridge', to: config.mainOffice, callerId: workNum || config.mainOffice, nurse: null }
      : { action: 'hangup', greeting: 'We are unable to connect your call at this time. Please try again later.', nurse: null };
  }

  if (agencyClosed) {
    const office = config.afterHoursTransferDisplay || 'the main office';
    if (config.afterHoursAction === 'voicemail' && config.voicemailEnabled) {
      const greeting = (config.afterHoursGreeting || config.voicemailGreeting ||
        'Our office is currently closed. Please leave a message after the tone and we will return your call.').replace(/\{office\}/gi, office);
      return { action: 'voicemail', greeting, nurse };
    }
    if (config.afterHoursAction === 'hangup' || (!config.afterHoursTransfer && !config.mainOffice)) {
      const greeting = (config.afterHoursGreeting || 'Our office is currently closed. Please call back during business hours.').replace(/\{office\}/gi, office);
      return { action: 'hangup', greeting, nurse };
    }
    const greeting = (config.afterHoursGreeting || 'Our office is currently closed. Please hold while we connect you.').replace(/\{office\}/gi, office);
    const target = config.afterHoursTransfer || config.mainOffice;
    return { action: 'greet_transfer', greeting, to: target, callerId: workNum, nurse };
  }

  // Off duty = toggled off, after the 5pm auto-off, or a scheduled window.
  if (isOffDutyNow(nurse, new Date(), config.settings)) {
    const office = config.mainOfficeDisplay || '724-465-0440';
    const greeting = (nurse.off_duty_message ||
      'Thank you for your call, I am not working right now. Please hold while I connect you to Penn Home Health.').replace(/\{office\}/gi, office);
    // Speak the message, then connect them to the office so they don't have to
    // redial; if no office number is configured, just play the message and end.
    if (config.mainOffice) return { action: 'greet_transfer', greeting, to: config.mainOffice, callerId: workNum, nurse };
    return { action: 'hangup', greeting, nurse };
  }

  // On duty: find-me-follow-me ringdown — ring the nurse's cell first, then any
  // other on-duty nurse, then the office. Caller id = the work number on every
  // leg so the patient never sees a personal cell.
  const others = await otherOnDutyCells(base44, config, nurse.email, nurse.agency_name);
  const maxTargets = Number.isFinite(Number(config.settings?.ringdown_max)) ? Number(config.settings.ringdown_max) : 4;
  const targets = buildRingdown({ primary: nurse.personal_cell_e164, others, office: config.mainOffice, maxTargets });
  if (targets.length > 0) {
    return { action: 'ringdown', targets, to: targets[0].to, callerId: workNum, nurse };
  }
  return { action: 'hangup', greeting: 'We are unable to connect your call at this time. Please try again later.', nurse };
}

async function logInboundCall(base44, callControlId, callerNum, workNum, route) {
  if (!callControlId) return;
  const existing = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (existing.length > 0) return;
  // Label the call accurately: a call to a de-provisioned/unowned work number
  // (no nurse) must NOT be mislabeled as an off-duty transfer.
  const callMode = !route.nurse ? 'unresolved'
    : route.action === 'voicemail' ? 'voicemail'
      : route.action === 'hangup' ? 'unresolved'
        : (route.action === 'ringdown' || (route.action === 'bridge' && route.nurse?.personal_cell_e164)) ? 'masked_bridge'
          : 'office_transfer';
  const logRow = await base44.asServiceRole.entities.CallLog.create({
    direction: 'inbound', from_number: callerNum, to_number: route.to || '', displayed_number: workNum,
    nurse_email: route.nurse?.email || null, call_mode: callMode, status: 'ringing', provider_call_id: callControlId,
  }).catch(() => null);
  await base44.asServiceRole.entities.UserActivity.create({
    user_email: 'system', action: 'inbound_call_received', entity_type: 'CallLog', entity_id: logRow?.id,
    details: { call_mode: callMode, direction: 'inbound' }, status: 'success',
  }).catch(() => {});
}

async function handleCallEvent(base44, apiKey, eventType, payload) {
  const callControlId = payload?.call_control_id;
  const state = decodeClientState(payload?.client_state);
  const direction = String(payload?.direction || '').toLowerCase(); // 'incoming' | 'outgoing'

  // --- OUTBOUND masked bridge: nurse leg answered → dial the patient (caller id = work number). ---
  if (eventType === 'call.answered' && state?.t === 'masked_bridge' && callControlId && apiKey) {
    const r = await callCommand(apiKey, callControlId, 'transfer', { to: state.bridge_to, from: state.caller_id });
    if (!r.ok) {
      // Don't leave the nurse connected to dead air: tell them, hang up, and mark
      // the call failed so the log reflects that the patient was never reached.
      await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: 'We could not connect your call. Please try again later.' });
      await callCommand(apiKey, callControlId, 'hangup', {});
      if (state.call_log_id) {
        await base44.asServiceRole.entities.CallLog.update(state.call_log_id, { status: 'failed', failure_reason: 'Bridge transfer to the patient failed' }).catch(() => {});
      }
    }
    return Response.json({ success: true, bridged: r.ok });
  }

  // --- INBOUND IVR state machine (Call Control) ---
  if (apiKey && callControlId) {
    // Step 1: a fresh inbound call rings in. Answer it first (consistent with the
    // outbound path), carrying the routing decision forward in client_state.
    if (eventType === 'call.initiated' && direction === 'incoming' && !state) {
      const callerNum = normalizeE164(payload?.from) || payload?.from || '';
      const workNum = normalizeE164(payload?.to) || payload?.to || '';
      // Resolve agency from the dialed work number's nurse (or matching settings
      // lines) so multi-tenant IVR uses that tenant's greetings/transfer targets.
      let agencyHint = '';
      for (const variant of phoneVariants(workNum)) {
        const matches = await base44.asServiceRole.entities.User
          .filter({ work_phone_number: variant }, undefined, 1).catch(() => []);
        if (matches[0]?.agency_name) { agencyHint = matches[0].agency_name; break; }
      }
      if (!agencyHint) {
        const byLine = await resolveAgencySettingsByNumber(base44, workNum);
        agencyHint = byLine?.agency_code || byLine?.office_name || '';
      }
      const config = await getAgencyConfig(base44, agencyHint);
      const route = await decideInboundRouting(base44, config, workNum);
      await logInboundCall(base44, callControlId, callerNum, workNum, route);
      await callCommand(apiKey, callControlId, 'answer', {
        client_state: encodeClientState({ t: 'inbound_ivr', action: route.action, greeting: route.greeting || '', to: route.to || null, callerId: route.callerId || null, targets: route.targets || null }),
      });
      return Response.json({ success: true, inbound: route.action });
    }

    // --- RINGDOWN advance: a dialed leg went unanswered → roll to the next
    // target on the original caller leg (a_leg). A plain caller hangup carries a
    // different client_state, so this only fires on a callee no-answer. ---
    if (eventType === 'call.hangup' && state?.t === 'ringdown' && state.a_leg && isUnansweredHangup(payload?.hangup_cause)) {
      const next = (Number(state.idx) || 0) + 1;
      const hasNext = Array.isArray(state.targets) && state.targets[next];
      if (hasNext) {
        await startRingdown(base44, apiKey, state.a_leg, state.targets, state.callerId, next);
      } else {
        // Ringdown exhausted: nobody answered. Mark the inbound call as missed
        // BEFORE hanging up the caller leg. The CallLog status enum has no
        // 'no_answer', so use 'failed' — every missed-call consumer (callbackQueue,
        // comms dashboard, phone analytics, call history) already treats 'failed'
        // as a missed call. Without this the trailing call.hangup maps to
        // 'completed' and the missed call silently vanishes from the callback queue.
        const inboundLogs = await base44.asServiceRole.entities.CallLog
          .filter({ provider_call_id: state.a_leg }, '-created_date', 1).catch(() => []);
        if (inboundLogs.length && inboundLogs[0].status !== 'failed') {
          await base44.asServiceRole.entities.CallLog.update(inboundLogs[0].id, {
            status: 'failed',
            failure_reason: 'No answer — all on-call targets were unavailable',
          }).catch(() => {});
        }
        await callCommand(apiKey, state.a_leg, 'hangup', {});
      }
      return Response.json({ success: true, ringdown_advance: next, exhausted: !hasNext });
    }

    // Step 2: the inbound call we answered is now live → ring the targets
    // (find-me-follow-me), or speak the greeting then continue once it finishes.
    if (eventType === 'call.answered' && state?.t === 'inbound_ivr') {
      if (state.action === 'ringdown') {
        await startRingdown(base44, apiKey, callControlId, state.targets || [], state.callerId, 0);
        return Response.json({ success: true, inbound_ivr: 'ringdown' });
      }
      const greeting = String(state.greeting || '').slice(0, 320);
      const next = encodeClientState({ t: 'inbound_after_greet', action: state.action, to: state.to || null, callerId: state.callerId || null, targets: state.targets || null });
      if (greeting) {
        await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: greeting, client_state: next });
      } else {
        // No greeting (e.g. a plain transfer) → act immediately.
        await continueAfterGreeting(base44, apiKey, callControlId, state.action, state.to, state.callerId, state.targets);
      }
      return Response.json({ success: true, inbound_ivr: state.action });
    }

    // Safety net: if call.initiated was lost (webhooks are at-least-once and can
    // drop), the first event we see for an inbound call may be call.answered with
    // no routing state. Re-derive the route and act so the call is never stranded
    // on a silent answered leg.
    if (eventType === 'call.answered' && direction === 'incoming' && !state) {
      const workNum = normalizeE164(payload?.to) || payload?.to || '';
      let agencyHint = '';
      for (const variant of phoneVariants(workNum)) {
        const matches = await base44.asServiceRole.entities.User
          .filter({ work_phone_number: variant }, undefined, 1).catch(() => []);
        if (matches[0]?.agency_name) { agencyHint = matches[0].agency_name; break; }
      }
      if (!agencyHint) {
        const byLine = await resolveAgencySettingsByNumber(base44, workNum);
        agencyHint = byLine?.agency_code || byLine?.office_name || '';
      }
      const config = await getAgencyConfig(base44, agencyHint);
      const route = await decideInboundRouting(base44, config, workNum);
      // Log here as well as on call.initiated: without a CallLog row every later
      // write for this call (status, voicemail recording, transcript, the new-
      // voicemail notification) finds no row and is silently dropped. logInboundCall
      // no-ops when a row already exists, so a delayed call.initiated can't double-write.
      await logInboundCall(base44, callControlId, normalizeE164(payload?.from) || payload?.from || '', workNum, route);
      if (route.action === 'ringdown') {
        await startRingdown(base44, apiKey, callControlId, route.targets || [], route.callerId, 0);
        return Response.json({ success: true, inbound_recovered: 'ringdown' });
      }
      const greeting = String(route.greeting || '').slice(0, 320);
      if (greeting) {
        const next = encodeClientState({ t: 'inbound_after_greet', action: route.action, to: route.to || null, callerId: route.callerId || null, targets: route.targets || null });
        await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: greeting, client_state: next });
      } else {
        await continueAfterGreeting(base44, apiKey, callControlId, route.action, route.to, route.callerId, route.targets);
      }
      return Response.json({ success: true, inbound_recovered: route.action });
    }

    // Step 3: greeting finished → execute the deferred action.
    if (eventType === 'call.speak.ended' && state?.t === 'inbound_after_greet') {
      await continueAfterGreeting(base44, apiKey, callControlId, state.action, state.to, state.callerId, state.targets);
      return Response.json({ success: true, after_greet: state.action });
    }

    // Live voicemail transcription (final segments) → append to the CallLog.
    if (eventType === 'call.transcription') {
      const td = payload?.transcription_data || {};
      const isFinal = td.is_final === true || td.status === 'completed';
      const text = td.transcript || td.text;
      if (isFinal && text) await appendVoicemailTranscript(base44, callControlId, text);
      return Response.json({ success: true, transcription: Boolean(isFinal && text) });
    }

    // Voicemail recording finished → persist it (port of handleTwilioVoicemail).
    if (eventType === 'call.recording.saved') {
      await saveVoicemail(base44, payload);
      return Response.json({ success: true, voicemail_saved: true });
    }
  }

  // --- Best-effort CallLog status update for any call event. ---
  const mapped = mapCallStatus(eventType);
  if (mapped) {
    let rows = callControlId
      ? await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => [])
      : [];
    if (!rows.length && state?.call_log_id) {
      rows = await base44.asServiceRole.entities.CallLog.filter({ id: state.call_log_id }, undefined, 5000).catch(() => []);
    }
    if (rows.length) {
      const cur = rows[0];
      const patch = {};
      // Forward-only so an out-of-order event can't regress a terminal call.
      if ((CALL_RANK[mapped] || 0) > (CALL_RANK[cur.status] || 0)) patch.status = mapped;
      // A leg that hung up before it was ever answered is a missed call, not a
      // completed one (e.g. the nurse's cell on a masked call rang out or was
      // busy). call.hangup alone maps to 'completed'; the cause decides.
      const missed = unansweredHangupStatus(eventType, cur.status, payload?.hangup_cause);
      if (missed) {
        patch.status = missed;
        if (!cur.failure_reason) patch.failure_reason = `Not answered (${String(payload.hangup_cause).toLowerCase()})`;
      }
      // Capture the call duration on hangup (from the Call Control timestamps)
      // so call logs and any length-based reporting aren't blank.
      if (eventType === 'call.hangup') {
        const dur = callDurationSecs(payload);
        if (dur != null && dur !== cur.duration_seconds) patch.duration_seconds = dur;
      }
      if (Object.keys(patch).length) {
        await base44.asServiceRole.entities.CallLog.update(cur.id, patch).catch(() => {});
      }
    }
  }
  return Response.json({ success: true, event: eventType, status: mapped });
}

// Ring the next find-me-follow-me target on the original caller leg. The dialed
// leg carries the ringdown client_state so an unanswered hangup can advance.
// A transfer command can be REJECTED outright (e.g. a malformed stored office
// number) with no hangup event to advance on — so on failure, try each
// remaining target in order, and if every one is rejected apologize and hang up
// rather than stranding the caller on a silent answered (billed) leg.
async function startRingdown(base44, apiKey, aLegId, targets, callerId, idx = 0) {
  const list = Array.isArray(targets) ? targets : [];
  for (let i = Math.max(0, Number(idx) || 0); i < list.length; i++) {
    const target = list[i];
    if (!target || !target.to) continue;
    const r = await callCommand(apiKey, aLegId, 'transfer', {
      to: target.to,
      from: callerId || target.to,
      timeout_secs: RING_TIMEOUT_SECS_DEFAULT,
      client_state: encodeClientState({ t: 'ringdown', targets: list, idx: i, callerId, a_leg: aLegId }),
    });
    if (r.ok) return;
  }
  // Every target was rejected, so no dialed leg exists to carry the ringdown
  // client_state and the exhaustion branch above can never fire for this call.
  // Mark the inbound log missed here too, otherwise the trailing call.hangup maps
  // to 'completed' and the call disappears from the callback queue.
  const inboundLogs = await base44.asServiceRole.entities.CallLog
    .filter({ provider_call_id: aLegId }, '-created_date', 1).catch(() => []);
  if (inboundLogs.length && inboundLogs[0].status !== 'failed') {
    await base44.asServiceRole.entities.CallLog.update(inboundLogs[0].id, {
      status: 'failed',
      failure_reason: 'No answer — all on-call targets were unavailable',
    }).catch(() => {});
  }
  await callCommand(apiKey, aLegId, 'speak', { ...SPEAK_DEFAULTS, payload: 'We are unable to connect your call at this time. Please try again later.' });
  await callCommand(apiKey, aLegId, 'hangup', {});
}

async function continueAfterGreeting(base44, apiKey, callControlId, action, to, callerId, targets = null) {
  // Find-me-follow-me: ring the targets in order on the caller leg.
  if (action === 'ringdown') {
    await startRingdown(base44, apiKey, callControlId, targets || (to ? [{ to, kind: 'primary' }] : []), callerId, 0);
    return;
  }
  // A plain bridge and a greet-then-transfer both end in a transfer; unify them
  // and fall back gracefully if the transfer fails so the caller is never left on
  // a silent, open (billed) leg.
  if ((action === 'greet_transfer' || action === 'bridge') && to) {
    const r = await callCommand(apiKey, callControlId, 'transfer', { to, from: callerId || to });
    if (!r.ok) {
      await callCommand(apiKey, callControlId, 'speak', { ...SPEAK_DEFAULTS, payload: 'We are unable to connect your call at this time. Please try again later.' });
      await callCommand(apiKey, callControlId, 'hangup', {});
    }
  } else if (action === 'voicemail') {
    // Bound the recording so a silent/abandoned line can't leave a billed leg
    // open indefinitely (matches the old 120s voicemail cap). Telnyx field is
    // max_length (seconds), not max_length_secs.
    // play_beep cues the caller that the voicemail is recording.
    await callCommand(apiKey, callControlId, 'record_start', {
      format: 'mp3', channels: 'single', max_length: 120, play_beep: true,
      client_state: encodeClientState({ t: 'voicemail' }),
    });
    // Real-time transcription: language lives under transcription_engine_config
    // (top-level `language` is not a valid TranscriptionStartRequest field).
    // 'Google' is the current name of the engine the legacy alias 'A' selected
    // (Telnyx keeps 'A'/'B' only for backward compatibility).
    await callCommand(apiKey, callControlId, 'transcription_start', {
      transcription_engine: 'Google',
      transcription_engine_config: { language: 'en', transcription_engine: 'Google' },
      client_state: encodeClientState({ t: 'voicemail' }),
    });
  } else {
    await callCommand(apiKey, callControlId, 'hangup', {});
  }
}

async function appendVoicemailTranscript(base44, callControlId, text) {
  if (!callControlId) return;
  const rows = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (!rows.length) return;
  const existing = rows[0].voicemail_transcription ? `${rows[0].voicemail_transcription} ` : '';
  await base44.asServiceRole.entities.CallLog.update(rows[0].id, {
    voicemail_transcription: `${existing}${text}`.slice(0, 4000),
    has_voicemail: true,
  }).catch(() => {});
}

function recordingDurationSecs(payload) {
  if (Number.isFinite(payload?.recording_duration_secs)) return payload.recording_duration_secs;
  const start = Date.parse(payload?.recording_started_at || '');
  const end = Date.parse(payload?.recording_ended_at || '');
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  return Math.round((end - start) / 1000);
}

async function saveVoicemail(base44, payload) {
  const callControlId = payload?.call_control_id;
  const recordingUrl = payload?.recording_urls?.mp3 || payload?.recording_urls?.wav || payload?.public_recording_urls?.mp3 || null;
  // call.recording.saved carries no duration field; derive it from the
  // recording's own start/end timestamps (the legacy name is kept as a fallback).
  const durationSecs = recordingDurationSecs(payload);
  if (!callControlId) return;
  const rows = await base44.asServiceRole.entities.CallLog.filter({ provider_call_id: callControlId }, '-created_date', 1).catch(() => []);
  if (!rows.length) return;
  const row = rows[0];
  await base44.asServiceRole.entities.CallLog.update(row.id, {
    voicemail_url: recordingUrl || row.voicemail_url || null,
    voicemail_duration_seconds: durationSecs ?? row.voicemail_duration_seconds ?? null,
    has_voicemail: true,
    status: 'completed',
  }).catch(() => {});
  // Notify once (a recording.saved redelivery shouldn't re-alert).
  if (row.nurse_email && !row.voicemail_notified) {
    await base44.asServiceRole.entities.CallLog.update(row.id, { voicemail_notified: true }).catch(() => {});
    const preview = row.voicemail_transcription ? ` "${String(row.voicemail_transcription).slice(0, 120)}"` : '';
    await base44.asServiceRole.entities.Notification.create({
      user_email: row.nurse_email, title: '📞 New voicemail',
      message: `New voicemail from ${row.from_number || 'a caller'}.${preview}`,
      type: 'voicemail', priority: 'medium', metadata: { related_entity: 'CallLog', related_entity_id: row.id }, is_read: false,
    }).catch(() => {});
  }
}

// ============================ ENTRY ============================
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const telnyxCreds = await resolveExactActiveTelnyxWebhookCredentials(base44);
    if (!telnyxCreds) {
      return Response.json(
        { error: 'Webhook credential is not configured uniquely' },
        { status: 503, headers: { 'Retry-After': '300' } },
      );
    }
    const { apiKey, publicKey } = telnyxCreds;

    // Read the raw body ONCE — signature is over the exact bytes.
    const rawBody = await req.text();
    const signature = req.headers.get('telnyx-signature-ed25519');
    const timestamp = req.headers.get('telnyx-timestamp');

    const activeWebhookCredential = telnyxCreds?.record?.provider === 'telnyx'
      && telnyxCreds?.record?.is_active === true
      && !!boundedTelnyxAuthorityId(telnyxCreds?.record?.id);
    if (!activeWebhookCredential
      || !(await verifyTelnyxSignature(rawBody, signature, timestamp, publicKey))) {
      return Response.json({ error: 'Invalid signature' }, { status: 401 });
    }

    let body = {};
    try { body = JSON.parse(rawBody); } catch { /* leave empty */ }
    const event = extractTelnyxEvent(body);
    const { eventType, payload } = event;

    if (!eventType) return Response.json({ success: true, skipped: 'no event type' });

    // These checks intentionally run only after signature verification and
    // before any inbound handler can perform a mutable User/AgencySettings
    // lookup. Telnyx-classified STOP/START is recorded in the scoped consent
    // ledger (through an exact service-owned destination/profile binding)
    // FIRST, before any routing: the keyword path used to live only inside the
    // paused branch, so releasing SMS routing would have skipped it (28d3f369).
    // Every other inbound text is then routed by its exact binding alone.
    if (eventType === 'message.received') {
      const keywordResponse = await handleInboundConsentKeyword(base44, telnyxCreds, event, payload);
      if (keywordResponse) return keywordResponse;
      if (INBOUND_PATIENT_SMS_ROUTING_PAUSED) return inboundRoutingPausedResponse('SMS');
    }
    if (INBOUND_PATIENT_CALL_ROUTING_PAUSED && isInboundPatientCallEvent(eventType, payload)) {
      return inboundRoutingPausedResponse('call');
    }

    if (eventType === 'message.received') return await handleInboundMessage(base44, telnyxCreds, event, payload);
    if (eventType.startsWith('message.')) return await handleOutboundMessageStatus(base44, payload);
    if (eventType === 'fax.received') return await handleInboundFax(base44, telnyxCreds, payload);
    if (eventType.startsWith('fax.')) return await handleFaxEvent(base44, telnyxCreds, payload);
    if (eventType.startsWith('call.')) return await handleCallEvent(base44, apiKey, eventType, payload);

    return Response.json({ success: true, skipped: 'unhandled event', event: eventType });
  } catch {
    // Do not log the raw provider/error text; it may contain phone numbers,
    // profile ids, media URLs, or message content.
    console.error('handleTelnyxStatusWebhook failed');
    return Response.json({ error: 'Failed to process webhook' }, { status: 500 });
  }
});