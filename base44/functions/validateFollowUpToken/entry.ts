import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_ITEMS = 100;
const EXACT_ROW_LIMIT = 10;
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

async function parseToken(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) {
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
  if (!plainObject(body) || Object.keys(body).length !== 1 || !Object.hasOwn(body, 'token')) {
    throw new PublicError(400, 'Invalid request');
  }
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
    throw new PublicError(400, 'Token is invalid');
  }
  return body.token;
}

function validateSnapshotItem(item: unknown, number: number) {
  if (!plainObject(item)) throw new PublicError(401, 'This link is no longer valid.');
  const expectedKeys = [
    'item_id', 'number', 'title', 'question', 'hint', 'why', 'citation',
    'response_type', 'item_status',
  ];
  if (
    Object.keys(item).sort().join('|') !== expectedKeys.sort().join('|')
    || !exactIdentifier(item.item_id)
    || item.number !== number
    || boundedText(item.title, 300, true) !== item.title
    || boundedText(item.question, 2000, false) !== item.question
    || boundedText(item.hint, 1000, true) !== item.hint
    || boundedText(item.why, 2000, true) !== item.why
    || boundedText(item.citation, 500, true) !== item.citation
    || !['text', 'document', 'yes_no'].includes(item.response_type)
    || !['open', 'answered', 'resolved'].includes(item.item_status)
  ) throw new PublicError(401, 'This link is no longer valid.');
  return item;
}

function validateStoredSnapshot(value: unknown) {
  if (!plainObject(value)) throw new PublicError(401, 'This link is no longer valid.');
  const expectedKeys = [
    'patient_name', 'patient_dob', 'referral_date', 'provider_name',
    'request_generated_at', 'items',
  ];
  if (
    Object.keys(value).sort().join('|') !== expectedKeys.sort().join('|')
    || boundedText(value.patient_name, 300, true) !== value.patient_name
    || boundedText(value.patient_dob, 40, true) !== value.patient_dob
    || boundedText(value.referral_date, 40, true) !== value.referral_date
    || boundedText(value.provider_name, 200, true) !== value.provider_name
    || !validInstant(value.request_generated_at)
    || !Array.isArray(value.items)
    || value.items.length < 1
    || value.items.length > MAX_ITEMS
  ) throw new PublicError(401, 'This link is no longer valid.');
  const items = value.items.map((item: unknown, index: number) => validateSnapshotItem(item, index + 1));
  if (new Set(items.map((item) => item.item_id)).size !== items.length) {
    throw new PublicError(401, 'This link is no longer valid.');
  }
  return value;
}

function currentSnapshot(referral: Record<string, any>, stored: Record<string, any>) {
  const followUp = referral.follow_up_requests;
  if (
    !plainObject(followUp)
    || !['open', 'sent'].includes(followUp.status)
    || followUp.generated_at !== stored.request_generated_at
    || !Array.isArray(followUp.items)
    || followUp.items.length !== stored.items.length
  ) throw new PublicError(401, 'This link is no longer valid.');
  const items = followUp.items.map((item: unknown, index: number) => {
    if (!plainObject(item)) throw new PublicError(401, 'This link is no longer valid.');
    const providerRequest = plainObject(item.provider_request) ? item.provider_request : {};
    const title = boundedText(item.title, 300, true);
    const needed = boundedText(item.needed, 2000, true);
    const question = boundedText(providerRequest.question ?? needed, 2000, false);
    const hint = boundedText(providerRequest.hint, 1000, true);
    const why = boundedText(item.why, 2000, true);
    const citation = boundedText(item.citation, 500, true);
    const itemId = exactIdentifier(item.id);
    if (!itemId || title === null || !question || hint === null || why === null || citation === null) {
      throw new PublicError(401, 'This link is no longer valid.');
    }
    return {
      item_id: itemId,
      number: index + 1,
      title,
      question,
      hint,
      why,
      citation,
      response_type: ['text', 'document', 'yes_no'].includes(providerRequest.response_type)
        ? providerRequest.response_type
        : 'text',
      item_status: ['open', 'answered', 'resolved'].includes(item.item_status)
        ? item.item_status
        : 'open',
    };
  });
  return {
    patient_name: boundedText(
      referral.patient_name || referral.extracted_data?.demographics?.full_name,
      300,
      true,
    ),
    patient_dob: boundedText(
      referral.patient_dob || referral.extracted_data?.demographics?.date_of_birth,
      40,
      true,
    ),
    referral_date: boundedText(referral.referral_date, 40, true),
    provider_name: stored.provider_name,
    request_generated_at: followUp.generated_at,
    items,
  };
}

