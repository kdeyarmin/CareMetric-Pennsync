import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * manageSmsConsent — protected-platform-owner management surface for the
 * SmsConsent ledger that
 * backs A2P 10DLC / TCPA compliance. Two actions:
 *
 *  - 'list' { search?, limit? }: read the recent SmsConsent rows, compute opt
 *    totals, and return a (optionally phone-filtered) recent slice for display.
 *  - 'set'  { phone_e164, consent_status }: an admin manually records consent for
 *    a number (e.g. honoring a verbal/written opt-out), writing a new SmsConsent
 *    row plus a SecurityLog audit entry.
 *
 * All reads/writes go through base44.asServiceRole. Tenant-admin access remains
 * unavailable until consent rows have immutable agency provenance and the
 * operation can authorize from AgencyMembership. Mutable User account_type and
 * agency_name fields are never authority. Single-file Deno deploy — helpers
 * are inlined.
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

const VALID_STATUSES = ['opted_in', 'opted_out', 'unknown'];

function isScopedConsentRow(row) {
  const phone = normalizeTelnyxSmsE164(row?.phone_e164);
  const integrationSecretId = boundedTelnyxAuthorityId(row?.integration_secret_id);
  const messagingProfileId = boundedTelnyxAuthorityId(row?.messaging_profile_id);
  const agencyId = boundedTelnyxAuthorityId(row?.agency_id);
  const expectedKey = phone && integrationSecretId && messagingProfileId && agencyId
    ? ['telnyx', integrationSecretId, messagingProfileId, agencyId, phone].join(':')
    : null;
  const destination = normalizeTelnyxSmsE164(row?.destination_e164);
  const expectedBindingKey = destination && integrationSecretId
    ? `telnyx:${integrationSecretId}:${destination}`
    : null;
  return !!expectedKey
    && row?.consent_key === expectedKey
    && row?.provider === 'telnyx'
    && row?.phone_e164 === phone
    && !!boundedTelnyxAuthorityId(row?.destination_binding_id)
    && row?.destination_binding_key === expectedBindingKey
    && row?.destination_e164 === destination
    && VALID_STATUSES.includes(row?.consent_status)
    && Number.isFinite(Date.parse(row?.captured_at || ''));
}

