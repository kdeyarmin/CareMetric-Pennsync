import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LABEL_LENGTH = 300;
const EXACT_ROW_LIMIT = 10;
const FAX_SIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_MANUAL_RETRIES = 10;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function exactIdentifier(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string' || value.length > 320) return null;
  const email = value.trim().toLowerCase();
  return email && email.includes('@') && !/\s/.test(email) ? email : null;
}

function boundedLabel(value: unknown, optional = true) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if ((!text && !optional) || text.length > MAX_LABEL_LENGTH || /[\u0000-\u001f\u007f]/.test(text)) {
    return null;
  }
  return text;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sameValue(left: unknown, right: unknown) {
  return canonicalJson(left) === canonicalJson(right);
}

function unwrapFunctionResult(value: unknown) {
  return plainObject(value) && Object.hasOwn(value, 'data') ? value.data : value;
}

function normalizeFaxDest(raw: unknown) {
  if (typeof raw !== 'string' || raw.length > 100) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (raw.trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

function normalizeFromE164(raw: unknown) {
  return normalizeFaxDest(typeof raw === 'string' ? raw : '');
}

function officeFaxDisplayName(officeE164: string | null) {
  const digits = String(officeE164 || '').replace(/[^\d]/g, '');
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  if (ten.length !== 10) return null;
  return `Office Fax ${ten.slice(0, 3)}-${ten.slice(3, 6)}-${ten.slice(6)}`;
}

const PREMIUM_AREA_CODES = new Set(['900', '976']);
function isAllowedDestination(e164: string, settings: Record<string, any>) {
  const isNanp = /^\+1\d{10}$/.test(e164);
  if (isNanp) {
    const areaCode = e164.slice(2, 5);
    if (PREMIUM_AREA_CODES.has(areaCode)) return { allowed: false, reason: 'premium_number_blocked' };
    const blocked = Array.isArray(settings.blocked_area_codes)
      ? settings.blocked_area_codes.map((value: unknown) => String(value).replace(/[^\d]/g, ''))
      : [];
    if (blocked.includes(areaCode)) return { allowed: false, reason: 'blocked_area_code' };
    return { allowed: true, reason: 'allowed' };
  }
  if (/^\+1/.test(e164)) return { allowed: false, reason: 'invalid_destination' };
  if (!/^\+\d{8,15}$/.test(e164)) return { allowed: false, reason: 'invalid_destination' };
  return settings.allow_international === true
    ? { allowed: true, reason: 'international_allowed' }
    : { allowed: false, reason: 'international_blocked' };
}

function blockedReasonMessage(reason: string) {
  switch (reason) {
    case 'premium_number_blocked': return 'Premium-rate numbers are blocked.';
    case 'blocked_area_code': return "That area code is blocked by your agency's policy.";
    case 'international_blocked': return 'International destinations are blocked by agency policy.';
    default: return "That destination isn't allowed.";
  }
}

async function parseInput(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid request');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid request');
  }
  if (!plainObject(body) || Object.keys(body).some((key) => ![
    'agency_id', 'referral_id', 'document_id', 'to_number', 'to_name', 'document_name',
    'retry_fax_log_id',
  ].includes(key))) throw new PublicError(400, 'Invalid request');
  if (Object.hasOwn(body, 'retry_fax_log_id')) {
    const retryFaxLogId = exactIdentifier(body.retry_fax_log_id);
    if (!retryFaxLogId || Object.keys(body).length !== 1) {
      throw new PublicError(400, 'Fax retry request is invalid');
    }
    return { mode: 'retry', retryFaxLogId };
  }
  const agencyId = exactIdentifier(body.agency_id);
  const referralId = exactIdentifier(body.referral_id);
  const documentId = exactIdentifier(body.document_id);
  const toNumber = normalizeFaxDest(body.to_number);
  const toName = boundedLabel(body.to_name);
  const documentName = boundedLabel(body.document_name);
  if (!agencyId || !referralId || !documentId || !toNumber || toName === null || documentName === null) {
    throw new PublicError(400, 'Fax request is invalid');
  }
  return {
    mode: 'send', agencyId, referralId, documentId, toNumber, toName, documentName,
  };
}

