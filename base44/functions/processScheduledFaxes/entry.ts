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

// Deploying source must not make a provider-facing queue runnable. The native
// workflow owns the schedule, while staging must opt in to this exact reviewed
// revision before the SDK is constructed.
const PROCESS_SCHEDULED_FAXES_ENABLED =
  String(Deno.env.get('WORKFLOW_RELEASE_PROCESS_SCHEDULED_FAXES') || '').trim() === 'enabled-v1';

const SCHEDULED_STALE_SCAN_LIMIT = 500;
const SCHEDULED_DISPATCH_MAX_RETRIES = 8;
const SCHEDULED_DISPATCH_BACKOFF_BASE_MINUTES = 10;
const SCHEDULED_DISPATCH_BACKOFF_MAX_MINUTES = 360;

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

async function scheduledFaxCapabilityMac(secret, capability) {
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

async function createFaxInternalCapability(action, resourceId, claimId) {
  const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (secret.length < 32) throw new Error('Internal fax capability signing is unavailable');
  const issuedAt = Date.now();
  const capability = {
    version: 1, action, resource_id: resourceId, claim_id: claimId,
    issued_at: issuedAt, expires_at: issuedAt + 300_000, nonce: crypto.randomUUID(),
  };
  return { ...capability, mac: await scheduledFaxCapabilityMac(secret, capability) };
}

async function verifyScheduledFaxCapability(value, action, resourceId, claimId) {
  if (!scheduledPlainObject(value)
    || Object.keys(value).some((key) => ![
      'version', 'action', 'resource_id', 'claim_id', 'issued_at', 'expires_at', 'nonce', 'mac',
    ].includes(key))
    || value.version !== 1 || value.action !== action
    || value.resource_id !== resourceId || value.claim_id !== claimId
    || !scheduledExactId(value.nonce) || !Number.isSafeInteger(value.issued_at)
    || !Number.isSafeInteger(value.expires_at) || !/^[a-f0-9]{64}$/.test(String(value.mac || ''))) return false;
  const now = Date.now();
  if (value.issued_at > now + 5_000 || value.expires_at < now
    || value.expires_at <= value.issued_at || value.expires_at - value.issued_at > 300_000) return false;
  const secret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (secret.length < 32) return false;
  return timingSafeEqualStr(String(value.mac), await scheduledFaxCapabilityMac(secret, value));
}

// <<<BEGIN SHARED HELPER: batchNeverDispatched — generated, edit base44/_shared/backendHelpers.mjs>>>
function batchNeverDispatched(payload, status) {
  const d = payload || {};
  if (!d.error || typeof d.successful === 'number') return false;
  // Requeue only what a later run could actually send. A 5xx is infrastructure
  // — unreadable credentials, a platform blip — and clears on its own. A 4xx is
  // bad input for THIS row (disallowed file_url, unusable recipient numbers) and
  // would fail identically on every future tick; there is no UI listing
  // ScheduledFax rows, so an unsendable row must reach a terminal status rather
  // than retry forever with nobody watching. An unknown status requeues, because
  // a stuck 'pending' row is recoverable and a destroyed PHI document is not.
  const code = Number(status);
  return !Number.isFinite(code) || code >= 500;
}
// <<<END SHARED HELPER: batchNeverDispatched>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

function scheduledPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function scheduledExactId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200
    && value.trim() === value && !value.startsWith('$')
    && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}

function scheduledValidInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function scheduledSuccessfulCas(value) {
  return scheduledPlainObject(value) && value.success === true
    && value.updated === 1 && value.has_more === false;
}

function scheduledQueueStateIsDispatchable(row, nowMs = Date.now()) {
  if (row?.status === 'pending') return row.next_dispatch_attempt_at == null;
  if (row?.status !== 'deferred' || !scheduledValidInstant(row.next_dispatch_attempt_at)
    || Date.parse(row.next_dispatch_attempt_at) > nowMs
    || !Number.isSafeInteger(row.dispatch_retry_count)
    || row.dispatch_retry_count < 1
    || row.dispatch_retry_count >= SCHEDULED_DISPATCH_MAX_RETRIES) return false;
  return true;
}

