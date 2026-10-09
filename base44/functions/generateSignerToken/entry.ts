import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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

/**
 * Authority-bound signer-token issuer (released 2026-10-08, owner decision).
 *
 * Mints one single-purpose bearer link for one signer of one package, stores
 * only its SHA-256, caps its lifetime at 168 hours and at every package and
 * document deadline, and emails it to the signer address recorded when the
 * request was created — never to a caller-supplied address. The plaintext
 * link is never returned to the requester.
 *
 * Who may issue: the built-in administrator, or an exact active
 * AgencyMembership in the package's agency WITH chart access to the package's
 * patient (agency_admin/manager there, the chart's creator, or an active
 * PatientCareTeamAssignment) — the same rule that admitted the request's
 * creation. `rotate: true` revokes the signer's current unexpired link first
 * (a reminder that supersedes the old link); a link that is mid-submission or
 * whose delivery is unreconciled still blocks a new one.
 */
const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const MAX_PACKAGE_DOCUMENTS = 25;
const CHART_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);

class PublicError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_IDENTIFIER_LENGTH
      || value.trim() !== value || value.startsWith('$')
      || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) {
    return null;
  }
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > 320 || !email.includes('@') || /\s/.test(email)) return null;
  return email;
}

// <<<BEGIN SHARED HELPER: signatureFileAndDeadline — generated, edit base44/_shared/backendHelpers.mjs>>>
function isPrivateFileUri(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/\s/.test(value) && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    && (value.startsWith('private/') || value.startsWith('private://')
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}

function dueDateEnd(value) {
  if (typeof value !== 'string') return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (!dateOnly && !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const calendar = value.slice(0, 10);
  const calendarMillis = Date.parse(calendar + 'T00:00:00.000Z');
  if (!Number.isFinite(calendarMillis) || new Date(calendarMillis).toISOString().slice(0, 10) !== calendar) return null;
  const millis = Date.parse(dateOnly ? value + 'T23:59:59.999Z' : value);
  return Number.isFinite(millis) ? millis : null;
}
// <<<END SHARED HELPER: signatureFileAndDeadline>>>

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function successfulSingleUpdate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.success === true && result.updated === 1 && result.has_more === false;
}

function htmlEscape(value: unknown) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const length = Number(req.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  const raw = await req.text().catch(() => { throw new PublicError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new PublicError(400, 'Request body must be an object');
  const record = body as Record<string, unknown>;
  const allowed = new Set(['agency_id', 'package_id', 'signer_id', 'expires_in_hours', 'request_id', 'rotate']);
  if (Object.keys(record).some((key) => !allowed.has(key))) throw new PublicError(400, 'Request contains unsupported fields');
  const agencyId = exactIdentifier(record.agency_id);
  const packageId = exactIdentifier(record.package_id);
  const signerId = exactIdentifier(record.signer_id);
  const requestId = exactIdentifier(record.request_id);
  const hours = record.expires_in_hours == null ? 72 : Number(record.expires_in_hours);
  if (!agencyId || !packageId || !signerId || !requestId) throw new PublicError(400, 'Exact agency, package, signer, and request ids are required');
  if (!Number.isSafeInteger(hours) || hours < 1 || hours > 168) throw new PublicError(400, 'expires_in_hours must be an integer from 1 through 168');
  if (record.rotate != null && typeof record.rotate !== 'boolean') throw new PublicError(400, 'rotate must be a boolean');
  return { agencyId, packageId, signerId, requestId, hours, rotate: record.rotate === true };
}

// The built-in administrator (the platform tier) may issue for any agency;
// it is recorded as `platform_owner` and never borrows a tenant membership.
function isProtectedPlatformOwner(user: Record<string, any>) {
  return user?.role === 'admin';
}

// Chart access to the package's patient, decided from the membership and the
// care-team assignment — never from a self-editable profile field.
async function assertIssuerChartAccess(
  entities: Record<string, any>,
  authority: Record<string, any>,
  agencyId: string,
  patientId: string,
) {
  if (authority.snapshot.tenant_role === 'platform_owner') return;
  if (CHART_WIDE_ROLES.has(String(authority.membership?.tenant_role || ''))) return;
  const patients = requireRows(await entities.Patient.filter(
    { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false }, undefined, EXACT_ROW_LIMIT,
  ), 'Patient.filter');
  if (patients.length !== 1 || patients[0]?.id !== patientId || patients[0]?.agency_id !== agencyId) {
    throw new PublicError(404, 'Signature package unavailable');
  }
  if (exactIdentifier(patients[0].created_by_user_id) && patients[0].created_by_user_id === authority.userId) return;
  const assignments = requireRows(await entities.PatientCareTeamAssignment.filter(
    { agency_id: agencyId, patient_id: patientId, user_id: authority.userId, status: 'active' }, undefined, 2,
  ), 'PatientCareTeamAssignment.filter');
  if (assignments.some((row) => row?.agency_id === agencyId && row?.patient_id === patientId
    && row?.user_id === authority.userId && row?.status === 'active')) return;
  // Same answer as a missing package: never confirm a chart the caller cannot open.
  throw new PublicError(404, 'Signature package unavailable');
}

function validateMembership(row: Record<string, any>, actor: Record<string, any>, agencyId: string) {
  const id = exactIdentifier(row?.id);
  const email = canonicalEmail(row?.user_email_normalized);
  if (!id || row.agency_id !== agencyId || row.user_id !== actor.userId
      || row.membership_key !== `${agencyId}:${actor.userId}`
      || !email || email !== actor.email || row.user_email_normalized !== email
      || !TENANT_ROLES.has(String(row.tenant_role || ''))
      || !MEMBERSHIP_STATUSES.has(String(row.status || ''))
      || row.status !== 'active' || !Number.isSafeInteger(row.version) || row.version < 1
      || !validInstant(row.activated_at)) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return row;
}

async function loadAuthority(base44: Record<string, any>, agencyId: string, expected: unknown = null) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (user.is_active === false || user.disabled === true || user.is_service === true || user.is_verified === false) {
    throw new PublicError(403, 'Forbidden');
  }
  const userId = exactIdentifier(user.id);
  const email = canonicalEmail(user.email);
  if (!userId || !email) throw new PublicError(403, 'Forbidden');
  const entities = base44.asServiceRole.entities;
  const platformOwner = isProtectedPlatformOwner(user);
  let membership = null;
  if (!platformOwner) {
    if (user.role !== 'user') throw new PublicError(403, 'Forbidden');
    const rows = requireRows(await entities.AgencyMembership.filter(
      { agency_id: agencyId, user_id: userId }, '-updated_date', EXACT_ROW_LIMIT,
    ), 'AgencyMembership.filter');
    if (rows.length >= EXACT_ROW_LIMIT || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== userId)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    if (rows.length !== 1) throw new PublicError(403, 'No active membership for agency');
    membership = validateMembership(rows[0], { userId, email }, agencyId);
  }
  const agencies = requireRows(await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT), 'Agency.filter');
  if (agencies.length !== 1 || agencies.some((row) => row?.id !== agencyId)
      || !ENABLED_AGENCY_STATUSES.has(String(agencies[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  const snapshot = {
    user_id: userId,
    user_email: email,
    tenant_role: platformOwner ? 'platform_owner' : membership.tenant_role,
    membership_id: membership?.id ?? null,
    membership_version: membership?.version ?? null,
    agency_id: agencyId,
    agency_status: agencies[0].status,
  };
  if (expected && !sameValue(snapshot, expected)) throw new PublicError(409, 'Signer-token authority changed during request');
  return { entities, userId, email, membership, snapshot };
}

function validateCanonicalSigner(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicError(409, 'Signer authority is invalid');
  const signer = raw as Record<string, any>;
  const signerId = exactIdentifier(signer.signer_id);
  const email = canonicalEmail(signer.email);
  if (!signerId || !email || signer.email !== email || typeof signer.signer_name !== 'string'
      || !signer.signer_name.trim() || signer.signer_name.length > 200
      || !['patient', 'caregiver', 'legal_representative', 'witness', 'provider'].includes(signer.signer_role)
      || signer.required !== true || !['pending', 'completed', 'declined'].includes(signer.status)
      || signer.signature_data != null || signer.ip_address != null || signer.device_info != null) {
    throw new PublicError(409, 'Signer authority is invalid');
  }
  if (signer.status === 'completed' && (!validInstant(signer.signed_at)
      || !exactIdentifier(signer.signature_artifact_id) || !exactDigest(signer.signature_sha256)
      || !exactIdentifier(signer.agreement_version))) {
    throw new PublicError(409, 'Signer completion integrity is invalid');
  }
  if (signer.status !== 'completed' && (signer.signed_at != null || signer.signature_artifact_id != null
      || signer.signature_sha256 != null || signer.agreement_version != null)) {
    throw new PublicError(409, 'Signer completion integrity is invalid');
  }
  return { ...signer, signer_id: signerId, email };
}

async function loadPackageSnapshot(entities: Record<string, any>, input: Record<string, any>) {
  const packages = requireRows(await entities.DocumentPackage.filter(
    { id: input.packageId, agency_id: input.agencyId }, undefined, EXACT_ROW_LIMIT,
  ), 'DocumentPackage.filter');
  if (packages.length !== 1 || packages.some((row) => row?.id !== input.packageId || row?.agency_id !== input.agencyId)) {
    throw new PublicError(404, 'Signature package unavailable');
  }
  const pkg = packages[0];
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const membershipId = exactIdentifier(pkg.creator_membership_id);
  const documentIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  if (!patientId || !creatorId || !creatorEmail || pkg.created_by_user_email_normalized !== creatorEmail
      || !membershipId || !Number.isSafeInteger(pkg.creator_membership_version) || pkg.creator_membership_version < 1
      || !exactDigest(pkg.package_key) || !exactIdentifier(pkg.client_request_id)
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || (pkg.token_issue_claimed_by != null && (!exactIdentifier(pkg.token_issue_claimed_by)
        || !exactIdentifier(pkg.token_issue_request_id) || !validInstant(pkg.token_issue_claimed_at)))
      || documentIds.length < 1 || documentIds.length > MAX_PACKAGE_DOCUMENTS || documentIds.includes(null)
      || new Set(documentIds).size !== documentIds.length || pkg.signer_id !== input.signerId
      || !canonicalEmail(pkg.signer_email) || pkg.signer_email !== canonicalEmail(pkg.signer_email)
      || !['pending', 'in_progress'].includes(pkg.status)) {
    throw new PublicError(409, 'Signature package integrity check failed');
  }
  const patients = requireRows(await entities.Patient.filter(
    { id: patientId, agency_id: input.agencyId, is_sample: false, is_archived: false }, undefined, EXACT_ROW_LIMIT,
  ), 'Patient.filter');
  if (patients.length !== 1 || patients.some((row) => row?.id !== patientId || row?.agency_id !== input.agencyId)) {
    throw new PublicError(409, 'Signature package patient authority is invalid');
  }
  const creatorMemberships = requireRows(await entities.AgencyMembership.filter(
    { id: membershipId, agency_id: input.agencyId, user_id: creatorId }, undefined, EXACT_ROW_LIMIT,
  ), 'AgencyMembership.filter');
  if (creatorMemberships.length !== 1 || creatorMemberships[0].status !== 'active'
      || creatorMemberships[0].version !== pkg.creator_membership_version
      || canonicalEmail(creatorMemberships[0].user_email_normalized) !== creatorEmail) {
    throw new PublicError(409, 'Signature package creator authority is no longer valid');
  }
  const signatures: Array<Record<string, any>> = [];
  let pendingForSigner = 0;
  // Only stored deadlines enter the snapshot: a clock-relative cap here would
  // differ between the initial and the re-proved snapshot and refuse every
  // issuance whose deadline is more than 168 hours away. The 168-hour cap is
  // applied once, at mint time.
  let maxTokenExpiry = Number.POSITIVE_INFINITY;
  if (pkg.due_date != null) {
    const packageDue = dueDateEnd(pkg.due_date);
    if (packageDue === null) throw new PublicError(409, 'Signature package deadline is invalid');
    maxTokenExpiry = Math.min(maxTokenExpiry, packageDue);
  }
  for (const deadline of [pkg.expires_at, pkg.expiration_date]) {
    if (deadline == null) continue;
    if (!validInstant(deadline)) throw new PublicError(409, 'Signature package deadline is invalid');
    maxTokenExpiry = Math.min(maxTokenExpiry, Date.parse(deadline));
  }
  for (const documentId of documentIds as string[]) {
    const rows = requireRows(await entities.DocumentSignature.filter(
      { id: documentId, agency_id: input.agencyId }, undefined, EXACT_ROW_LIMIT,
    ), 'DocumentSignature.filter');
    if (rows.length !== 1 || rows[0]?.id !== documentId || rows[0]?.agency_id !== input.agencyId) {
      throw new PublicError(409, 'Signature document authority is invalid');
    }
    const signature = rows[0];
    const signers = Array.isArray(signature.signers) ? signature.signers.map(validateCanonicalSigner) : [];
    if (signers.length < 1 || new Set(signers.map((candidate) => candidate.signer_id)).size !== signers.length) {
      throw new PublicError(409, 'Signature signer roster is invalid');
    }
    const signer = signers.find((candidate) => candidate.signer_id === input.signerId);
    // A document already sealed for every signer stays in the package; the
    // signer's link simply has nothing left to do on it.
    const sealed = signature.status === 'completed' && signature.workflow_status === 'completed'
      && signer?.status === 'completed' && exactIdentifier(signature.signed_document_id) !== null;
    if (!signer || signer.email !== canonicalEmail(pkg.signer_email)
        || signer.signer_name !== pkg.signer_name
        || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
        || canonicalEmail(signature.created_by_user_email_normalized) !== creatorEmail
        || signature.creator_membership_id !== membershipId
        || signature.creator_membership_version !== pkg.creator_membership_version
        || !exactIdentifier(signature.document_id) || !exactIdentifier(signature.document_binding_id)
        || signature.document_binding_version !== 2 || !exactDigest(signature.document_content_sha256)
        || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
        || (!sealed && (!['pending', 'in_progress'].includes(signature.status)
          || !['pending', 'partial', 'signatures_collected'].includes(signature.workflow_status)
          || signature.completed_date != null || signature.completed_at != null))
        || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
      throw new PublicError(409, 'Signature document integrity check failed');
    }
    if (signer.status === 'pending') pendingForSigner += 1;
    if (signature.due_date != null) {
      const due = dueDateEnd(signature.due_date);
      if (due === null) throw new PublicError(409, 'Signature document deadline is invalid');
      maxTokenExpiry = Math.min(maxTokenExpiry, due);
    }
    for (const deadline of [signature.expires_at, signature.expiration_date]) {
      if (deadline == null) continue;
      if (!validInstant(deadline)) throw new PublicError(409, 'Signature document deadline is invalid');
      maxTokenExpiry = Math.min(maxTokenExpiry, Date.parse(deadline));
    }
    const bindings = requireRows(await entities.DocumentTenantBinding.filter(
      { id: signature.document_binding_id, agency_id: input.agencyId, document_id: signature.document_id },
      undefined, EXACT_ROW_LIMIT,
    ), 'DocumentTenantBinding.filter');
    if (bindings.length !== 1 || bindings[0]?.id !== signature.document_binding_id
        || bindings[0].storage_mode !== 'private' || bindings[0].version !== 2
        || bindings[0].patient_id !== patientId
        || bindings[0].content_sha256 !== signature.document_content_sha256
        || typeof bindings[0].file_uri !== 'string'
        || !isPrivateFileUri(bindings[0].file_uri)) {
      throw new PublicError(409, 'Signature source-document binding is invalid');
    }
    signatures.push({
      id: signature.id,
      authority_version: signature.authority_version,
      document_id: signature.document_id,
      document_binding_id: signature.document_binding_id,
      document_content_sha256: signature.document_content_sha256,
      status: signature.status,
      signer_status: signer.status,
      due_date: signature.due_date ?? null,
      expires_at: signature.expires_at ?? null,
      expiration_date: signature.expiration_date ?? null,
    });
  }
  if (pendingForSigner === 0) throw new PublicError(409, 'Signer has no pending documents');
  if (maxTokenExpiry <= Date.now()) throw new PublicError(409, 'Signature package has expired');
  return {
    package: {
      id: pkg.id, agency_id: pkg.agency_id, patient_id: patientId,
      authority_version: pkg.authority_version, status: pkg.status,
      signer_id: pkg.signer_id, signer_email: canonicalEmail(pkg.signer_email),
      signer_name: pkg.signer_name, document_signatures: documentIds,
      created_by_user_id: creatorId, creator_membership_id: membershipId,
      creator_membership_version: pkg.creator_membership_version,
      due_date: pkg.due_date ?? null,
      expires_at: pkg.expires_at ?? null, expiration_date: pkg.expiration_date ?? null,
      max_token_expires_at: Number.isFinite(maxTokenExpiry) ? new Date(maxTokenExpiry).toISOString() : null,
      token_issue_claimed_by: pkg.token_issue_claimed_by ?? null,
      token_issue_claimed_at: pkg.token_issue_claimed_at ?? null,
      token_issue_request_id: pkg.token_issue_request_id ?? null,
    },
    signatures,
  };
}

function generateToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signerPortalOrigin() {
  const raw = String(Deno.env.get('APP_PUBLIC_URL') || '').trim();
  let url: URL;
  try { url = new URL(raw); } catch { throw new PublicError(503, 'Signer portal is not configured (APP_PUBLIC_URL must be an https origin)'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new PublicError(503, 'Signer portal is not configured (APP_PUBLIC_URL must be an https origin)');
  }
  return url.origin;
}

Deno.serve(async (req) => {
  let cleanupEntities: Record<string, any> | null = null;
  let packageClaim: Record<string, any> | null = null;
  let createdToken: Record<string, any> | null = null;
  let externalStarted = false;
  try {
    if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    // Authenticate before the body names any agency, package or signer.
    const caller = await base44.auth.me().catch(() => null);
    if (!caller) throw new PublicError(401, 'Unauthorized');
    const input = await parseRequest(req);
    const portalOrigin = signerPortalOrigin();
    const initialAuthority = await loadAuthority(base44, input.agencyId);
    cleanupEntities = initialAuthority.entities;
    const initialPackage = await loadPackageSnapshot(initialAuthority.entities, input);
    await assertIssuerChartAccess(initialAuthority.entities, initialAuthority, input.agencyId, initialPackage.package.patient_id);
    if (!outboundDeliveryReleased()) return outboundDeliveryPausedResponse('email');
    const duplicate = requireRows(await initialAuthority.entities.DocumentPackageToken.filter(
      { agency_id: input.agencyId, package_id: input.packageId, signer_id: input.signerId, token_request_id: input.requestId },
      '-created_date', EXACT_ROW_LIMIT,
    ), 'DocumentPackageToken.filter');
    if (duplicate.length > 1) throw new PublicError(409, 'Signer-token request identity is ambiguous');
    if (duplicate.length === 1) {
      const prior = duplicate[0];
      if (!exactIdentifier(prior.id) || !validInstant(prior.expires_at)
          || !['delivery_pending', 'delivery_indeterminate', 'delivery_rejected', 'active', 'claimed', 'consumed', 'revoked', 'expired'].includes(prior.status)) {
        throw new PublicError(409, 'Signer-token request history is invalid');
      }
      return Response.json({
        success: prior.status === 'active', idempotent: true, token_id: prior.id,
        package_id: input.packageId, signer_id: input.signerId,
        status: prior.status, delivery_state: prior.delivery_state ?? null,
        expires_at: prior.expires_at, requires_reconciliation: prior.status === 'delivery_indeterminate',
      }, { status: prior.status === 'delivery_indeterminate' ? 202 : 200,
        headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
    }
    const capabilityTokens = requireRows(await initialAuthority.entities.DocumentPackageToken.filter(
      { agency_id: input.agencyId, package_id: input.packageId, signer_id: input.signerId },
      '-created_date', EXACT_ROW_LIMIT,
    ), 'DocumentPackageToken.filter');
    if (capabilityTokens.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Signer-token history requires review');
    for (const candidate of capabilityTokens) {
      if (!['active', 'claimed', 'delivery_pending', 'delivery_indeterminate'].includes(candidate.status)) continue;
      if (!exactIdentifier(candidate.id) || !validInstant(candidate.expires_at)
          || !Number.isSafeInteger(candidate.authority_version) || candidate.authority_version < 1) {
        throw new PublicError(409, 'Signer-token identity is invalid');
      }
      if (candidate.status === 'active' && Date.now() < Date.parse(candidate.expires_at) && input.rotate) {
        // A reminder supersedes the signer's current link: revoke it first so
        // two live bearer links never exist for one signer.
        const revokedAt = new Date().toISOString();
        const revoked = await initialAuthority.entities.DocumentPackageToken.updateMany(
          { id: candidate.id, status: 'active', authority_version: candidate.authority_version },
          { $set: { status: 'revoked', is_active: false, revoked_at: revokedAt,
            authority_version: candidate.authority_version + 1 } },
        );
        if (!successfulSingleUpdate(revoked)) throw new PublicError(409, 'Active signer link changed during rotation');
        await initialAuthority.entities.SignatureAuditEvent.create({
          event_key: await sha256(`token_revoked\0${candidate.id}\0${input.requestId}`),
          agency_id: input.agencyId, package_id: input.packageId, signer_id: input.signerId,
          token_id: candidate.id, action: 'token_revoked', actor_type: 'authenticated_user',
          actor_user_id: initialAuthority.userId,
          membership_id: initialAuthority.membership?.id ?? null,
          membership_version: initialAuthority.membership?.version ?? null,
          request_id: input.requestId, authority_version: candidate.authority_version + 1, occurred_at: revokedAt,
        });
        continue;
      }
      if (candidate.status === 'active' && Date.now() < Date.parse(candidate.expires_at)) {
        throw new PublicError(409, 'This signer already has an active link; send a reminder to replace it');
      }
      if (candidate.status !== 'active') {
        throw new PublicError(409, 'A signer link is mid-submission or its delivery requires reconciliation');
      }
      const expired = await initialAuthority.entities.DocumentPackageToken.updateMany(
        { id: candidate.id, status: 'active', authority_version: candidate.authority_version },
        { $set: { status: 'expired', is_active: false, authority_version: candidate.authority_version + 1 } },
      );
      if (!successfulSingleUpdate(expired)) throw new PublicError(409, 'Active signer token changed during expiry reconciliation');
    }

    const existingClaim = initialPackage.package.token_issue_claimed_by;
    if (existingClaim && Date.parse(initialPackage.package.token_issue_claimed_at) > Date.now() - 5 * 60 * 1000) {
      throw new PublicError(409, 'Signer-token issuance is already in progress');
    }
    const claimId = crypto.randomUUID();
    const claimedAt = new Date().toISOString();
    const claimFilter: Record<string, any> = {
      id: input.packageId, agency_id: input.agencyId,
      status: initialPackage.package.status,
      authority_version: initialPackage.package.authority_version,
    };
    if (existingClaim) {
      claimFilter.token_issue_claimed_by = existingClaim;
      claimFilter.token_issue_claimed_at = initialPackage.package.token_issue_claimed_at;
      claimFilter.token_issue_request_id = initialPackage.package.token_issue_request_id;
    }
    const claimResult = await initialAuthority.entities.DocumentPackage.updateMany(claimFilter, {
      $set: { token_issue_claimed_by: claimId, token_issue_claimed_at: claimedAt,
        token_issue_request_id: input.requestId,
        authority_version: initialPackage.package.authority_version + 1 },
    });
    if (!successfulSingleUpdate(claimResult)) throw new PublicError(409, 'Signer-token issuance changed concurrently');
    packageClaim = { id: input.packageId, agencyId: input.agencyId, claimId,
      requestId: input.requestId, version: initialPackage.package.authority_version + 1 };

    const finalAuthority = await loadAuthority(base44, input.agencyId, initialAuthority.snapshot);
    const finalPackage = await loadPackageSnapshot(finalAuthority.entities, input);
    const expectedClaimedPackage = {
      ...initialPackage,
      package: { ...initialPackage.package,
        authority_version: initialPackage.package.authority_version + 1,
        token_issue_claimed_by: claimId, token_issue_claimed_at: claimedAt,
        token_issue_request_id: input.requestId },
    };
    if (!sameValue(expectedClaimedPackage, finalPackage)) {
      throw new PublicError(409, 'Signature package changed during token issuance');
    }

    const plaintext = generateToken();
    const tokenDigest = await sha256(plaintext);
    const now = new Date();
    const expiresAt = new Date(Math.min(
      now.getTime() + input.hours * 60 * 60 * 1000,
      finalPackage.package.max_token_expires_at == null
        ? Number.POSITIVE_INFINITY
        : Date.parse(finalPackage.package.max_token_expires_at),
    )).toISOString();
    const deliveryAttemptId = crypto.randomUUID();
    const tokenRow = await finalAuthority.entities.DocumentPackageToken.create({
      agency_id: input.agencyId, package_id: input.packageId,
      document_ids: finalPackage.package.document_signatures,
      token: tokenDigest, token_hashed: true,
      signer_id: input.signerId, signer_email: finalPackage.package.signer_email,
      signer_name: finalPackage.package.signer_name,
      status: 'delivery_pending', authority_version: 1,
      created_by_user_id: finalAuthority.userId,
      creator_membership_id: finalAuthority.membership?.id ?? null,
      creator_membership_version: finalAuthority.membership?.version ?? null,
      token_request_id: input.requestId, token_created_at: now.toISOString(),
      delivery_attempt_id: deliveryAttemptId, delivery_state: 'pending',
      expires_at: expiresAt, is_active: false, access_count: 0,
    });
    const tokenId = exactIdentifier(tokenRow?.id);
    if (!tokenId) throw new Error('Token create did not return an exact id');
    const readback = requireRows(await finalAuthority.entities.DocumentPackageToken.filter(
      { id: tokenId, agency_id: input.agencyId, package_id: input.packageId, token: tokenDigest }, undefined, EXACT_ROW_LIMIT,
    ), 'DocumentPackageToken.filter');
    if (readback.length !== 1 || readback[0].id !== tokenId || readback[0].status !== 'delivery_pending'
        || readback[0].token_hashed !== true || readback[0].authority_version !== 1
        || readback[0].is_active !== false || readback[0].delivery_state !== 'pending'
        || readback[0].delivery_attempt_id !== deliveryAttemptId
        || readback[0].signer_id !== input.signerId || readback[0].token_request_id !== input.requestId) {
      throw new Error('Token persistence could not be verified');
    }
    createdToken = { id: tokenId, digest: tokenDigest, version: 1,
      agencyId: input.agencyId, packageId: input.packageId, signerId: input.signerId,
      requestId: input.requestId, deliveryAttemptId };

    const eventKey = await sha256(`token_minted\0${tokenId}\0${input.requestId}`);
    const audit = await finalAuthority.entities.SignatureAuditEvent.create({
      event_key: eventKey, agency_id: input.agencyId, package_id: input.packageId,
      signer_id: input.signerId, token_id: tokenId, action: 'token_minted',
      actor_type: 'authenticated_user', actor_user_id: finalAuthority.userId,
      membership_id: finalAuthority.membership?.id ?? null,
      membership_version: finalAuthority.membership?.version ?? null,
      request_id: input.requestId, authority_version: 1, occurred_at: now.toISOString(),
    });
    if (!exactIdentifier(audit?.id)) {
      throw new Error('Token audit provenance could not be verified');
    }

    const disclosureAuthority = await loadAuthority(base44, input.agencyId, initialAuthority.snapshot);
    const disclosurePackage = await loadPackageSnapshot(disclosureAuthority.entities, input);
    if (!sameValue(finalPackage, disclosurePackage)) throw new PublicError(409, 'Signature package changed during token issuance');
    const signerLink = `${portalOrigin}/signer?token=${encodeURIComponent(plaintext)}`;
    externalStarted = true;
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: finalPackage.package.signer_email,
      from_name: 'PennSync by CareMetric',
      subject: 'A document is ready for your secure review and signature',
      body: `<!doctype html><html><body><p>Hello ${htmlEscape(finalPackage.package.signer_name)},</p>`
        + '<p>A document package is ready for your review and signature.</p>'
        + `<p><a href="${htmlEscape(signerLink)}">Review and sign securely</a></p>`
        + `<p>This private link works only for you and expires ${htmlEscape(new Date(expiresAt).toUTCString())}.</p>`
        + '<p>Do not forward this private link. If you did not expect it, contact your care team.</p></body></html>',
    });
    const acceptedAt = new Date().toISOString();
    const deliveryAudit = await finalAuthority.entities.SignatureAuditEvent.create({
      event_key: await sha256(`token_delivery_accepted\0${tokenId}\0${deliveryAttemptId}`),
      agency_id: input.agencyId, package_id: input.packageId,
      signer_id: input.signerId, token_id: tokenId, action: 'token_delivery_accepted',
      actor_type: 'system', actor_user_id: finalAuthority.userId,
      membership_id: finalAuthority.membership?.id ?? null,
      membership_version: finalAuthority.membership?.version ?? null,
      request_id: deliveryAttemptId, authority_version: 2, occurred_at: acceptedAt,
    });
    if (!exactIdentifier(deliveryAudit?.id)) throw new Error('Token delivery audit could not be recorded');
    const activate = await finalAuthority.entities.DocumentPackageToken.updateMany(
      { id: tokenId, token: tokenDigest, status: 'delivery_pending', delivery_state: 'pending',
        delivery_attempt_id: deliveryAttemptId, authority_version: 1 },
      { $set: { status: 'active', delivery_state: 'accepted', delivery_settled_at: acceptedAt,
        is_active: true, authority_version: 2 } },
    );
    if (!successfulSingleUpdate(activate)) {
      throw new Error('Token delivery was accepted but capability activation requires reconciliation');
    }
    createdToken.version = 2;
    createdToken.status = 'active';
    createdToken.deliveryState = 'accepted';

    await finalAuthority.entities.DocumentPackage.updateMany(
      { id: packageClaim.id, agency_id: packageClaim.agencyId,
        token_issue_claimed_by: packageClaim.claimId, token_issue_request_id: packageClaim.requestId,
        authority_version: packageClaim.version },
      { $set: { token_issue_claimed_by: null, token_issue_claimed_at: null,
        token_issue_request_id: null, authority_version: packageClaim.version + 1 } },
    ).catch(() => null);
    packageClaim = null;
    return Response.json({
      success: true, token_id: tokenId, package_id: input.packageId,
      signer_id: input.signerId, status: 'active', delivery_state: 'accepted', expires_at: expiresAt,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    if (cleanupEntities && createdToken && createdToken.status !== 'active') {
      const now = new Date().toISOString();
      const status = externalStarted ? 'delivery_indeterminate' : 'revoked';
      const deliveryState = externalStarted ? 'indeterminate' : 'rejected';
      await cleanupEntities.DocumentPackageToken.updateMany(
        { id: createdToken.id, token: createdToken.digest,
          status: 'delivery_pending', authority_version: createdToken.version },
        { $set: { status, delivery_state: deliveryState, delivery_settled_at: now,
          is_active: false, revoked_at: externalStarted ? null : now,
          authority_version: createdToken.version + 1 } },
      ).catch(() => null);
      if (externalStarted) {
        await cleanupEntities.SignatureAuditEvent.create({
          event_key: await sha256(`token_delivery_indeterminate\0${createdToken.id}\0${createdToken.deliveryAttemptId}`),
          agency_id: createdToken.agencyId, package_id: createdToken.packageId,
          signer_id: createdToken.signerId, token_id: createdToken.id,
          action: 'token_delivery_indeterminate', actor_type: 'system',
          request_id: createdToken.deliveryAttemptId,
          authority_version: createdToken.version + 1, occurred_at: now,
        }).catch(() => null);
      }
    }
    if (cleanupEntities && packageClaim) {
      await cleanupEntities.DocumentPackage.updateMany(
        { id: packageClaim.id, agency_id: packageClaim.agencyId,
          token_issue_claimed_by: packageClaim.claimId, token_issue_request_id: packageClaim.requestId,
          authority_version: packageClaim.version },
        { $set: { token_issue_claimed_by: null, token_issue_claimed_at: null,
          token_issue_request_id: null, authority_version: packageClaim.version + 1 } },
      ).catch(() => null);
    }
    if (externalStarted) {
      return Response.json({ error: 'Signer-link delivery requires reconciliation',
        delivery_state: 'indeterminate', requires_reconciliation: true }, {
        status: 202, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
      });
    }
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : 'Unable to issue signer token';
    return Response.json({ error: message }, { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  }
});
