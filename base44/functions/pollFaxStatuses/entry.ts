import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

const FAX_POLL_EXACT_ROW_LIMIT = 10;
const FAX_POLL_RANK = {
  submission_unknown: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  failed: 4,
  retrying: 4,
  retried: 5,
};

const exactFaxAuthorityId = (value) => {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized
    && normalized === value
    && normalized.length <= 200
    && !normalized.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : null;
};

const exactFaxInstant = (value) => typeof value === 'string'
  && Number.isFinite(Date.parse(value));

const successfulFaxCas = (value) => !!value
  && typeof value === 'object'
  && !Array.isArray(value)
  && value.success === true
  && value.updated === 1
  && value.has_more === false;

function faxHasOutboundStatusAuthority(row) {
  const referralAuthority = exactFaxAuthorityId(row?.referral_id) === row?.referral_id
    && exactFaxAuthorityId(row?.sent_by_user_id) === row?.sent_by_user_id
    && exactFaxAuthorityId(row?.sent_by_membership_id) === row?.sent_by_membership_id
    && Number.isSafeInteger(row?.sent_by_membership_version)
    && row.sent_by_membership_version >= 1;
  const bindingAuthority = exactFaxAuthorityId(row?.sender_telecom_binding_id)
      === row?.sender_telecom_binding_id
    && Number.isSafeInteger(row?.sender_telecom_binding_version)
    && row.sender_telecom_binding_version >= 1
    && exactFaxAuthorityId(row?.sender_provider_number_id) === row?.sender_provider_number_id;
  return !!row
    && exactFaxAuthorityId(row.id) === row.id
    && exactFaxAuthorityId(row.agency_id) === row.agency_id
    && exactFaxAuthorityId(row.document_id) === row.document_id
    && (referralAuthority || bindingAuthority)
    && row.provider === 'telnyx'
    && exactFaxAuthorityId(row.integration_secret_id) === row.integration_secret_id
    && exactFaxInstant(row.integration_secret_updated_at)
    && exactFaxAuthorityId(row.fax_connection_id) === row.fax_connection_id
    && exactFaxAuthorityId(row.sender_settings_id) === row.sender_settings_id
    && exactFaxInstant(row.sender_settings_updated_at)
    && exactFaxAuthorityId(row.telnyx_fax_id) === row.telnyx_fax_id
    && exactFaxAuthorityId(row.provider_submission_attempt_id)
      === row.provider_submission_attempt_id
    && row.provider_submission_state === 'accepted'
    && exactFaxInstant(row.provider_accepted_at)
    && row.document_url == null;
}

function faxHasPrivateRetryAuthority(row) {
  return faxHasOutboundStatusAuthority(row)
    && exactFaxAuthorityId(row.referral_id) === row.referral_id
    && exactFaxAuthorityId(row.sent_by_user_id) === row.sent_by_user_id
    && exactFaxAuthorityId(row.sent_by_membership_id) === row.sent_by_membership_id
    && Number.isSafeInteger(row.sent_by_membership_version)
    && row.sent_by_membership_version >= 1
    && Number.isSafeInteger(row.retry_count)
    && row.retry_count >= 0
    && Number.isSafeInteger(row.retry_generation)
    && row.retry_generation >= 0
    && row.retry_generation <= row.retry_count;
}

async function resolveFaxPollRetryPolicy(base44, agencyId) {
  let exact;
  try {
    exact = await base44.asServiceRole.entities.FaxRetryConfig.filter(
      { agency_id: agencyId },
      undefined,
      FAX_POLL_EXACT_ROW_LIMIT,
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
      FAX_POLL_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, config: null };
  }
  const agencyCode = exactFaxAuthorityId(agencies?.[0]?.agency_code);
  if (!Array.isArray(agencies) || agencies.length !== 1 || agencies[0]?.id !== agencyId
    || !agencyCode) return { ok: false, config: null };

  let duplicateAgencies;
  let legacy;
  try {
    duplicateAgencies = await base44.asServiceRole.entities.Agency.filter(
      { agency_code: agencyCode },
      undefined,
      FAX_POLL_EXACT_ROW_LIMIT,
    );
    legacy = await base44.asServiceRole.entities.FaxRetryConfig.filter(
      { agency_name: agencyCode },
      undefined,
      FAX_POLL_EXACT_ROW_LIMIT,
    );
  } catch {
    return { ok: false, config: null };
  }
  if (!Array.isArray(duplicateAgencies) || duplicateAgencies.length !== 1
    || duplicateAgencies[0]?.id !== agencyId
    || !Array.isArray(legacy) || legacy.length > 1
    || legacy.some((row) => row?.agency_name !== agencyCode
      || (row?.agency_id != null && row.agency_id !== agencyId))) {
    return { ok: false, config: null };
  }
  return { ok: true, config: legacy[0] || null };
}