function scheduledDispatchBackoff(row, nowMs = Date.now()) {
  const current = Number.isSafeInteger(row?.dispatch_retry_count) && row.dispatch_retry_count >= 0
    ? Math.min(row.dispatch_retry_count, SCHEDULED_DISPATCH_MAX_RETRIES)
    : 0;
  const attempts = Math.min(current + 1, SCHEDULED_DISPATCH_MAX_RETRIES);
  if (attempts >= SCHEDULED_DISPATCH_MAX_RETRIES) {
    return {
      status: 'blocked',
      accepted: 0,
      failed: 0,
      unknown: 0,
      code: 'fax_configuration_retry_exhausted',
      dispatchRetryCount: attempts,
      nextDispatchAttemptAt: null,
    };
  }
  const minutes = Math.min(
    SCHEDULED_DISPATCH_BACKOFF_MAX_MINUTES,
    SCHEDULED_DISPATCH_BACKOFF_BASE_MINUTES * (2 ** Math.min(attempts - 1, 6)),
  );
  return {
    status: 'deferred',
    accepted: 0,
    failed: 0,
    unknown: 0,
    code: 'fax_configuration_unavailable',
    dispatchRetryCount: attempts,
    nextDispatchAttemptAt: new Date(nowMs + minutes * 60_000).toISOString(),
  };
}

async function parseScheduledInvocation(req) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > 4_000) return null;
  const raw = await req.text().catch(() => '');
  if (new TextEncoder().encode(raw).byteLength > 4_000) return null;
  if (!raw) return {};
  try {
    const body = JSON.parse(raw);
    return scheduledPlainObject(body)
      && Object.keys(body).every((key) => key === 'capability') ? body : null;
  } catch {
    return null;
  }
}

async function scheduledInternalInvoke(body) {
  const claimId = scheduledExactId(body?.capability?.claim_id);
  return !!claimId && verifyScheduledFaxCapability(
    body.capability, 'process_scheduled', 'scheduled-fax-processor', claimId,
  );
}

function scheduledRequireRows(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value;
}

