import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

const MAX_BODY_BYTES = 500_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_ITEMS = 100;
const MAX_RESPONSE_LENGTH = 4000;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const NOTIFICATION_SCAN_LIMIT = 10;
const CLAIM_LEASE_MS = 10 * 60 * 1000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);

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

function boundedReason(value: unknown) {
  return boundedText(value, 500, false);
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

function randomId() {
  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function successfulSingleUpdate(value: unknown) {
  return plainObject(value)
    && value.success === true
    && value.updated === 1
    && value.has_more === false;
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
    'token', 'responses', 'completed_by', 'credential',
  ].includes(key))) throw new PublicError(400, 'Invalid request');
  if (typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
    throw new PublicError(400, 'Token is invalid');
  }
  if (!Array.isArray(body.responses) || body.responses.length < 1 || body.responses.length > MAX_ITEMS) {
    throw new PublicError(400, 'At least one valid response is required');
  }
  const completedBy = boundedText(body.completed_by, 200, true);
  const credential = boundedText(body.credential, 50, true);
  if (completedBy === null || credential === null) throw new PublicError(400, 'Response attribution is invalid');
  const responses = body.responses.map((value: unknown) => {
    if (
      !plainObject(value)
      || Object.keys(value).sort().join('|') !== ['item_id', 'response_text'].sort().join('|')
    ) throw new PublicError(400, 'A response is invalid');
    const itemId = exactIdentifier(value.item_id);
    const responseText = boundedText(value.response_text, MAX_RESPONSE_LENGTH, false);
    if (!itemId || !responseText) throw new PublicError(400, 'A response is invalid');
    return { item_id: itemId, response_text: responseText };
  }).sort((left, right) => left.item_id.localeCompare(right.item_id));
  if (new Set(responses.map((response) => response.item_id)).size !== responses.length) {
    throw new PublicError(400, 'A response item was submitted more than once');
  }
  return {
    token: body.token,
    responses,
    completedBy,
    credential,
    responseHash: await sha256Hex({
      responses,
      completed_by: completedBy,
      credential,
    }),
  };
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
    const itemId = exactIdentifier(item.id);
    const title = boundedText(item.title, 300, true);
    const needed = boundedText(item.needed, 2000, true);
    const question = boundedText(providerRequest.question ?? needed, 2000, false);
    const hint = boundedText(providerRequest.hint, 1000, true);
    const why = boundedText(item.why, 2000, true);
    const citation = boundedText(item.citation, 500, true);
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
  const rows = requireRows(
    await entities.ProviderFollowUpToken.filter({ token: tokenHash }, undefined, EXACT_ROW_LIMIT),
    'ProviderFollowUpToken.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.length !== 1) {
    throw new PublicError(401, 'This link is no longer valid.');
  }
  const row = rows[0];
  const snapshot = validateStoredSnapshot(row.request_snapshot);
  const agencyId = exactIdentifier(row.agency_id);
  const referralId = exactIdentifier(row.referral_id);
  const issuedById = exactIdentifier(row.issued_by_user_id);
  const issuedByEmail = canonicalEmail(row.issued_by_user_email_normalized);
  const membershipId = exactIdentifier(row.issued_by_membership_id);
  const hasClaim = row.submit_claimed_by != null
    || row.submit_claimed_at != null
    || row.submit_claimed_response_hash != null;
  const validClaim = !hasClaim || (
    !!exactIdentifier(row.submit_claimed_by)
    && validInstant(row.submit_claimed_at)
    && /^[a-f0-9]{64}$/.test(String(row.submit_claimed_response_hash || ''))
  );
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
    || !validClaim
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
  const rows = requireRows(
    await entities.Referral.filter(
      { id: token.referral_id, agency_id: token.agency_id },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (
    rows.length >= EXACT_ROW_LIMIT
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
  if (requireCurrentSnapshot && !sameValue(currentSnapshot(referral, snapshot), snapshot)) {
    throw new PublicError(409, 'This request changed. Please contact the agency for a new link.');
  }
  return referral;
}

function validateResponseScope(
  snapshot: Record<string, any>,
  responses: Array<Record<string, string>>,
) {
  const items = new Map(snapshot.items.map((item: Record<string, any>) => [item.item_id, item]));
  for (const response of responses) {
    const item = items.get(response.item_id);
    if (!item || item.item_status !== 'open') {
      throw new PublicError(400, 'A response does not belong to an open item on this request');
    }
  }
}

function committedSubmission(referral: Record<string, any>, input: Record<string, any>) {
  const followUp = referral.follow_up_requests;
  const markerPresent = followUp?.portal_submission_id != null
    || followUp?.portal_submission_hash != null
    || followUp?.portal_submitted_at != null;
  if (!markerPresent) return null;
  const submissionId = exactIdentifier(followUp.portal_submission_id);
  if (
    !plainObject(followUp)
    || !submissionId
    || !/^[a-f0-9]{64}$/.test(String(followUp.portal_submission_hash || ''))
    || !validInstant(followUp.portal_submitted_at)
    || !['received', 'resolved'].includes(followUp.status)
  ) throw new PublicError(409, 'This request has an invalid submission state.');
  if (followUp.portal_submission_hash !== input.responseHash) {
    throw new PublicError(409, 'This request was already completed with a different response.');
  }
  if (!Array.isArray(followUp.items)) throw new PublicError(409, 'This request has an invalid submission state.');
  const itemMap = new Map(followUp.items.map((item: Record<string, any>) => [item?.id, item]));
  for (const submitted of input.responses) {
    const item = itemMap.get(submitted.item_id);
    if (
      !plainObject(item)
      || !['answered', 'resolved'].includes(item.item_status)
      || item.answered_at !== followUp.portal_submitted_at
      || !plainObject(item.response)
      || item.response.text !== submitted.response_text
      || item.response.completed_by !== input.completedBy
      || item.response.credential !== input.credential
      || item.response.submitted_via !== 'portal'
    ) throw new PublicError(409, 'This request has an invalid submission state.');
  }
  return { submissionId, submittedAt: followUp.portal_submitted_at };
}

async function claimToken(
  entities: Record<string, any>,
  tokenHash: string,
  initial: Record<string, any>,
  responseHash: string,
) {
  const claimId = randomId();
  const claimedAt = new Date().toISOString();
  const filter: Record<string, any> = {
    id: initial.id,
    token: tokenHash,
    version: initial.version,
    updated_date: initial.updated_date,
    is_active: true,
    status: 'sent',
  };
  if (initial.submit_claimed_by) {
    if (Date.parse(initial.submit_claimed_at) > Date.now() - CLAIM_LEASE_MS) {
      throw new PublicError(409, 'This request is already being submitted. Please retry.');
    }
    filter.submit_claimed_by = initial.submit_claimed_by;
    filter.submit_claimed_at = initial.submit_claimed_at;
    filter.submit_claimed_response_hash = initial.submit_claimed_response_hash;
  } else {
    filter.submit_claimed_by = { $exists: false };
  }
  const result = await entities.ProviderFollowUpToken.updateMany(
    filter,
    {
      $set: {
        submit_claimed_by: claimId,
        submit_claimed_at: claimedAt,
        submit_claimed_response_hash: responseHash,
      },
      $inc: { version: 1 },
    },
  );
  if (!successfulSingleUpdate(result)) {
    throw new PublicError(409, 'This request is already being submitted. Please retry.');
  }
  const claimed = await loadToken(entities, tokenHash);
  await validateTokenHashes(claimed.row, claimed.snapshot);
  if (
    claimed.row.id !== initial.id
    || claimed.row.version !== initial.version + 1
    || claimed.row.submit_claimed_by !== claimId
    || claimed.row.submit_claimed_at !== claimedAt
    || claimed.row.submit_claimed_response_hash !== responseHash
    || claimed.row.is_active !== true
    || claimed.row.status !== 'sent'
  ) throw new PublicError(409, 'This request changed during submission. Please retry.');
  return claimed;
}

async function releaseClaim(
  entities: Record<string, any>,
  tokenHash: string,
  claimId: string,
) {
  try {
    const current = await loadToken(entities, tokenHash);
    if (current.row.submit_claimed_by !== claimId || current.row.is_active !== true) return;
    await entities.ProviderFollowUpToken.updateMany(
      {
        id: current.row.id,
        token: tokenHash,
        version: current.row.version,
        updated_date: current.row.updated_date,
        is_active: true,
        submit_claimed_by: claimId,
      },
      {
        $unset: {
          submit_claimed_by: '',
          submit_claimed_at: '',
          submit_claimed_response_hash: '',
        },
        $inc: { version: 1 },
      },
    );
  } catch {
    // A short claim lease permits safe recovery if best-effort release fails.
  }
}

function answeredFollowUp(
  referral: Record<string, any>,
  input: Record<string, any>,
  submissionId: string,
  submittedAt: string,
) {
  const responses = new Map(input.responses.map((response: Record<string, string>) => [
    response.item_id,
    response.response_text,
  ]));
  return {
    ...referral.follow_up_requests,
    status: 'received',
    received_at: submittedAt,
    portal_link_active: false,
    portal_submission_id: submissionId,
    portal_submission_hash: input.responseHash,
    portal_submitted_at: submittedAt,
    items: referral.follow_up_requests.items.map((item: Record<string, any>) => {
      const responseText = responses.get(item.id);
      if (!responseText) return item;
      return {
        ...item,
        item_status: 'answered',
        response: {
          text: responseText,
          completed_by: input.completedBy,
          credential: input.credential,
          submitted_via: 'portal',
        },
        answered_at: submittedAt,
      };
    }),
  };
}

async function finalizeToken(
  entities: Record<string, any>,
  tokenHash: string,
  token: Record<string, any>,
  submissionId: string,
  responseHash: string,
  submittedAt: string,
  answeredCount: number,
) {
  const filter: Record<string, any> = {
    id: token.id,
    token: tokenHash,
    version: token.version,
    updated_date: token.updated_date,
    is_active: true,
    status: 'sent',
  };
  if (token.submit_claimed_by) {
    filter.submit_claimed_by = submissionId;
    filter.submit_claimed_response_hash = responseHash;
  }
  const result = await entities.ProviderFollowUpToken.updateMany(
    filter,
    {
      $set: {
        is_active: false,
        status: 'delivered',
        submission_id: submissionId,
        submitted_at: submittedAt,
        submitted_response_hash: responseHash,
        answered_count: answeredCount,
      },
      $unset: {
        submit_claimed_by: '',
        submit_claimed_at: '',
        submit_claimed_response_hash: '',
      },
      $inc: { version: 1 },
    },
  );
  if (!successfulSingleUpdate(result)) {
    throw new PublicError(503, 'Responses were received, but confirmation was interrupted. Please retry.');
  }
  const final = await loadToken(entities, tokenHash);
  await validateTokenHashes(final.row, final.snapshot);
  if (
    final.row.id !== token.id
    || final.row.version !== token.version + 1
    || final.row.is_active !== false
    || final.row.status !== 'delivered'
    || final.row.submission_id !== submissionId
    || final.row.submitted_at !== submittedAt
    || final.row.submitted_response_hash !== responseHash
    || final.row.answered_count !== answeredCount
    || final.row.submit_claimed_by != null
    || final.row.submit_claimed_at != null
    || final.row.submit_claimed_response_hash != null
  ) throw new PublicError(503, 'Responses were received, but confirmation was interrupted. Please retry.');
  return final.row;
}

async function loadActiveRecipient(
  entities: Record<string, any>,
  agencyId: string,
  userId: string,
  normalizedEmail: string,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (
    rows.length >= MEMBERSHIP_SCAN_LIMIT
    || rows.length !== 1
    || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)
  ) return null;
  const row = rows[0];
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = String(row.status || '');
  if (
    !exactIdentifier(row.id)
    || row.membership_key !== `${agencyId}:${userId}`
    || storedEmail !== normalizedEmail
    || row.user_email_normalized !== storedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (!validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)))
  ) return null;
  return status === 'active' ? row : null;
}