function validateReferralResult(value: unknown, input: Record<string, any>) {
  if (!plainObject(value) || value.success !== true || value.action !== 'get') {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  const referral = value.referral;
  const scope = value.scope;
  if (
    !plainObject(referral)
    || referral.id !== input.referralId
    || referral.agency_id !== input.agencyId
    || !Number.isSafeInteger(referral.version)
    || referral.version < 1
    || !validInstant(referral.updated_date)
    || !plainObject(referral.follow_up_requests)
    || !['open', 'sent'].includes(referral.follow_up_requests.status)
    || referral.follow_up_requests.portal_link_active !== true
    || !exactIdentifier(referral.follow_up_requests.portal_token_id)
    || !plainObject(scope)
    || scope.agency_id !== input.agencyId
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
    || !INTAKE_ROLES.has(scope.tenant_role)
  ) throw new PublicError(409, 'Referral authorization response was invalid');
  return { referral, scope };
}

function exactHttpsUrl(value: unknown) {
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

function validateDocumentResult(
  value: unknown,
  input: Record<string, any>,
  referralResult: Record<string, any>,
) {
  if (!plainObject(value) || value.success !== true || value.purpose !== 'fax') {
    throw new PublicError(502, 'Document authorization response was invalid');
  }
  const document = value.document;
  const delivery = value.delivery;
  const scope = value.scope;
  const signedUrl = exactHttpsUrl(delivery?.download_url);
  if (
    !plainObject(document)
    || document.id !== input.documentId
    || document.file_type !== 'application/pdf'
    || document.category !== 'referral'
    || !Number.isSafeInteger(document.file_size)
    || document.file_size < 1
    || document.patient_id !== null
    || !plainObject(delivery)
    || !signedUrl
    || delivery.expires_in_seconds !== FAX_SIGNED_URL_TTL_SECONDS
    || !plainObject(scope)
    || !sameValue(scope, referralResult.scope)
  ) throw new PublicError(409, 'Document authorization response was invalid');
  return { document, delivery: { download_url: signedUrl }, scope };
}

async function loadReferral(base44: Record<string, any>, input: Record<string, any>) {
  const response = await base44.functions.invoke('manageAuthorizedReferral', {
    action: 'get',
    agency_id: input.agencyId,
    referral_id: input.referralId,
  });
  return validateReferralResult(unwrapFunctionResult(response), input);
}

async function loadDocument(
  base44: Record<string, any>,
  input: Record<string, any>,
  referral: Record<string, any>,
) {
  const response = await base44.functions.invoke('getAuthorizedDocument', {
    agency_id: input.agencyId,
    document_id: input.documentId,
    purpose: 'fax',
  });
  return validateDocumentResult(unwrapFunctionResult(response), input, referral);
}

async function loadAgencyAndSettings(entities: Record<string, any>, agencyId: string) {
  const agencyRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (
    agencyRows.length !== 1
    || agencyRows.some((row) => row?.id !== agencyId)
    || !ENABLED_AGENCY_STATUSES.has(String(agencyRows[0]?.status || ''))
    || !exactIdentifier(agencyRows[0]?.agency_code)
  ) throw new PublicError(409, 'Agency configuration is unavailable');
  const agency = agencyRows[0];
  const duplicateCodeRows = requireRows(
    await entities.Agency.filter({ agency_code: agency.agency_code }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (
    duplicateCodeRows.length !== 1
    || duplicateCodeRows[0]?.id !== agencyId
    || duplicateCodeRows[0]?.agency_code !== agency.agency_code
  ) throw new PublicError(409, 'Agency configuration is ambiguous');
  const settingsRows = requireRows(
    await entities.AgencySettings.filter(
      { agency_code: agency.agency_code },
      '-updated_date',
      EXACT_ROW_LIMIT,
    ),
    'AgencySettings.filter',
  );
  if (
    settingsRows.length !== 1
    || settingsRows[0]?.agency_code !== agency.agency_code
    || (settingsRows[0]?.agency_id != null && settingsRows[0].agency_id !== agencyId)
    || !exactIdentifier(settingsRows[0]?.id)
    || !validInstant(settingsRows[0]?.updated_date)
  ) throw new PublicError(409, 'Agency fax settings are unavailable');
  return { agency, settings: settingsRows[0] };
}

async function loadTelnyxCredentials(entities: Record<string, any>) {
  const rows = requireRows(
    await entities.IntegrationSecret.filter(
      { provider: 'telnyx', is_active: true },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'IntegrationSecret.filter',
  );
  if (rows.length !== 1 || rows.some((row) => row?.provider !== 'telnyx'
    || row?.is_active !== true || !exactIdentifier(row?.id))) {
    throw new PublicError(500, 'Fax integration is not configured uniquely');
  }
  const row = rows[0];
  const apiKey = typeof row.api_key === 'string' ? row.api_key.trim() : '';
  const connectionId = exactIdentifier(row.fax_connection_id);
  if (!apiKey || !connectionId || !validInstant(row.updated_date)) {
    throw new PublicError(500, 'Fax integration is not configured');
  }
  return {
    apiKey,
    connectionId,
    integrationSecretId: row.id,
    integrationSecretUpdatedAt: row.updated_date,
  };
}

async function findRecentFax(
  entities: Record<string, any>,
  input: Record<string, any>,
  excludeFaxLogId: string | null = null,
) {
  const rows = requireRows(
    await entities.FaxLog.filter(
      {
        agency_id: input.agencyId,
        referral_id: input.referralId,
        document_id: input.documentId,
        to_number: input.toNumber,
      },
      '-created_date',
      EXACT_ROW_LIMIT,
    ),
    'FaxLog.filter',
  );
  if (rows.some((row) => (
    row?.agency_id !== input.agencyId
    || row?.referral_id !== input.referralId
    || row?.document_id !== input.documentId
    || row?.to_number !== input.toNumber
  ))) throw new PublicError(409, 'Fax retry identity is ambiguous');
  const cutoff = Date.now() - 2 * 60 * 1000;
  return rows.find((row) => (
    row.id !== excludeFaxLogId
    && validInstant(row.created_date)
    && Date.parse(row.created_date) >= cutoff
    && row.status !== 'failed'
  )) || null;
}

async function findUnresolvedSubmission(
  entities: Record<string, any>,
  input: Record<string, any>,
) {
  const identity = {
    agency_id: input.agencyId,
    referral_id: input.referralId,
    to_number: input.toNumber,
  };
  const queries = [
    { ...identity, status: 'submission_unknown' },
    { ...identity, provider_submission_state: 'pending' },
    { ...identity, provider_submission_state: 'indeterminate' },
  ];
  const byId = new Map<string, Record<string, any>>();
  for (const query of queries) {
    const rows = requireRows(
      await entities.FaxLog.filter(query, '-created_date', EXACT_ROW_LIMIT),
      'FaxLog.filter',
    );
    if (rows.some((row) => Object.entries(query).some(
      ([key, value]) => row?.[key] !== value,
    ))) throw new PublicError(409, 'Fax reconciliation identity is ambiguous');
    for (const row of rows) {
      const id = exactIdentifier(row?.id);
      if (!id || !validInstant(row?.created_date)) {
        throw new PublicError(409, 'Fax reconciliation identity is ambiguous');
      }
      byId.set(id, row);
    }
  }
  return [...byId.values()].sort((left, right) => (
    Date.parse(right?.created_date || '') - Date.parse(left?.created_date || '')
  ))[0] || null;
}

async function findPendingSubmissionOwner(
  entities: Record<string, any>,
  input: Record<string, any>,
) {
  const rows = requireRows(
    await entities.FaxLog.filter(
      {
        agency_id: input.agencyId,
        referral_id: input.referralId,
        to_number: input.toNumber,
        provider_submission_state: 'pending',
      },
      'created_date',
      EXACT_ROW_LIMIT,
    ),
    'FaxLog.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => (
    row?.agency_id !== input.agencyId
    || row?.referral_id !== input.referralId
    || row?.to_number !== input.toNumber
    || row?.provider_submission_state !== 'pending'
    || !exactIdentifier(row?.id)
    || !validInstant(row?.created_date)
  ))) throw new PublicError(409, 'Fax submission identity is ambiguous');
  if (rows.some((row) => (
    row.status !== 'queued'
    || row.telnyx_fax_id != null
    || !exactIdentifier(row.provider_submission_attempt_id)
    || !exactIdentifier(row.document_id)
    || (row.retry_of_fax_log_id != null
      && !exactIdentifier(row.retry_of_fax_log_id))
  ))) throw new PublicError(409, 'Fax submission identity is ambiguous');
  rows.sort((left, right) => {
    const byCreated = Date.parse(left.created_date) - Date.parse(right.created_date);
    return byCreated || String(left.id).localeCompare(String(right.id));
  });
  return rows[0] || null;
}

async function loadProviderFaxIdentity(
  entities: Record<string, any>,
  providerFaxId: string,
) {
  const rows = requireRows(
    await entities.FaxLog.filter(
      { telnyx_fax_id: providerFaxId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'FaxLog.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => (
    row?.telnyx_fax_id !== providerFaxId || !exactIdentifier(row?.id)
  ))) return { exact: false, rows: [] };
  return { exact: true, rows };
}

function successfulExactUpdate(value: unknown) {
  return plainObject(value)
    && value.success === true
    && value.updated === 1
    && value.has_more === false;
}

function nonNegativeSafeInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function validRetrySource(row: Record<string, any>, faxLogId: string, actor: Record<string, any>) {
  const retryCount = nonNegativeSafeInteger(row?.retry_count);
  const retryGeneration = nonNegativeSafeInteger(row?.retry_generation);
  const toNumber = normalizeFaxDest(row?.to_number);
  const toName = boundedLabel(row?.to_name);
  const documentName = boundedLabel(row?.document_name);
  if (
    row?.id !== faxLogId
    || row?.sent_by_user_id !== actor.userId
    || !exactIdentifier(row?.agency_id)
    || !exactIdentifier(row?.referral_id)
    || !exactIdentifier(row?.document_id)
    || !exactIdentifier(row?.sent_by_membership_id)
    || !Number.isSafeInteger(row?.sent_by_membership_version)
    || row.sent_by_membership_version < 1
    || !toNumber
    || row.to_number !== toNumber
    || toName === null
    || documentName === null
    || row.status !== 'failed'
    || row.provider_submission_state !== 'accepted'
    || !exactIdentifier(row.provider_submission_attempt_id)
    || row.provider_terminal_status !== 'failed'
    || !validInstant(row.provider_accepted_at)
    || !validInstant(row.provider_terminal_at)
    || Date.parse(row.provider_terminal_at) < Date.parse(row.provider_accepted_at)
    || !exactIdentifier(row.telnyx_fax_id)
    || retryCount === null
    || retryCount > MAX_MANUAL_RETRIES
    || retryGeneration === null
    || retryGeneration > retryCount
    || row.retry_claimed_by != null
    || row.retry_claimed_at != null
    || row.retry_claimed_by_user_id != null
    || row.failure_notify_claimed_by != null
    || row.failure_notify_claimed_at != null
    || row.document_url != null
    || !validInstant(row.updated_date)
  ) throw new PublicError(409, 'Fax is not eligible for an authorized retry');
  return {
    row,
    retryCount,
    retryGeneration,
    input: {
      mode: 'retry',
      agencyId: row.agency_id,
      referralId: row.referral_id,
      documentId: row.document_id,
      toNumber,
      toName,
      documentName,
    },
  };
}

async function loadRetrySource(
  entities: Record<string, any>,
  faxLogId: string,
  actor: Record<string, any>,
) {
  const rows = requireRows(
    await entities.FaxLog.filter({ id: faxLogId }, undefined, EXACT_ROW_LIMIT),
    'FaxLog.filter',
  );
  if (rows.length !== 1 || rows.some((row) => row?.id !== faxLogId)) {
    throw new PublicError(409, 'Fax retry identity is ambiguous');
  }
  return validRetrySource(rows[0], faxLogId, actor);
}

function maxRetriesFromConfig(config: Record<string, any> | null) {
  const raw = config?.max_retries;
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return 3;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_MANUAL_RETRIES ? value : 3;
}

async function loadFaxRetryConfig(
  entities: Record<string, any>,
  agencyId: string,
  agencyCode: string,
) {
  const exact = requireRows(
    await entities.FaxRetryConfig.filter({ agency_id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'FaxRetryConfig.filter',
  );
  if (exact.length > 1 || exact.some((row) => row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Fax retry policy is ambiguous');
  }
  if (exact.length === 1) return exact[0];

  // Temporary compatibility for a uniquely bound pre-migration row. Agency
  // codes are re-proved unique by loadAgencyAndSettings before this fallback.
  const legacy = requireRows(
    await entities.FaxRetryConfig.filter({ agency_name: agencyCode }, undefined, EXACT_ROW_LIMIT),
    'FaxRetryConfig.filter',
  );
  if (
    legacy.length > 1
    || legacy.some((row) => row?.agency_name !== agencyCode)
    || (legacy[0]?.agency_id != null && legacy[0].agency_id !== agencyId)
  ) throw new PublicError(409, 'Fax retry policy is ambiguous');
  return legacy[0] || null;
}

async function claimRetrySource(
  entities: Record<string, any>,
  source: Record<string, any>,
  actor: Record<string, any>,
) {
  const claimId = crypto.randomUUID();
  const claimedAt = new Date().toISOString();
  const result = await entities.FaxLog.updateMany(
    {
      id: source.row.id,
      agency_id: source.input.agencyId,
      referral_id: source.input.referralId,
      document_id: source.input.documentId,
      to_number: source.input.toNumber,
      sent_by_user_id: actor.userId,
      status: 'failed',
      provider_submission_state: 'accepted',
      provider_terminal_status: 'failed',
      telnyx_fax_id: source.row.telnyx_fax_id,
      retry_count: source.retryCount,
      retry_generation: source.retryGeneration,
      updated_date: source.row.updated_date,
    },
    {
      $set: {
        status: 'retrying',
        retry_claimed_by: claimId,
        retry_claimed_at: claimedAt,
        retry_claimed_by_user_id: actor.userId,
      },
    },
  );
  if (!successfulExactUpdate(result)) {
    throw new PublicError(409, 'Another retry is already in progress');
  }
  const rows = requireRows(
    await entities.FaxLog.filter({ id: source.row.id }, undefined, EXACT_ROW_LIMIT),
    'FaxLog.filter',
  );
  if (
    rows.length !== 1
    || rows[0]?.id !== source.row.id
    || rows[0]?.status !== 'retrying'
    || rows[0]?.retry_claimed_by !== claimId
    || rows[0]?.retry_claimed_at !== claimedAt
    || rows[0]?.retry_claimed_by_user_id !== actor.userId
    || !validInstant(rows[0]?.updated_date)
  ) throw new PublicError(409, 'Fax retry claim could not be verified');
  return { ...source, row: rows[0], claimId, claimedAt, settled: false };
}

async function settleRetrySource(
  entities: Record<string, any>,
  retry: Record<string, any> | null,
  status: 'failed' | 'retried',
  reason: string,
  consumeAttempt = true,
  clearRetrySchedule = consumeAttempt,
) {
  if (!retry || retry.settled) return true;
  const nextGeneration = consumeAttempt
    ? retry.retryGeneration + 1
    : retry.retryGeneration;
  const result = await entities.FaxLog.updateMany(
    {
      id: retry.row.id,
      agency_id: retry.input.agencyId,
      status: 'retrying',
      retry_claimed_by: retry.claimId,
      retry_claimed_at: retry.claimedAt,
      retry_claimed_by_user_id: retry.row.sent_by_user_id,
      updated_date: retry.row.updated_date,
    },
    {
      $set: {
        status,
        retry_count: Math.max(retry.retryCount, nextGeneration),
        retry_generation: nextGeneration,
        retry_claimed_by: null,
        retry_claimed_at: null,
        retry_claimed_by_user_id: null,
        failure_reason: reason,
        ...(clearRetrySchedule ? { next_retry_at: null } : {}),
      },
    },
  );
  if (!successfulExactUpdate(result)) return false;
  retry.settled = true;
  return true;
}

async function loadExactFaxLog(entities: Record<string, any>, faxLogId: string) {
  const rows = requireRows(
    await entities.FaxLog.filter({ id: faxLogId }, undefined, EXACT_ROW_LIMIT),
    'FaxLog.filter',
  );
  if (rows.length !== 1 || rows[0]?.id !== faxLogId) return null;
  return rows[0];
}

function validCreatedFaxLog(
  row: Record<string, any> | null,
  input: Record<string, any>,
  actor: Record<string, any>,
  scope: Record<string, any>,
  submissionAttemptId: string,
  retryAttempt: number,
  retrySourceId: string | null,
  providerAuthority: Record<string, any>,
) {
  return !!row
    && !!exactIdentifier(row.id)
    && row.agency_id === input.agencyId
    && row.referral_id === input.referralId
    && row.document_id === input.documentId
    && row.to_number === input.toNumber
    && row.sent_by_user_id === actor.userId
    && row.sent_by_membership_id === scope.membership_id
    && row.sent_by_membership_version === scope.membership_version
    && row.status === 'queued'
    && row.provider_submission_state === 'pending'
    && row.provider_submission_attempt_id === submissionAttemptId
    && row.provider === 'telnyx'
    && row.integration_secret_id === providerAuthority.integrationSecretId
    && row.integration_secret_updated_at === providerAuthority.integrationSecretUpdatedAt
    && row.fax_connection_id === providerAuthority.connectionId
    && row.sender_settings_id === providerAuthority.settingsId
    && row.sender_settings_updated_at === providerAuthority.settingsUpdatedAt
    && row.retry_count === retryAttempt
    && row.retry_generation === retryAttempt
    && (row.retry_of_fax_log_id ?? null) === retrySourceId
    && row.document_url == null
    && validInstant(row.created_date)
    && validInstant(row.updated_date);
}

async function transitionCreatedFaxSubmission(
  entities: Record<string, any>,
  created: Record<string, any>,
  changes: Record<string, any>,
) {
  await entities.FaxLog.updateMany(
    {
      id: created.id,
      status: 'queued',
      provider_submission_state: 'pending',
      provider_submission_attempt_id: created.provider_submission_attempt_id,
      updated_date: created.updated_date,
    },
    { $set: changes },
  ).catch(() => null);
  const current = await loadExactFaxLog(entities, created.id).catch(() => null);
  if (!current || Object.entries(changes).some(([key, value]) => current[key] !== value)
    || !validInstant(current.updated_date)) return null;
  return current;
}

async function quarantineAcceptedFaxIdentity(
  entities: Record<string, any>,
  accepted: Record<string, any>,
) {
  const reason = 'Provider fax identity became ambiguous after acceptance; reconcile before resend';
  const result = await entities.FaxLog.updateMany(
    {
      id: accepted.id,
      telnyx_fax_id: accepted.telnyx_fax_id,
      status: accepted.status,
      provider_submission_state: 'accepted',
      provider_submission_attempt_id: accepted.provider_submission_attempt_id,
      updated_date: accepted.updated_date,
    },
    { $set: {
      status: 'submission_unknown',
      provider_submission_state: 'indeterminate',
      failure_reason: reason,
    } },
  ).catch(() => null);
  if (!successfulExactUpdate(result)) return null;
  const current = await loadExactFaxLog(entities, accepted.id).catch(() => null);
  return current?.id === accepted.id
    && current.telnyx_fax_id === accepted.telnyx_fax_id
    && current.status === 'submission_unknown'
    && current.provider_submission_state === 'indeterminate'
    && current.failure_reason === reason
    && validInstant(current.updated_date)
    ? current
    : null;
}

function providerSubmissionIsDefinitelyRejected(response: Response) {
  return response.status >= 400
    && response.status < 500
    && ![408, 409, 425].includes(response.status);
}

Deno.serve(async (req) => {
  let entities: Record<string, any> | null = null;
  let retryContext: Record<string, any> | null = null;
  let providerAttemptStarted = false;
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const userId = exactIdentifier(user?.id);
    const userEmail = canonicalEmail(user?.email);
    if (
      !userId
      || !userEmail
      || user?.role !== 'user'
      || user?.is_active === false
      || user?.disabled === true
      || user?.is_service === true
      || user?.is_verified === false
    ) throw new PublicError(user ? 403 : 401, user ? 'Forbidden' : 'Unauthorized');
    const requested = await parseInput(req);
    const actor = { userId, userEmail };
    entities = base44.asServiceRole.entities;
    const retrySource = requested.mode === 'retry'
      ? await loadRetrySource(entities, requested.retryFaxLogId, actor)
      : null;
    const input = retrySource?.input || requested;
    const initialReferral = await loadReferral(base44, input);
    const initialDocument = await loadDocument(base44, input, initialReferral);
    const configuration = await loadAgencyAndSettings(entities, input.agencyId);
    const credentials = await loadTelnyxCredentials(entities);
    const officeFax = normalizeFromE164(configuration.settings.office_fax_number_e164);
    const outboundFax = normalizeFromE164(configuration.settings.outbound_fax_number_e164);
    const fromNumber = outboundFax || officeFax;
    if (!fromNumber) throw new PublicError(500, 'No valid outbound fax number is configured');
    const destination = isAllowedDestination(input.toNumber, configuration.settings);
    if (!destination.allowed) throw new PublicError(403, blockedReasonMessage(destination.reason));

    if (retrySource) {
      const retryConfig = await loadFaxRetryConfig(
        entities,
        input.agencyId,
        configuration.agency.agency_code,
      );
      const maxRetries = maxRetriesFromConfig(retryConfig);
      if (retrySource.retryGeneration >= maxRetries) {
        throw new PublicError(409, `Maximum retries (${maxRetries}) reached`);
      }
      retryContext = await claimRetrySource(entities, retrySource, actor);
    }

    const finalReferral = await loadReferral(base44, input);
    const finalDocument = await loadDocument(base44, input, finalReferral);
    const finalConfiguration = await loadAgencyAndSettings(entities, input.agencyId);
    const finalCredentials = await loadTelnyxCredentials(entities);
    if (
      !sameValue(finalReferral, initialReferral)
      || !sameValue(finalDocument.document, initialDocument.document)
      || !sameValue(finalDocument.scope, initialDocument.scope)
      || !sameValue(finalConfiguration, configuration)
      || !sameValue(finalCredentials, credentials)
    ) throw new PublicError(409, 'Fax authority changed during preparation');
    const providerAuthority = {
      integrationSecretId: finalCredentials.integrationSecretId,
      integrationSecretUpdatedAt: finalCredentials.integrationSecretUpdatedAt,
      connectionId: finalCredentials.connectionId,
      settingsId: finalConfiguration.settings.id,
      settingsUpdatedAt: finalConfiguration.settings.updated_date,
    };

    const unresolved = retryContext
      ? null
      : await findUnresolvedSubmission(entities, input);
    if (unresolved) {
      return Response.json(
        {
          success: true,
          deduped: true,
          log_id: unresolved.id,
          status: 'submission_unknown',
          requires_reconciliation: true,
        },
        { status: 202, headers: NO_STORE_HEADERS },
      );
    }

    const existing = retryContext ? null : await findRecentFax(entities, input);
    if (existing) {
      return Response.json(
        { success: true, deduped: true, log_id: existing.id, status: existing.status },
        { headers: NO_STORE_HEADERS },
      );
    }

    const submissionAttemptId = crypto.randomUUID();
    const retryAttempt = retryContext ? retryContext.retryGeneration + 1 : 0;
    const faxLog = await entities.FaxLog.create({
      agency_id: input.agencyId,
      referral_id: input.referralId,
      document_id: input.documentId,
      from_number: fromNumber,
      to_number: input.toNumber,
      to_name: input.toName || null,
      document_name: input.documentName || finalDocument.document.file_name,
      status: 'queued',
      provider_submission_state: 'pending',
      provider_submission_attempt_id: submissionAttemptId,
      provider: 'telnyx',
      integration_secret_id: providerAuthority.integrationSecretId,
      integration_secret_updated_at: providerAuthority.integrationSecretUpdatedAt,
      fax_connection_id: providerAuthority.connectionId,
      sender_settings_id: providerAuthority.settingsId,
      sender_settings_updated_at: providerAuthority.settingsUpdatedAt,
      patient_id: finalReferral.referral.patient_id || null,
      sent_by: userEmail,
      sent_by_user_id: userId,
      sent_by_membership_id: finalReferral.scope.membership_id,
      sent_by_membership_version: finalReferral.scope.membership_version,
      retry_count: retryAttempt,
      retry_generation: retryAttempt,
      ...(retryContext ? { retry_of_fax_log_id: retryContext.row.id } : {}),
      retry_claimed_by: null,
      retry_claimed_at: null,
      retry_claimed_by_user_id: null,
    });
    const faxLogId = exactIdentifier(faxLog?.id);
    if (!faxLogId) throw new Error('FaxLog.create returned no exact id');
    const createdFaxLog = await loadExactFaxLog(entities, faxLogId);
    if (!createdFaxLog || !validCreatedFaxLog(
      createdFaxLog,
      input,
      actor,
      finalReferral.scope,
      submissionAttemptId,
      retryAttempt,
      retryContext?.row.id || null,
      providerAuthority,
    )) throw new Error('FaxLog.create could not be verified');

    // Close the preflight-read -> create race across ordinary sends and retries.
    // Once this row exists, elect the oldest exact pending row for the
    // tenant/referral/destination and suppress every later contender before any
    // provider call. This is the strongest available boundary without a
    // datastore uniqueness constraint or Telnyx idempotency key; the browser
    // also disables a second submission while this runs.
    const owner = await findPendingSubmissionOwner(entities, input);
    if (!owner || owner.id !== createdFaxLog.id) {
      const suppressed = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        status: 'failed',
        provider_submission_state: 'rejected',
        failure_reason: 'Concurrent duplicate suppressed before provider submission',
      });
      const retryReleased = await settleRetrySource(
        entities,
        retryContext,
        'failed',
        'Another authorized fax submission already owns this destination',
        false,
        true,
      );
      if (!owner || !suppressed || !retryReleased) {
        return Response.json({
          success: true,
          log_id: faxLogId,
          status: 'submission_unknown',
          requires_reconciliation: true,
          warning: 'Local fax submission ownership needs reconciliation; do not resend.',
        }, { status: 202, headers: NO_STORE_HEADERS });
      }
      return Response.json({
        success: true,
        deduped: true,
        log_id: owner.id,
        status: owner.status,
      }, { headers: NO_STORE_HEADERS });
    }

    const requestUrl = new URL(req.url);
    const functionsBase = requestUrl.protocol === 'https:'
      ? (requestUrl.origin + requestUrl.pathname).replace(/\/+$/, '').replace(/\/[^/]+$/, '')
      : '';
    const providerPayload: Record<string, any> = {
      connection_id: credentials.connectionId,
      from: fromNumber,
      to: input.toNumber,
      media_url: finalDocument.delivery.download_url,
      quality: 'high',
    };
    const displayName = officeFaxDisplayName(officeFax);
    if (displayName) providerPayload.from_display_name = displayName;
    if (functionsBase) providerPayload.webhook_url = `${functionsBase}/handleTelnyxStatusWebhook`;

    let telnyxResponse: Response;
    providerAttemptStarted = true;
    try {
      telnyxResponse = await fetch('https://api.telnyx.com/v2/faxes', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(providerPayload),
      });
    } catch {
      const unknownStored = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        status: 'submission_unknown',
        provider_submission_state: 'indeterminate',
        failure_reason: 'Provider submission outcome is unknown; reconcile before any resend',
      });
      const retrySettled = await settleRetrySource(
        entities,
        retryContext,
        'retried',
        'A retry attempt was submitted but its provider acceptance is unknown',
      );
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: userEmail,
        user_name: user?.full_name || null,
        action: 'fax_submission_indeterminate',
        details: { provider: 'telnyx', direction: 'outbound', workflow: 'referral_follow_up' },
        page: 'referral_follow_up',
        entity_type: 'FaxLog',
        entity_id: faxLogId,
        status: 'indeterminate',
        user_agent: req.headers.get('user-agent') || 'unknown',
      }).catch(() => null);
      return Response.json({
        success: true,
        log_id: faxLogId,
        status: 'submission_unknown',
        requires_reconciliation: true,
        ...(!unknownStored || !retrySettled
          ? { warning: 'Local fax state needs reconciliation; do not resend.' }
          : {}),
      }, { status: 202, headers: NO_STORE_HEADERS });
    }

    const providerResult = await telnyxResponse.json().catch(() => ({}));
    const providerFaxId = exactIdentifier(providerResult?.data?.id);
    const providerAccepted = telnyxResponse.ok && !!providerFaxId;
    if (!providerAccepted && providerSubmissionIsDefinitelyRejected(telnyxResponse)) {
      const firstError = Array.isArray(providerResult?.errors) ? providerResult.errors[0] : null;
      const rejectedStored = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        status: 'failed',
        provider_submission_state: 'rejected',
        failure_reason: boundedLabel(firstError?.title) || 'Fax provider rejected the request',
      });
      const retrySettled = await settleRetrySource(
        entities,
        retryContext,
        'failed',
        'Fax provider rejected the retry request before acceptance',
      );
      if (!rejectedStored || !retrySettled) {
        return Response.json({
          success: true,
          log_id: faxLogId,
          status: 'submission_unknown',
          requires_reconciliation: true,
          warning: 'The provider rejected this request, but local fax state needs reconciliation.',
        }, { status: 202, headers: NO_STORE_HEADERS });
      }
      console.error('sendAuthorizedReferralFax provider rejected request');
      throw new PublicError(502, 'Fax provider rejected the request');
    }

    if (!providerAccepted) {
      const providerIdentity = providerFaxId
        ? await loadProviderFaxIdentity(entities, providerFaxId).catch(() => null)
        : null;
      const safeProviderFaxId = providerIdentity?.exact && providerIdentity.rows.length === 0
        ? providerFaxId
        : null;
      const unknownStored = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        ...(safeProviderFaxId ? { telnyx_fax_id: safeProviderFaxId } : {}),
        status: 'submission_unknown',
        provider_submission_state: 'indeterminate',
        failure_reason: 'Provider submission outcome is unknown; reconcile before any resend',
      });
      const retrySettled = await settleRetrySource(
        entities,
        retryContext,
        'retried',
        'A retry attempt was submitted but its provider acceptance is unknown',
      );
      return Response.json({
        success: true,
        log_id: faxLogId,
        status: 'submission_unknown',
        requires_reconciliation: true,
        ...(!unknownStored || !retrySettled
          ? { warning: 'Local fax state needs reconciliation; do not resend.' }
          : {}),
      }, { status: 202, headers: NO_STORE_HEADERS });
    }
    const availableProviderIdentity = await loadProviderFaxIdentity(
      entities,
      providerFaxId,
    ).catch(() => null);
    if (!availableProviderIdentity?.exact || availableProviderIdentity.rows.length !== 0) {
      const unknownStored = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        status: 'submission_unknown',
        provider_submission_state: 'indeterminate',
        failure_reason: 'Provider accepted the fax with an ambiguous identity; reconcile before resend',
      });
      const retrySettled = await settleRetrySource(
        entities,
        retryContext,
        'retried',
        'A retry was accepted with an ambiguous provider identity',
      );
      return Response.json({
        success: true,
        log_id: faxLogId,
        status: 'submission_unknown',
        requires_reconciliation: true,
        ...(!unknownStored || !retrySettled
          ? { warning: 'Provider identity and local fax state both require reconciliation; do not resend.' }
          : { warning: 'The provider accepted this fax, but its identity conflicts with an existing record.' }),
      }, { status: 202, headers: NO_STORE_HEADERS });
    }
    const acceptedAt = new Date().toISOString();
    const acceptedFaxLog = await transitionCreatedFaxSubmission(entities, createdFaxLog, {
      telnyx_fax_id: providerFaxId,
      status: 'sending',
      provider_submission_state: 'accepted',
      provider_accepted_at: acceptedAt,
      failure_reason: null,
    });
    if (!acceptedFaxLog) {
      // Telnyx supplied an exact fax id, so this transmission is accepted even
      // when our confirmation write fails. Returning a failure would invite a
      // duplicate resend. Preserve a fail-closed reconciliation state if a
      // second write is possible and tell the caller the submission succeeded.
      await transitionCreatedFaxSubmission(entities, createdFaxLog, {
        telnyx_fax_id: providerFaxId,
        status: 'submission_unknown',
        provider_submission_state: 'indeterminate',
        failure_reason: 'Provider accepted the fax but local confirmation failed; reconcile before resend',
      });
      await settleRetrySource(
        entities,
        retryContext,
        'retried',
        'A retry was accepted by the provider but local confirmation failed',
      );
      console.error('sendAuthorizedReferralFax acceptance confirmation failed');
      return Response.json({
        success: true,
        log_id: faxLogId,
        status: 'submission_unknown',
        requires_reconciliation: true,
        warning: 'The provider accepted this fax, but status confirmation needs operator review.',
      }, { status: 202, headers: NO_STORE_HEADERS });
    }
    const confirmedProviderIdentity = await loadProviderFaxIdentity(
      entities,
      providerFaxId,
    ).catch(() => null);
    if (!confirmedProviderIdentity?.exact
      || confirmedProviderIdentity.rows.length !== 1
      || confirmedProviderIdentity.rows[0]?.id !== faxLogId) {
      const quarantined = await quarantineAcceptedFaxIdentity(
        entities,
        acceptedFaxLog,
      );
      await settleRetrySource(
        entities,
        retryContext,
        'retried',
        'A retry was accepted but its provider identity could not be confirmed uniquely',
      );
      return Response.json({
        success: true,
        log_id: faxLogId,
        status: 'submission_unknown',
        requires_reconciliation: true,
        warning: quarantined
          ? 'The provider accepted this fax, but its identity conflicts with another record.'
          : 'The provider accepted this fax, but its identity and local state need operator review.',
      }, { status: 202, headers: NO_STORE_HEADERS });
    }
    const retrySettled = await settleRetrySource(
      entities,
      retryContext,
      'retried',
      `Retry attempt #${retryAttempt} accepted by the fax provider`,
    );
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: userEmail,
      user_name: user?.full_name || null,
      action: 'fax_sent',
      details: { provider: 'telnyx', direction: 'outbound', workflow: 'referral_follow_up' },
      page: 'referral_follow_up',
      entity_type: 'FaxLog',
      entity_id: faxLogId,
      status: 'accepted',
      user_agent: req.headers.get('user-agent') || 'unknown',
    }).catch(() => null);
    return Response.json(
      {
        success: true,
        log_id: faxLogId,
        status: acceptedFaxLog.status,
        ...(retryContext ? { retry_of_fax_log_id: retryContext.row.id } : {}),
        ...(!retrySettled ? { warning: 'The fax was accepted, but its prior attempt needs reconciliation.' } : {}),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (entities && retryContext && !retryContext.settled) {
      const released = await settleRetrySource(
        entities,
        retryContext,
        'failed',
        providerAttemptStarted
          ? 'The retry provider attempt did not complete cleanly'
          : 'The retry attempt was not submitted to the fax provider',
        providerAttemptStarted,
      ).catch(() => false);
      if (!released) console.error('sendAuthorizedReferralFax retry claim release failed');
    }
    if (error instanceof PublicError) {
      return Response.json(
        { success: false, error: error.message },
        {
          status: error.status,
          headers: {
            ...NO_STORE_HEADERS,
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('sendAuthorizedReferralFax failed');
    return Response.json(
      { success: false, error: 'Unable to send referral fax' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