async function loadToken(entities: Record<string, any>, tokenHash: string) {
  const rows = await entities.ProviderFollowUpToken.filter(
    { token: tokenHash },
    undefined,
    EXACT_ROW_LIMIT,
  );
  if (!Array.isArray(rows) || rows.length !== 1) {
    throw new PublicError(401, 'This link is no longer valid.');
  }
  const row = rows[0];
  const snapshot = validateStoredSnapshot(row.request_snapshot);
  const agencyId = exactIdentifier(row.agency_id);
  const referralId = exactIdentifier(row.referral_id);
  const issuedById = exactIdentifier(row.issued_by_user_id);
  const issuedByEmail = canonicalEmail(row.issued_by_user_email_normalized);
  const membershipId = exactIdentifier(row.issued_by_membership_id);
  if (
    !exactIdentifier(row.id)
    || !agencyId
    || !referralId
    || row.token !== tokenHash
    || !/^[a-f0-9]{64}$/.test(String(row.token_creation_key || ''))
    || row.request_generated_at !== snapshot.request_generated_at
    || !/^[a-f0-9]{64}$/.test(String(row.request_snapshot_hash || ''))
    || !Number.isSafeInteger(row.referral_version_at_issue)
    || row.referral_version_at_issue < 1
    || row.referral_version_after_issue !== row.referral_version_at_issue + 1
    || !validInstant(row.referral_updated_date_at_issue)
    || !issuedById
    || !issuedByEmail
    || row.issued_by_user_email_normalized !== issuedByEmail
    || !membershipId
    || !Number.isSafeInteger(row.issued_by_membership_version)
    || row.issued_by_membership_version < 1
    || !validInstant(row.issued_at)
    || !validInstant(row.expires_at)
    || typeof row.is_active !== 'boolean'
    || !['sent', 'delivered', 'expired', 'revoked'].includes(row.status)
    || !Number.isSafeInteger(row.access_count)
    || row.access_count < 0
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.updated_date)
  ) throw new PublicError(401, 'This link is no longer valid.');
  return { row, snapshot };
}

async function validateTokenHashes(row: Record<string, any>, snapshot: Record<string, any>) {
  const snapshotHash = await sha256Hex(snapshot);
  const creationKey = await sha256Hex([
    row.agency_id,
    row.referral_id,
    row.request_generated_at,
    snapshotHash,
    row.issued_by_user_id,
    row.issued_at,
  ]);
  if (snapshotHash !== row.request_snapshot_hash || creationKey !== row.token_creation_key) {
    throw new PublicError(401, 'This link is no longer valid.');
  }
}

async function loadBoundReferral(
  entities: Record<string, any>,
  token: Record<string, any>,
  snapshot: Record<string, any>,
  requireCurrentSnapshot: boolean,
) {
  const rows = await entities.Referral.filter(
    { id: token.referral_id, agency_id: token.agency_id },
    undefined,
    EXACT_ROW_LIMIT,
  );
  if (
    !Array.isArray(rows)
    || rows.length !== 1
    || rows.some((row) => row?.id !== token.referral_id || row?.agency_id !== token.agency_id)
  ) throw new PublicError(401, 'This link is no longer valid.');
  const referral = rows[0];
  const creatorId = exactIdentifier(referral.created_by_user_id);
  const creatorEmail = canonicalEmail(referral.created_by_user_email_normalized);
  const requestId = exactIdentifier(referral.client_request_id);
  if (
    !creatorId
    || !creatorEmail
    || referral.created_by_user_email_normalized !== creatorEmail
    || canonicalEmail(referral.created_by) !== creatorEmail
    || !requestId
    || referral.referral_creation_key !== `${token.agency_id}:${creatorId}:${requestId}`
    || !Number.isSafeInteger(referral.version)
    || referral.version < token.referral_version_after_issue
    || !validInstant(referral.created_date)
    || !validInstant(referral.updated_date)
    || referral.archived_at != null
    || referral.follow_up_requests?.portal_token_id !== token.id
    || referral.follow_up_requests?.portal_token_snapshot_hash !== token.request_snapshot_hash
    || referral.follow_up_requests?.portal_token_issued_at !== token.issued_at
    || referral.follow_up_requests?.portal_token_expires_at !== token.expires_at
  ) throw new PublicError(401, 'This link is no longer valid.');
  if (requireCurrentSnapshot) {
    const snapshotNow = currentSnapshot(referral, snapshot);
    if (!sameValue(snapshotNow, snapshot)) {
      throw new PublicError(409, 'This request changed. Please contact the agency for a new link.');
    }
  }
  return referral;
}