function notificationPayload(referral: Record<string, any>, token: Record<string, any>) {
  return {
    agency_id: token.agency_id,
    dedupe_key: `provider-follow-up:${token.agency_id}:${token.referral_id}:${token.id}`,
    user_email: referral.created_by_user_email_normalized,
    title: 'Provider follow-up response received',
    message: 'A provider submitted information for a referral follow-up request. Review the responses and resolve completed items.',
    type: 'info',
    priority: 'medium',
    metadata: {
      agency_id: token.agency_id,
      related_entity: 'Referral',
      related_entity_id: token.referral_id,
      workflow: 'provider_follow_up_response',
    },
    is_read: false,
    action_url: `/ReferralFollowUp?id=${encodeURIComponent(token.referral_id)}`,
  };
}

function notificationMatches(row: Record<string, any>, expected: Record<string, any>) {
  return row?.agency_id === expected.agency_id
    && row?.dedupe_key === expected.dedupe_key
    && canonicalEmail(row?.user_email) === expected.user_email
    && row?.title === expected.title
    && row?.message === expected.message
    && row?.type === expected.type
    && row?.priority === expected.priority
    && sameValue(row?.metadata, expected.metadata)
    && row?.is_read === false
    && row?.action_url === expected.action_url;
}

async function notifyRequester(
  entities: Record<string, any>,
  referral: Record<string, any>,
  token: Record<string, any>,
) {
  try {
    const recipient = await loadActiveRecipient(
      entities,
      token.agency_id,
      referral.created_by_user_id,
      referral.created_by_user_email_normalized,
    );
    if (!recipient) return false;
    const expected = notificationPayload(referral, token);
    const find = async () => {
      const rows = requireRows(
        await entities.Notification.filter(
          {
            agency_id: expected.agency_id,
            dedupe_key: expected.dedupe_key,
            user_email: expected.user_email,
          },
          '-created_date',
          NOTIFICATION_SCAN_LIMIT,
        ),
        'Notification.filter',
      );
      if (rows.length >= NOTIFICATION_SCAN_LIMIT || rows.length > 1) return null;
      if (rows.some((row) => !notificationMatches(row, expected))) return null;
      return rows[0] || false;
    };
    const existing = await find();
    if (existing) return true;
    if (existing === null) return false;
    await entities.Notification.create(expected);
    return !!(await find());
  } catch {
    return false;
  }
}

