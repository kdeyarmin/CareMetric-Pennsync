import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Scheduled, tenant-bound OCR and referral fax-back matcher. Every scan is
// agency scoped, every write is compare-and-set, and only an inbound row whose
// immutable Telnyx destination binding is still valid may reach OCR or a
// Referral. Provider media URLs stay on the service-only IncomingFax entity.

const FORM_MARKER = 'additional information request';
const MAX_BODY_BYTES = 10_000;
const MAX_IDENTIFIER_LENGTH = 300;
const MAX_AGENCY_SCAN = 1000;
const MAX_INCOMING_SCAN = 100;
const MAX_REFERRAL_SCAN = 5000;
const MAX_CANDIDATES = 250;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;
const NOTIFICATION_SCAN_LIMIT = 10;
const MAX_OCR_ATTEMPTS = 5;
const CLAIM_LEASE_MS = 15 * 60 * 1000;
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
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

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validHttpsUrl(value: unknown) {
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

function normalizeE164(value: unknown) {
  if (typeof value !== 'string' || value.length > 100) return null;
  const trimmed = value.trim();
  const digits = trimmed.replace(/[^\d]/g, '');
  if (trimmed.startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
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
    throw new PublicError(400, 'Invalid request body');
  }
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw new PublicError(413, 'Request body is too large');
  }
  let body: unknown;
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    throw new PublicError(400, 'Invalid request body');
  }
  if (!plainObject(body) || Object.keys(body).some((key) => key !== 'agency_id')) {
    throw new PublicError(400, 'Request body is invalid');
  }
  const agencyId = body.agency_id === undefined ? null : exactIdentifier(body.agency_id);
  if (body.agency_id !== undefined && !agencyId) throw new PublicError(400, 'agency_id is invalid');
  return { agencyId };
}

async function loadScheduledAgencyIds(entities: Record<string, any>) {
  const ids = new Set<string>();
  for (const status of ENABLED_AGENCY_STATUSES) {
    const rows = requireRows(
      await entities.Agency.filter({ status }, undefined, MAX_AGENCY_SCAN),
      'Agency.filter',
    );
    if (rows.length >= MAX_AGENCY_SCAN) throw new PublicError(409, 'Agency scan is incomplete');
    for (const row of rows) {
      const id = exactIdentifier(row?.id);
      if (!id || row.id !== id || row.status !== status || ids.has(id)) {
        throw new PublicError(409, 'Agency scan scope could not be verified');
      }
      ids.add(id);
    }
  }
  return [...ids].sort();
}

async function loadEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency scope is ambiguous');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0]?.status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

function validateIncomingFax(row: Record<string, any>, agencyId: string) {
  const id = exactIdentifier(row?.id);
  const bindingId = exactIdentifier(row?.ingress_binding_id);
  const integrationSecretId = exactIdentifier(row?.integration_secret_id);
  const telnyxFaxId = exactIdentifier(row?.telnyx_fax_id);
  const destination = normalizeE164(row?.received_to_number);
  const documentUrl = validHttpsUrl(row?.document_url);
  const bindingKey = destination && integrationSecretId
    ? `telnyx:${integrationSecretId}:${destination}`
    : null;
  if (
    !id
    || row.id !== id
    || row.agency_id !== agencyId
    || !bindingId
    || !integrationSecretId
    || !telnyxFaxId
    || !destination
    || row.received_to_number !== destination
    || !documentUrl
    || row.document_url !== documentUrl
    || row.ingress_binding_key !== bindingKey
    || !Number.isSafeInteger(row.ingress_binding_version)
    || row.ingress_binding_version < 1
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || !['pending', 'processing', 'completed'].includes(row.processing_status)
  ) throw new PublicError(409, 'Inbound fax integrity check failed');
  return row;
}