async function scheduledSha256(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function scheduledProvenanceIsComplete(row) {
  return !!row
    && !!scheduledExactId(row.id)
    && row.authorization_version === 1
    && !!scheduledExactId(row.schedule_key)
    && !!scheduledExactId(row.client_request_id)
    && !!scheduledExactId(row.agency_id)
    && !!scheduledExactId(row.document_id)
    && !!scheduledExactId(row.document_binding_id)
    && row.document_binding_version === 2
    && /^[a-f0-9]{64}$/.test(String(row.document_content_sha256 || ''))
    && row.provider === 'telnyx'
    && !!scheduledExactId(row.integration_secret_id)
    && scheduledValidInstant(row.integration_secret_updated_at)
    && !!scheduledExactId(row.fax_connection_id)
    && /^\+\d{8,15}$/.test(String(row.sender_number_e164 || ''))
    && !!scheduledExactId(row.sender_telecom_binding_id)
    && Number.isSafeInteger(row.sender_telecom_binding_version)
    && row.sender_telecom_binding_version >= 1
    && !!scheduledExactId(row.sender_provider_number_id)
    && !!scheduledExactId(row.sender_settings_id)
    && scheduledValidInstant(row.sender_settings_updated_at)
    && !!scheduledExactId(row.authorized_by_user_id)
    && typeof row.authorized_by_email_normalized === 'string'
    && row.authorized_by_email_normalized === row.authorized_by_email_normalized.trim().toLowerCase()
    && row.authorized_by_email_normalized.includes('@')
    && !!scheduledExactId(row.authorized_by_membership_id)
    && Number.isSafeInteger(row.authorized_by_membership_version)
    && row.authorized_by_membership_version >= 1
    && ['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']
      .includes(row.authorized_tenant_role)
    && scheduledValidInstant(row.scheduled_time)
    && scheduledValidInstant(row.updated_date)
    && Array.isArray(row.to_numbers)
    && row.to_numbers.length >= 1
    && row.to_numbers.length <= 50
    && new Set(row.to_numbers).size === row.to_numbers.length
    && row.to_numbers.every((number) => /^\+\d{8,15}$/.test(String(number || '')))
    && (row.dispatch_retry_count == null || (
      Number.isSafeInteger(row.dispatch_retry_count)
      && row.dispatch_retry_count >= 0
      && row.dispatch_retry_count <= SCHEDULED_DISPATCH_MAX_RETRIES
    ))
    && (row.next_dispatch_attempt_at == null || scheduledValidInstant(row.next_dispatch_attempt_at))
    && row.document_url == null
    && row.from_number == null;
}

async function scheduledOutcomeFromLogs(entities, row) {
  const logs = scheduledRequireRows(
    await entities.FaxLog.filter({ scheduled_fax_id: row.id }, '-created_date', 100),
    'FaxLog.filter',
  );
  if (logs.some((log) => log?.scheduled_fax_id !== row.id
    || log?.batch_request_key !== row.schedule_key
    || log?.agency_id !== row.agency_id || log?.document_id !== row.document_id
    || log?.document_binding_id !== row.document_binding_id
    || log?.document_binding_version !== row.document_binding_version
    || log?.document_content_sha256 !== row.document_content_sha256
    || log?.sent_by_user_id !== row.authorized_by_user_id
    || log?.sent_by_membership_id !== row.authorized_by_membership_id
    || log?.sent_by_membership_version !== row.authorized_by_membership_version
    || log?.provider !== row.provider
    || log?.integration_secret_id !== row.integration_secret_id
    || log?.integration_secret_updated_at !== row.integration_secret_updated_at
    || log?.fax_connection_id !== row.fax_connection_id
    || log?.from_number !== row.sender_number_e164
    || log?.sender_telecom_binding_id !== row.sender_telecom_binding_id
    || log?.sender_telecom_binding_version !== row.sender_telecom_binding_version
    || log?.sender_provider_number_id !== row.sender_provider_number_id
    || log?.sender_settings_id !== row.sender_settings_id
    || log?.sender_settings_updated_at !== row.sender_settings_updated_at)) {
    return { status: 'needs_review', accepted: 0, failed: 0, unknown: logs.length, code: 'fax_log_scope_mismatch' };
  }
  const byRecipient = new Map();
  for (const log of logs) {
    if (!row.to_numbers.includes(log?.to_number)) {
      return { status: 'needs_review', accepted: 0, failed: 0, unknown: logs.length, code: 'fax_log_destination_mismatch' };
    }
    const expectedKey = await scheduledSha256(`${row.schedule_key}\u0000${log.to_number}`);
    if (log.batch_recipient_key !== expectedKey || byRecipient.has(log.to_number)) {
      return { status: 'needs_review', accepted: 0, failed: 0, unknown: logs.length, code: 'fax_log_identity_ambiguous' };
    }
    byRecipient.set(log.to_number, log);
  }
  let accepted = 0;
  let failed = 0;
  let unknown = 0;
  for (const log of logs) {
    if (log.provider_submission_state === 'accepted') accepted++;
    else if (log.provider_submission_state === 'rejected') failed++;
    else unknown++;
  }
  if (logs.length < row.to_numbers.length) {
    // A stale invoke crossed an asynchronous/provider boundary. Even an empty
    // read is not proof that a child create or provider acceptance did not
    // commit. Quarantine for operator reconciliation; never automatically send
    // the same PHI disclosure again from incomplete evidence.
    unknown += row.to_numbers.length - logs.length;
    return {
      status: 'needs_review',
      accepted,
      failed,
      unknown,
      code: 'incomplete_dispatch_evidence',
    };
  }
  const status = unknown > 0
    ? 'needs_review'
    : failed === 0
      ? 'sent'
      : accepted > 0
        ? 'partial_failure'
        : 'failed';
  return { status, accepted, failed, unknown, code: unknown > 0 ? 'provider_submission_reconciliation' : null };
}

async function settleScheduledFax(entities, current, outcome) {
  const terminal = !['pending', 'deferred'].includes(outcome.status);
  const dispatchRetryCount = Number.isSafeInteger(outcome.dispatchRetryCount)
    ? outcome.dispatchRetryCount
    : (Number.isSafeInteger(current.dispatch_retry_count) ? current.dispatch_retry_count : 0);
  const result = await entities.ScheduledFax.updateMany({
    id: current.id,
    status: 'processing',
    claimed_by: current.claimed_by,
    claimed_at: current.claimed_at,
    dispatch_attempt_id: current.dispatch_attempt_id,
    updated_date: current.updated_date,
  }, { $set: {
    status: outcome.status,
    claimed_by: null,
    claimed_at: null,
    // Preserve the provider/broker correlation on every terminal outcome. A
    // verified pre-dispatch deferral alone may clear it before a new claim.
    dispatch_attempt_id: terminal ? current.dispatch_attempt_id : null,
    accepted_count: outcome.accepted,
    failed_count: outcome.failed,
    unknown_count: outcome.unknown,
    last_error_code: outcome.code,
    dispatch_retry_count: dispatchRetryCount,
    next_dispatch_attempt_at: outcome.status === 'deferred'
      ? outcome.nextDispatchAttemptAt
      : null,
    completed_at: terminal ? new Date().toISOString() : null,
  } });
  return scheduledSuccessfulCas(result);
}

async function quarantineStaleScheduledClaim(entities, row, nowMs = Date.now()) {
  if (!scheduledExactId(row?.id) || row?.status !== 'processing'
    || !scheduledValidInstant(row?.updated_date)) return false;
  const result = await entities.ScheduledFax.updateMany({
    id: row.id,
    status: 'processing',
    updated_date: row.updated_date,
  }, { $set: {
    status: 'needs_review',
    // Invalid legacy provenance cannot prove that no external work started.
    // Keep every correlation field for operator reconciliation while the
    // terminal needs_review status prevents automatic resend.
    claimed_by: row.claimed_by ?? null,
    claimed_at: row.claimed_at ?? null,
    dispatch_attempt_id: row.dispatch_attempt_id ?? null,
    accepted_count: 0,
    failed_count: 0,
    unknown_count: Array.isArray(row.to_numbers) ? row.to_numbers.length : 0,
    last_error_code: 'legacy_or_invalid_processing_claim',
    next_dispatch_attempt_at: null,
    completed_at: new Date(nowMs).toISOString(),
  } });
  return scheduledSuccessfulCas(result);
}

async function reconcileStaleScheduledClaims(entities) {
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const rows = scheduledRequireRows(
    await entities.ScheduledFax.filter(
      { status: 'processing' },
      'claimed_at',
      SCHEDULED_STALE_SCAN_LIMIT,
    ),
    'ScheduledFax.filter',
  );
  let reconciled = 0;
  let quarantined = 0;
  let errors = 0;
  for (const row of rows) {
    if (scheduledValidInstant(row?.claimed_at) && row.claimed_at >= staleBefore) continue;
    if (!scheduledProvenanceIsComplete(row) || !scheduledExactId(row.claimed_by)
      || row.dispatch_attempt_id !== row.claimed_by || !scheduledValidInstant(row.claimed_at)) {
      if (await quarantineStaleScheduledClaim(entities, row).catch(() => false)) quarantined++;
      else errors++;
      continue;
    }
    try {
      const outcome = await scheduledOutcomeFromLogs(entities, row);
      if (await settleScheduledFax(entities, row, outcome)) reconciled++;
      else errors++;
    } catch {
      // A storage read failure is not evidence that no provider request exists.
      // Preserve the processing claim for a later reconciliation tick.
      errors++;
    }
  }
  return {
    reconciled,
    quarantined,
    errors,
    scanLimitReached: rows.length === SCHEDULED_STALE_SCAN_LIMIT,
  };
}

function scheduledResultOutcome(data, total) {
  const accepted = Number(data?.accepted);
  const failed = Number(data?.failed);
  const unknown = Number(data?.unknown);
  if (![accepted, failed, unknown].every((value) => Number.isSafeInteger(value) && value >= 0)
    || accepted + failed + unknown !== total) {
    return { status: 'needs_review', accepted: 0, failed: 0, unknown: total, code: 'invalid_broker_result' };
  }
  if (unknown > 0 || data.requires_reconciliation === true) {
    return { status: 'needs_review', accepted, failed, unknown, code: 'provider_submission_reconciliation' };
  }
  return {
    status: failed === 0 ? 'sent' : accepted > 0 ? 'partial_failure' : 'failed',
    accepted,
    failed,
    unknown,
    code: failed > 0 ? 'provider_rejected' : null,
  };
}

Deno.serve(async (req) => {
  try {
    if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('fax');
    if (!PROCESS_SCHEDULED_FAXES_ENABLED) {
      return Response.json(
        { error: 'Scheduled fax processing workflow is not released' },
        { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
      );
    }
    const invocation = await parseScheduledInvocation(req);
    if (!invocation) return Response.json({ error: 'Invalid request' }, { status: 400 });
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError && !await scheduledInternalInvoke(invocation)) return authError;
    if (isDeactivatedUser(me)) return DEACTIVATED_USER_RESPONSE();
    const entities = base44.asServiceRole.entities;
    const staleClaims = await reconcileStaleScheduledClaims(entities);
    const now = new Date().toISOString();
    const [pendingRows, deferredRows] = await Promise.all([
      entities.ScheduledFax.filter({
        status: 'pending', scheduled_time: { $lte: now },
      }, 'scheduled_time', 200),
      entities.ScheduledFax.filter({
        status: 'deferred', next_dispatch_attempt_at: { $lte: now },
      }, 'next_dispatch_attempt_at', 200),
    ]);
    const rows = [
      ...scheduledRequireRows(pendingRows, 'ScheduledFax.filter'),
      ...scheduledRequireRows(deferredRows, 'ScheduledFax.filter'),
    ];
    rows.sort((left, right) => {
      const rank = { urgent: 0, normal: 1, low: 2 };
      const delta = (rank[left.priority] ?? 1) - (rank[right.priority] ?? 1);
      return delta || Date.parse(left.scheduled_time) - Date.parse(right.scheduled_time);
    });

    let processed = 0;
    let sent = 0;
    let failed = 0;
    let needsReview = 0;
    let blocked = 0;
    let inFlight = 0;
    let deferred = 0;

    for (const row of rows) {
      if (!scheduledProvenanceIsComplete(row)
        || !scheduledQueueStateIsDispatchable(row, Date.parse(now))) {
        const blockedResult = await entities.ScheduledFax.updateMany({
          id: row.id, status: row.status, updated_date: row.updated_date,
        }, { $set: {
          status: 'blocked',
          last_error_code: !scheduledProvenanceIsComplete(row)
            ? 'legacy_or_invalid_fax_provenance'
            : 'invalid_dispatch_retry_state',
          next_dispatch_attempt_at: null,
          completed_at: new Date().toISOString(),
        } }).catch(() => null);
        if (scheduledSuccessfulCas(blockedResult)) blocked++;
        continue;
      }
      const expectedScheduleKey = await scheduledSha256(
        `${row.agency_id}\u0000${row.authorized_by_user_id}\u0000${row.client_request_id}`,
      );
      if (expectedScheduleKey !== row.schedule_key || row.canceled_at != null) {
        const blockedResult = await entities.ScheduledFax.updateMany({
          id: row.id, status: row.status, updated_date: row.updated_date,
        }, { $set: {
          status: row.canceled_at != null ? 'cancelled' : 'blocked',
          last_error_code: row.canceled_at != null ? 'fax_cancelled' : 'invalid_schedule_key',
          completed_at: new Date().toISOString(),
        } }).catch(() => null);
        if (scheduledSuccessfulCas(blockedResult)) blocked++;
        continue;
      }
      const sameKey = await entities.ScheduledFax.filter(
        { schedule_key: row.schedule_key }, undefined, 10,
      ).catch(() => null);
      if (!Array.isArray(sameKey) || sameKey.length !== 1 || sameKey[0]?.id !== row.id) {
        const blockedResult = await entities.ScheduledFax.updateMany({
          id: row.id, status: row.status, updated_date: row.updated_date,
        }, { $set: {
          status: 'blocked', last_error_code: 'duplicate_schedule_key', completed_at: new Date().toISOString(),
        } }).catch(() => null);
        if (scheduledSuccessfulCas(blockedResult)) blocked++;
        continue;
      }

      const dispatchAttemptId = crypto.randomUUID();
      const claimedAt = new Date().toISOString();
      const claim = await entities.ScheduledFax.updateMany({
        id: row.id,
        status: row.status,
        schedule_key: row.schedule_key,
        authorization_version: 1,
        agency_id: row.agency_id,
        document_id: row.document_id,
        document_binding_id: row.document_binding_id,
        document_content_sha256: row.document_content_sha256,
        authorized_by_user_id: row.authorized_by_user_id,
        authorized_by_membership_id: row.authorized_by_membership_id,
        authorized_by_membership_version: row.authorized_by_membership_version,
        integration_secret_id: row.integration_secret_id,
        integration_secret_updated_at: row.integration_secret_updated_at,
        sender_telecom_binding_id: row.sender_telecom_binding_id,
        sender_telecom_binding_version: row.sender_telecom_binding_version,
        ...(row.status === 'deferred' ? {
          dispatch_retry_count: row.dispatch_retry_count,
          next_dispatch_attempt_at: row.next_dispatch_attempt_at,
        } : {}),
        updated_date: row.updated_date,
      }, { $set: {
        status: 'processing',
        claimed_by: dispatchAttemptId,
        claimed_at: claimedAt,
        dispatch_attempt_id: dispatchAttemptId,
        last_dispatch_attempt_at: claimedAt,
      } }).catch(() => null);
      if (!scheduledSuccessfulCas(claim)) continue;
      const claimedRows = await entities.ScheduledFax.filter({ id: row.id }, undefined, 10).catch(() => null);
      const claimed = Array.isArray(claimedRows) && claimedRows.length === 1 ? claimedRows[0] : null;
      if (!claimed || claimed.id !== row.id || claimed.status !== 'processing' || claimed.claimed_by !== dispatchAttemptId
        || claimed.claimed_at !== claimedAt || claimed.dispatch_attempt_id !== dispatchAttemptId
        || !scheduledValidInstant(claimed.updated_date)) continue;
      if (claimed.canceled_at != null) {
        await settleScheduledFax(entities, claimed, {
          status: 'cancelled', accepted: 0, failed: 0, unknown: 0, code: 'fax_cancelled',
        });
        continue;
      }

      try {
        const capability = await createFaxInternalCapability(
          'dispatch_scheduled', row.id, dispatchAttemptId,
        );
        const response = await base44.asServiceRole.functions.invoke('sendBatchFax', {
          action: 'dispatch_scheduled',
          scheduled_fax_id: row.id,
          dispatch_attempt_id: dispatchAttemptId,
          capability,
        });
        const data = scheduledPlainObject(response?.data) ? response.data : response;
        const [current] = await entities.ScheduledFax.filter({ id: row.id }, undefined, 10).catch(() => []);
        if (!current || current.status !== 'processing' || current.claimed_by !== dispatchAttemptId) continue;
        const outcome = scheduledResultOutcome(data, row.to_numbers.length);
        if (await settleScheduledFax(entities, current, outcome)) {
          processed++;
          if (outcome.status === 'sent') sent++;
          else if (outcome.status === 'needs_review') needsReview++;
          else failed++;
        }
      } catch (error) {
        const payload = error?.response?.data;
        const status = Number(error?.response?.status);
        const [current] = await entities.ScheduledFax.filter({ id: row.id }, undefined, 10).catch(() => []);
        if (!current || current.status !== 'processing' || current.claimed_by !== dispatchAttemptId) continue;
        if (scheduledPlainObject(payload) && payload.dispatch_started === false && Number.isFinite(status)) {
          const transient = status >= 500 && payload.code === 'fax_configuration_unavailable';
          const outcome = transient
            ? scheduledDispatchBackoff(current)
            : {
              status: 'blocked',
              accepted: 0,
              failed: 0,
              unknown: 0,
              code: typeof payload.code === 'string'
                ? payload.code.slice(0, 200)
                : 'fax_dispatch_rejected',
            };
          if (await settleScheduledFax(entities, current, outcome)) {
            if (outcome.status === 'deferred') deferred++;
            else blocked++;
          }
        } else {
          // An invoke error without a verified pre-dispatch response may have
          // happened after Telnyx accepted a request. Preserve the claim for the
          // stale reconciler; never blindly requeue and duplicate PHI.
          inFlight++;
        }
      }
    }

    return Response.json({
      success: true,
      due: rows.length,
      processed,
      sent,
      failed,
      needs_review: needsReview,
      blocked,
      deferred,
      awaiting_reconciliation: inFlight,
      stale_claims_reconciled: staleClaims.reconciled,
      stale_claims_quarantined: staleClaims.quarantined,
      stale_claim_errors: staleClaims.errors,
      stale_scan_limit_reached: staleClaims.scanLimitReached,
      timestamp: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch {
    console.error('processScheduledFaxes failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
