import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_ITEMS = 100;
const EXACT_ROW_LIMIT = 10;
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

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedText(value: unknown, maximum: number, optional = false) {
  if (value == null && optional) return '';
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if ((!text && !optional) || text.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) {
    return null;
  }
  return text;
}

function unwrapFunctionResult(value: unknown) {
  return plainObject(value) && Object.hasOwn(value, 'data') ? value.data : value;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (plainObject(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

async function sha256Hex(value: unknown) {
  const bytes = new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(canonicalJson(value)),
  );
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function generateSecureToken() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseInput(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let raw = '';
  try {
    raw = await req.text();
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    throw new PublicError(400, 'Invalid JSON body');
  }
  if (!plainObject(body)) throw new PublicError(400, 'Request body must be an object');
  if (Object.keys(body).some((key) => ![
    'agency_id', 'referral_id', 'provider_name', 'expires_in_days',
  ].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(body.agency_id);
  const referralId = exactIdentifier(body.referral_id);
  const providerName = boundedText(body.provider_name, 200, true);
  const expiresInDays = body.expires_in_days === undefined ? 30 : Number(body.expires_in_days);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  if (providerName === null) throw new PublicError(400, 'provider_name is invalid');
  if (!Number.isSafeInteger(expiresInDays) || expiresInDays < 1 || expiresInDays > 90) {
    throw new PublicError(400, 'expires_in_days is invalid');
  }
  return { agencyId, referralId, providerName, expiresInDays };
}

function validateBrokerResult(value: unknown, agencyId: string, referralId: string) {
  if (!plainObject(value) || value.success !== true || value.action !== 'get') {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  const referral = value.referral;
  const scope = value.scope;
  if (
    !plainObject(referral)
    || referral.id !== referralId
    || referral.agency_id !== agencyId
    || !Number.isSafeInteger(referral.version)
    || referral.version < 1
    || !validInstant(referral.created_date)
    || !validInstant(referral.updated_date)
    || !plainObject(scope)
    || scope.agency_id !== agencyId
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
    || !INTAKE_ROLES.has(scope.tenant_role)
  ) {
    throw new PublicError(502, 'Referral authorization response was invalid');
  }
  return { referral, scope };
}

async function authorizedReferral(base44: Record<string, any>, agencyId: string, referralId: string) {
  const response = await base44.functions.invoke('manageAuthorizedReferral', {
    action: 'get',
    agency_id: agencyId,
    referral_id: referralId,
  });
  return validateBrokerResult(unwrapFunctionResult(response), agencyId, referralId);
}

function snapshotItem(item: unknown, number: number) {
  if (!plainObject(item)) throw new PublicError(409, 'Follow-up request is invalid');
  const itemId = exactIdentifier(item.id);
  const title = boundedText(item.title, 300, true);
  const needed = boundedText(item.needed, 2000, true);
  const providerRequest = plainObject(item.provider_request) ? item.provider_request : {};
  const question = boundedText(providerRequest.question ?? needed, 2000, false);
  const hint = boundedText(providerRequest.hint, 1000, true);
  const why = boundedText(item.why, 2000, true);
  const citation = boundedText(item.citation, 500, true);
  const responseType = ['text', 'document', 'yes_no'].includes(providerRequest.response_type)
    ? providerRequest.response_type
    : 'text';
  const itemStatus = ['open', 'answered', 'resolved'].includes(item.item_status)
    ? item.item_status
    : 'open';
  if (!itemId || title === null || !question || hint === null || why === null || citation === null) {
    throw new PublicError(409, 'Follow-up request is invalid');
  }
  return {
    item_id: itemId,
    number,
    title,
    question,
    hint,
    why,
    citation,
    response_type: responseType,
    item_status: itemStatus,
  };
}

function requestSnapshot(referral: Record<string, any>, providerName: string) {
  const followUp = referral.follow_up_requests;
  if (
    !plainObject(followUp)
    || !['open', 'sent'].includes(followUp.status)
    || !validInstant(followUp.generated_at)
    || !Array.isArray(followUp.items)
    || followUp.items.length < 1
    || followUp.items.length > MAX_ITEMS
  ) {
    throw new PublicError(409, 'Referral has no issuable follow-up request');
  }
  const items = followUp.items.map((item: unknown, index: number) => snapshotItem(item, index + 1));
  if (new Set(items.map((item) => item.item_id)).size !== items.length) {
    throw new PublicError(409, 'Follow-up request item identity is ambiguous');
  }
  const patientName = boundedText(
    referral.patient_name || referral.extracted_data?.demographics?.full_name,
    300,
    true,
  );
  const patientDob = boundedText(
    referral.patient_dob || referral.extracted_data?.demographics?.date_of_birth,
    40,
    true,
  );
  const referralDate = boundedText(referral.referral_date, 40, true);
  if (patientName === null || patientDob === null || referralDate === null) {
    throw new PublicError(409, 'Referral provider snapshot is invalid');
  }
  return {
    patient_name: patientName,
    patient_dob: patientDob,
    referral_date: referralDate,
    provider_name: providerName,
    request_generated_at: followUp.generated_at,
    items,
  };
}

function appBaseUrl(req: Request) {
  const configured = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim();
  const requestOrigin = String(req.headers.get('origin') || '').trim();
  const candidates = [configured, requestOrigin, 'https://caremetricai.base44.app'];
  for (const candidate of candidates) {
    try {
      const parsed = new URL(candidate);
      const host = parsed.hostname.toLowerCase();
      const isConfigured = !!configured && candidate === configured;
      const isBase44Host = host === 'base44.app'
        || host.endsWith('.base44.app')
        || host === 'base44.io'
        || host.endsWith('.base44.io');
      if (
        parsed.protocol === 'https:'
        && !parsed.username
        && !parsed.password
        && (isConfigured || isBase44Host)
      ) return parsed.origin;
    } catch {
      // Try the reviewed compatibility origin.
    }
  }
  try {
    const own = new URL(req.url);
    if (own.protocol === 'https:') return own.origin;
  } catch {
    // Handled below.
  }
  throw new PublicError(500, 'Public provider portal URL is not configured');
}

function exactTokenRecord(row: Record<string, any>, expected: Record<string, any>) {
  return !!exactIdentifier(row?.id)
    && row.agency_id === expected.agency_id
    && row.referral_id === expected.referral_id
    && row.token === expected.token
    && row.token_creation_key === expected.token_creation_key
    && row.request_generated_at === expected.request_generated_at
    && row.request_snapshot_hash === expected.request_snapshot_hash
    && sameValue(row.request_snapshot, expected.request_snapshot)
    && row.referral_version_at_issue === expected.referral_version_at_issue
    && row.referral_version_after_issue === expected.referral_version_after_issue
    && row.referral_updated_date_at_issue === expected.referral_updated_date_at_issue
    && row.issued_by_user_id === expected.issued_by_user_id
    && row.issued_by_user_email_normalized === expected.issued_by_user_email_normalized
    && row.issued_by_membership_id === expected.issued_by_membership_id
    && row.issued_by_membership_version === expected.issued_by_membership_version
    && row.issued_at === expected.issued_at
    && row.expires_at === expected.expires_at
    && row.is_active === true
    && row.status === 'sent'
    && row.access_count === 0
    && row.version === 1;
}

async function revokeUnboundToken(entities: Record<string, any>, tokenId: string) {
  await entities.ProviderFollowUpToken.updateMany(
    { id: tokenId, version: 1, is_active: true },
    { $set: { is_active: false, status: 'revoked' }, $inc: { version: 1 } },
  ).catch(() => null);
}

async function revokePreviousToken(
  entities: Record<string, any>,
  tokenId: string,
  agencyId: string,
  referralId: string,
) {
  const rows = await entities.ProviderFollowUpToken.filter(
    { id: tokenId, agency_id: agencyId, referral_id: referralId },
    undefined,
    EXACT_ROW_LIMIT,
  ).catch(() => []);
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  if (
    row?.id !== tokenId
    || row?.agency_id !== agencyId
    || row?.referral_id !== referralId
    || row?.is_active !== true
    || !Number.isSafeInteger(row?.version)
    || row.version < 1
    || !validInstant(row?.updated_date)
  ) return false;
  const update = await entities.ProviderFollowUpToken.updateMany(
    {
      id: tokenId,
      agency_id: agencyId,
      referral_id: referralId,
      version: row.version,
      updated_date: row.updated_date,
      is_active: true,
    },
    { $set: { is_active: false, status: 'revoked' }, $inc: { version: 1 } },
  ).catch(() => null);
  return plainObject(update)
    && update.success === true
    && update.updated === 1
    && update.has_more === false;
}

Deno.serve(async (req) => {
  let createdTokenId: string | null = null;
  let base44: Record<string, any> | null = null;
  try {
    const input = await parseInput(req);
    base44 = createClientFromRequest(req);
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

    const initial = await authorizedReferral(base44, input.agencyId, input.referralId);
    const snapshot = requestSnapshot(initial.referral, input.providerName);
    const snapshotHash = await sha256Hex(snapshot);
    const token = generateSecureToken();
    const tokenHash = await sha256Hex(token);
    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(
      Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
    ).toISOString();
    const tokenCreationKey = await sha256Hex([
      input.agencyId,
      input.referralId,
      snapshot.request_generated_at,
      snapshotHash,
      userId,
      issuedAt,
    ]);
    const tokenPayload = {
      agency_id: input.agencyId,
      referral_id: input.referralId,
      token: tokenHash,
      token_creation_key: tokenCreationKey,
      provider_name: input.providerName || null,
      request_generated_at: snapshot.request_generated_at,
      request_snapshot_hash: snapshotHash,
      request_snapshot: snapshot,
      referral_version_at_issue: initial.referral.version,
      referral_version_after_issue: initial.referral.version + 1,
      referral_updated_date_at_issue: initial.referral.updated_date,
      issued_by_user_id: userId,
      issued_by_user_email_normalized: userEmail,
      issued_by_membership_id: initial.scope.membership_id,
      issued_by_membership_version: initial.scope.membership_version,
      issued_at: issuedAt,
      expires_at: expiresAt,
      is_active: true,
      status: 'sent',
      access_count: 0,
      version: 1,
    };
    const entities = base44.asServiceRole.entities;
    const created = await entities.ProviderFollowUpToken.create(tokenPayload);
    createdTokenId = exactIdentifier(created?.id);
    if (!createdTokenId) throw new Error('ProviderFollowUpToken.create returned no exact id');
    const tokenRows = await entities.ProviderFollowUpToken.filter(
      { id: createdTokenId, agency_id: input.agencyId, referral_id: input.referralId },
      undefined,
      EXACT_ROW_LIMIT,
    );
    if (
      !Array.isArray(tokenRows)
      || tokenRows.length !== 1
      || !exactTokenRecord(tokenRows[0], tokenPayload)
    ) throw new Error('Provider follow-up token readback failed');

    const current = await authorizedReferral(base44, input.agencyId, input.referralId);
    if (
      current.referral.version !== initial.referral.version
      || current.referral.updated_date !== initial.referral.updated_date
      || !sameValue(requestSnapshot(current.referral, input.providerName), snapshot)
      || !sameValue(current.scope, initial.scope)
    ) throw new PublicError(409, 'Referral changed during link generation');

    const linkedFollowUp = {
      ...current.referral.follow_up_requests,
      portal_link_active: true,
      portal_token_id: createdTokenId,
      portal_token_snapshot_hash: snapshotHash,
      portal_token_issued_at: issuedAt,
      portal_token_expires_at: expiresAt,
    };
    const update = await entities.Referral.updateMany(
      {
        id: input.referralId,
        agency_id: input.agencyId,
        version: current.referral.version,
        updated_date: current.referral.updated_date,
      },
      { $set: { follow_up_requests: linkedFollowUp }, $inc: { version: 1 } },
    );
    if (
      !plainObject(update)
      || update.success !== true
      || update.updated !== 1
      || update.has_more !== false
    ) throw new PublicError(409, 'Referral changed during link generation');

    const bound = await authorizedReferral(base44, input.agencyId, input.referralId);
    if (
      bound.referral.version !== tokenPayload.referral_version_after_issue
      || bound.referral.follow_up_requests?.portal_token_id !== createdTokenId
      || bound.referral.follow_up_requests?.portal_token_snapshot_hash !== snapshotHash
      || bound.referral.follow_up_requests?.portal_token_issued_at !== issuedAt
      || bound.referral.follow_up_requests?.portal_token_expires_at !== expiresAt
      || !sameValue(requestSnapshot(bound.referral, input.providerName), snapshot)
      || !sameValue(bound.scope, initial.scope)
    ) throw new Error('Provider follow-up token binding verification failed');

    const previousTokenId = exactIdentifier(initial.referral.follow_up_requests?.portal_token_id);
    if (previousTokenId && previousTokenId !== createdTokenId) {
      // The Referral pointer change already makes the prior capability unusable.
      // Mark its row revoked as lifecycle cleanup without risking the new link.
      await revokePreviousToken(
        entities,
        previousTokenId,
        input.agencyId,
        input.referralId,
      );
    }

    return Response.json({
      success: true,
      token_id: createdTokenId,
      portal_link: `${appBaseUrl(req)}/followup?token=${encodeURIComponent(token)}`,
      expires_at: expiresAt,
      referral_version: bound.referral.version,
    }, { status: 201, headers: NO_STORE_HEADERS });
  } catch (error) {
    if (createdTokenId && base44) {
      try {
        await revokeUnboundToken(base44.asServiceRole.entities, createdTokenId);
      } catch {
        // The unbound token cannot validate because the Referral does not point to it.
      }
    }
    if (error instanceof PublicError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: {
            ...NO_STORE_HEADERS,
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('generateFollowUpPortalToken failed');
    return Response.json(
      { error: 'Failed to generate provider response link' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