function publicPayload(token: Record<string, any>, snapshot: Record<string, any>, referral: Record<string, any>) {
  return {
    valid: true,
    patient_name: snapshot.patient_name,
    patient_dob: snapshot.patient_dob,
    referral_date: snapshot.referral_date,
    provider_name: snapshot.provider_name,
    request_status: referral.follow_up_requests?.status || 'sent',
    already_submitted: !!token.submitted_at,
    items: snapshot.items,
    expires_at: token.expires_at,
  };
}

Deno.serve(async (req) => {
  try {
    const token = await parseToken(req);
    const tokenHash = await sha256Hex(token);
    const base44 = createClientFromRequest(req);
    const entities = base44.asServiceRole.entities;
    const initial = await loadToken(entities, tokenHash);
    await validateTokenHashes(initial.row, initial.snapshot);
    if (Date.parse(initial.row.expires_at) <= Date.now()) {
      if (initial.row.is_active === true && initial.row.status === 'sent') {
        await entities.ProviderFollowUpToken.updateMany(
          {
            id: initial.row.id,
            token: tokenHash,
            version: initial.row.version,
            updated_date: initial.row.updated_date,
            is_active: true,
            status: 'sent',
          },
          { $set: { is_active: false, status: 'expired' }, $inc: { version: 1 } },
        ).catch(() => null);
      }
      throw new PublicError(401, 'This link has expired. Please contact the agency for a new one.');
    }
    if (initial.row.submitted_at) {
    if (
      initial.row.is_active !== false
      || initial.row.status !== 'delivered'
      || !validInstant(initial.row.submitted_at)
      || !exactIdentifier(initial.row.submission_id)
      || !/^[a-f0-9]{64}$/.test(String(initial.row.submitted_response_hash || ''))
      || !Number.isSafeInteger(initial.row.answered_count)
      || initial.row.answered_count < 1
      ) throw new PublicError(401, 'This link is no longer valid.');
      const referral = await loadBoundReferral(
        entities,
        initial.row,
        initial.snapshot,
        false,
      );
      if (
        !['received', 'resolved'].includes(referral.follow_up_requests?.status)
        || referral.follow_up_requests?.portal_submission_id !== initial.row.submission_id
        || referral.follow_up_requests?.portal_submission_hash !== initial.row.submitted_response_hash
        || referral.follow_up_requests?.portal_submitted_at !== initial.row.submitted_at
      ) throw new PublicError(401, 'This link is no longer valid.');
      return Response.json(
        publicPayload(initial.row, initial.snapshot, referral),
        { headers: NO_STORE_HEADERS },
      );
    }
    if (initial.row.is_active !== true || initial.row.status !== 'sent' || initial.row.submit_claimed_by) {
      throw new PublicError(401, 'This link is no longer valid.');
    }
    await loadBoundReferral(entities, initial.row, initial.snapshot, true);

    const accessedAt = new Date().toISOString();
    const accessUpdate = await entities.ProviderFollowUpToken.updateMany(
      {
        id: initial.row.id,
        token: tokenHash,
        version: initial.row.version,
        updated_date: initial.row.updated_date,
        is_active: true,
      },
      {
        $set: { last_accessed_at: accessedAt },
        $inc: { access_count: 1, version: 1 },
      },
    );
    if (
      !plainObject(accessUpdate)
      || accessUpdate.success !== true
      || accessUpdate.updated !== 1
      || accessUpdate.has_more !== false
    ) throw new PublicError(409, 'This link is already being used. Please retry.');

    const final = await loadToken(entities, tokenHash);
    await validateTokenHashes(final.row, final.snapshot);
    if (
      final.row.id !== initial.row.id
      || final.row.version !== initial.row.version + 1
      || final.row.access_count !== initial.row.access_count + 1
      || final.row.last_accessed_at !== accessedAt
      || final.row.is_active !== true
      || final.row.status !== 'sent'
      || !sameValue(final.snapshot, initial.snapshot)
    ) throw new PublicError(409, 'This link changed while opening. Please retry.');
    const referral = await loadBoundReferral(entities, final.row, final.snapshot, true);
    return Response.json(
      publicPayload(final.row, final.snapshot, referral),
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json(
        { valid: false, error: error.message },
        {
          status: error.status,
          headers: {
            ...NO_STORE_HEADERS,
            ...(error.status === 405 ? { Allow: 'POST' } : {}),
          },
        },
      );
    }
    console.error('validateFollowUpToken failed');
    return Response.json(
      { valid: false, error: 'Unable to validate this link.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