async function loadIngressAuthority(
  entities: Record<string, any>,
  fax: Record<string, any>,
) {
  const bindings = requireRows(
    await entities.TelecomDestinationBinding.filter(
      {
        id: fax.ingress_binding_id,
        agency_id: fax.agency_id,
        provider: 'telnyx',
        status: 'active',
      },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'TelecomDestinationBinding.filter',
  );
  if (bindings.length !== 1 || bindings.some((row) => (
    row?.id !== fax.ingress_binding_id
    || row?.agency_id !== fax.agency_id
    || row?.provider !== 'telnyx'
    || row?.status !== 'active'
  ))) throw new PublicError(409, 'Inbound fax binding is unavailable');
  const binding = bindings[0];
  const creatorEmail = canonicalEmail(binding.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(binding.last_transition_by_email_normalized);
  const transitionRequestId = exactIdentifier(binding.last_transition_request_id);
  const transitionReason = typeof binding.last_transition_reason === 'string'
    ? binding.last_transition_reason.trim()
    : '';
  const expectedTransitionKey = transitionRequestId
    ? `${binding.binding_key}:${transitionRequestId}`
    : null;
  const createdAt = Date.parse(binding.created_at || '');
  const activatedAt = Date.parse(binding.activated_at || '');
  const transitionedAt = Date.parse(binding.last_transition_at || '');
  const suspendedAt = binding.suspended_at == null ? null : Date.parse(binding.suspended_at);
  const initialActive = binding.last_transition_action === 'bind'
    && binding.version === 1
    && suspendedAt == null
    && createdAt === activatedAt
    && activatedAt === transitionedAt
    && binding.created_by_user_id === binding.last_transition_by_user_id
    && binding.created_by_user_email_normalized === binding.last_transition_by_email_normalized;
  const reactivated = binding.last_transition_action === 'activate'
    && Number.isSafeInteger(binding.version) && binding.version >= 2
    && Number.isFinite(suspendedAt)
    && createdAt <= suspendedAt && suspendedAt < activatedAt
    && activatedAt === transitionedAt;
  if (
    binding.binding_key !== fax.ingress_binding_key
    || binding.integration_secret_id !== fax.integration_secret_id
    || binding.destination_e164 !== fax.received_to_number
    || binding.fax_inbound_enabled !== true
    || typeof binding.sms_inbound_enabled !== 'boolean'
    || typeof binding.sms_outbound_enabled !== 'boolean'
    || typeof binding.voice_inbound_enabled !== 'boolean'
    || !exactIdentifier(binding.fax_connection_id)
    || !exactIdentifier(binding.provider_number_id)
    || !exactIdentifier(binding.phone_number_id)
    || !exactIdentifier(binding.created_by_user_id)
    || !creatorEmail
    || binding.created_by_user_email_normalized !== creatorEmail
    || !exactIdentifier(binding.last_transition_by_user_id)
    || !transitionEmail
    || binding.last_transition_by_email_normalized !== transitionEmail
    || !transitionRequestId
    || binding.last_transition_request_key !== expectedTransitionKey
    || !['manual', 'telnyx_purchase', 'legacy_backfill'].includes(binding.source)
    || (!initialActive && !reactivated)
    || !transitionReason
    || binding.last_transition_reason !== transitionReason
    || transitionReason.length > 500
    || !Number.isSafeInteger(binding.version)
    || binding.version < fax.ingress_binding_version
    || !Number.isFinite(createdAt)
    || !Number.isFinite(activatedAt)
    || !Number.isFinite(transitionedAt)
    || createdAt > activatedAt
    || activatedAt > transitionedAt
    || binding.revoked_at != null
    || binding.revocation_reason != null
  ) throw new PublicError(409, 'Inbound fax binding integrity check failed');

  const duplicateBindings = requireRows(
    await entities.TelecomDestinationBinding.filter(
      { binding_key: fax.ingress_binding_key, status: 'active' },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'TelecomDestinationBinding.filter',
  );
  if (duplicateBindings.length !== 1 || duplicateBindings[0]?.id !== binding.id) {
    throw new PublicError(409, 'Inbound fax binding identity is ambiguous');
  }

  const secrets = requireRows(
    await entities.IntegrationSecret.filter(
      { provider: 'telnyx', is_active: true },
      undefined,
      2,
    ),
    'IntegrationSecret.filter',
  );
  if (
    secrets.length !== 1
    || secrets[0]?.id !== fax.integration_secret_id
    || secrets[0]?.provider !== 'telnyx'
    || secrets[0]?.is_active !== true
    || secrets[0]?.fax_connection_id !== binding.fax_connection_id
  ) throw new PublicError(409, 'Inbound fax integration authority is unavailable');
  return binding;
}

function validateReferral(row: Record<string, any>, agencyId: string) {
  const id = exactIdentifier(row?.id);
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const requestId = exactIdentifier(row?.client_request_id);
  if (
    !id
    || row.id !== id
    || row.agency_id !== agencyId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || canonicalEmail(row.created_by) !== creatorEmail
    || !requestId
    || row.referral_creation_key !== `${agencyId}:${creatorId}:${requestId}`
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !validInstant(row.created_date)
    || !validInstant(row.updated_date)
    || row.archived_at != null
  ) throw new PublicError(409, 'Referral integrity check failed');
  return row;
}

async function loadExactReferral(
  entities: Record<string, any>,
  agencyId: string,
  referralId: string,
) {
  const rows = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (rows.length !== 1 || rows.some((row) => row?.id !== referralId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Referral changed during inbound fax processing');
  }
  return validateReferral(rows[0], agencyId);
}

async function loadFaxDestination(
  entities: Record<string, any>,
  referral: Record<string, any>,
) {
  const followUp = referral.follow_up_requests;
  const faxLogId = exactIdentifier(followUp?.fax_log_id);
  if (!faxLogId || followUp?.sent_via !== 'fax') return null;
  const rows = requireRows(
    await entities.FaxLog.filter(
      { id: faxLogId, agency_id: referral.agency_id, referral_id: referral.id },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'FaxLog.filter',
  );
  if (rows.length !== 1 || rows.some((row) => (
    row?.id !== faxLogId
    || row?.agency_id !== referral.agency_id
    || row?.referral_id !== referral.id
  ))) throw new PublicError(409, 'Referral fax provenance is unavailable');
  const faxLog = rows[0];
  const destination = normalizeE164(faxLog.to_number);
  if (
    !destination
    || faxLog.to_number !== destination
    || !exactIdentifier(faxLog.document_id)
    || !exactIdentifier(faxLog.sent_by_user_id)
    || !exactIdentifier(faxLog.sent_by_membership_id)
    || !Number.isSafeInteger(faxLog.sent_by_membership_version)
    || faxLog.sent_by_membership_version < 1
    || !['queued', 'sending', 'sent', 'delivered'].includes(faxLog.status)
  ) throw new PublicError(409, 'Referral fax provenance is invalid');
  return destination;
}

async function loadReferralScan(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Referral.filter(
      { agency_id: agencyId, archived_at: { $exists: false } },
      '-created_date',
      MAX_REFERRAL_SCAN,
    ),
    'Referral.filter',
  );
  if (rows.length >= MAX_REFERRAL_SCAN) throw new PublicError(409, 'Referral scan is incomplete');
  if (rows.some((row) => row?.agency_id !== agencyId || row?.archived_at != null)) {
    throw new PublicError(409, 'Referral scan scope could not be verified');
  }
  const eligible: Array<Record<string, any>> = [];
  const seen = new Set<string>();
  for (const row of rows) {
    let referral;
    try {
      referral = validateReferral(row, agencyId);
    } catch (error) {
      // Legacy same-tenant rows without immutable broker provenance remain
      // quarantined: they can never become a matching candidate, but one such
      // row must not poison the entire agency queue and strand newer referrals.
      if (!(error instanceof PublicError)) throw error;
      continue;
    }
    if (seen.has(referral.id)) throw new PublicError(409, 'Referral identity is ambiguous');
    seen.add(referral.id);
    eligible.push(referral);
  }
  return eligible;
}

async function buildCandidates(
  entities: Record<string, any>,
  referrals: Array<Record<string, any>>,
) {
  const candidates: Array<Record<string, any>> = [];
  for (const referral of referrals) {
    const followUp = referral.follow_up_requests;
    if (!plainObject(followUp) || followUp.status !== 'sent' || followUp.sent_via !== 'fax') continue;
    if (!validInstant(followUp.generated_at) || !Array.isArray(followUp.items)) {
      throw new PublicError(409, 'Referral follow-up integrity check failed');
    }
    if (candidates.length >= MAX_CANDIDATES) {
      throw new PublicError(409, 'Referral fax candidate scan is incomplete');
    }
    const sentToNumber = await loadFaxDestination(entities, referral);
    if (!sentToNumber) continue;
    candidates.push({
      referral,
      patientName: referral.patient_name || referral.extracted_data?.demographics?.full_name || '',
      patientDob: referral.patient_dob || referral.extracted_data?.demographics?.date_of_birth || '',
      providerName: referral.extracted_data?.demographics?.referring_physician || referral.referral_source || '',
      sentToNumber,
    });
  }
  return candidates;
}

const normText = (value: unknown) => String(value || '').toLowerCase().replace(/\s+/g, ' ');
const normName = (value: unknown) => String(value || '')
  .toLowerCase()
  .replace(/\bdr\.?\b/g, '')
  .replace(/[^a-z ]/g, '')
  .trim();

function nameInText(name: unknown, text: string) {
  const words = normName(name).split(' ').filter((word) => word.length > 1);
  if (words.length < 2) return false;
  const tokens = new Set(normName(text).split(' ').filter(Boolean));
  return words.every((word) => tokens.has(word));
}

function dobInText(dob: unknown, text: string) {
  const raw = String(dob || '').trim();
  const normalized = String(text || '').replace(/\s*([/-])\s*/g, '$1');
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return raw.length >= 8 && normalized.includes(raw);
  const [, year, month, day] = match;
  return [
    `${year}-${month}-${day}`,
    `${month}/${day}/${year}`,
    `${Number(month)}/${Number(day)}/${year}`,
    `${month}-${day}-${year}`,
  ].some((value) => normalized.includes(value));
}

function matchSignals(
  fax: { ocrText: string; senderNumber: string },
  candidate: Record<string, any>,
) {
  const text = normText(fax.ocrText);
  const sender = normalizeE164(fax.senderNumber);
  return {
    form_marker: text.includes(FORM_MARKER),
    patient_name: nameInText(candidate.patientName, text),
    patient_dob: dobInText(candidate.patientDob, text),
    sender_number: !!sender && sender === candidate.sentToNumber,
    provider_name: nameInText(candidate.providerName, text),
  };
}

function bestFaxBackMatch(
  fax: { ocrText: string; senderNumber: string },
  candidates: Array<Record<string, any>>,
) {
  let best: Record<string, any> | null = null;
  for (const candidate of candidates) {
    const signals = matchSignals(fax, candidate);
    const score = Object.values(signals).filter(Boolean).length;
    if (score === 0 || !(signals.patient_name || signals.patient_dob || signals.sender_number)) continue;
    const confident = signals.patient_name && score >= 2;
    if (!best || score > best.score) {
      best = { candidate, signals, score, confident, tied: false };
    } else if (score === best.score) {
      best = { ...best, confident: false, tied: true };
    }
  }
  return best;
}

function applyFaxAnswersToItems(
  items: Array<Record<string, any>>,
  answers: Array<Record<string, any>>,
  answeredAt: string,
) {
  const byId = new Map<string, string>();
  for (const answer of answers || []) {
    const id = exactIdentifier(answer?.id);
    const response = typeof answer?.response_text === 'string'
      ? answer.response_text.trim().slice(0, 4000)
      : '';
    if (id && answer?.answered === true && response) byId.set(id, response);
  }
  let answeredCount = 0;
  const merged = items.map((item) => {
    const response = byId.get(item?.id);
    if (!response || (item.item_status && item.item_status !== 'open')) return item;
    answeredCount += 1;
    return {
      ...item,
      item_status: 'answered',
      response: { text: response, source: 'fax' },
      answered_at: answeredAt,
    };
  });
  return { items: merged, answeredCount };
}

async function claimFax(
  entities: Record<string, any>,
  fax: Record<string, any>,
  runId: string,
) {
  if (
    fax.processing_status === 'processing'
    && validInstant(fax.claimed_at)
    && Date.parse(fax.claimed_at) > Date.now() - CLAIM_LEASE_MS
  ) return null;
  if (!['pending', 'processing'].includes(fax.processing_status)) return null;
  const claimedAt = new Date().toISOString();
  const result = await entities.IncomingFax.updateMany(
    {
      id: fax.id,
      agency_id: fax.agency_id,
      version: fax.version,
      updated_date: fax.updated_date,
      processing_status: fax.processing_status,
    },
    {
      $set: { processing_status: 'processing', claimed_by: runId, claimed_at: claimedAt },
      $inc: { version: 1 },
    },
  );
  if (!successfulSingleUpdate(result)) return null;
  const claimed = await loadExactIncomingFax(entities, fax.agency_id, fax.id);
  if (
    claimed.version !== fax.version + 1
    || claimed.processing_status !== 'processing'
    || claimed.claimed_by !== runId
    || claimed.claimed_at !== claimedAt
  ) throw new Error('Inbound fax claim failed post-write verification');
  return claimed;
}

async function loadExactIncomingFax(
  entities: Record<string, any>,
  agencyId: string,
  incomingFaxId: string,
) {
  const rows = requireRows(
    await entities.IncomingFax.filter(
      { id: incomingFaxId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'IncomingFax.filter',
  );
  if (rows.length !== 1 || rows.some((row) => (
    row?.id !== incomingFaxId || row?.agency_id !== agencyId
  ))) throw new PublicError(409, 'Inbound fax changed during processing');
  return validateIncomingFax(rows[0], agencyId);
}

async function conditionalFaxUpdate(
  entities: Record<string, any>,
  fax: Record<string, any>,
  fields: Record<string, any>,
) {
  const result = await entities.IncomingFax.updateMany(
    {
      id: fax.id,
      agency_id: fax.agency_id,
      version: fax.version,
      updated_date: fax.updated_date,
      processing_status: fax.processing_status,
      claimed_by: fax.claimed_by,
    },
    { $set: fields, $inc: { version: 1 } },
  );
  return successfulSingleUpdate(result);
}

async function releaseFailedOcr(entities: Record<string, any>, fax: Record<string, any>) {
  const attempts = (Number.isSafeInteger(fax.ocr_attempts) ? fax.ocr_attempts : 0) + 1;
  return conditionalFaxUpdate(entities, fax, {
    processing_status: attempts >= MAX_OCR_ATTEMPTS ? 'failed' : 'pending',
    claimed_by: null,
    claimed_at: null,
    ocr_attempts: attempts,
  });
}

async function releaseClaimForRetry(entities: Record<string, any>, fax: Record<string, any>) {
  return conditionalFaxUpdate(entities, fax, {
    processing_status: 'pending',
    claimed_by: null,
    claimed_at: null,
  });
}

async function runOcr(base44: Record<string, any>, fax: Record<string, any>) {
  return base44.asServiceRole.integrations.Core.InvokeLLM({
    model: 'automatic',
    prompt: 'Transcribe this received fax completely and accurately, including typed and handwritten text. Extract only the requested fields and do not infer missing values.',
    file_urls: [fax.document_url],
    response_json_schema: {
      type: 'object',
      properties: {
        full_text: { type: 'string' },
        patient_name: { type: 'string' },
        patient_dob: { type: 'string' },
        provider_name: { type: 'string' },
        summary: { type: 'string' },
      },
    },
  });
}

async function extractItemAnswers(
  base44: Record<string, any>,
  followUp: Record<string, any>,
  ocrText: string,
) {
  const openItems = followUp.items
    .filter((item: Record<string, any>) => (
      exactIdentifier(item?.id) && (!item.item_status || item.item_status === 'open')
    ))
    .map((item: Record<string, any>) => ({
      id: item.id,
      title: typeof item.title === 'string' ? item.title.slice(0, 300) : '',
      question: typeof item.provider_request?.question === 'string'
        ? item.provider_request.question.slice(0, 1000)
        : (typeof item.needed === 'string' ? item.needed.slice(0, 1000) : ''),
    }));
  if (!openItems.length) return { items: followUp.items, answeredCount: 0 };
  const extraction = await base44.asServiceRole.integrations.Core.InvokeLLM({
    model: 'automatic',
    prompt: `Determine which requested items were explicitly answered in this provider fax. Do not invent answers.\n\nREQUESTED ITEMS:\n${openItems.map((item: Record<string, any>, index: number) => `${index + 1}. id: ${item.id}\n${item.title}\n${item.question}`).join('\n')}\n\nFAX TEXT:\n${ocrText.slice(0, 30000)}`,
    response_json_schema: {
      type: 'object',
      properties: {
        answers: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              answered: { type: 'boolean' },
              response_text: { type: 'string' },
            },
          },
        },
      },
    },
  });
  return applyFaxAnswersToItems(
    followUp.items,
    Array.isArray(extraction?.answers) ? extraction.answers : [],
    new Date().toISOString(),
  );
}

async function conditionalReferralUpdate(
  entities: Record<string, any>,
  referral: Record<string, any>,
  followUp: Record<string, any>,
) {
  const result = await entities.Referral.updateMany(
    {
      id: referral.id,
      agency_id: referral.agency_id,
      version: referral.version,
      updated_date: referral.updated_date,
    },
    { $set: { follow_up_requests: followUp }, $inc: { version: 1 } },
  );
  return successfulSingleUpdate(result);
}

async function loadActiveRecipient(
  entities: Record<string, any>,
  referral: Record<string, any>,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { agency_id: referral.agency_id, user_id: referral.created_by_user_id },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT || rows.some((row) => (
    row?.agency_id !== referral.agency_id || row?.user_id !== referral.created_by_user_id
  ))) throw new PublicError(409, 'Notification recipient scope is ambiguous');
  if (rows.length !== 1) return null;
  const membership = rows[0];
  const email = canonicalEmail(membership.user_email_normalized);
  if (
    !exactIdentifier(membership.id)
    || membership.membership_key !== `${referral.agency_id}:${referral.created_by_user_id}`
    || email !== referral.created_by_user_email_normalized
    || membership.user_email_normalized !== email
    || !TENANT_ROLES.has(String(membership.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(String(membership.status || ''))
    || !exactIdentifier(membership.created_by_user_id)
    || !exactIdentifier(membership.last_transition_by_user_id)
    || canonicalEmail(membership.last_transition_by_email_normalized) !== membership.last_transition_by_email_normalized
    || !validInstant(membership.last_transition_at)
    || !Number.isSafeInteger(membership.version)
    || membership.version < 1
  ) throw new PublicError(409, 'Notification recipient integrity check failed');
  return membership.status === 'active' ? email : null;
}

function faxNotification(
  referral: Record<string, any>,
  incomingFaxId: string,
  recipient: string,
  kind: 'matched' | 'suggested',
) {
  const dedupeKey = `referral-fax-${kind}:${referral.agency_id}:${referral.id}:${incomingFaxId}`;
  return {
    agency_id: referral.agency_id,
    dedupe_key: dedupeKey,
    user_email: recipient,
    title: kind === 'matched'
      ? 'Provider fax response received'
      : 'Inbound fax may answer a provider request',
    message: kind === 'matched'
      ? 'An inbound fax was matched to a provider follow-up request. Review the returned document and extracted answers.'
      : 'An inbound fax may match a provider follow-up request. Review it before attaching it.',
    type: 'info',
    priority: kind === 'matched' ? 'medium' : 'high',
    metadata: {
      agency_id: referral.agency_id,
      related_entity: 'Referral',
      related_entity_id: referral.id,
      incoming_fax_id: incomingFaxId,
      workflow: `inbound_referral_fax_${kind}`,
    },
    is_read: false,
    action_url: `/ReferralFollowUp?id=${encodeURIComponent(referral.id)}`,
  };
}

async function ensureNotification(
  entities: Record<string, any>,
  referral: Record<string, any>,
  incomingFaxId: string,
  kind: 'matched' | 'suggested',
) {
  const recipient = await loadActiveRecipient(entities, referral);
  if (!recipient) return false;
  const expected = faxNotification(referral, incomingFaxId, recipient, kind);
  const query = {
    agency_id: expected.agency_id,
    dedupe_key: expected.dedupe_key,
    user_email: expected.user_email,
  };
  let rows = requireRows(
    await entities.Notification.filter(query, '-created_date', NOTIFICATION_SCAN_LIMIT),
    'Notification.filter',
  );
  if (rows.length >= NOTIFICATION_SCAN_LIMIT || rows.length > 1) {
    throw new PublicError(409, 'Inbound fax notification is ambiguous');
  }
  if (!rows.length) {
    await entities.Notification.create(expected);
    rows = requireRows(
      await entities.Notification.filter(query, '-created_date', NOTIFICATION_SCAN_LIMIT),
      'Notification.filter',
    );
  }
  if (rows.length !== 1 || Object.entries(expected).some(([key, value]) => (
    !sameValue(rows[0]?.[key], value)
  ))) throw new Error('Inbound fax notification failed verification');
  return true;
}

function attachedReferralForFax(
  referrals: Array<Record<string, any>>,
  incomingFaxId: string,
) {
  const matches = referrals.filter((referral) => (
    referral.follow_up_requests?.fax_back?.incoming_fax_id === incomingFaxId
  ));
  if (matches.length > 1) throw new PublicError(409, 'Inbound fax is attached ambiguously');
  return matches[0] || null;
}

function ocrFields(ocr: Record<string, any>, ocrText: string) {
  return {
    ocr_text: ocrText.slice(0, 50000),
    ai_summary: typeof ocr?.summary === 'string' ? ocr.summary.slice(0, 4000) : null,
    extracted_info: {
      patient_name: typeof ocr?.patient_name === 'string' ? ocr.patient_name.slice(0, 300) : null,
      patient_dob: typeof ocr?.patient_dob === 'string' ? ocr.patient_dob.slice(0, 100) : null,
      provider_name: typeof ocr?.provider_name === 'string' ? ocr.provider_name.slice(0, 300) : null,
    },
  };
}

async function finalizeFax(
  entities: Record<string, any>,
  fax: Record<string, any>,
  fields: Record<string, any>,
) {
  const finalized = await conditionalFaxUpdate(entities, fax, {
    processing_status: 'completed',
    claimed_by: null,
    claimed_at: null,
    ...fields,
  });
  if (!finalized) throw new Error('Inbound fax changed before finalization');
}

async function processClaimedFax(
  base44: Record<string, any>,
  faxSnapshot: Record<string, any>,
  referrals: Array<Record<string, any>>,
  candidates: Array<Record<string, any>>,
) {
  let ocr: Record<string, any>;
  try {
    ocr = await runOcr(base44, faxSnapshot);
  } catch {
    await releaseFailedOcr(base44.asServiceRole.entities, faxSnapshot);
    return { processed: 0, matched: 0, suggested: 0, failed: 1 };
  }
  const ocrText = typeof ocr?.full_text === 'string' ? ocr.full_text : '';
  const entities = base44.asServiceRole.entities;
  const fax = await loadExactIncomingFax(entities, faxSnapshot.agency_id, faxSnapshot.id);
  if (
    fax.version !== faxSnapshot.version
    || fax.updated_date !== faxSnapshot.updated_date
    || fax.processing_status !== 'processing'
    || fax.claimed_by !== faxSnapshot.claimed_by
    || fax.claimed_at !== faxSnapshot.claimed_at
  ) throw new PublicError(409, 'Inbound fax claim changed during OCR');
  await loadIngressAuthority(entities, fax);
  const attachedSnapshot = attachedReferralForFax(referrals, fax.id);
  if (attachedSnapshot) {
    const attached = await loadExactReferral(entities, fax.agency_id, attachedSnapshot.id);
    if (attached.follow_up_requests?.fax_back?.incoming_fax_id !== fax.id) {
      throw new PublicError(409, 'Referral fax attachment changed during reconciliation');
    }
    await ensureNotification(entities, attached, fax.id, 'matched');
    await finalizeFax(entities, fax, {
      ...ocrFields(ocr, ocrText),
      status: 'routed',
      routed_at: new Date().toISOString(),
      routed_to: `ReferralFollowUp:${attached.id}`,
      suggested_patient_id: attached.patient_id || null,
      suggested_referral_id: attached.id,
      ai_category: 'referral',
      notes: 'Matched to a provider follow-up request.',
      confidence_score: 100,
    });
    return { processed: 1, matched: 1, suggested: 0, failed: 0 };
  }

  const match = bestFaxBackMatch(
    { ocrText, senderNumber: fax.sender_fax_number || '' },
    candidates,
  );
  if (!match) {
    await finalizeFax(entities, fax, {
      ...ocrFields(ocr, ocrText),
      status: 'unread',
      ai_category: 'other',
      notes: 'No confident provider follow-up match was found.',
    });
    return { processed: 1, matched: 0, suggested: 0, failed: 0 };
  }

  const referralSnapshot = match.candidate.referral;
  const signalNames = Object.entries(match.signals)
    .filter(([, value]) => value)
    .map(([name]) => name);
  if (!match.confident) {
    const suggestedReferral = await loadExactReferral(
      entities,
      fax.agency_id,
      referralSnapshot.id,
    );
    if (!sameValue(suggestedReferral, referralSnapshot)) {
      throw new PublicError(409, 'Referral changed during inbound fax suggestion');
    }
    await ensureNotification(entities, suggestedReferral, fax.id, 'suggested');
    await finalizeFax(entities, fax, {
      ...ocrFields(ocr, ocrText),
      status: 'unread',
      ai_category: 'referral',
      suggested_routing: 'admin',
      suggested_referral_id: suggestedReferral.id,
      suggested_patient_id: suggestedReferral.patient_id || null,
      notes: match.tied
        ? 'Possible provider follow-up match is ambiguous; manual review is required.'
        : 'Possible provider follow-up match requires manual review.',
      confidence_score: Math.min(100, match.score * 20),
    });
    return { processed: 1, matched: 0, suggested: 1, failed: 0 };
  }

  const current = await loadExactReferral(entities, fax.agency_id, referralSnapshot.id);
  if (!sameValue(current, referralSnapshot)) {
    throw new PublicError(409, 'Referral follow-up changed during inbound fax processing');
  }
  const followUp = current.follow_up_requests;
  if (!plainObject(followUp) || followUp.status !== 'sent' || !Array.isArray(followUp.items)) {
    throw new PublicError(409, 'Referral follow-up is no longer eligible');
  }
  let merged = { items: followUp.items, answeredCount: 0 };
  try {
    merged = await extractItemAnswers(base44, followUp, ocrText);
  } catch {
    // Attachment remains useful if conservative per-item extraction fails.
  }
  // Item extraction is a second asynchronous provider boundary. The 15-minute
  // claim lease can expire, the agency can be disabled, or the receiving-number
  // binding can be suspended while that call is in flight. Re-read the exact
  // claim and every routing authority immediately before the Referral write;
  // otherwise an older worker could attach after a successor claimed the fax,
  // or after inbound authority was revoked.
  const preCommitFax = await loadExactIncomingFax(entities, fax.agency_id, fax.id);
  if (
    preCommitFax.version !== fax.version
    || preCommitFax.updated_date !== fax.updated_date
    || preCommitFax.processing_status !== 'processing'
    || preCommitFax.claimed_by !== fax.claimed_by
    || preCommitFax.claimed_at !== fax.claimed_at
  ) throw new PublicError(409, 'Inbound fax claim changed before referral attachment');
  await loadEnabledAgency(entities, fax.agency_id);
  await loadIngressAuthority(entities, preCommitFax);
  const receivedAt = new Date().toISOString();
  const nextFollowUp = {
    ...followUp,
    items: merged.items,
    status: 'received',
    received_at: receivedAt,
    portal_link_active: false,
    fax_back: {
      incoming_fax_id: fax.id,
      matched_signals: signalNames,
      auto_answered_count: merged.answeredCount,
    },
  };
  const committed = await conditionalReferralUpdate(entities, current, nextFollowUp);
  if (!committed) throw new PublicError(409, 'Referral changed during inbound fax processing');
  const updated = await loadExactReferral(entities, fax.agency_id, current.id);
  if (
    updated.version !== current.version + 1
    || !sameValue(updated.follow_up_requests, nextFollowUp)
    || Object.hasOwn(updated.follow_up_requests?.fax_back || {}, 'document_url')
  ) throw new Error('Referral fax-back update failed verification');
  await ensureNotification(entities, updated, fax.id, 'matched');
  await finalizeFax(entities, fax, {
    ...ocrFields(ocr, ocrText),
    status: 'routed',
    routed_at: receivedAt,
    routed_to: `ReferralFollowUp:${updated.id}`,
    suggested_patient_id: updated.patient_id || null,
    suggested_referral_id: updated.id,
    ai_category: 'referral',
    notes: 'Matched to a provider follow-up request.',
    confidence_score: Math.min(100, match.score * 20),
  });
  return { processed: 1, matched: 1, suggested: 0, failed: 0 };
}

async function processAgency(
  base44: Record<string, any>,
  agencyId: string,
  runId: string,
) {
  const entities = base44.asServiceRole.entities;
  await loadEnabledAgency(entities, agencyId);
  const pending = requireRows(
    await entities.IncomingFax.filter(
      { agency_id: agencyId, processing_status: 'pending' },
      '-received_at',
      MAX_INCOMING_SCAN,
    ),
    'IncomingFax.filter',
  );
  const processing = requireRows(
    await entities.IncomingFax.filter(
      { agency_id: agencyId, processing_status: 'processing' },
      '-received_at',
      MAX_INCOMING_SCAN,
    ),
    'IncomingFax.filter',
  );
  if (pending.length >= MAX_INCOMING_SCAN || processing.length >= MAX_INCOMING_SCAN) {
    throw new PublicError(409, 'Inbound fax scan is incomplete');
  }
  const rows: Array<Record<string, any>> = [...pending, ...processing];
  if (rows.some((row) => row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Inbound fax scan scope could not be verified');
  }
  const totals = { scanned: rows.length, processed: 0, matched: 0, suggested: 0, failed: 0 };
  if (!rows.length) return totals;
  const eligibleFaxes: Array<Record<string, any>> = [];
  for (const row of rows) {
    try {
      eligibleFaxes.push(validateIncomingFax(row, agencyId));
    } catch (error) {
      // As with legacy Referrals, exact-tenant IncomingFax rows that predate
      // immutable ingress provenance stay quarantined instead of blocking all
      // newer work. The agency scope check above still makes a foreign row a
      // hard failure rather than silently skipping a filter regression.
      if (!(error instanceof PublicError)) throw error;
      totals.failed += 1;
    }
  }
  if (!eligibleFaxes.length) return totals;
  const referrals = await loadReferralScan(entities, agencyId);
  const candidates = await buildCandidates(entities, referrals);
  const seen = new Set<string>();
  for (const fax of eligibleFaxes) {
    if (seen.has(fax.id)) throw new PublicError(409, 'Inbound fax scan returned duplicate rows');
    seen.add(fax.id);
    await loadIngressAuthority(entities, fax);
    const claimed = await claimFax(entities, fax, runId);
    if (!claimed) continue;
    try {
      const outcome = await processClaimedFax(base44, claimed, referrals, candidates);
      totals.processed += outcome.processed;
      totals.matched += outcome.matched;
      totals.suggested += outcome.suggested;
      totals.failed += outcome.failed;
    } catch (error) {
      await releaseClaimForRetry(entities, claimed).catch(() => false);
      if (error instanceof PublicError) throw error;
      totals.failed += 1;
    }
  }
  return totals;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const me = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, me);
    if (authError) {
      authError.headers.set('Cache-Control', 'no-store');
      return authError;
    }
    if (isDeactivatedUser(me)) {
      const response = DEACTIVATED_USER_RESPONSE();
      response.headers.set('Cache-Control', 'no-store');
      return response;
    }
    const { agencyId } = await parseInput(req);
    const entities = base44.asServiceRole.entities;
    const agencyIds = agencyId ? [agencyId] : await loadScheduledAgencyIds(entities);
    const runRoot = typeof globalThis.crypto?.randomUUID === 'function'
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}:${Math.random().toString(36).slice(2)}`;
    const totals = { scanned: 0, processed: 0, matched: 0, suggested: 0, failed: 0 };
    for (const scheduledAgencyId of agencyIds) {
      const result = await processAgency(
        base44,
        scheduledAgencyId,
        `inbound-referral-fax:${scheduledAgencyId}:${runRoot}`,
      );
      totals.scanned += result.scanned;
      totals.processed += result.processed;
      totals.matched += result.matched;
      totals.suggested += result.suggested;
      totals.failed += result.failed;
    }
    return Response.json({
      success: true,
      agency_id: agencyId,
      agencies_processed: agencyIds.length,
      ...totals,
    }, { headers: NO_STORE_HEADERS });
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
    console.error('processInboundFaxes failed');
    return Response.json(
      { success: false, error: 'Inbound fax processing failed' },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
});