async function loadExactFaxPollCredential(base44) {
  let rows;
  try {
    rows = await base44.asServiceRole.entities.IntegrationSecret.filter(
      { provider: 'telnyx', is_active: true },
      undefined,
      FAX_POLL_EXACT_ROW_LIMIT,
    );
  } catch {
    return null;
  }
  if (!Array.isArray(rows) || rows.length !== 1
    || rows[0]?.provider !== 'telnyx' || rows[0]?.is_active !== true
    || !exactFaxAuthorityId(rows[0]?.id)
    || !exactFaxAuthorityId(rows[0]?.fax_connection_id)
    || !exactFaxInstant(rows[0]?.updated_date)) return null;
  const apiKey = typeof rows[0]?.api_key === 'string' ? rows[0].api_key.trim() : '';
  return apiKey ? {
    apiKey,
    integrationSecretId: rows[0].id,
    integrationSecretUpdatedAt: rows[0].updated_date,
    connectionId: rows[0].fax_connection_id,
  } : null;
}


// ---- fax retry policy (source of truth: src/components/fax/faxRetry.js). Copied
// verbatim from handleTelnyxStatusWebhook so the poller and the DLR webhook plan a
// failed fax's retry/exhaustion identically — the poller must NOT declare every
// Telnyx-reported failure permanent while retries remain. ----
const PERMANENT_FAILURE_PATTERNS = [
  /invalid/i, /not a fax/i, /no fax machine/i, /incompatible/i, /unsupported/i,
  /rejected/i, /blocked/i, /do not call/i, /unallocated/i, /disconnected/i,
  /forbidden/i, /not in service/i, /no such number/i, /malformed/i,
];
// Transient signals win over a coincidental permanent word ("rejected - line
// busy" is retryable). Checked first. Mirrors src/components/fax/faxRetry.js.
const TRANSIENT_FAILURE_PATTERNS = [
  /busy/i, /no.?answer/i, /temporar/i, /timeout/i, /timed out/i,
  /try again/i, /congestion/i, /\b(429|500|502|503|504)\b/,
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

const FAX_MAX_RETRY_ATTEMPTS = 10;

function boundedFaxRetryPolicy(config) {
  const source = config && typeof config === 'object' && !Array.isArray(config)
    ? config
    : {};
  const unset = (value) => value == null
    || (typeof value === 'string' && value.trim() === '');
  const rawMaxRetries = Number(source.max_retries);
  const rawDelayMinutes = Number(source.retry_delay_minutes);
  // Entity data is an input, even when the settings UI normally constrains it.
  // An invalid policy fails closed instead of authorizing another transmission.
  const valid = (unset(source.max_retries)
      || (Number.isSafeInteger(rawMaxRetries)
        && rawMaxRetries >= 0
        && rawMaxRetries <= FAX_MAX_RETRY_ATTEMPTS))
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

const FAX_NOTIFICATION_CLAIM_LEASE_MS = 5 * 60 * 1000;

function faxNotificationSpec(fax, kind) {
  const delivered = kind === 'delivery';
  const agencyId = exactFaxAuthorityId(fax?.agency_id);
  const dedupeKey = `fax:${agencyId || 'legacy'}:${fax.id}:${delivered ? 'delivered' : 'failed'}`;
  return {
    markerField: delivered ? 'delivery_confirmation_sent' : 'final_failure_notified',
    claimField: delivered ? 'delivery_notify_claimed_by' : 'failure_notify_claimed_by',
    claimedAtField: delivered ? 'delivery_notify_claimed_at' : 'failure_notify_claimed_at',
    dedupeKey,
    payload: {
      ...(agencyId ? { agency_id: agencyId } : {}),
      dedupe_key: dedupeKey,
      user_email: fax.sent_by,
      type: delivered ? 'fax_delivered' : 'fax_failed',
      title: delivered ? 'Fax Status Update' : 'Fax Failed',
      message: getNotificationMessage(delivered ? 'delivered' : 'failed', fax),
      metadata: { related_entity: 'FaxLog', related_entity_id: fax.id },
      is_read: false,
    },
  };
}

function faxNotificationMatches(row, spec) {
  return !!row
    && exactFaxAuthorityId(row.id) === row.id
    && row.dedupe_key === spec.dedupeKey
    && row.user_email === spec.payload.user_email
    && row.type === spec.payload.type
    && (row.agency_id ?? null) === (spec.payload.agency_id ?? null)
    && row.metadata?.related_entity === 'FaxLog'
    && row.metadata?.related_entity_id === spec.payload.metadata.related_entity_id;
}

async function loadFaxNotifications(base44, spec) {
  const rows = await base44.asServiceRole.entities.Notification.filter(
    { dedupe_key: spec.dedupeKey },
    undefined,
    FAX_POLL_EXACT_ROW_LIMIT,
  );
  if (!Array.isArray(rows) || rows.length >= FAX_POLL_EXACT_ROW_LIMIT
    || rows.some((row) => !faxNotificationMatches(row, spec))) return null;
  return rows;
}

async function finalizeFaxNotification(base44, fax, spec, claimToken) {
  const rows = await base44.asServiceRole.entities.FaxLog.filter(
    { id: fax.id },
    undefined,
    FAX_POLL_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== fax.id
    || rows[0]?.telnyx_fax_id !== fax.telnyx_fax_id) return false;
  if (rows[0][spec.markerField] === true) return true;
  if (rows[0][spec.claimField] !== claimToken
    || !exactFaxInstant(rows[0][spec.claimedAtField])
    || !exactFaxInstant(rows[0].updated_date)) return false;
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
  if (successfulFaxCas(result)) return true;
  const concurrent = await base44.asServiceRole.entities.FaxLog.filter(
    { id: fax.id },
    undefined,
    FAX_POLL_EXACT_ROW_LIMIT,
  ).catch(() => null);
  return Array.isArray(concurrent) && concurrent.length === 1
    && concurrent[0]?.id === fax.id
    && concurrent[0]?.telnyx_fax_id === fax.telnyx_fax_id
    && concurrent[0]?.[spec.markerField] === true;
}

async function sendClaimedFaxNotification(base44, fax, kind, claimToken) {
  const spec = faxNotificationSpec(fax, kind);
  let existing = await loadFaxNotifications(base44, spec).catch(() => null);
  if (existing?.length) return finalizeFaxNotification(base44, fax, spec, claimToken);
  if (existing === null) return false;
  let created = null;
  try {
    created = await base44.asServiceRole.entities.Notification.create(spec.payload);
  } catch {
    // Creation may have committed even when its response was lost. Reconcile
    // the purpose-specific key and retain the claim if no exact row is visible;
    // a later poll can retry without creating a duplicate committed notice.
    existing = await loadFaxNotifications(base44, spec).catch(() => null);
    if (existing?.length) return finalizeFaxNotification(base44, fax, spec, claimToken);
    return false;
  }
  if (!faxNotificationMatches(created, spec)) {
    existing = await loadFaxNotifications(base44, spec).catch(() => null);
    if (!existing?.length) return false;
  }
  return finalizeFaxNotification(base44, fax, spec, claimToken);
}

async function recoverFaxNotification(base44, fax, kind, telnyxCreds) {
  const spec = faxNotificationSpec(fax, kind);
  if (!fax.sent_by || fax[spec.markerField] === true
    || !exactFaxAuthorityId(fax.id)
    || !exactFaxAuthorityId(fax.telnyx_fax_id)
    || !exactFaxInstant(fax.updated_date)) return false;

  // Do not trust a terminal row whose provider id now resolves to another row
  // (including another tenant). Ambiguous provider identities are quarantined.
  const identityRows = await base44.asServiceRole.entities.FaxLog.filter(
    { telnyx_fax_id: fax.telnyx_fax_id },
    undefined,
    FAX_POLL_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(identityRows) || identityRows.length !== 1
    || identityRows[0]?.id !== fax.id
    || identityRows[0]?.telnyx_fax_id !== fax.telnyx_fax_id) return false;
  const current = identityRows[0];
  const terminalStatus = kind === 'delivery' ? 'delivered' : 'failed';
  if (!faxHasOutboundStatusAuthority(current)
    || current.integration_secret_id !== telnyxCreds.integrationSecretId
    || current.integration_secret_updated_at !== telnyxCreds.integrationSecretUpdatedAt
    || current.fax_connection_id !== telnyxCreds.connectionId
    || current.status !== terminalStatus
    || current.provider_submission_state !== 'accepted'
    || current.provider_terminal_status !== terminalStatus
    || !exactFaxInstant(current.provider_accepted_at)
    || !exactFaxInstant(current.provider_terminal_at)
    || Date.parse(current.provider_terminal_at) < Date.parse(current.provider_accepted_at)
    || current.sent_by !== fax.sent_by
    || (current.agency_id ?? null) !== (fax.agency_id ?? null)
    || (kind === 'failure' && current.next_retry_at != null)) return false;
  if (current[spec.markerField] === true) return true;

  const existingClaim = exactFaxAuthorityId(current[spec.claimField]);
  const claimInstant = exactFaxInstant(current[spec.claimedAtField])
    ? current[spec.claimedAtField]
    : current.updated_date;
  if (existingClaim && exactFaxInstant(claimInstant)
    && Date.parse(claimInstant) > Date.now() - FAX_NOTIFICATION_CLAIM_LEASE_MS) return false;

  const claimToken = crypto.randomUUID();
  const claimedAt = new Date().toISOString();
  const claimed = await base44.asServiceRole.entities.FaxLog.updateMany(
    {
      id: current.id,
      telnyx_fax_id: current.telnyx_fax_id,
      status: current.status,
      updated_date: current.updated_date,
    },
    { $set: {
      [spec.markerField]: false,
      [spec.claimField]: claimToken,
      [spec.claimedAtField]: claimedAt,
    } },
  ).catch(() => null);
  if (!successfulFaxCas(claimed)) return false;
  const claimRows = await base44.asServiceRole.entities.FaxLog.filter(
    { id: current.id },
    undefined,
    FAX_POLL_EXACT_ROW_LIMIT,
  ).catch(() => null);
  if (!Array.isArray(claimRows) || claimRows.length !== 1
    || claimRows[0]?.id !== current.id
    || claimRows[0]?.telnyx_fax_id !== current.telnyx_fax_id
    || claimRows[0]?.status !== current.status
    || claimRows[0]?.[spec.claimField] !== claimToken
    || claimRows[0]?.[spec.claimedAtField] !== claimedAt) return false;
  return sendClaimedFaxNotification(base44, claimRows[0], kind, claimToken);
}

async function recoverTerminalFaxNotifications(base44, telnyxCreds) {
  let recovered = 0;
  for (const status of ['delivered', 'failed']) {
    const markerField = status === 'delivered'
      ? 'delivery_confirmation_sent'
      : 'final_failure_notified';
    const rows = await base44.asServiceRole.entities.FaxLog.filter(
      { status, [markerField]: false },
      '-updated_date',
      20,
    ).catch(() => null);
    if (!Array.isArray(rows)) continue;
    for (const fax of rows) {
      if (fax?.status !== status || !fax?.sent_by) continue;
      if (status === 'delivered') {
        if (fax.provider_terminal_status !== 'delivered') continue;
        if (await recoverFaxNotification(base44, fax, 'delivery', telnyxCreds).catch(() => false)) recovered++;
      } else {
        if (fax.provider_terminal_status !== 'failed' || fax.next_retry_at != null) continue;
        if (await recoverFaxNotification(base44, fax, 'failure', telnyxCreds).catch(() => false)) recovered++;
      }
    }
  }
  return recovered;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Authorization: privileged status-poll job (service-role FaxLog reads/writes
    // + Telnyx calls, no end user). Opt-in lockdown like checkExpiredInvitations
    // (see §4); mirrors the admin-gated syncFaxStatuses.
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();
    const telnyxCreds = await loadExactFaxPollCredential(base44);
    if (!telnyxCreds) {
      return Response.json({ error: 'Fax integration is not configured uniquely' }, { status: 500 });
    }

    // Reconcile stale manual-retry claims without assuming that an interrupted
    // function never reached Telnyx. The retry broker creates its child FaxLog
    // before making the provider request. If a child exists and is not a
    // definite provider rejection, retire the source instead of making it
    // eligible for another send; this prevents a crash-after-submit duplicate.
    let releasedStale = 0;
    try {
      const staleCutoff = new Date(Date.now() - 15 * 60 * 1000).toISOString();
      const retrying = await base44.asServiceRole.entities.FaxLog.filter(
        { status: 'retrying' }, '-created_date', 20,
      ).catch(() => []);
      for (const fax of Array.isArray(retrying) ? retrying : []) {
        if (!faxHasPrivateRetryAuthority(fax)
          || !exactFaxAuthorityId(fax?.retry_claimed_by)
          || !exactFaxAuthorityId(fax?.retry_claimed_by_user_id)
          || fax.retry_claimed_by_user_id !== fax.sent_by_user_id
          || !exactFaxInstant(fax?.retry_claimed_at)
          || !exactFaxInstant(fax?.updated_date)
          || fax.provider_terminal_status !== 'failed'
          || !exactFaxInstant(fax.provider_terminal_at)
          || Date.parse(fax.provider_terminal_at) < Date.parse(fax.provider_accepted_at)
          || fax.integration_secret_id !== telnyxCreds.integrationSecretId
          || fax.integration_secret_updated_at !== telnyxCreds.integrationSecretUpdatedAt
          || fax.fax_connection_id !== telnyxCreds.connectionId
          || Date.parse(fax.retry_claimed_at) >= Date.parse(staleCutoff)) continue;
        const children = await base44.asServiceRole.entities.FaxLog.filter(
          { retry_of_fax_log_id: fax.id },
          '-created_date',
          FAX_POLL_EXACT_ROW_LIMIT,
        ).catch(() => null);
        if (!Array.isArray(children) || children.length > 1
          || children.some((row) => row?.retry_of_fax_log_id !== fax.id)) continue;
        const child = children[0] || null;
        const exactChild = !child || (
          exactFaxAuthorityId(child.id) === child.id
          && child.agency_id === fax.agency_id
          && child.referral_id === fax.referral_id
          && child.document_id === fax.document_id
          && child.sent_by_user_id === fax.sent_by_user_id
          && child.sent_by_membership_id === fax.sent_by_membership_id
          && child.sent_by_membership_version === fax.sent_by_membership_version
          && child.to_number === fax.to_number
          && child.retry_of_fax_log_id === fax.id
          && child.retry_generation === fax.retry_generation + 1
          && Number.isSafeInteger(child.retry_count)
          && child.retry_count >= child.retry_generation
          && exactFaxAuthorityId(child.provider_submission_attempt_id)
            === child.provider_submission_attempt_id
          && child.provider === 'telnyx'
          && child.integration_secret_id === telnyxCreds.integrationSecretId
          && child.integration_secret_updated_at === telnyxCreds.integrationSecretUpdatedAt
          && child.fax_connection_id === telnyxCreds.connectionId
          && child.document_url == null
        );
        if (!exactChild) continue;
        const definitelyRejected = children.length === 1
          && child.status === 'failed'
          && child.provider_submission_state === 'rejected';
        const nextStatus = children.length === 0 || definitelyRejected ? 'failed' : 'retried';
        const result = await base44.asServiceRole.entities.FaxLog.updateMany(
          {
            id: fax.id,
            agency_id: fax.agency_id,
            referral_id: fax.referral_id,
            document_id: fax.document_id,
            sent_by_user_id: fax.sent_by_user_id,
            status: 'retrying',
            provider: 'telnyx',
            integration_secret_id: fax.integration_secret_id,
            integration_secret_updated_at: fax.integration_secret_updated_at,
            fax_connection_id: fax.fax_connection_id,
            retry_count: fax.retry_count,
            retry_generation: fax.retry_generation,
            retry_claimed_by: fax.retry_claimed_by,
            retry_claimed_at: fax.retry_claimed_at,
            retry_claimed_by_user_id: fax.retry_claimed_by_user_id,
            updated_date: fax.updated_date,
          },
          { $set: {
            status: nextStatus,
            retry_claimed_by: null,
            retry_claimed_at: null,
            retry_claimed_by_user_id: null,
            ...(definitelyRejected ? {
              retry_count: Math.max(fax.retry_count, children[0].retry_generation),
              retry_generation: children[0].retry_generation,
            } : {}),
            ...(children.length === 1 ? { next_retry_at: null } : {}),
            failure_reason: nextStatus === 'failed'
              ? (fax.failure_reason || 'Retry attempt ended before provider submission could be proved')
              : 'A replacement attempt exists and requires its own delivery reconciliation',
          } },
        ).catch(() => null);
        if (successfulFaxCas(result)) releasedStale++;
      }
    } catch (err) {
      console.error('stale retry-claim release failed:', err?.message);
    }

    // Terminal statuses do not advance again, so a webhook replay cannot repair
    // a notification create that committed ambiguously or failed after the
    // status transition. Reconcile stale outbox claims on every poll instead.
    await recoverTerminalFaxNotifications(base44, telnyxCreds).catch((err) => {
      console.error('terminal fax-notification recovery failed:', err?.message);
    });

    // Poll recent non-terminal attempts. A submission_unknown row is included
    // only when it carries a provider id recovered from an accepted response;
    // a successful provider GET can then reconcile it without another send.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    
    const pendingFaxes = await base44.asServiceRole.entities.FaxLog.filter(
      { status: { $in: ['queued', 'sending', 'sent', 'submission_unknown'] } },
      '-created_date',
      20  // Small batch to avoid CPU limit
    );

    // Filter to exact recent rows and exact provider ids before interpolating an
    // identifier into a Telnyx URL or writing a provider response back.
    const exactCandidates = (Array.isArray(pendingFaxes) ? pendingFaxes : []).filter((fax) => (
      exactFaxAuthorityId(fax?.id) === fax?.id
      && exactFaxAuthorityId(fax?.telnyx_fax_id) === fax?.telnyx_fax_id
      && exactFaxInstant(fax?.created_date)
      && Date.parse(fax.created_date) > Date.parse(cutoff)
      && exactFaxInstant(fax?.updated_date)
    ));
    const providerIdCounts = new Map();
    for (const fax of exactCandidates) {
      providerIdCounts.set(fax.telnyx_fax_id, (providerIdCounts.get(fax.telnyx_fax_id) || 0) + 1);
    }
    const ambiguousFaxIdentities = [...providerIdCounts.values()]
      .filter((count) => count > 1).length;
    const faxesToCheck = exactCandidates.filter((fax) => (
      providerIdCounts.get(fax.telnyx_fax_id) === 1
    ));

    if (faxesToCheck.length === 0) {
      return Response.json({
        success: true,
        checked: 0,
        updated: 0,
        released_stale_retries: releasedStale,
        ambiguous_fax_identities: ambiguousFaxIdentities,
      });
    }

    const { apiKey } = telnyxCreds;
    const authorizedFaxes = faxesToCheck.filter((fax) => (
      faxHasOutboundStatusAuthority(fax)
      && fax.integration_secret_id === telnyxCreds.integrationSecretId
      && fax.integration_secret_updated_at === telnyxCreds.integrationSecretUpdatedAt
      && fax.fax_connection_id === telnyxCreds.connectionId
    ));

    // Cache retry policy only by immutable Agency id. A mutable sender email or
    // User.agency_name is not authorization for a service-role retry schedule.
    const agencyCfgCache = new Map();
    const resolveCfgForAgency = async (agencyId) => {
      if (agencyCfgCache.has(agencyId)) return agencyCfgCache.get(agencyId);
      const resolved = await resolveFaxPollRetryPolicy(base44, agencyId);
      agencyCfgCache.set(agencyId, resolved);
      return resolved;
    };

    let updated = 0;

    // Process all faxes in parallel instead of sequentially
    await Promise.all(authorizedFaxes.map(async (fax) => {
      try {
        const identityRows = await base44.asServiceRole.entities.FaxLog.filter(
          { telnyx_fax_id: fax.telnyx_fax_id },
          undefined,
          FAX_POLL_EXACT_ROW_LIMIT,
        );
        if (!Array.isArray(identityRows) || identityRows.length !== 1
          || identityRows[0]?.id !== fax.id
          || identityRows[0]?.telnyx_fax_id !== fax.telnyx_fax_id) return;
        const response = await fetch(
          `https://api.telnyx.com/v2/faxes/${encodeURIComponent(fax.telnyx_fax_id)}`,
          { headers: { Authorization: `Bearer ${apiKey}` } }
        );

        if (!response.ok) return;

        const faxData = await response.json();
        const responseProviderId = exactFaxAuthorityId(faxData?.data?.id);
        const newStatus = mapFaxStatus(faxData?.data?.status);

        // Bind the response to the requested FaxLog before using it. Unknown
        // statuses and mismatched/missing provider ids are not safe writes.
        if (!newStatus || responseProviderId !== fax.telnyx_fax_id) return;

        // The provider GET is an external-await boundary. Re-prove that the id
        // still resolves to this exact unchanged row before applying its result;
        // a duplicate provider id inserted during the request is quarantined.
        const currentIdentityRows = await base44.asServiceRole.entities.FaxLog.filter(
          { telnyx_fax_id: fax.telnyx_fax_id },
          undefined,
          FAX_POLL_EXACT_ROW_LIMIT,
        );
        if (!Array.isArray(currentIdentityRows) || currentIdentityRows.length !== 1
          || currentIdentityRows[0]?.id !== fax.id
          || currentIdentityRows[0]?.telnyx_fax_id !== fax.telnyx_fax_id
          || currentIdentityRows[0]?.status !== fax.status
          || currentIdentityRows[0]?.updated_date !== fax.updated_date) return;

        if ((FAX_POLL_RANK[newStatus] || 0) > (FAX_POLL_RANK[fax.status] || 0)) {
          // Share the webhook's idempotency markers (delivery_confirmation_sent /
          // final_failure_notified) so the poller and handleTelnyxStatusWebhook
          // can't both notify the sender for the same terminal transition.
          const transitionedAt = new Date().toISOString();
          const update = {
            status: newStatus,
            telnyx_fax_id: responseProviderId,
            next_retry_at: null,
            provider_submission_state: 'accepted',
            provider_accepted_at: exactFaxInstant(fax.provider_accepted_at)
              ? fax.provider_accepted_at
              : transitionedAt,
            ...(Number.isFinite(faxData?.data?.page_count)
              ? { pages: faxData.data.page_count }
              : {}),
            ...(newStatus === 'delivered' || newStatus === 'failed' ? {
              provider_terminal_status: newStatus,
              provider_terminal_at: transitionedAt,
            } : {}),
          };
          let notificationKind = null;
          let notificationClaimToken = null;
          if (newStatus === 'delivered' && fax.sent_by && !fax.delivery_confirmation_sent) {
            notificationKind = 'delivery';
            notificationClaimToken = crypto.randomUUID();
            update.delivery_confirmation_sent = false;
            update.delivery_notify_claimed_by = notificationClaimToken;
            update.delivery_notify_claimed_at = transitionedAt;
          } else if (newStatus === 'failed') {
            // Honor the admin FaxRetryConfig instead of declaring EVERY failure
            // permanent. If the poller observes a failure before the DLR webhook,
            // schedule a retry (next_retry_at + retry_count) that autoRetryFailedFaxes
            // will honor while retries remain, and only set final_failure_notified +
            // notify the sender once retries are truly exhausted. Mirrors
            // handleTelnyxStatusWebhook.handleFaxEvent so the poller and the webhook
            // can't disagree about when a fax is really dead (and so the poller can't
            // suppress the webhook's later legitimate terminal notification).
            const failureReason = faxData?.data?.failure_reason || fax.failure_reason || 'Fax delivery failed';
            update.failure_reason = failureReason;
            const retryAuthority = faxHasPrivateRetryAuthority(fax);
            const retryPolicy = retryAuthority
              ? await resolveCfgForAgency(fax.agency_id)
              : { ok: false, config: null };
            const boundedPolicy = boundedFaxRetryPolicy(retryPolicy.config);
            const cfg = boundedPolicy.config;
            const retryCfg = boundedPolicy.normalized;
            const plan = retryAuthority && retryPolicy.ok && boundedPolicy.valid
              ? planFaxRetry({
                retryCount: fax.retry_count || 0,
                errorCode: faxData?.data?.failure_code || faxData?.data?.error_code,
                errorMessage: failureReason,
                priority: fax.priority || 'normal',
                config: cfg,
              })
              : { willRetry: false };
            // planFaxRetry already encodes the budget; schedule whenever willRetry
            // (including nextRetryCount === maxRetries — the last allowed send).
            if (plan.willRetry) {
              update.next_retry_at = plan.nextRetryAt;
              update.retry_count = plan.nextRetryCount;
            } else {
              const shouldNotify = retryAuthority && retryPolicy.ok && boundedPolicy.valid
                ? retryCfg.notifyOnFinalFailure
                : true;
              if (shouldNotify && fax.sent_by && !fax.final_failure_notified) {
                notificationKind = 'failure';
                notificationClaimToken = crypto.randomUUID();
                update.final_failure_notified = false;
                update.failure_notify_claimed_by = notificationClaimToken;
                update.failure_notify_claimed_at = transitionedAt;
              } else {
                update.final_failure_notified = true;
              }
            }
          }
          // 'sent' is a non-terminal progress state, not delivery — don't notify the
          // sender it was 'fax_delivered'. The delivered/failed branches above own the
          // sender notification when a terminal state is reached.

          const transitionResult = await base44.asServiceRole.entities.FaxLog.updateMany(
            {
              id: fax.id,
              telnyx_fax_id: fax.telnyx_fax_id,
              status: fax.status,
              updated_date: fax.updated_date,
            },
            { $set: update },
          );
          if (!successfulFaxCas(transitionResult)) return;
          const transitionCheck = await base44.asServiceRole.entities.FaxLog
            .filter({ id: fax.id }, undefined, FAX_POLL_EXACT_ROW_LIMIT).catch(() => []);
          if (transitionCheck.length !== 1
            || transitionCheck[0]?.id !== fax.id
            || transitionCheck[0]?.status !== newStatus
            || transitionCheck[0]?.telnyx_fax_id !== fax.telnyx_fax_id
            || transitionCheck[0]?.provider_submission_state !== 'accepted'
            || ((newStatus === 'delivered' || newStatus === 'failed')
              && (transitionCheck[0]?.provider_terminal_status !== newStatus
                || !exactFaxInstant(transitionCheck[0]?.provider_terminal_at)))) return;

          if (notificationKind && notificationClaimToken) {
            const notified = await sendClaimedFaxNotification(
              base44,
              transitionCheck[0],
              notificationKind,
              notificationClaimToken,
            ).catch(() => false);
            if (!notified) console.error('Fax notification remains pending for poller recovery');
          }

          updated++;
        }
      } catch (error) {
        console.error('Error checking fax status');
      }
    }));

    return Response.json({
      success: true,
      checked: authorizedFaxes.length,
      updated,
      released_stale_retries: releasedStale,
      ambiguous_fax_identities: ambiguousFaxIdentities,
    });
  } catch (error) {
    console.error('pollFaxStatuses failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

function mapFaxStatus(telnyxStatus) {
  const statusMap = {
    'queued': 'queued',
    'media.processed': 'sending',
    'originated': 'sending',
    'sending': 'sending',
    'sent': 'sent',
    'delivered': 'delivered',
    'failed': 'failed',
    'cancelled': 'failed',
    'canceled': 'failed'
  };
  return statusMap[telnyxStatus] || null;
}

function getNotificationMessage(status, fax) {
  const docName = fax.document_name || 'Document';
  const recipient = fax.to_name || fax.to_number;
  switch (status) {
    case 'sent': return `Fax "${docName}" sent to ${recipient}`;
    case 'delivered': return `Fax "${docName}" delivered to ${recipient}`;
    case 'failed': return `Fax "${docName}" failed to ${recipient}. Reason: ${fax.failure_reason || 'Unknown'}`;
    default: return `Fax status updated to ${status}`;
  }
}