Deno.serve(async (req) => {
  let entities: Record<string, any> | null = null;
  let tokenHash = '';
  let acquiredClaimId: string | null = null;
  let referralCommitted = false;
  try {
    const input = await parseInput(req);
    tokenHash = await sha256Hex(input.token);
    const base44 = createClientFromRequest(req);
    entities = base44.asServiceRole.entities;
    let loaded = await loadToken(entities, tokenHash);
    await validateTokenHashes(loaded.row, loaded.snapshot);
    validateResponseScope(loaded.snapshot, input.responses);

    if (Date.parse(loaded.row.expires_at) <= Date.now()) {
      if (loaded.row.is_active === true) {
        await entities.ProviderFollowUpToken.updateMany(
          {
            id: loaded.row.id,
            token: tokenHash,
            version: loaded.row.version,
            updated_date: loaded.row.updated_date,
            is_active: true,
          },
          { $set: { is_active: false, status: 'expired' }, $inc: { version: 1 } },
        ).catch(() => null);
      }
      throw new PublicError(401, 'This link has expired. Please contact the agency for a new one.');
    }

    let referral = await loadBoundReferral(entities, loaded.row, loaded.snapshot, false);
    let committed = committedSubmission(referral, input);
    if (loaded.row.submitted_at) {
      if (
        loaded.row.is_active !== false
        || loaded.row.status !== 'delivered'
        || !validInstant(loaded.row.submitted_at)
        || loaded.row.submitted_at !== committed?.submittedAt
        || loaded.row.submission_id !== committed?.submissionId
        || loaded.row.submitted_response_hash !== input.responseHash
        || loaded.row.answered_count !== input.responses.length
      ) throw new PublicError(409, 'This request was already completed with a different response.');
      return Response.json(
        { success: true, answered: input.responses.length, already_submitted: true },
        { headers: NO_STORE_HEADERS },
      );
    }
    if (loaded.row.is_active !== true || loaded.row.status !== 'sent') {
      throw new PublicError(401, 'This link is no longer valid.');
    }

    if (committed) {
      const finalized = await finalizeToken(
        entities,
        tokenHash,
        loaded.row,
        committed.submissionId,
        input.responseHash,
        committed.submittedAt,
        input.responses.length,
      );
      const notified = await notifyRequester(entities, referral, finalized);
      return Response.json(
        { success: true, answered: input.responses.length, recovered: true, notified },
        { headers: NO_STORE_HEADERS },
      );
    }

    await loadBoundReferral(entities, loaded.row, loaded.snapshot, true);
    loaded = await claimToken(entities, tokenHash, loaded.row, input.responseHash);
    acquiredClaimId = loaded.row.submit_claimed_by;
    referral = await loadBoundReferral(entities, loaded.row, loaded.snapshot, true);
    committed = committedSubmission(referral, input);
    if (committed) {
      if (committed.submissionId !== acquiredClaimId) {
        throw new PublicError(409, 'This request changed during submission. Please retry.');
      }
    } else {
      const submittedAt = new Date().toISOString();
      const nextFollowUp = answeredFollowUp(
        referral,
        input,
        acquiredClaimId,
        submittedAt,
      );
      const update = await entities.Referral.updateMany(
        {
          id: referral.id,
          agency_id: referral.agency_id,
          version: referral.version,
          updated_date: referral.updated_date,
        },
        { $set: { follow_up_requests: nextFollowUp }, $inc: { version: 1 } },
      );
      if (!successfulSingleUpdate(update)) {
        throw new PublicError(409, 'This request changed during submission. Please retry.');
      }
      referralCommitted = true;
      referral = await loadBoundReferral(entities, loaded.row, loaded.snapshot, false);
      committed = committedSubmission(referral, input);
      if (!committed || committed.submissionId !== acquiredClaimId || committed.submittedAt !== submittedAt) {
        throw new PublicError(503, 'Responses were received, but confirmation was interrupted. Please retry.');
      }
    }

    referralCommitted = true;
    const finalized = await finalizeToken(
      entities,
      tokenHash,
      loaded.row,
      committed.submissionId,
      input.responseHash,
      committed.submittedAt,
      input.responses.length,
    );
    acquiredClaimId = null;
    const notified = await notifyRequester(entities, referral, finalized);
    return Response.json(
      { success: true, answered: input.responses.length, notified },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    if (entities && tokenHash && acquiredClaimId && !referralCommitted) {
      await releaseClaim(entities, tokenHash, acquiredClaimId);
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
    console.error('submitFollowUpResponse failed');
    return Response.json(
      { success: false, error: 'Unable to submit responses.' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
