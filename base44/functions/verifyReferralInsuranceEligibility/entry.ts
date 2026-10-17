import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>
/**
 * Office Ally insurance eligibility verification (270/271) for one Referral.
 * Design: docs — pennsync-office-ally-integration-design.md (D235), Phase 1.
 *
 * Broker-style authorized function: the caller is authenticated, agency scope
 * is derived from the caller's one exact active AgencyMembership (never from
 * request input), and the referral is re-read server-side — PHI inputs come
 * from the stored record, never from caller-supplied demographics. The
 * function RETURNS the normalized outcome (design §4.4) and never writes the
 * Referral: persistence is the client's broker call (`updateAuthorizedReferral`)
 * in Phase 2, which keeps exactly one referral write path.
 *
 * Expected conditions (not configured, unsupported payer, insufficient data,
 * member not found, payer unavailable, provider not enrolled) are typed
 * outcomes in an HTTP 200; non-200 is reserved for authority/contract
 * violations, as the other authorized functions do.
 *
 * D233 hard rule: a referral document's MRN is the SENDING facility's number,
 * never PennSync's. No identifier is ever read from an MRN field; the 270
 * search keys are payer member ID + name + DOB only.
 */

const TRIGGERS = new Set(['referral_analysis', 'manual_reverify']);
const INTAKE_ROLES = new Set(['agency_admin', 'manager', 'office_staff']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
// Stored outcomes with one of these statuses came from a payer answer, so the
// once-per-fingerprint guard (§4.2) may return them without re-spending a
// billable 270 transaction.
const PAYER_ANSWERED_STATUSES = new Set([
  'verified_active',
  'verified_inactive',
  'member_not_found',
]);

const MAX_BODY_BYTES = 1_000_000;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const MEMBERSHIP_SCAN_LIMIT = 100;

// ---------------------------------------------------------------------------
// Office Ally RestAPI client configuration.
//
// PLACEHOLDER VALUES — the exact RestAPI endpoint path and the API-key header
// name are confirmed during Realtime RestAPI EDI Submitter onboarding
// (design §2.2 / §6 item 1); the Swagger document is script-rendered and was
// not machine-readable when this was written. They are isolated here so
// onboarding changes exactly two constants. The configuration seam is
// fail-closed: without the API key AND the information-receiver identity the
// function answers `not_configured` and never calls out.
//
// Receiver identity is env config in Phase 1 (design §4.6 names AgencySettings
// as the eventual home): at current main neither AgencySettings nor Agency
// carries an NPI or legal-name field, so there is no server-side record to
// read it from yet. Phase 2 may move it onto AgencySettings with the entity
// change that adds `insurance_verification`.
// ---------------------------------------------------------------------------
const OFFICE_ALLY_API_URL = 'https://edi.officeally.io/api/eligibility';
const OFFICE_ALLY_API_KEY_HEADER = 'x-api-key';
const OFFICE_ALLY_TIMEOUT_MS = 30_000;
const OFFICE_ALLY_MAX_RESPONSE_BYTES = 256 * 1024;

// ---------------------------------------------------------------------------
// Payer directory (design §2.7 seed). Extracted payer names are normalized
// (lowercase, every non-alphanumeric stripped) before matching, so
// "SecurityBlue", "security blue" and "SECURITY-BLUE" are the same key.
// Unknown payers NEVER trigger a call — no payer ID is ever guessed.
// ---------------------------------------------------------------------------
const PAYER_DIRECTORY: Array<{
  payerId: string;
  payerName: string;
  alternatePayerId: string | null;
  matches: (normalized: string) => boolean;
}> = [
  {
    // SecurityBlue is Highmark's Medicare Advantage product in PA; there is
    // no payer literally named "SecurityBlue" on Office Ally's list, and
    // eligibility is inferred to route under Highmark Senior Health Company
    // (PA). Onboarding confirms whether the agency's enrollment is the
    // professional ID (SHCPAP, the default below) or the institutional ID
    // (SHCPAI, recorded as the alternate) — design §2.7 / §6 item 2.
    payerId: 'SHCPAP',
    payerName: 'Highmark Senior Health Company (PA)',
    alternatePayerId: 'SHCPAI',
    matches: (name) => name.includes('securityblue')
      || (name.includes('highmark') && name.includes('senior')),
  },
  {
    payerId: 'HHO',
    payerName: 'Highmark Health Options',
    alternatePayerId: null,
    matches: (name) => name.includes('highmarkhealthoptions'),
  },
  {
    payerId: '00246',
    payerName: 'BCBS Western New York (Highmark)',
    alternatePayerId: null,
    matches: (name) => name.includes('bcbs') && name.includes('westernnewyork'),
  },
  {
    payerId: '55204',
    payerName: 'Highmark Western and Northeastern New York',
    alternatePayerId: null,
    matches: (name) => name.includes('highmark')
      && (name.includes('westernnewyork') || name.includes('northeasternnewyork')),
  },
  {
    // Any other Highmark name ("Highmark BCBS", "Highmark Blue Shield", …)
    // resolves to the seeded PA Highmark eligibility route. This is a seed
    // to be corrected per product at onboarding (design §6 item 2), not a
    // claim that every Highmark product routes identically.
    payerId: 'SHCPAP',
    payerName: 'Highmark Senior Health Company (PA)',
    alternatePayerId: 'SHCPAI',
    matches: (name) => name.includes('highmark'),
  },
];

class PublicError extends Error {
  status: number;
  code: string | null;

  constructor(status: number, message: string, code: string | null = null) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
    this.code = code;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (
    !normalized
    || normalized.length > 320
    || !normalized.includes('@')
    || /\s/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (
    !value
    || value.length > MAX_IDENTIFIER_LENGTH
    || value.trim() !== value
    || value.startsWith('$')
    || /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function plainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
) {
  const allowedSet = new Set(allowed);
  if (Object.keys(value).some((key) => !allowedSet.has(key))) {
    throw new PublicError(400, `${label} contains unsupported fields`);
  }
}

async function parseRequest(req: Request) {
  const contentLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
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
  assertOnlyKeys(body, ['agency_id', 'referral_id', 'trigger'], 'Eligibility verification');
  const agencyId = exactIdentifier(body.agency_id);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  const referralId = exactIdentifier(body.referral_id);
  if (!referralId) throw new PublicError(400, 'referral_id is invalid');
  if (typeof body.trigger !== 'string' || !TRIGGERS.has(body.trigger)) {
    throw new PublicError(400, 'trigger is invalid');
  }
  return { agencyId, referralId, trigger: body.trigger };
}

// ---------------------------------------------------------------------------
// Authority — mirrors manageAuthorizedReferral: the caller's identity comes
// from `auth.me()` and tenant scope from the one exact active AgencyMembership
// for (user_id, agency_id), never from request input.
// ---------------------------------------------------------------------------

function validateMembershipRows(
  rawRows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rawRows.some((row) => row?.user_id !== userId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  if (rawRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (rawRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');
  const row = rawRows[0];
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  if (
    !exactIdentifier(row.id)
    || row.membership_key !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== normalizedEmail
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
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  if (!INTAKE_ROLES.has(String(row.tenant_role || ''))) {
    throw new PublicError(403, 'Tenant role cannot use Referral intake');
  }
  return row;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  if (rows.some((row) => row?.id !== agencyId)) {
    throw new PublicError(409, 'Agency query scope could not be verified');
  }
  if (rows.length !== 1 || !ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  user: Record<string, any>,
  agencyId: string,
) {
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden');
  const entities = base44.asServiceRole.entities;
  const memberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId, agency_id: agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateMembershipRows(memberships, userId, normalizedEmail, agencyId);
  await loadExactEnabledAgency(entities, agencyId);
  return { userId, normalizedEmail, agencyId, tenantRole: String(membership.tenant_role) };
}

async function loadExactReferral(
  entities: Record<string, any>,
  referralId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Referral.filter(
      { id: referralId, agency_id: agencyId },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Referral.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Referral is ambiguous');
  if (rows.some((row) => row?.id !== referralId || row?.agency_id !== agencyId)) {
    throw new PublicError(409, 'Referral query scope could not be verified');
  }
  if (rows.length !== 1) throw new PublicError(404, 'Referral unavailable');
  const row = rows[0];
  if (row.archived_at != null) throw new PublicError(404, 'Referral unavailable');
  return row;
}

// ---------------------------------------------------------------------------
// Defensive extraction of the 270 search keys from the stored referral
// (design §3.2). The live extraction schema does not rigidly pin the
// insurance sub-fields, so the member ID is read in the documented order —
// `insurance_details.primary.policy_number`, then `.member_id`, then the
// legacy `demographics.policy_numbers` string — and never guessed. The MBI
// is never substituted for the plan member ID, and no MRN field is read
// anywhere (D233).
// ---------------------------------------------------------------------------

function firstText(value: unknown, maxLength: number) {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const text = String(value).trim();
  if (!text || text.length > maxLength) return null;
  return text;
}

function normalizeDob(value: unknown) {
  const text = firstText(value, 32);
  if (!text) return null;
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const slash = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(text);
  if (iso) {
    year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]);
  } else if (slash) {
    month = Number(slash[1]); day = Number(slash[2]); year = Number(slash[3]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return null;
  }
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${year}-${pad(month)}-${pad(day)}`;
}

function parseFullName(fullName: string) {
  const text = fullName.replace(/\s+/g, ' ').trim();
  if (text.includes(',')) {
    const [last, rest] = text.split(',', 2);
    return { lastName: (last || '').trim(), firstName: (rest || '').trim().split(' ')[0] || '' };
  }
  const parts = text.split(' ').filter(Boolean);
  if (parts.length <= 1) return { lastName: parts[0] || '', firstName: '' };
  return { lastName: parts[parts.length - 1], firstName: parts.slice(0, -1).join(' ') };
}

function readExtractedInsurance(referral: Record<string, any>) {
  const extracted = plainObject(referral.extracted_data) ? referral.extracted_data : {};
  const demographics = plainObject(extracted.demographics) ? extracted.demographics : {};
  const details = plainObject(demographics.insurance_details)
    ? demographics.insurance_details
    : {};
  const primary = plainObject(details.primary) ? details.primary : {};
  const memberId = firstText(primary.policy_number, 64)
    || firstText(primary.member_id, 64)
    || firstText(demographics.policy_numbers, 64);
  const payerName = firstText(demographics.insurance_primary, 200)
    || firstText(primary.provider, 200)
    || firstText(primary.payer_name, 200);
  const fullName = firstText(demographics.full_name, 200)
    || firstText(referral.patient_name, 200);
  const dob = normalizeDob(demographics.date_of_birth ?? referral.patient_dob);
  return { memberId, payerName, fullName, dob };
}

function normalizePayerName(name: string) {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function resolvePayer(payerName: string | null) {
  if (!payerName) return null;
  const normalized = normalizePayerName(payerName);
  if (!normalized) return null;
  return PAYER_DIRECTORY.find((entry) => entry.matches(normalized)) || null;
}

function maskMemberId(memberId: string) {
  return `…${memberId.slice(-4)}`;
}

async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// Outcome object (design §4.4). Every outcome carries the full key set;
// fields the payer did not answer stay null — absent payer data is never
// estimated. `missing` is empty except on `insufficient_data` (§4.5: the
// outcome is stored with the missing-field list). The full member ID is
// never part of an outcome — only its last four characters are.
// ---------------------------------------------------------------------------

type Outcome = Record<string, any>;

function baseOutcome(trigger: string, attemptedAt: string, dateOfService: string): Outcome {
  return {
    status: 'error',
    provider: 'office_ally',
    trigger,
    attempted_at: attemptedAt,
    verified_at: null,
    payer_id: null,
    payer_name: null,
    plan_name: null,
    plan_type: null,
    member_id_masked: null,
    date_of_service: dateOfService,
    input_fingerprint: null,
    coverage: { active: null, effective_date: null, termination_date: null },
    benefits: {
      home_health: { copay: null, coinsurance_percent: null, visit_limit: null, notes: null },
      deductible: { individual_total: null, individual_remaining: null },
      prior_auth: 'unknown',
    },
    message: '',
    aaa_code: null,
    trace_id: null,
    attempts: 0,
    missing: [],
  };
}

function readConfig() {
  const apiKey = String(Deno.env.get('OFFICE_ALLY_API_KEY') || '').trim();
  const receiverName = String(Deno.env.get('OFFICE_ALLY_RECEIVER_NAME') || '').trim();
  const receiverNpi = String(Deno.env.get('OFFICE_ALLY_RECEIVER_NPI') || '').trim();
  const accountId = String(Deno.env.get('OFFICE_ALLY_ACCOUNT_ID') || '').trim();
  if (!apiKey || !receiverName || !receiverNpi) return null;
  return { apiKey, receiverName, receiverNpi, accountId: accountId || null };
}

// ---------------------------------------------------------------------------
// JSON 270 builder. The shape below is the JSON-X12 structure the parser and
// fixtures are written against; the exact RestAPI envelope is confirmed at
// onboarding (design §6 item 1) and changes stay inside this section and the
// parser. EQ service types 30 (Health Benefit Plan Coverage) and 42 (Home
// Health Care) are both requested so home-health benefit lines come back
// when the payer supports service-type-specific responses (design §2.5).
// ---------------------------------------------------------------------------

function buildEligibilityRequest(input: {
  payer: { payerId: string; payerName: string };
  config: { receiverName: string; receiverNpi: string; accountId: string | null };
  memberId: string;
  fullName: string;
  dob: string;
  dateOfService: string;
}) {
  const { lastName, firstName } = parseFullName(input.fullName);
  return {
    transactionSetIdentifierCode: '270',
    ...(input.config.accountId ? { submitterAccountId: input.config.accountId } : {}),
    informationSource: {
      entityType: 'payer',
      payerId: input.payer.payerId,
      organizationName: input.payer.payerName,
    },
    informationReceiver: {
      entityType: 'provider',
      organizationName: input.config.receiverName,
      npi: input.config.receiverNpi,
    },
    subscriber: {
      memberId: input.memberId,
      lastName,
      firstName,
      dateOfBirth: input.dob.replace(/-/g, ''),
      dateOfService: input.dateOfService,
      serviceTypeCodes: ['30', '42'],
    },
  };
}

async function readBoundedText(response: Response) {
  const reader = typeof response.body?.getReader === 'function'
    ? response.body.getReader()
    : null;
  if (!reader) {
    const text = await response.text();
    return {
      text,
      tooLarge: new TextEncoder().encode(text).byteLength > OFFICE_ALLY_MAX_RESPONSE_BYTES,
    };
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > OFFICE_ALLY_MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => {});
      return { text: '', tooLarge: true };
    }
    chunks.push(value);
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { text: new TextDecoder().decode(merged), tooLarge: false };
}

// ---------------------------------------------------------------------------
// JSON 271 parser → outcome fields. Fixture shape (design §5 Phase 1):
//
//   { transactionSetIdentifierCode: '271', traceId,
//     informationSource: { payerId, organizationName },
//     subscriber: {
//       memberId,
//       aaa: [{ level: 'source' | 'receiver' | 'subscriber',
//               validRequestIndicator: 'Y' | 'N', actionCode }],
//       benefits: [{ eligibilityOrBenefitInformationCode, serviceTypeCode,
//                    coverageLevelCode, planName, planType,
//                    startDate, endDate, amount, remainingAmount, percent,
//                    quantityQualifier, quantity,
//                    authorizationOrCertificationIndicator, messages: [] }],
//     } }
//
// EB01 codes used: '1'–'4' active coverage variants, '6'–'8' inactive
// variants, 'A' co-insurance, 'B' co-payment, 'C' deductible, 'D' benefit
// description. AAA03 mapping (design §2.4 / §4.5): a receiver-level (2100B)
// AAA means the payer does not recognize the agency NPI → provider_not_enrolled;
// '42'/'80' → payer_unavailable; any other subscriber-level (2100C) AAA →
// member_not_found.
// ---------------------------------------------------------------------------

const ACTIVE_EB_CODES = new Set(['1', '2', '3', '4']);
const INACTIVE_EB_CODES = new Set(['6', '7', '8']);

function ebText(value: unknown) {
  return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
}

function ebAmount(value: unknown) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

function ebDate(value: unknown) {
  const text = ebText(value);
  if (!text) return null;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(text);
  const candidate = compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : text;
  return normalizeDob(candidate);
}

function collectAaa(parsed: Record<string, any>) {
  const subscriber = plainObject(parsed.subscriber) ? parsed.subscriber : {};
  const lists = [
    ...(Array.isArray(parsed.aaa) ? parsed.aaa : []),
    ...(Array.isArray(subscriber.aaa) ? subscriber.aaa : []),
  ];
  return lists
    .filter((entry) => plainObject(entry))
    .map((entry) => ({
      level: ebText(entry.level) || 'subscriber',
      actionCode: ebText(entry.actionCode),
      validRequestIndicator: ebText(entry.validRequestIndicator),
    }))
    .filter((entry) => entry.actionCode);
}

function extractTraceId(parsed: Record<string, any>, response: Response) {
  const candidate = ebText(parsed.traceId)
    || ebText(parsed.controlNumber)
    || ebText(parsed.transactionControlNumber)
    || ebText(response.headers.get('x-trace-id'));
  return candidate ? candidate.slice(0, 128) : null;
}

function isAcknowledgment(parsed: Record<string, any>) {
  const setId = ebText(parsed.transactionSetIdentifierCode);
  return setId === '999'
    || setId === 'TA1'
    || plainObject(parsed.functionalAcknowledgment)
    || plainObject(parsed.interchangeAcknowledgment);
}

function parse271(parsed: Record<string, any>) {
  const subscriber = plainObject(parsed.subscriber) ? parsed.subscriber : null;
  const benefits = subscriber && Array.isArray(subscriber.benefits)
    ? subscriber.benefits.filter((entry: unknown) => plainObject(entry))
    : [];
  const aaa = collectAaa(parsed);

  if (aaa.length > 0) {
    const receiverAaa = aaa.find((entry) => entry.level === 'receiver');
    if (receiverAaa) {
      return { status: 'provider_not_enrolled', answered: true, aaa_code: receiverAaa.actionCode };
    }
    const unavailable = aaa.find((entry) => entry.actionCode === '42' || entry.actionCode === '80');
    if (unavailable) {
      return { status: 'payer_unavailable', answered: true, aaa_code: unavailable.actionCode };
    }
    const subscriberAaa = aaa.find((entry) => entry.level === 'subscriber');
    if (subscriberAaa) {
      return { status: 'member_not_found', answered: true, aaa_code: subscriberAaa.actionCode };
    }
    return { status: 'error', answered: false, aaa_code: aaa[0].actionCode };
  }

  if (!subscriber || benefits.length === 0) return null;

  const byServiceType = (code: string) => benefits.filter(
    (entry: Record<string, any>) => ebText(entry.serviceTypeCode) === code,
  );
  const stc30 = byServiceType('30');
  const stc42 = byServiceType('42');
  const statusEntry = (codes: Set<string>) => stc30.find(
    (entry: Record<string, any>) => codes.has(ebText(entry.eligibilityOrBenefitInformationCode)),
  ) || benefits.find(
    (entry: Record<string, any>) => codes.has(ebText(entry.eligibilityOrBenefitInformationCode)),
  ) || null;
  const activeEntry = statusEntry(ACTIVE_EB_CODES);
  const inactiveEntry = activeEntry ? null : statusEntry(INACTIVE_EB_CODES);
  const coverageEntry = activeEntry || inactiveEntry;
  if (!coverageEntry) return null;

  const firstWith = (entries: Array<Record<string, any>>, field: string) => {
    const found = entries.find((entry) => ebText(entry[field]));
    return found ? ebText(found[field]).slice(0, 200) : null;
  };

  // Home-health benefits come ONLY from STC-42 lines (design §2.5): a
  // generic STC-30 copay must never be presented as the home-health copay.
  const homeHealth = { copay: null as number | null, coinsurance_percent: null as number | null, visit_limit: null as number | null, notes: null as string | null };
  const copayEntry = stc42.find(
    (entry: Record<string, any>) => ebText(entry.eligibilityOrBenefitInformationCode) === 'B',
  );
  if (copayEntry) homeHealth.copay = ebAmount(copayEntry.amount);
  const coinsuranceEntry = stc42.find(
    (entry: Record<string, any>) => ebText(entry.eligibilityOrBenefitInformationCode) === 'A',
  );
  if (coinsuranceEntry) {
    const percent = ebAmount(coinsuranceEntry.percent);
    if (percent !== null) {
      // X12 EB08 is a fraction (0.20 = 20%); values above 1 are already in
      // percent units. Stored in percent units either way.
      homeHealth.coinsurance_percent = percent <= 1
        ? Math.round(percent * 10000) / 100
        : percent;
    }
  }
  const visitEntry = stc42.find(
    (entry: Record<string, any>) => ebText(entry.quantityQualifier) === 'VS'
      && ebAmount(entry.quantity) !== null,
  );
  if (visitEntry) homeHealth.visit_limit = ebAmount(visitEntry.quantity);
  const noteParts = stc42.flatMap((entry: Record<string, any>) => (
    Array.isArray(entry.messages)
      ? entry.messages.filter((message: unknown) => typeof message === 'string')
      : []
  ));
  if (noteParts.length > 0) homeHealth.notes = noteParts.join('; ').slice(0, 500);

  // Deductible comes from STC-30 lines: EB 'C' carries the total in `amount`
  // and the not-yet-met remainder in `remainingAmount` when the payer
  // returns it; a missing remainder stays null, never derived.
  const deductible = { individual_total: null as number | null, individual_remaining: null as number | null };
  const deductibleEntry = stc30.find(
    (entry: Record<string, any>) => ebText(entry.eligibilityOrBenefitInformationCode) === 'C',
  );
  if (deductibleEntry) {
    deductible.individual_total = ebAmount(deductibleEntry.amount);
    deductible.individual_remaining = ebAmount(deductibleEntry.remainingAmount);
  }

  // Prior auth: 'required' or 'not_required' ONLY on an explicit EB11
  // indicator on a home-health (42) or plan-coverage (30) line; anything
  // else stays 'unknown' and is never presented as "no auth needed" (§2.5).
  const authEntries = [...stc42, ...stc30];
  let priorAuth: 'required' | 'not_required' | 'unknown' = 'unknown';
  if (authEntries.some((entry) => ebText(entry.authorizationOrCertificationIndicator) === 'Y')) {
    priorAuth = 'required';
  } else if (
    authEntries.some((entry) => ebText(entry.authorizationOrCertificationIndicator) === 'N')
  ) {
    priorAuth = 'not_required';
  }

  return {
    status: activeEntry ? 'verified_active' : 'verified_inactive',
    answered: true,
    aaa_code: null,
    plan_name: ebText(coverageEntry.planName).slice(0, 200)
      || firstWith(benefits, 'planName'),
    plan_type: ebText(coverageEntry.planType).slice(0, 200)
      || firstWith(benefits, 'planType'),
    coverage: {
      active: !!activeEntry,
      effective_date: ebDate(coverageEntry.startDate ?? coverageEntry.effectiveDate),
      termination_date: ebDate(coverageEntry.endDate ?? coverageEntry.terminationDate),
    },
    benefits: { home_health: homeHealth, deductible, prior_auth: priorAuth },
  };
}

const STATUS_MESSAGES: Record<string, string> = {
  verified_inactive: 'Coverage is inactive or terminated for this member.',
  member_not_found: 'The payer has no member matching the submitted ID, name, and date of birth.',
  payer_unavailable: 'The payer could not answer right now — re-verify later.',
  provider_not_enrolled: 'The agency is not enrolled for eligibility with this payer — contact the agency admin.',
  payer_unsupported: 'Eligibility checks are not available for this payer yet — verify coverage manually.',
  insufficient_data: 'Information needed to verify eligibility is missing from the referral.',
  not_configured: 'Office Ally eligibility verification is not configured.',
  error: 'The eligibility check failed — give the trace ID to support.',
};

function outcomeMessage(status: string, outcome: Outcome) {
  if (status === 'verified_active') {
    return `Coverage active — ${outcome.plan_name || outcome.payer_name || 'plan confirmed'}.`;
  }
  return STATUS_MESSAGES[status] || STATUS_MESSAGES.error;
}

// ---------------------------------------------------------------------------
// Verification flow. Order matters:
//   1. Defensive extraction — an unusable search key is `insufficient_data`
//      before anything is spent or guessed.
//   2. Payer resolution — an unknown payer is never called.
//   3. Fingerprint guard (§4.2) — a stored payer-answered outcome for the
//      same (payer, member, DOB) is returned unchanged on analysis
//      reprocessing; it costs nothing and needs no configuration.
//   4. Configuration seam — a new call without full configuration is a
//      silent `not_configured` skip.
//   5. Exactly one 270. No automatic resubmission, ever (§4.5): AAA-error
//      271s are billable transactions, so retries are a staff decision via
//      the manual re-verify trigger.
// ---------------------------------------------------------------------------

async function verifyEligibility(
  entities: Record<string, any>,
  input: { agencyId: string; referralId: string; trigger: string },
) {
  const referral = await loadExactReferral(entities, input.referralId, input.agencyId);
  const attemptedAt = new Date().toISOString();
  const outcome = baseOutcome(input.trigger, attemptedAt, attemptedAt.slice(0, 10));

  const stored = plainObject(referral.insurance_verification)
    ? referral.insurance_verification
    : null;
  const priorAttempts = stored
    && Number.isSafeInteger(stored.attempts)
    && Number(stored.attempts) >= 0
    ? Number(stored.attempts)
    : 0;
  outcome.attempts = priorAttempts;

  const extracted = readExtractedInsurance(referral);
  if (extracted.payerName) outcome.payer_name = extracted.payerName;
  if (extracted.memberId) outcome.member_id_masked = maskMemberId(extracted.memberId);

  const missing: string[] = [];
  if (!extracted.memberId) missing.push('member_id');
  if (!extracted.fullName) missing.push('patient_name');
  if (!extracted.dob) missing.push('date_of_birth');
  if (missing.length > 0) {
    outcome.status = 'insufficient_data';
    outcome.missing = missing;
    outcome.message = `Missing information needed to verify eligibility: ${missing.join(', ')}.`;
    return outcome;
  }

  const payer = resolvePayer(extracted.payerName);
  if (!payer) {
    outcome.status = 'payer_unsupported';
    outcome.message = outcomeMessage('payer_unsupported', outcome);
    return outcome;
  }
  outcome.payer_id = payer.payerId;
  outcome.payer_name = payer.payerName;
  outcome.input_fingerprint = await sha256Hex(
    `${payer.payerId}|${extracted.memberId}|${extracted.dob}`,
  );

  if (
    input.trigger === 'referral_analysis'
    && stored
    && stored.input_fingerprint === outcome.input_fingerprint
    && PAYER_ANSWERED_STATUSES.has(String(stored.status))
  ) {
    return stored;
  }

  const config = readConfig();
  if (!config) {
    outcome.status = 'not_configured';
    outcome.message = outcomeMessage('not_configured', outcome);
    return outcome;
  }

  outcome.attempts = priorAttempts + 1;
  const requestBody = buildEligibilityRequest({
    payer,
    config,
    memberId: String(extracted.memberId),
    fullName: String(extracted.fullName),
    dob: String(extracted.dob),
    dateOfService: outcome.date_of_service,
  });

  let response: Response;
  try {
    response = await fetch(OFFICE_ALLY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // D232: Deno's fetch rejects redirect:'error'; 'manual' plus the
        // !ok refusal below means a 3xx is never followed and the API key
        // is never re-sent to a redirect target.
        [OFFICE_ALLY_API_KEY_HEADER]: config.apiKey,
      },
      body: JSON.stringify(requestBody),
      redirect: 'manual',
      signal: AbortSignal.timeout(OFFICE_ALLY_TIMEOUT_MS),
    });
  } catch {
    // Timeout or transport failure: the payer never answered. Retryable by
    // staff via manual re-verify; never resubmitted automatically.
    outcome.status = 'payer_unavailable';
    outcome.message = outcomeMessage('payer_unavailable', outcome);
    return outcome;
  }

  const read = await readBoundedText(response).catch(() => ({ text: '', tooLarge: false }));
  if (read.tooLarge) {
    outcome.status = 'error';
    outcome.message = outcomeMessage('error', outcome);
    console.error('verifyReferralInsuranceEligibility outcome: error (oversized response)');
    return outcome;
  }

  if (!response.ok) {
    // Includes every 3xx under redirect:'manual' — refused, never followed.
    outcome.status = 'error';
    outcome.message = outcomeMessage('error', outcome);
    console.error(
      `verifyReferralInsuranceEligibility outcome: error (http ${response.status})`,
    );
    return outcome;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    parsed = null;
  }
  if (!plainObject(parsed) || isAcknowledgment(parsed)) {
    // A 999/TA1 acknowledgment or an unparseable body is our defect class:
    // logged loudly with whatever trace identifier can be recovered, never
    // retried automatically. No PHI is ever logged.
    outcome.status = 'error';
    if (plainObject(parsed)) outcome.trace_id = extractTraceId(parsed, response);
    outcome.message = outcomeMessage('error', outcome);
    console.error(
      `verifyReferralInsuranceEligibility outcome: error trace: ${outcome.trace_id || 'none'}`,
    );
    return outcome;
  }

  outcome.trace_id = extractTraceId(parsed, response);
  const result = parse271(parsed);
  if (!result) {
    outcome.status = 'error';
    outcome.message = outcomeMessage('error', outcome);
    console.error(
      `verifyReferralInsuranceEligibility outcome: error trace: ${outcome.trace_id || 'none'}`,
    );
    return outcome;
  }

  outcome.status = result.status;
  if (result.answered) outcome.verified_at = new Date().toISOString();
  if (result.aaa_code) outcome.aaa_code = result.aaa_code;
  if (result.plan_name !== undefined) outcome.plan_name = result.plan_name || null;
  if (result.plan_type !== undefined) outcome.plan_type = result.plan_type || null;
  if (result.coverage) outcome.coverage = result.coverage;
  if (result.benefits) outcome.benefits = result.benefits;
  outcome.message = outcomeMessage(result.status, outcome);
  if (result.status === 'error') {
    console.error(
      `verifyReferralInsuranceEligibility outcome: error trace: ${outcome.trace_id || 'none'}`,
    );
  }
  return outcome;
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }
    const input = await parseRequest(req);
    const base44 = createClientFromRequest(
      userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID),
    );
    const user = await base44.auth.me().catch(() => null);
    if (!user) throw new PublicError(401, 'Unauthorized');
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (
      (user.role !== 'user' && user.role !== 'admin')
      || user.disabled === true
      || user.is_service === true
      || user.is_verified === false
    ) {
      throw new PublicError(403, 'Forbidden');
    }
    await loadAuthority(base44, user, input.agencyId);
    const verification = await verifyEligibility(base44.asServiceRole.entities, input);
    return Response.json({ success: true, verification });
  } catch (error) {
    if (error instanceof PublicError) {
      console.error(`verifyReferralInsuranceEligibility failed: ${error.status} ${error.message}`);
      return Response.json(
        { error: error.message, ...(error.code ? { code: error.code } : {}) },
        { status: error.status },
      );
    }
    // Provider errors may contain predicates or PHI; never log the object.
    console.error(
      `verifyReferralInsuranceEligibility failed: 500 ${error instanceof Error ? error.name : 'unknown'}`,
    );
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
