import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_LABEL_LENGTH = 300;
const EXACT_ROW_LIMIT = 10;
const FAX_SIGNED_URL_TTL_SECONDS = 15 * 60;
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
  ].includes(key))) throw new PublicError(400, 'Invalid request');
  const agencyId = exactIdentifier(body.agency_id);
  const referralId = exactIdentifier(body.referral_id);
  const documentId = exactIdentifier(body.document_id);
  const toNumber = normalizeFaxDest(body.to_number);
  const toName = boundedLabel(body.to_name);
  const documentName = boundedLabel(body.document_name);
  if (!agencyId || !referralId || !documentId || !toNumber || toName === null || documentName === null) {
    throw new PublicError(400, 'Fax request is invalid');
  }
  return { agencyId, referralId, documentId, toNumber, toName, documentName };
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
  ) throw new PublicError(409, 'Agency fax settings are unavailable');
  return { agency, settings: settingsRows[0] };
}

async function loadTelnyxCredentials(entities: Record<string, any>) {
  const rows = requireRows(
    await entities.IntegrationSecret.filter({ provider: 'telnyx' }, '-updated_date', 5000),
    'IntegrationSecret.filter',
  );
  const withKey = rows.filter((row) => (
    typeof row?.api_key === 'string' && row.api_key.trim()
  ));
  const active = withKey.filter((row) => row.is_active === true);
  const candidates = active.length ? active : withKey;
  if (candidates.length !== 1) throw new PublicError(500, 'Fax integration is not configured uniquely');
  const row = candidates[0];
  const apiKey = String(row.api_key).trim();
  const connectionId = typeof row.fax_connection_id === 'string'
    ? row.fax_connection_id.trim()
    : '';
  if (!apiKey || !connectionId) throw new PublicError(500, 'Fax integration is not configured');
  return { apiKey, connectionId };
}

async function findRecentFax(
  entities: Record<string, any>,
  input: Record<string, any>,
  actor: Record<string, any>,
) {
  const rows = requireRows(
    await entities.FaxLog.filter(
      {
        agency_id: input.agencyId,
        referral_id: input.referralId,
        document_id: input.documentId,
        to_number: input.toNumber,
        sent_by_user_id: actor.userId,
      },
      '-created_date',
      EXACT_ROW_LIMIT,
    ),
    'FaxLog.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => (
    row?.agency_id !== input.agencyId
    || row?.referral_id !== input.referralId
    || row?.document_id !== input.documentId
    || row?.to_number !== input.toNumber
    || row?.sent_by_user_id !== actor.userId
  ))) throw new PublicError(409, 'Fax retry identity is ambiguous');
  const cutoff = Date.now() - 2 * 60 * 1000;
  return rows.find((row) => (
    validInstant(row.created_date)
    && Date.parse(row.created_date) >= cutoff
    && row.status !== 'failed'
  )) || null;
}

Deno.serve(async (req) => {
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
    const input = await parseInput(req);
    const actor = { userId, userEmail };
    const initialReferral = await loadReferral(base44, input);
    const initialDocument = await loadDocument(base44, input, initialReferral);
    const entities = base44.asServiceRole.entities;
    const configuration = await loadAgencyAndSettings(entities, input.agencyId);
    const credentials = await loadTelnyxCredentials(entities);
    const officeFax = normalizeFromE164(configuration.settings.office_fax_number_e164);
    const outboundFax = normalizeFromE164(configuration.settings.outbound_fax_number_e164);
    const fromNumber = outboundFax || officeFax;
    if (!fromNumber) throw new PublicError(500, 'No valid outbound fax number is configured');
    const destination = isAllowedDestination(input.toNumber, configuration.settings);
    if (!destination.allowed) throw new PublicError(403, blockedReasonMessage(destination.reason));

    const finalReferral = await loadReferral(base44, input);
    const finalDocument = await loadDocument(base44, input, finalReferral);
    if (
      !sameValue(finalReferral, initialReferral)
      || !sameValue(finalDocument.document, initialDocument.document)
      || !sameValue(finalDocument.scope, initialDocument.scope)
    ) throw new PublicError(409, 'Fax authority changed during preparation');

    const existing = await findRecentFax(entities, input, actor);
    if (existing) {
      return Response.json(
        { success: true, deduped: true, log_id: existing.id, status: existing.status },
        { headers: NO_STORE_HEADERS },
      );
    }

    const faxLog = await entities.FaxLog.create({
      agency_id: input.agencyId,
      referral_id: input.referralId,
      document_id: input.documentId,
      from_number: fromNumber,
      to_number: input.toNumber,
      to_name: input.toName || null,
      document_name: input.documentName || finalDocument.document.file_name,
      status: 'queued',
      patient_id: finalReferral.referral.patient_id || null,
      sent_by: userEmail,
      sent_by_user_id: userId,
      sent_by_membership_id: finalReferral.scope.membership_id,
      sent_by_membership_version: finalReferral.scope.membership_version,
      retry_count: 0,
    });
    const faxLogId = exactIdentifier(faxLog?.id);
    if (!faxLogId) throw new Error('FaxLog.create returned no exact id');

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
      await entities.FaxLog.update(faxLogId, {
        status: 'failed',
        failure_reason: 'Network error reaching fax provider',
      }).catch(() => null);
      throw new PublicError(502, 'Failed to reach fax provider');
    }

    const providerResult = await telnyxResponse.json().catch(() => ({}));
    if (!telnyxResponse.ok) {
      const firstError = Array.isArray(providerResult?.errors) ? providerResult.errors[0] : null;
      await entities.FaxLog.update(faxLogId, {
        status: 'failed',
        failure_reason: boundedLabel(firstError?.title) || 'Fax provider rejected the request',
      }).catch(() => null);
      console.error('sendAuthorizedReferralFax provider rejected request');
      throw new PublicError(502, 'Fax provider rejected the request');
    }

    const providerFaxId = exactIdentifier(providerResult?.data?.id);
    if (!providerFaxId) {
      await entities.FaxLog.update(faxLogId, {
        status: 'failed',
        failure_reason: 'Fax provider returned no transmission id',
      }).catch(() => null);
      throw new PublicError(502, 'Fax provider returned an invalid response');
    }
    await entities.FaxLog.update(faxLogId, {
      telnyx_fax_id: providerFaxId,
      status: 'sending',
    });
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
      { success: true, log_id: faxLogId, status: providerResult?.data?.status || 'sending' },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
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