/** Normalize a raw phone string to +E.164, or null if it doesn't look valid. */
function normalizeE164(raw) {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  const digits = trimmed.replace(/[^\d]/g, "");

  // Already E.164-ish international form — decided FIRST. A 10-digit
  // international number ("+49 89 123456") otherwise fell into the NANP branch
  // below and was rewritten as an unrelated "+1..." US subscriber.
  // Mirrors src/components/voice/phoneUtils.js.
  if (trimmed.startsWith("+")) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== "0" ? `+${digits}` : null;
  }

  // US-centric normalization (matches other phone utilities in the repo).
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  return null;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (user.disabled === true || user.is_service === true || user.is_verified === false
      || !isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Only the protected platform owner can manage SMS consent' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || 'list');

    if (action === 'list') {
      const rows = await base44.asServiceRole.entities.SmsConsent.list('-captured_at', 500);
      if (!Array.isArray(rows)) {
        return Response.json({ error: 'Scoped consent state is unavailable' }, { status: 503 });
      }
      const list = rows.filter(isScopedConsentRow);

      // Consent is append-only and profile/tenant scoped. Collapse by the full
      // immutable scope key; a shared recipient number may have independent
      // states in two tenants, and legacy phone-only rows are intentionally absent.
      const totals = { opted_in: 0, opted_out: 0, unknown: 0 };
      const latestByScope = new Map();
      const ambiguousScopes = new Set();
      for (const r of list) {
        const key = r.consent_key;
        const current = latestByScope.get(key);
        if (!current) {
          latestByScope.set(key, r);
        } else if (Date.parse(current.captured_at) === Date.parse(r.captured_at)) {
          ambiguousScopes.add(key);
        }
      }
      if (ambiguousScopes.size > 0) {
        return Response.json({
          error: 'Consent history has an ambiguous latest event',
          code: 'sms_consent_latest_ambiguous',
        }, { status: 503 });
      }
      for (const r of latestByScope.values()) {
        const s = r?.consent_status;
        if (s === 'opted_in') totals.opted_in += 1;
        else if (s === 'opted_out') totals.opted_out += 1;
        else totals.unknown += 1;
      }

      const search = typeof body.search === 'string' ? body.search.trim().toLowerCase() : '';
      let filtered = list;
      if (search) {
        filtered = list.filter((r) => String(r?.phone_e164 || '').toLowerCase().includes(search));
      }

      const limit = Number.isFinite(Number(body.limit)) && Number(body.limit) > 0 ? Math.floor(Number(body.limit)) : 100;
      const recent = filtered.slice(0, limit).map((r) => ({
        phone_e164: r?.phone_e164 || '',
        consent_status: r?.consent_status || 'unknown',
        consent_source: r?.consent_source || '',
        captured_at: r?.captured_at || '',
        patient_id: r?.patient_id ?? null,
        agency_id: r?.agency_id || '',
        destination_e164: r?.destination_e164 || '',
        destination_binding_id: r?.destination_binding_id || '',
        destination_binding_key: r?.destination_binding_key || '',
        notes: r?.notes || '',
      }));

      return Response.json({ success: true, totals, recent });
    }

    if (action === 'set') {
      const status = String(body.consent_status || '');
      if (!VALID_STATUSES.includes(status)) {
        return Response.json({ error: "consent_status must be 'opted_in', 'opted_out', or 'unknown'." }, { status: 400 });
      }
      const phone = normalizeE164(body.phone_e164);
      if (!phone) {
        return Response.json({ error: 'A valid E.164 phone number is required.' }, { status: 400 });
      }

      const telnyxCreds = await resolveTelnyxCreds(base44);
      const smsAuthority = await resolveActiveTelnyxSmsBinding(base44, {
        integrationSecretId: telnyxCreds?.record?.id,
        integrationProvider: telnyxCreds?.record?.provider,
        integrationIsActive: telnyxCreds?.record?.is_active === true,
        messagingProfileId: telnyxCreds?.messagingProfileId,
        destinationE164: body.destination_e164,
        requireOutbound: true,
      });
      if (!smsAuthority.ok
        || (body.destination_binding_id && body.destination_binding_id !== smsAuthority.bindingId)
        || (body.destination_binding_key && body.destination_binding_key !== smsAuthority.bindingKey)) {
        return Response.json({
          error: 'SMS consent cannot be changed without the exact current destination binding',
          code: 'telecom_authority_migration_pending',
        }, { status: 503 });
      }

      const linkedPatientId = typeof body.patient_id === 'string' && body.patient_id.trim()
        ? body.patient_id.trim()
        : null;
      if (linkedPatientId) {
        const patientRows = await base44.asServiceRole.entities.Patient
          .filter({ id: linkedPatientId }, undefined, 2).catch(() => []);
        const exactPatients = Array.isArray(patientRows)
          ? patientRows.filter((row) => row?.id === linkedPatientId
            && row?.agency_id === smsAuthority.agencyId
            && normalizeE164(row?.phone) === phone)
          : [];
        if (patientRows.length !== 1 || exactPatients.length !== 1) {
          return Response.json({ error: 'Patient does not match the bound SMS tenant and recipient' }, { status: 409 });
        }
      }

      // A consumer-initiated STOP (keyword_stop) is a hard legal revocation only the
      // consumer can lift by texting START. The send-gate resolves consent from the
      // single newest row, so an admin_manual opt-in would become "latest" and
      // silently re-enable texting to a number that legally opted out (TCPA). Refuse
      // it — mirror the guard in recordSmsConsent.
      const latest = await loadLatestScopedSmsConsent(base44, smsAuthority, phone);
      if (!latest.ok) {
        return Response.json({ error: 'Scoped consent state is unavailable' }, { status: 503 });
      }
      if (status === 'opted_in') {
        if (latest.keywordStopActive) {
          return Response.json({
            error: 'This number sent STOP and must text START to re-subscribe; a manual opt-in cannot override a consumer opt-out.',
            consent_status: 'opted_out',
          }, { status: 409 });
        }
      }

      // Recheck the protected built-in role + configured owner identity at the
      // mutation boundary; mutable custom User fields are never consulted.
      const freshUser = await base44.auth.me().catch(() => null);
      if (!freshUser || isDeactivatedUser(freshUser) || freshUser.disabled === true
        || freshUser.is_service === true || freshUser.is_verified === false
        || !isProtectedSuperAdmin(freshUser)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }

      const latestCapturedMs = Date.parse(latest.row?.captured_at || '');
      const now = new Date(Math.max(
        Date.now(),
        Number.isFinite(latestCapturedMs) ? latestCapturedMs + 1 : 0,
      )).toISOString();
      await base44.asServiceRole.entities.SmsConsent.create({
        consent_key: latest.consentKey,
        agency_id: smsAuthority.agencyId,
        provider: 'telnyx',
        integration_secret_id: smsAuthority.integrationSecretId,
        messaging_profile_id: smsAuthority.messagingProfileId,
        destination_binding_id: smsAuthority.bindingId,
        destination_binding_key: smsAuthority.bindingKey,
        destination_e164: smsAuthority.destinationE164,
        phone_e164: phone,
        consent_status: status,
        consent_source: 'admin_manual',
        captured_by: normalizeProtectedEmail(freshUser.email),
        captured_at: now,
        patient_id: linkedPatientId,
        notes: 'Set by admin',
      });

      await base44.asServiceRole.entities.SecurityLog.create({
        timestamp: now,
        user_email: freshUser.email,
        action: 'sms_consent_set_manually',
        details: {
          consent_status: status,
          patient_linked: Boolean(linkedPatientId),
        },
      }).catch((err) => console.error('SecurityLog write failed:', err));

      return Response.json({ success: true, phone_e164: phone, consent_status: status });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('manageSmsConsent error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
