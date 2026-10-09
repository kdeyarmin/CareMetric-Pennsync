import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';

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
// <<<BEGIN SHARED HELPER: faxQueueCreationReservation — generated, edit base44/_shared/backendHelpers.mjs>>>
async function faxQueueCreationKey(kind, resourceKey) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(JSON.stringify([kind, resourceKey]))));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function reserveFaxQueueCreation(entities, agencyId, kind, resourceKey) {
  const key = await faxQueueCreationKey(kind, resourceKey);
  const rows = await entities.Agency.filter({ id: agencyId }, undefined, 2);
  if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== agencyId
    || !['active', 'trial'].includes(rows[0].status)
    || !Number.isFinite(Date.parse(rows[0].updated_date || ''))) return null;
  const agency = rows[0];
  const previous = agency.fax_workflow_reservations;
  if (previous != null && (typeof previous !== 'object' || Array.isArray(previous))) return null;
  const reservations = previous || {};
  if (Object.keys(reservations).length >= 500 || Object.hasOwn(reservations, key)) return null;
  const token = crypto.randomUUID();
  const result = await entities.Agency.updateMany({
    id: agencyId, status: agency.status, updated_date: agency.updated_date,
    fax_workflow_reservations: Object.hasOwn(agency, 'fax_workflow_reservations')
      ? previous : { $exists: false },
  }, { $set: { fax_workflow_reservations: { ...reservations, [key]: token } } }).catch(() => null);
  if (result?.success !== true || result.updated !== 1 || result.has_more !== false) {
    await releaseFaxQueueCreation(entities, { agencyId, key, token }).catch(() => false);
    return null;
  }
  const verified = await entities.Agency.filter({ id: agencyId }, undefined, 2).catch(() => null);
  if (!Array.isArray(verified) || verified.length !== 1 || verified[0]?.id !== agencyId
    || verified[0].fax_workflow_reservations?.[key] !== token) {
    await releaseFaxQueueCreation(entities, { agencyId, key, token }).catch(() => false);
    return null;
  }
  return { agencyId, key, token };
}
async function releaseFaxQueueCreation(entities, reservation) {
  for (let attempt = 0; attempt < 5; attempt++) {
    let rows;
    try {
      rows = await entities.Agency.filter({ id: reservation.agencyId }, undefined, 2);
    } catch (error) {
      if (await waitFaxReservationThrottle(error, attempt)) continue;
      return false;
    }
    if (!Array.isArray(rows) || rows.length !== 1 || rows[0]?.id !== reservation.agencyId) return false;
    const row = rows[0];
    const previous = row.fax_workflow_reservations;
    if (previous == null || !Object.hasOwn(previous, reservation.key)) return true;
    if (previous[reservation.key] !== reservation.token) return false;
    const remaining = { ...previous };
    delete remaining[reservation.key];
    let writeError;
    const result = await entities.Agency.updateMany({
      id: row.id, updated_date: row.updated_date, fax_workflow_reservations: previous,
    }, { $set: { fax_workflow_reservations: remaining } }).catch(error => { writeError = error; return null; });
    if (result?.success === true && result.updated === 1 && result.has_more === false) return true;
    if (writeError && Number(writeError.response?.status ?? writeError.status) === 429
      && !await waitFaxReservationThrottle(writeError, attempt)) return false;
    // A different key can change this shared map. Reload without dropping that
    // writer's entry; a lost successful response is also recovered by absence.
  }
  return false;
}
async function waitFaxReservationThrottle(error, attempt) {
  if (Number(error?.response?.status ?? error?.status) !== 429 || attempt >= 4) return false;
  const retryAfterRaw = error?.response?.headers?.['retry-after'] ?? error?.headers?.['retry-after'] ?? 0;
  const retryAfter = Number.isFinite(Number(retryAfterRaw)) ? Number(retryAfterRaw)
    : (Date.parse(String(retryAfterRaw)) - Date.now()) / 1000;
  // Longer throttles remain fenced for the next same-key request. Short ones
  // get at most 11 seconds of total backoff; never retry a known longer limit early.
  const delay = Math.min(1000 * 2 ** attempt, 4000);
  if (Number.isFinite(retryAfter) && retryAfter * 1000 > delay) return false;
  await new Promise(resolve => setTimeout(resolve, delay));
  return true;
}
async function releaseRecoveredFaxQueueCreation(entities, agencyId, kind, resourceKey, child) {
  const token = child?.queue_creation_reservation_token;
  if (token == null) return true; // Pre-protocol children have no reservation.
  if (typeof token !== 'string' || !/^[a-f0-9-]{36}$/.test(token)) return false;
  return releaseFaxQueueCreation(entities, {
    agencyId, key: await faxQueueCreationKey(kind, resourceKey), token,
  });
}
// <<<END SHARED HELPER: faxQueueCreationReservation>>>
// <<<BEGIN SHARED HELPER: esignCore — generated, edit base44/_shared/backendHelpers.mjs>>>
// Staff-side e-signature authority. Every staff signing capability decides who
// the caller is from the built-in User plus an exact, active AgencyMembership in
// the chart's own agency — never from the self-editable profile fields
// (agency_id, agency_name, account_type, is_manager, assigned_nurses). Chart
// access follows the care-team rule used by callerMayAccessPatient and
// assertOasisChartAccess: the built-in administrator, an agency_admin/manager
// of that agency, the chart's creator, or an active PatientCareTeamAssignment.
// Authority is decided before any request body field selects a record.
const ESIGN_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const ESIGN_CHART_WIDE_ROLES = new Set(['agency_admin', 'manager']);
const ESIGN_REQUEST_ROLES = new Set(['agency_admin', 'manager', 'clinician']);
const ESIGN_ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const ESIGN_ROW_LIMIT = 10;
const ESIGN_NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };
const ESIGN_SOURCE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg']);

class EsignError extends Error {
  constructor(status, message, code) {
    super(message);
    this.name = 'EsignError';
    this.status = status;
    this.code = code || null;
  }
}

function esignId(value) {
  if (typeof value !== 'string' || !value || value.length > 200 || value.trim() !== value
    || value.startsWith('$')
    || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return value;
}

function esignEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email) ? email : null;
}

function esignInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function esignDigest(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

function esignRows(value, label) {
  if (!Array.isArray(value)) throw new Error(label + ' returned a non-array result');
  return value;
}

function esignSingleUpdate(result) {
  return !!result && typeof result === 'object' && result.success === true
    && result.updated === 1 && result.has_more === false;
}

async function esignSha256Bytes(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function esignSha256(value) {
  return esignSha256Bytes(new TextEncoder().encode(String(value)));
}

async function esignExactOne(entity, query, label, missingStatus) {
  const rows = esignRows(await entity.filter(query, undefined, ESIGN_ROW_LIMIT), label + '.filter');
  if (rows.length >= ESIGN_ROW_LIMIT) throw new EsignError(409, label + ' is ambiguous');
  for (const row of rows) {
    for (const [key, value] of Object.entries(query)) {
      if (row?.[key] !== value) throw new EsignError(409, label + ' query scope could not be verified');
    }
  }
  if (rows.length !== 1) throw new EsignError(missingStatus || 404, label + ' unavailable');
  return rows[0];
}

function esignJson(body, status) {
  return Response.json(body, { status: status || 200, headers: ESIGN_NO_STORE });
}

function esignErrorResponse(error, fallbackMessage) {
  if (error instanceof EsignError) {
    return esignJson({ error: error.message, ...(error.code ? { code: error.code } : {}) }, error.status);
  }
  const status = Number(error?.response?.status ?? error?.status);
  if (status === 429) return esignJson({ error: 'Too many requests; retry shortly', code: 'rate_limited' }, 429);
  // Static only: identifiers, names and storage pointers may carry PHI.
  console.error('esign broker failure');
  return esignJson({ error: fallbackMessage || 'Signature service error' }, 500);
}

async function esignReadJson(req, maxBytes) {
  const limit = maxBytes || 16_000;
  const stated = Number(req.headers.get('content-length'));
  if (Number.isFinite(stated) && stated > limit) throw new EsignError(413, 'Request body is too large');
  const raw = await req.text().catch(() => { throw new EsignError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > limit) throw new EsignError(413, 'Request body is too large');
  let body;
  try { body = JSON.parse(raw || '{}'); } catch { throw new EsignError(400, 'Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new EsignError(400, 'Request body must be an object');
  return body;
}

function esignOnlyKeys(body, keys) {
  const unknown = Object.keys(body).filter((key) => !keys.includes(key));
  if (unknown.length) throw new EsignError(400, 'Unsupported field: ' + unknown[0]);
  return body;
}

async function esignLoadCaller(base44) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new EsignError(401, 'Unauthorized');
  if (user.is_active === false || user.disabled === true || user.is_service === true) {
    throw new EsignError(403, 'Unauthorized - account is deactivated');
  }
  const userId = esignId(user.id);
  const email = esignEmail(user.email);
  if (!userId || !email) throw new EsignError(403, 'Forbidden');
  return { user, userId, email, builtInAdmin: user.role === 'admin' };
}

async function esignLoadMembership(entities, agencyId, caller) {
  const rows = esignRows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, user_id: caller.userId }, '-updated_date', ESIGN_ROW_LIMIT,
  ), 'AgencyMembership.filter');
  if (rows.length >= ESIGN_ROW_LIMIT
    || rows.some((row) => row?.agency_id !== agencyId || row?.user_id !== caller.userId)) {
    throw new EsignError(409, 'Tenant membership is ambiguous');
  }
  if (rows.length === 0) return null;
  if (rows.length > 1) throw new EsignError(409, 'Tenant membership is ambiguous');
  const row = rows[0];
  if (!esignId(row.id) || row.membership_key !== agencyId + ':' + caller.userId
    || esignEmail(row.user_email_normalized) !== caller.email
    || row.user_email_normalized !== caller.email
    || !ESIGN_TENANT_ROLES.has(String(row.tenant_role || ''))
    || !Number.isSafeInteger(row.version) || row.version < 1) {
    throw new EsignError(409, 'Tenant membership integrity check failed');
  }
  return row.status === 'active' ? row : null;
}

async function esignLoadAgency(entities, agencyId) {
  const agency = await esignExactOne(entities.Agency, { id: agencyId }, 'Agency', 403);
  if (!ESIGN_ENABLED_AGENCY_STATUSES.has(String(agency.status || ''))) {
    throw new EsignError(403, 'Agency is unavailable');
  }
  return agency;
}

async function esignLoadPatient(entities, agencyId, patientId) {
  return esignExactOne(entities.Patient,
    { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false }, 'Patient', 404);
}

async function esignChartAccess(entities, caller, membership, patient) {
  if (caller.builtInAdmin) return 'platform_admin';
  if (!membership || membership.agency_id !== patient.agency_id) return null;
  if (ESIGN_CHART_WIDE_ROLES.has(membership.tenant_role)) return 'agency_wide';
  if (esignId(patient.created_by_user_id) && patient.created_by_user_id === caller.userId) return 'patient_creator';
  const rows = await entities.PatientCareTeamAssignment.filter(
    { agency_id: patient.agency_id, patient_id: patient.id, user_id: caller.userId, status: 'active' },
    undefined, 2,
  ).catch(() => null);
  const active = Array.isArray(rows) && rows.some((row) => row?.agency_id === patient.agency_id
    && row?.patient_id === patient.id && row?.user_id === caller.userId && row?.status === 'active');
  return active ? 'care_team' : null;
}

/**
 * Resolve the staff caller for one agency (and optionally one chart).
 * options: { agencyId, patientId?, requireMembership?, roles? (Set of tenant roles) }
 */
async function esignStaffAuthority(base44, options) {
  const caller = await esignLoadCaller(base44);
  const agencyId = esignId(options?.agencyId);
  if (!agencyId) throw new EsignError(400, 'agency_id is required');
  const entities = base44.asServiceRole.entities;
  const agency = await esignLoadAgency(entities, agencyId);
  const membership = await esignLoadMembership(entities, agencyId, caller);
  if (!membership && !caller.builtInAdmin) throw new EsignError(403, 'No active membership for this agency');
  if (options?.requireMembership && !membership) {
    throw new EsignError(403, 'An active membership in this agency is required for this signature action');
  }
  if (options?.roles && membership && !caller.builtInAdmin && !options.roles.has(membership.tenant_role)) {
    throw new EsignError(403, 'Your agency role cannot perform this signature action');
  }
  let patient = null;
  let access = null;
  if (options?.patientId != null) {
    const patientId = esignId(options.patientId);
    if (!patientId) throw new EsignError(400, 'patient_id is invalid');
    patient = await esignLoadPatient(entities, agencyId, patientId);
    access = await esignChartAccess(entities, caller, membership, patient);
    // Same answer as a missing chart: never confirm a chart the caller cannot open.
    if (!access) throw new EsignError(404, 'Patient unavailable');
  }
  return {
    caller, entities, agency, agencyId, membership, patient, access,
    tenantRole: membership ? membership.tenant_role : 'platform_admin',
  };
}

// Chart access for a chart the caller did not name: a stored row's own
// patient. Refusal reads exactly like absence.
async function esignRequireChartAccess(authority, patientId) {
  const id = esignId(patientId);
  if (!id) throw new EsignError(404, 'Signature request unavailable');
  let patient;
  try {
    patient = await esignLoadPatient(authority.entities, authority.agencyId, id);
  } catch (error) {
    if (error instanceof EsignError && error.status === 404) throw new EsignError(404, 'Signature request unavailable');
    throw error;
  }
  const access = await esignChartAccess(authority.entities, authority.caller, authority.membership, patient);
  if (!access) throw new EsignError(404, 'Signature request unavailable');
  return { patient, access };
}

// Load one signature document inside the caller's already-authorized agency,
// then require chart access to the patient that row belongs to.
async function esignLoadAuthorizedSignature(authority, signatureId) {
  const id = esignId(signatureId);
  if (!id) throw new EsignError(400, 'document_signature_id is required');
  const row = await esignExactOne(authority.entities.DocumentSignature,
    { id, agency_id: authority.agencyId }, 'DocumentSignature', 404);
  const chart = await esignRequireChartAccess(authority, row.patient_id);
  return { row, ...chart };
}

// Request-level actions (cancel, edit placement, resend notices) belong to the
// requester or to an agency_admin/manager of the chart's agency.
function esignMayManageRequest(authority, row) {
  return authority.caller.builtInAdmin
    || ESIGN_CHART_WIDE_ROLES.has(String(authority.membership?.tenant_role || ''))
    || row?.created_by_user_id === authority.caller.userId;
}

// The packages of one request: same agency, same creator, same client request.
// (DocumentPackage is carried into the owned store unchanged, so a request is
// identified there by these three columns rather than by a new request key.)
async function esignLoadRequestPackages(entities, agencyId, creatorId, clientRequestId) {
  if (!esignId(agencyId) || !esignId(creatorId) || typeof clientRequestId !== 'string' || !clientRequestId) return [];
  const query = { agency_id: agencyId, created_by_user_id: creatorId, client_request_id: clientRequestId };
  return esignRows(await entities.DocumentPackage.filter(query, 'created_date', 50), 'DocumentPackage.filter')
    .filter((row) => row?.agency_id === agencyId && row?.created_by_user_id === creatorId
      && row?.client_request_id === clientRequestId);
}

// Append-only provenance, idempotent by its deterministic event_key.
async function esignAudit(entities, payload) {
  const existing = esignRows(await entities.SignatureAuditEvent.filter(
    { event_key: payload.event_key }, undefined, ESIGN_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (existing.length > 1) throw new Error('Signature audit identity is ambiguous');
  if (existing.length === 1) return existing[0];
  const row = await entities.SignatureAuditEvent.create(payload);
  if (!esignId(row?.id)) throw new Error('Signature audit could not be recorded');
  return row;
}

// Chart-safe PDF file names (the chart brokers accept only this alphabet).
const ESIGN_FILE_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/;

function esignSafeFileName(value, fallback) {
  const base = String(value || '')
    .replace(/\.[A-Za-z0-9]{1,5}$/, '')
    .replace(/[^A-Za-z0-9._ ()-]+/g, ' ')
    .replace(/\.{2,}/g, '.')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 180)
    .trim();
  const name = (base || fallback || 'Document') + '.pdf';
  return ESIGN_FILE_NAME_PATTERN.test(name) && !name.includes('..') ? name : 'Signed document.pdf';
}
// <<<END SHARED HELPER: esignCore>>>
// <<<BEGIN SHARED HELPER: esignChartFiling — generated, edit base44/_shared/backendHelpers.mjs>>>
// File generated bytes (a sealed signed PDF or a document rendered from a
// template) into the patient's chart exactly as createAuthorizedDocument does:
// private storage only, a metadata-only Document row, and a version-2
// DocumentTenantBinding whose binding_key is SHA-256(agency, creator, request).
// listAuthorizedDocuments / getAuthorizedDocument verify every one of these
// invariants before a chart reader sees the file, so the archive is readable
// through the ordinary chart brokers and nowhere else. The agency-level
// 'document' reservation serializes a key exactly like an upload does.
function esignChartBindingMatches(row, expected) {
  return !!esignId(row?.id) && row.binding_key === expected.bindingKey
    && !!esignId(row.document_id) && row.agency_id === expected.agencyId
    && row.patient_id === expected.patientId
    && row.created_by_user_id === expected.creator.userId
    && row.created_by_user_email_normalized === expected.creator.email
    && row.document_created_by_email_normalized === expected.creator.email
    && row.membership_id === expected.creator.membershipId
    && Number.isSafeInteger(row.membership_version) && row.membership_version >= 1
    && row.storage_mode === 'private' && isPrivateFileUri(row.file_uri)
    && row.file_type === 'application/pdf' && row.purpose === 'patient_document'
    && row.client_request_id === expected.clientRequestId && row.version === 2
    && /^[a-f0-9]{64}$/.test(String(row.content_sha256 || ''))
    && Number.isSafeInteger(row.file_size) && row.file_size > 0;
}

async function esignLoadChartBinding(entities, expected) {
  const rows = esignRows(await entities.DocumentTenantBinding.filter(
    { binding_key: expected.bindingKey }, '-created_date', ESIGN_ROW_LIMIT,
  ), 'DocumentTenantBinding.filter');
  const exact = rows.filter((row) => row?.binding_key === expected.bindingKey);
  if (exact.length > 1 || rows.length >= ESIGN_ROW_LIMIT) throw new EsignError(409, 'Chart filing identity is ambiguous');
  if (exact.length === 0) return null;
  if (!esignChartBindingMatches(exact[0], expected)) throw new EsignError(409, 'Chart filing identity conflicts with another document');
  const document = await esignExactOne(entities.Document, { id: exact[0].document_id }, 'Document', 409);
  if (document.patient_id !== expected.patientId || document.file_url != null
    || document.file_name !== exact[0].file_name) {
    throw new EsignError(409, 'Chart filing document integrity check failed');
  }
  return { binding: exact[0], document };
}

// Only a caller holding an exclusive lease over the filing (the sealing lease of
// one DocumentSignature) may clear a reservation a dead attempt left behind.
async function esignClearStaleFiling(base44, agencyId, clientRequestId, creatorUserId) {
  const entities = base44.asServiceRole.entities;
  const bindingKey = await esignSha256(agencyId + '\u0000' + creatorUserId + '\u0000' + clientRequestId);
  const key = await faxQueueCreationKey('document', bindingKey);
  const agency = await esignExactOne(entities.Agency, { id: agencyId }, 'Agency', 409);
  const token = agency.fax_workflow_reservations?.[key];
  if (typeof token !== 'string') return true;
  return releaseFaxQueueCreation(entities, { agencyId, key, token });
}

/**
 * input: { agencyId, patientId, creator: { userId, email, membershipId, membershipVersion },
 *   clientRequestId, fileName, title, render: async () => Uint8Array, extra: {} }
 * render() runs only when no filing for this key exists yet.
 */
async function esignFileChartDocument(base44, input) {
  const entities = base44.asServiceRole.entities;
  const bindingKey = await esignSha256(input.agencyId + '\u0000' + input.creator.userId + '\u0000' + input.clientRequestId);
  const expected = { ...input, bindingKey };
  const existing = await esignLoadChartBinding(entities, expected);
  if (existing) {
    await releaseRecoveredFaxQueueCreation(entities, input.agencyId, 'document', bindingKey, existing.binding).catch(() => false);
    return { ...existing, created: false };
  }
  const reservation = await reserveFaxQueueCreation(entities, input.agencyId, 'document', bindingKey);
  if (!reservation) throw new EsignError(409, 'Chart filing is already in progress; retry shortly', 'filing_in_progress');
  let createStarted = false;
  try {
    const raced = await esignLoadChartBinding(entities, expected);
    if (raced) {
      await releaseFaxQueueCreation(entities, reservation).catch(() => false);
      return { ...raced, created: false };
    }
    const bytes = await input.render();
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < 8 || bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error('Rendered document is invalid');
    }
    const contentSha256 = await esignSha256Bytes(bytes);
    const fileName = esignSafeFileName(input.fileName, 'Signed document');
    const upload = await base44.asServiceRole.integrations.Core.UploadPrivateFile({
      file: new File([bytes], fileName, { type: 'application/pdf' }),
    });
    const fileUri = typeof upload?.file_uri === 'string' ? upload.file_uri : '';
    if (!isPrivateFileUri(fileUri)) throw new Error('Private upload returned an invalid URI');
    const now = new Date().toISOString();
    createStarted = true;
    const document = await entities.Document.create({
      title: fileName,
      file_name: fileName,
      file_size: bytes.byteLength,
      file_type: 'application/pdf',
      category: 'other',
      patient_id: input.patientId,
      tags: ['patient_document'],
      document_date: now.slice(0, 10),
      uploaded_by: input.creator.email,
      created_by: input.creator.email,
      is_sensitive: true,
      ...(input.extra || {}),
    });
    const documentId = esignId(document?.id);
    if (!documentId) throw new Error('Document.create returned no exact id');
    const documentCreatorId = esignId(document.created_by_id);
    if (document.created_by_id != null && (!documentCreatorId
      || (documentCreatorId !== input.creator.userId && !/^service_[a-f0-9-]{36}$/.test(documentCreatorId)))) {
      throw new Error('Document.create returned invalid platform provenance');
    }
    await entities.DocumentTenantBinding.create({
      binding_key: bindingKey,
      document_id: documentId,
      agency_id: input.agencyId,
      patient_id: input.patientId,
      created_by_user_id: input.creator.userId,
      created_by_user_email_normalized: input.creator.email,
      membership_id: input.creator.membershipId,
      membership_version: input.creator.membershipVersion,
      document_created_by_email_normalized: input.creator.email,
      ...(documentCreatorId ? { document_created_by_id: documentCreatorId } : {}),
      queue_creation_reservation_token: reservation.token,
      storage_mode: 'private',
      file_uri: fileUri,
      file_name: fileName,
      file_type: 'application/pdf',
      file_size: bytes.byteLength,
      content_sha256: contentSha256,
      client_request_id: input.clientRequestId,
      purpose: 'patient_document',
      version: 2,
      created_at: now,
      last_verified_at: now,
    });
    const filed = await esignLoadChartBinding(entities, expected);
    if (!filed || filed.document.id !== documentId || filed.binding.content_sha256 !== contentSha256
      || filed.binding.file_uri !== fileUri) {
      throw new EsignError(409, 'Chart filing could not be verified');
    }
    await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    return { ...filed, created: true };
  } catch (error) {
    // Once a create started, an empty read cannot prove nothing committed: keep
    // the reservation so a retry resumes the exact filing instead of duplicating it.
    if (!createStarted) await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    if (error && typeof error === 'object') error.esignFilingStarted = createStarted;
    throw error;
  }
}
// <<<END SHARED HELPER: esignChartFiling>>>
// <<<BEGIN SHARED HELPER: esignPdfRender — generated, edit base44/_shared/backendHelpers.mjs>>>
// Signed-PDF renderer (pdf-lib). Consumers import PDFDocument, StandardFonts
// and rgb from 'npm:pdf-lib@1.17.1'. Rendering is pure: it reads only the bytes
// and the server-derived signing facts it is handed, never a request body.
const ESIGN_LETTER = [612, 792];
const ESIGN_MARGIN = 54;

// Standard 14 fonts encode WinAnsi only; anything else would throw mid-render.
function esignPdfText(value, max) {
  const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
  let out = '';
  for (const character of text) {
    const code = character.codePointAt(0);
    out += (code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff) ? character : '?';
    if (max && out.length >= max) break;
  }
  return out;
}

function esignWrapText(font, value, size, maxWidth) {
  const words = esignPdfText(value).split(' ');
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    // Hard-break a single token wider than the column (digests, long emails).
    let rest = word;
    while (font.widthOfTextAtSize(rest, size) > maxWidth && rest.length > 1) {
      let cut = rest.length - 1;
      while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > maxWidth) cut -= 1;
      lines.push(rest.slice(0, cut));
      rest = rest.slice(cut);
    }
    line = rest;
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function esignUtcStamp(value) {
  const millis = Date.parse(String(value || ''));
  return Number.isFinite(millis) ? new Date(millis).toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC') : 'n/a';
}

function esignRoleLabel(role) {
  return ({
    patient: 'Patient', caregiver: 'Caregiver', legal_representative: 'Legal representative',
    witness: 'Witness', provider: 'Provider',
  })[role] || 'Signer';
}

function esignCaptureLabel(method) {
  return method === 'in_person'
    ? 'In person on an authenticated staff device; drawn signature and typed-name attestation'
    : 'Single-purpose emailed link; drawn signature and typed-name attestation';
}

async function esignEmbedImage(doc, bytes, fileType) {
  return fileType === 'image/jpeg' ? doc.embedJpg(bytes) : doc.embedPng(bytes);
}

async function esignLoadSourcePdf(bytes, fileType) {
  if (fileType === 'application/pdf') {
    // An encrypted PDF throws here; sealing an encrypted source is refused.
    return PDFDocument.load(bytes, { updateMetadata: false });
  }
  if (fileType !== 'image/png' && fileType !== 'image/jpeg') throw new Error('Unsupported source document type');
  const doc = await PDFDocument.create();
  const image = await esignEmbedImage(doc, bytes, fileType);
  const page = doc.addPage(ESIGN_LETTER);
  const maxWidth = ESIGN_LETTER[0] - ESIGN_MARGIN * 2;
  const maxHeight = ESIGN_LETTER[1] - ESIGN_MARGIN * 2;
  const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  const width = image.width * scale;
  const height = image.height * scale;
  page.drawImage(image, {
    x: (ESIGN_LETTER[0] - width) / 2,
    y: ESIGN_LETTER[1] - ESIGN_MARGIN - height,
    width,
    height,
  });
  return doc;
}

function esignFitImage(image, boxWidth, boxHeight) {
  const scale = Math.min(boxWidth / image.width, boxHeight / image.height);
  return { width: image.width * scale, height: image.height * scale };
}

function esignInitials(name) {
  return esignPdfText(name).split(' ').filter(Boolean).map((part) => part[0].toUpperCase()).join('').slice(0, 4);
}

// Field boxes are page-relative percentages captured by the request builder.
function esignDrawFields(doc, font, fields, signerFacts, preview) {
  const pages = doc.getPages();
  const placed = new Set();
  for (const field of Array.isArray(fields) ? fields : []) {
    const facts = signerFacts.get(field?.signerId);
    if (!facts || (facts.status !== 'completed' && !preview)) continue;
    const pageNumber = Number(field.page || 1);
    if (!Number.isSafeInteger(pageNumber) || pageNumber < 1 || pageNumber > pages.length) continue;
    const page = pages[pageNumber - 1];
    const box = page.getMediaBox();
    const x = box.x + box.width * (Number(field.position?.x) / 100);
    const width = box.width * (Number(field.size?.width) / 100);
    const height = box.height * (Number(field.size?.height) / 100);
    const y = box.y + box.height - box.height * (Number(field.position?.y) / 100) - height;
    if (![x, y, width, height].every(Number.isFinite) || width <= 0 || height <= 0) continue;
    if (facts.status !== 'completed') {
      // Preview only: show where a still-pending signer will sign.
      page.drawRectangle({ x, y, width, height, borderColor: rgb(0.13, 0.23, 0.46), borderWidth: 0.75, opacity: 0.4 });
      const label = esignPdfText((field.label || field.type) + ': ' + facts.signer_name, 80);
      const size = Math.min(8, Math.max(5, height * 0.4));
      page.drawText(label, { x: x + 2, y: y + 2, size, font, color: rgb(0.13, 0.23, 0.46) });
      continue;
    }
    if (field.type === 'signature' && facts.image) {
      const fit = esignFitImage(facts.image, width, height);
      page.drawImage(facts.image, { x, y: y + (height - fit.height) / 2, width: fit.width, height: fit.height });
      placed.add(facts.signer_id);
    } else {
      const text = field.type === 'date'
        ? esignUtcStamp(facts.signed_at).slice(0, 10)
        : field.type === 'initials' ? esignInitials(facts.signer_name) : esignPdfText(facts.signer_name, 120);
      let size = Math.min(14, Math.max(6, height * 0.7));
      while (size > 6 && font.widthOfTextAtSize(text, size) > width) size -= 0.5;
      page.drawText(text, { x: x + 1, y: y + (height - size) / 2 + 1, size, font, color: rgb(0.05, 0.08, 0.2) });
    }
  }
  return placed;
}

function esignCertificateWriter(doc, fonts, preview) {
  let page = null;
  let cursor = 0;
  const width = ESIGN_LETTER[0] - ESIGN_MARGIN * 2;
  const newPage = () => {
    page = doc.addPage(ESIGN_LETTER);
    cursor = ESIGN_LETTER[1] - ESIGN_MARGIN;
    if (preview) {
      page.drawText('PREVIEW - NOT SEALED', {
        x: ESIGN_MARGIN, y: ESIGN_LETTER[1] / 2, size: 44, font: fonts.bold,
        color: rgb(0.85, 0.2, 0.2), opacity: 0.18,
      });
    }
  };
  const ensure = (height) => {
    if (!page || cursor - height < ESIGN_MARGIN) newPage();
  };
  const text = (value, options) => {
    const size = options?.size || 10;
    const font = options?.bold ? fonts.bold : fonts.regular;
    const lines = esignWrapText(font, value, size, width - (options?.indent || 0));
    for (const line of lines) {
      ensure(size + 4);
      page.drawText(line, {
        x: ESIGN_MARGIN + (options?.indent || 0), y: cursor - size, size, font,
        color: options?.muted ? rgb(0.33, 0.4, 0.5) : rgb(0.07, 0.1, 0.17),
      });
      cursor -= size + 4;
    }
  };
  const gap = (height) => { cursor -= height; };
  const rule = () => {
    ensure(8);
    page.drawLine({
      start: { x: ESIGN_MARGIN, y: cursor - 2 }, end: { x: ESIGN_MARGIN + width, y: cursor - 2 },
      thickness: 0.5, color: rgb(0.8, 0.84, 0.9),
    });
    cursor -= 8;
  };
  const image = (embedded, boxWidth, boxHeight) => {
    ensure(boxHeight + 6);
    page.drawRectangle({
      x: ESIGN_MARGIN, y: cursor - boxHeight, width: boxWidth, height: boxHeight,
      borderColor: rgb(0.8, 0.84, 0.9), borderWidth: 0.75,
    });
    if (embedded) {
      const fit = esignFitImage(embedded, boxWidth - 8, boxHeight - 8);
      page.drawImage(embedded, {
        x: ESIGN_MARGIN + 4, y: cursor - boxHeight + 4 + (boxHeight - 8 - fit.height) / 2,
        width: fit.width, height: fit.height,
      });
    }
    cursor -= boxHeight + 6;
  };
  return { text, gap, rule, image, newPage };
}

/**
 * Render the signed PDF: the exact source bytes, every collected signature in
 * its placed fields, and an appended certificate page.
 * input: { sourceBytes, sourceType, fields, signers: [{ signer_id, signer_name,
 *   signer_role, email, status, signed_at, capture_method, agreement_version,
 *   signature_sha256, imageBytes, imageType }], meta: { title, signatureId,
 *   requestKey, sourceSha256, agreementTextSha256, completedAt, agencyName }, preview }
 */
async function esignRenderSignedPdf(input) {
  const doc = await esignLoadSourcePdf(input.sourceBytes, input.sourceType);
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const facts = new Map();
  for (const signer of input.signers) {
    const image = signer.imageBytes ? await esignEmbedImage(doc, signer.imageBytes, signer.imageType) : null;
    facts.set(signer.signer_id, { ...signer, image });
  }
  esignDrawFields(doc, fonts.regular, input.fields, facts, !!input.preview);

  const meta = input.meta || {};
  const certificate = esignCertificateWriter(doc, fonts, !!input.preview);
  certificate.newPage();
  certificate.text('Electronic Signature Certificate', { size: 18, bold: true });
  certificate.text(input.preview
    ? 'Preview of the signatures collected so far. This copy is not sealed and is not the signed record.'
    : 'This page is part of the sealed signed record produced by PennSync e-signature.', { size: 9, muted: true });
  certificate.gap(6);
  certificate.rule();
  certificate.text('Document: ' + esignPdfText(meta.title || 'Document', 200), { bold: true });
  if (meta.agencyName) certificate.text('Requested by: ' + esignPdfText(meta.agencyName, 200));
  certificate.text('Request reference: ' + esignPdfText(meta.signatureId || ''), { size: 9 });
  certificate.text('Source document SHA-256: ' + esignPdfText(meta.sourceSha256 || ''), { size: 9 });
  if (meta.agreementTextSha256) {
    certificate.text('Electronic signature consent text SHA-256: ' + esignPdfText(meta.agreementTextSha256), { size: 9 });
  }
  certificate.text(input.preview
    ? 'Status: in progress (preview generated ' + esignUtcStamp(meta.completedAt) + ')'
    : 'Completed: ' + esignUtcStamp(meta.completedAt), { size: 10, bold: !input.preview });
  certificate.gap(6);
  for (const signer of facts.values()) {
    certificate.rule();
    certificate.text(esignPdfText(signer.signer_name, 200) + ' - ' + esignRoleLabel(signer.signer_role), { bold: true, size: 11 });
    certificate.text('Email: ' + esignPdfText(signer.email, 320), { size: 9 });
    if (signer.status === 'completed') {
      certificate.text('Signed: ' + esignUtcStamp(signer.signed_at), { size: 9 });
      certificate.text('Method: ' + esignCaptureLabel(signer.capture_method), { size: 9 });
      certificate.text('Consent version: ' + esignPdfText(signer.agreement_version || 'n/a'), { size: 9 });
      certificate.text('Signature image SHA-256: ' + esignPdfText(signer.signature_sha256 || ''), { size: 9 });
      certificate.image(signer.image, 220, 70);
    } else {
      certificate.text('Status: awaiting signature', { size: 9, muted: true });
    }
  }
  certificate.rule();
  certificate.text(input.preview
    ? 'Preview only. The sealed record is produced when every required signer has signed.'
    : 'Integrity: this certificate is bound to the exact source document by its SHA-256 digest. '
      + 'The SHA-256 digest of this sealed PDF is recorded in the PennSync signature audit trail '
      + 'and can be re-verified with Signature Integrity.', { size: 8, muted: true });

  const stamp = new Date(Date.parse(String(meta.completedAt || '')) || Date.now());
  doc.setTitle(esignPdfText((input.preview ? 'PREVIEW - ' : 'Signed - ') + (meta.title || 'Document'), 200));
  doc.setSubject('Electronic signature record');
  doc.setProducer('PennSync e-signature');
  doc.setCreator('PennSync by CareMetric');
  doc.setCreationDate(stamp);
  doc.setModificationDate(stamp);
  return doc.save({ useObjectStreams: false });
}

/** A standalone certificate (no source pages) for an already-sealed request. */
async function esignRenderCertificatePdf(input) {
  const doc = await PDFDocument.create();
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
  };
  const meta = input.meta || {};
  const certificate = esignCertificateWriter(doc, fonts, false);
  certificate.newPage();
  certificate.text('Certificate of Electronic Signature Completion', { size: 18, bold: true });
  certificate.gap(6);
  certificate.rule();
  certificate.text('Document: ' + esignPdfText(meta.title || 'Document', 200), { bold: true });
  if (meta.agencyName) certificate.text('Requested by: ' + esignPdfText(meta.agencyName, 200));
  certificate.text('Request reference: ' + esignPdfText(meta.signatureId || ''), { size: 9 });
  certificate.text('Source document SHA-256: ' + esignPdfText(meta.sourceSha256 || ''), { size: 9 });
  certificate.text('Sealed signed PDF SHA-256: ' + esignPdfText(meta.signedSha256 || ''), { size: 9 });
  certificate.text('Completed: ' + esignUtcStamp(meta.completedAt), { size: 10, bold: true });
  for (const signer of input.signers) {
    certificate.rule();
    certificate.text(esignPdfText(signer.signer_name, 200) + ' - ' + esignRoleLabel(signer.signer_role), { bold: true, size: 11 });
    certificate.text('Email: ' + esignPdfText(signer.email, 320), { size: 9 });
    certificate.text('Signed: ' + esignUtcStamp(signer.signed_at), { size: 9 });
    certificate.text('Method: ' + esignCaptureLabel(signer.capture_method), { size: 9 });
    certificate.text('Consent version: ' + esignPdfText(signer.agreement_version || 'n/a'), { size: 9 });
    certificate.text('Signature image SHA-256: ' + esignPdfText(signer.signature_sha256 || ''), { size: 9 });
  }
  if (Array.isArray(input.events) && input.events.length) {
    certificate.rule();
    certificate.text('Audit trail', { bold: true, size: 11 });
    for (const event of input.events) {
      certificate.text(esignUtcStamp(event.occurred_at) + '  ' + esignPdfText(event.label, 160), { size: 8 });
    }
  }
  certificate.rule();
  certificate.text('Generated ' + esignUtcStamp(new Date().toISOString())
    + '. Verify the sealed PDF digest above with Signature Integrity in PennSync.', { size: 8, muted: true });
  doc.setTitle(esignPdfText('Signature certificate - ' + (meta.title || 'Document'), 200));
  doc.setProducer('PennSync e-signature');
  doc.setCreator('PennSync by CareMetric');
  return doc.save({ useObjectStreams: false });
}

function esignBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
// <<<END SHARED HELPER: esignPdfRender>>>
// <<<BEGIN SHARED HELPER: esignSignedRecord — generated, edit base44/_shared/backendHelpers.mjs>>>
// Read side of a signed record: re-read the private source document and every
// private signature image and refuse any byte that no longer matches the
// SHA-256 recorded when the signers reviewed and signed. Rendering a preview,
// a certificate or the sealed PDF, and integrity verification, all start here.
// Nothing in this block writes a row or sends anything.
const ESIGN_MAX_SOURCE_BYTES = 25 * 1024 * 1024;
const ESIGN_MAX_ARTIFACT_BYTES = 1024 * 1024;

async function esignReadPrivateBytes(base44, fileUri, maxBytes) {
  if (!isPrivateFileUri(fileUri)) throw new EsignError(409, 'Private file reference is invalid');
  const result = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: fileUri, expires_in: 60 });
  let url;
  try { url = new URL(result?.signed_url); } catch { throw new Error('Private file read failed'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Private file read failed');
  const response = await fetch(url.toString());
  if (!response.ok) throw new Error('Private file read failed');
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) throw new EsignError(413, 'Private file is too large to seal');
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength < 1 || bytes.byteLength > maxBytes) throw new EsignError(413, 'Private file is too large to seal');
  return bytes;
}

async function esignLoadSourceBinding(entities, row) {
  const binding = await esignExactOne(entities.DocumentTenantBinding,
    { id: row.document_binding_id, agency_id: row.agency_id, document_id: row.document_id },
    'DocumentTenantBinding', 409);
  if (binding.patient_id !== row.patient_id || binding.storage_mode !== 'private' || binding.version !== 2
    || binding.content_sha256 !== row.document_content_sha256 || !isPrivateFileUri(binding.file_uri)
    || !ESIGN_SOURCE_TYPES.has(String(binding.file_type || ''))) {
    throw new EsignError(409, 'Signature source-document binding is invalid');
  }
  return binding;
}

async function esignLoadSourceBytes(base44, row, binding) {
  const bytes = await esignReadPrivateBytes(base44, binding.file_uri, ESIGN_MAX_SOURCE_BYTES);
  if (await esignSha256Bytes(bytes) !== row.document_content_sha256) {
    throw new EsignError(409, 'Source document bytes do not match the reviewed digest', 'source_digest_mismatch');
  }
  return bytes;
}

async function esignLoadSignerFacts(base44, row, options) {
  const entities = base44.asServiceRole.entities;
  const roster = Array.isArray(row?.signers) ? row.signers : [];
  if (!roster.length) throw new EsignError(409, 'Signature roster is invalid');
  const facts = [];
  for (const signer of roster) {
    const base = {
      signer_id: signer?.signer_id, signer_name: String(signer?.signer_name || 'Signer'),
      signer_role: signer?.signer_role, email: esignEmail(signer?.email) || '',
      status: signer?.status, signed_at: signer?.signed_at ?? null,
      capture_method: signer?.capture_method || 'emailed_link',
      agreement_version: signer?.agreement_version ?? null, signature_sha256: signer?.signature_sha256 ?? null,
    };
    if (signer?.status !== 'completed') {
      if (options?.requireAll && signer?.required === true) throw new EsignError(409, 'Signatures are still being collected', 'not_ready');
      facts.push(base);
      continue;
    }
    const artifactId = esignId(signer.signature_artifact_id);
    if (!artifactId || !esignDigest(signer.signature_sha256)) throw new EsignError(409, 'Signer completion integrity is invalid');
    const artifact = await esignExactOne(entities.SignatureArtifactBinding,
      { id: artifactId, agency_id: row.agency_id }, 'SignatureArtifactBinding', 409);
    if (artifact.document_signature_id !== row.id || artifact.signer_id !== signer.signer_id
      || artifact.storage_mode !== 'private' || !isPrivateFileUri(artifact.file_uri)
      || artifact.content_sha256 !== signer.signature_sha256
      || !['image/png', 'image/jpeg'].includes(artifact.file_type)
      || artifact.source_document_sha256 !== row.document_content_sha256) {
      throw new EsignError(409, 'Signature artifact integrity check failed');
    }
    const imageBytes = await esignReadPrivateBytes(base44, artifact.file_uri, ESIGN_MAX_ARTIFACT_BYTES);
    if (await esignSha256Bytes(imageBytes) !== artifact.content_sha256) {
      throw new EsignError(409, 'Signature image bytes do not match the recorded digest', 'artifact_digest_mismatch');
    }
    facts.push({
      ...base,
      capture_method: artifact.capture_method || base.capture_method,
      agreement_text_sha256: artifact.agreement_text_sha256 ?? null,
      imageBytes, imageType: artifact.file_type,
    });
  }
  return facts;
}

async function esignRenderRow(base44, row, options) {
  const entities = base44.asServiceRole.entities;
  const binding = await esignLoadSourceBinding(entities, row);
  const sourceBytes = await esignLoadSourceBytes(base44, row, binding);
  const signers = await esignLoadSignerFacts(base44, row, { requireAll: !options?.preview });
  const agreementDigests = [...new Set(signers.map((signer) => signer.agreement_text_sha256).filter(Boolean))];
  return esignRenderSignedPdf({
    sourceBytes, sourceType: binding.file_type, fields: row.signature_fields, signers,
    meta: {
      title: row.document_title || row.document_name || binding.file_name,
      signatureId: row.id, requestKey: row.request_key, sourceSha256: row.document_content_sha256,
      agreementTextSha256: agreementDigests.length === 1 ? agreementDigests[0] : null,
      completedAt: options?.completedAt || new Date().toISOString(), agencyName: options?.agencyName || null,
    },
    preview: !!options?.preview,
  });
}
// <<<END SHARED HELPER: esignSignedRecord>>>
// <<<BEGIN SHARED HELPER: esignFinalization — generated, edit base44/_shared/backendHelpers.mjs>>>
// Sealing pipeline for one DocumentSignature whose required signers have all
// signed. It re-reads the private source bytes and every private signature
// image, refuses any byte that no longer matches its recorded SHA-256, renders
// the signatures into their placed fields plus a certificate page, hashes the
// exact sealed bytes, files the sealed PDF into the patient's chart through the
// chart-document invariants, and only then marks the document (and any package
// whose every document is sealed) completed. A short lease on the row makes it
// single-writer; every step is idempotent so a retry resumes.
const ESIGN_FINALIZE_LEASE_MS = 10 * 60 * 1000;

async function esignActiveMember(entities, agencyId, userId, email) {
  if (!esignId(userId) || !email) return null;
  const rows = await entities.AgencyMembership.filter({ agency_id: agencyId, user_id: userId }, '-updated_date', ESIGN_ROW_LIMIT)
    .catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  return row?.agency_id === agencyId && row?.user_id === userId && row?.status === 'active'
    && row?.membership_key === agencyId + ':' + userId && esignEmail(row?.user_email_normalized) === email
    && Number.isSafeInteger(row?.version) && row.version >= 1 ? row : null;
}

// A request's documents share request_key; its packages share (agency_id,
// created_by_user_id, client_request_id) with the signature row.
async function esignSyncRequestPackages(entities, agencyId, row) {
  const requestKey = row?.request_key;
  if (!esignDigest(requestKey)) return 0;
  const signatures = esignRows(await entities.DocumentSignature.filter(
    { agency_id: agencyId, request_key: requestKey }, undefined, 50,
  ), 'DocumentSignature.filter');
  const byId = new Map(signatures.filter((doc) => doc?.agency_id === agencyId && doc?.request_key === requestKey)
    .map((doc) => [doc.id, doc]));
  const packages = await esignLoadRequestPackages(entities, agencyId, row.created_by_user_id, row.client_request_id);
  let completed = 0;
  for (const pkg of packages) {
    if (!['pending', 'in_progress'].includes(pkg.status) || !Number.isSafeInteger(pkg.authority_version)) continue;
    const ids = Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [];
    if (!ids.length || !ids.every((id) => byId.get(id)?.status === 'completed')) continue;
    const result = await entities.DocumentPackage.updateMany(
      { id: pkg.id, agency_id: agencyId, status: pkg.status, authority_version: pkg.authority_version },
      { $set: { status: 'completed', completed_at: new Date().toISOString(), authority_version: pkg.authority_version + 1 } },
    ).catch(() => null);
    if (esignSingleUpdate(result)) completed += 1;
  }
  return completed;
}

function esignCompletionEmailHtml() {
  const origin = String(Deno.env.get('APP_PUBLIC_URL') || '').trim();
  let link = '';
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && !url.username && !url.password) link = url.origin + '/DocumentHub';
  } catch { link = ''; }
  return '<!doctype html><html><body>'
    + '<p>A document you sent for electronic signature has been signed by every required signer.</p>'
    + '<p>The sealed signed PDF and its signature certificate are filed to the patient’s chart in PennSync.</p>'
    + (link ? '<p><a href="' + link + '">Open the Document Hub</a></p>' : '<p>Sign in to PennSync to view it.</p>')
    + '<p>This message intentionally contains no patient or signer details.</p></body></html>';
}

// In-app notification (always, idempotent by dedupe_key) and one email (only
// when outbound delivery is released). Neither names the patient or signer.
async function esignNotifyCreator(base44, row, options) {
  const entities = base44.asServiceRole.entities;
  if (row?.status !== 'completed' || !esignId(row?.id)) return { notified: false, emailed: false };
  const creatorEmail = esignEmail(row.created_by_user_email_normalized);
  const recipient = await esignActiveMember(entities, row.agency_id, row.created_by_user_id, creatorEmail);
  if (!recipient) return { notified: false, emailed: false };
  const dedupeKey = 'esign-completed:' + row.agency_id + ':' + row.id;
  const existing = esignRows(await entities.Notification.filter({ dedupe_key: dedupeKey }, '-created_date', 5),
    'Notification.filter');
  let notified = existing.length > 0;
  if (!notified) {
    await entities.Notification.create({
      agency_id: row.agency_id,
      dedupe_key: dedupeKey,
      recipient_user_id: recipient.user_id,
      recipient_membership_id: recipient.id,
      recipient_membership_version: recipient.version,
      authority_version: 1,
      authority_state: 'active',
      version: 1,
      user_email: recipient.user_email_normalized,
      title: 'Signature request completed',
      message: 'Every required signer has signed. The sealed signed PDF and its certificate are filed to the patient chart.',
      type: 'signature_request',
      priority: 'medium',
      metadata: {
        agency_id: row.agency_id, related_entity: 'DocumentSignature',
        related_entity_id: row.id, workflow: 'esign_completed',
      },
      is_read: false,
      dismissed: false,
      action_url: '/DocumentHub?tab=signatures',
    });
    notified = true;
  }
  let emailed = row.admin_notified === true;
  if (!emailed && outboundDeliveryReleased()) {
    const claimId = crypto.randomUUID();
    const claimFilter = options?.forceEmail
      ? { id: row.id, agency_id: row.agency_id, status: 'completed' }
      : { id: row.id, agency_id: row.agency_id, status: 'completed', admin_notify_claimed_by: null };
    const claim = await entities.DocumentSignature.updateMany(claimFilter,
      { $set: { admin_notify_claimed_by: claimId } }).catch(() => null);
    if (esignSingleUpdate(claim)) {
      // A provider exception is indeterminate: the claim stays, so no automatic
      // resend happens; notifyAdminOfSignedDocument can resend deliberately.
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: recipient.user_email_normalized,
        from_name: 'PennSync by CareMetric',
        subject: 'A signature request is complete',
        body: esignCompletionEmailHtml(),
      });
      await entities.DocumentSignature.updateMany(
        { id: row.id, agency_id: row.agency_id, admin_notify_claimed_by: claimId },
        { $set: { admin_notified: true } },
      ).catch(() => null);
      emailed = true;
    }
  }
  return { notified, emailed };
}

/**
 * Seal one document. actor: { type: 'system'|'authenticated_user'|'scheduler',
 *   userId?, membershipId?, membershipVersion? }.
 * Returns { state: 'completed'|'already_completed'|'not_ready'|'busy', row, ... }.
 */
async function esignFinalizeSignature(base44, input) {
  const entities = base44.asServiceRole.entities;
  const agencyId = esignId(input?.agencyId);
  const signatureId = esignId(input?.signatureId);
  if (!agencyId || !signatureId) throw new EsignError(400, 'Exact agency and document ids are required');
  let row = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 404);
  if (row.status === 'completed' && row.workflow_status === 'completed' && esignId(row.signed_document_id)) {
    await esignSyncRequestPackages(entities, agencyId, row).catch(() => 0);
    await esignNotifyCreator(base44, row).catch(() => null);
    return { state: 'already_completed', row };
  }
  if (row.status !== 'in_progress' || row.workflow_status !== 'signatures_collected'
    || !Number.isSafeInteger(row.authority_version)) return { state: 'not_ready', row };
  const roster = Array.isArray(row.signers) ? row.signers : [];
  if (!roster.length || roster.some((signer) => signer?.required === true && signer?.status !== 'completed')) {
    return { state: 'not_ready', row };
  }
  if (esignId(row.finalize_claimed_by) && esignInstant(row.finalize_claimed_at)
    && Date.parse(row.finalize_claimed_at) > Date.now() - ESIGN_FINALIZE_LEASE_MS) {
    return { state: 'busy', row };
  }
  const creator = {
    userId: esignId(row.created_by_user_id),
    email: esignEmail(row.created_by_user_email_normalized),
    membershipId: esignId(row.creator_membership_id),
    membershipVersion: row.creator_membership_version,
  };
  if (!creator.userId || !creator.email || !creator.membershipId
    || !Number.isSafeInteger(creator.membershipVersion) || creator.membershipVersion < 1) {
    throw new EsignError(409, 'Signature request creator provenance is invalid');
  }
  const claimId = crypto.randomUUID();
  const claimFilter = {
    id: signatureId, agency_id: agencyId, status: 'in_progress',
    workflow_status: 'signatures_collected', authority_version: row.authority_version,
  };
  const claim = await entities.DocumentSignature.updateMany(claimFilter, { $set: {
    finalize_claimed_by: claimId, finalize_claimed_at: new Date().toISOString(),
    authority_version: row.authority_version + 1,
  } });
  if (!esignSingleUpdate(claim)) return { state: 'busy', row };
  row = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 409);
  if (row.finalize_claimed_by !== claimId) return { state: 'busy', row };
  const claimedVersion = row.authority_version;
  try {
    const agency = await esignExactOne(entities.Agency, { id: agencyId }, 'Agency', 409);
    const completedAt = new Date().toISOString();
    const clientRequestId = 'esign-sealed-' + signatureId;
    const fileInput = {
      agencyId, patientId: row.patient_id, creator, clientRequestId,
      fileName: 'Signed ' + String(row.document_title || row.document_name || 'document'),
      render: () => esignRenderRow(base44, row, { preview: false, completedAt, agencyName: agency.agency_name }),
      extra: { is_signed: true, is_locked: true, description: 'Sealed electronic signature record' },
    };
    let filed;
    try {
      filed = await esignFileChartDocument(base44, fileInput);
    } catch (error) {
      if (!(error instanceof EsignError) || error.code !== 'filing_in_progress') throw error;
      // This invocation holds the exclusive sealing lease, so a reservation for
      // this filing key can only belong to a dead attempt.
      await esignClearStaleFiling(base44, agencyId, clientRequestId, creator.userId);
      filed = await esignFileChartDocument(base44, fileInput);
    }
    const sealedSha256 = filed.binding.content_sha256;
    const sealedAt = filed.binding.created_at || completedAt;
    const completion = await entities.DocumentSignature.updateMany(
      { id: signatureId, agency_id: agencyId, finalize_claimed_by: claimId,
        workflow_status: 'signatures_collected', authority_version: claimedVersion },
      { $set: {
        status: 'completed', workflow_status: 'completed',
        completed_at: sealedAt, completed_date: sealedAt, finalized_at: sealedAt,
        signature_hash: sealedSha256, signature_hash_alg: 'SHA-256', signature_hash_at: sealedAt,
        signature_hash_payload_v: 3,
        signed_document_id: filed.document.id, signed_document_binding_id: filed.binding.id,
        signed_file_size: filed.binding.file_size, archived: true,
        finalize_claimed_by: null, finalize_claimed_at: null,
        authority_version: claimedVersion + 1,
      } },
    );
    const sealed = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 409);
    if ((!esignSingleUpdate(completion) && sealed.signed_document_id !== filed.document.id)
      || sealed.status !== 'completed' || sealed.signature_hash !== sealedSha256) {
      throw new EsignError(409, 'Signature completion requires reconciliation');
    }
    await esignAudit(entities, {
      event_key: await esignSha256('document_finalized\u0000' + signatureId + '\u0000' + sealedSha256),
      agency_id: agencyId, document_signature_id: signatureId,
      action: 'document_finalized', actor_type: input?.actor?.type || 'system',
      ...(esignId(input?.actor?.userId) ? { actor_user_id: input.actor.userId } : {}),
      ...(esignId(input?.actor?.membershipId) ? { membership_id: input.actor.membershipId,
        membership_version: input.actor.membershipVersion } : {}),
      request_id: claimId, authority_version: sealed.authority_version,
      document_content_sha256: row.document_content_sha256, artifact_content_sha256: sealedSha256,
      occurred_at: sealedAt,
    }).catch(() => null);
    await esignSyncRequestPackages(entities, agencyId, row).catch(() => 0);
    const notice = await esignNotifyCreator(base44, sealed).catch(() => null);
    return {
      state: 'completed', row: sealed, signedDocumentId: filed.document.id,
      signedSha256: sealedSha256, notified: !!notice?.notified,
    };
  } catch (error) {
    // Return the lease at once unless a chart-filing create started without
    // being verified: then the lease expires on its own and the retry resumes
    // that exact filing (a verified filing is always reused, never repeated).
    if (error?.esignFilingStarted !== true) {
      await entities.DocumentSignature.updateMany(
        { id: signatureId, agency_id: agencyId, finalize_claimed_by: claimId, authority_version: claimedVersion },
        { $set: { finalize_claimed_by: null, finalize_claimed_at: null, authority_version: claimedVersion + 1 } },
      ).catch(() => null);
    }
    throw error;
  }
}
// <<<END SHARED HELPER: esignFinalization>>>
/**
 * Private-artifact, review-grant-bound external signature submit broker
 * (released 2026-10-08, owner decision). The signer's hashed link plus a
 * one-use review grant are the only authority. The drawn image is checked as a
 * real PNG/JPEG under 1 MiB, the typed name must match the signer the request
 * named, the image goes to private storage only, and the exact bytes' SHA-256
 * is bound to the reviewed source digest and consent text. A retry with the
 * same client_request_id reconciles instead of recording a second act.
 * When the last required signer signs, the document is sealed in the same
 * call (esignFinalizeSignature): stamped, certified, hashed, filed to the
 * chart; a sealing failure leaves the signature recorded and is retried by
 * checkPendingSignatureRequests or onDocumentSigned.
 */
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const MAX_SIGNATURE_FILE_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_SIGNATURE_FILE_BYTES + 32 * 1024;
const AGREEMENT_VERSION = 'signature-consent-v1';
const CLAIM_LEASE_MS = 5 * 60 * 1000;

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

const SIGNING_NOT_CONFIGURED = 'Electronic signing is not configured yet. Please contact your care team.';

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_IDENTIFIER_LENGTH
      || value.trim() !== value || value.startsWith('$')
      || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email) ? email : null;
}

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
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

function currentDeadline(token: Record<string, any>, pkg: Record<string, any>, signatures: Array<Record<string, any>>) {
  const deadlines = [Date.parse(token.expires_at)];
  for (const row of [pkg, ...signatures]) {
    if (row.due_date != null) {
      const millis = dueDateEnd(row.due_date);
      if (millis === null) {
        throw new PublicError(401, 'Invalid or expired signing authority');
      }
      deadlines.push(millis);
    }
    for (const field of ['expires_at', 'expiration_date']) {
      if (row[field] == null) continue;
      if (!validInstant(row[field])) throw new PublicError(401, 'Invalid or expired signing authority');
      deadlines.push(Date.parse(row[field]));
    }
  }
  const deadline = Math.min(...deadlines);
  if (!Number.isFinite(deadline) || Date.now() >= deadline || Date.parse(token.expires_at) > deadline) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  return new Date(deadline).toISOString();
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

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function signerAuthorityRoster(signers: Array<Record<string, any>>) {
  return signers.map((signer) => ({
    signer_id: signer.signer_id,
    signer_name: signer.signer_name,
    signer_role: signer.signer_role,
    email: signer.email,
    required: signer.required,
  }));
}

function canonicalName(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
    : '';
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function validSignatureImage(bytes: Uint8Array, fileType: string) {
  if (fileType === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const iend = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    return bytes.length >= 33
      && png.every((value, index) => bytes[index] === value)
      && iend.every((value, index) => bytes[bytes.length - iend.length + index] === value);
  }
  return fileType === 'image/jpeg' && bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

// <<<BEGIN SHARED HELPER: signatureAuditKeys — generated, edit base44/_shared/backendHelpers.mjs>>>
function signatureAuditKeyId(value) {
  if (value == null) return 'legacy';
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new Error('Signature audit key identity is invalid');
  return value;
}

function signatureAuditKeyring() {
  const configured = Deno.env.get('SIGNATURE_HMAC_KEYRING');
  if (!configured) {
    if (Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID')) throw new Error('Signature audit keyring is not configured');
    const secret = String(Deno.env.get('SIGNATURE_HMAC_SECRET') || '');
    if (secret.length < 32) throw new Error('Signature audit is not configured');
    return { activeId: 'legacy', keys: { legacy: secret } };
  }
  if (configured.length > 16384) throw new Error('Signature audit keyring is invalid');
  let keys;
  try {
    // Parse the flat string map without silently overwriting duplicate JSON keys.
    // JSON.parse on each string also normalizes escaped-equivalent key names.
    let offset = 0;
    const space = () => { while (/^[\t\r\n ]$/.test(configured[offset] || '')) offset += 1; };
    const take = (character) => { space(); if (configured[offset++] !== character) throw new Error('Invalid keyring'); };
    const string = () => {
      space();
      const start = offset;
      if (configured[offset++] !== '"') throw new Error('Invalid keyring string');
      while (offset < configured.length) {
        const character = configured[offset++];
        if (character === '"') return JSON.parse(configured.slice(start, offset));
        if (character.charCodeAt(0) === 92) offset += 1;
      }
      throw new Error('Unterminated keyring string');
    };
    keys = Object.create(null);
    take('{');
    space();
    if (configured[offset] !== '}') {
      while (true) {
        const id = string();
        if (Object.hasOwn(keys, id)) throw new Error('Duplicate keyring identity');
        take(':');
        keys[id] = string();
        space();
        if (configured[offset] !== ',') break;
        offset += 1;
      }
    }
    take('}');
    space();
    if (offset !== configured.length) throw new Error('Invalid keyring suffix');
  } catch { throw new Error('Signature audit keyring is invalid'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length < 1 || Object.keys(keys).length > 8) {
    throw new Error('Signature audit keyring is invalid');
  }
  for (const [id, secret] of Object.entries(keys)) {
    signatureAuditKeyId(id);
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024) throw new Error('Signature audit keyring is invalid');
  }
  const activeId = Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID');
  if (!activeId || !Object.hasOwn(keys, signatureAuditKeyId(activeId))) throw new Error('Signature audit active key is unavailable');
  return { activeId, keys };
}

function retainedSignatureAuditKey(keyring, id) {
  const keyId = signatureAuditKeyId(id);
  if (!Object.hasOwn(keyring.keys, keyId)) throw new Error('Signature audit verification key is unavailable');
  return keyring.keys[keyId];
}
// <<<END SHARED HELPER: signatureAuditKeys>>>

// <<<BEGIN SHARED HELPER: signatureAuditDigest — generated, edit base44/_shared/backendHelpers.mjs>>>
async function hmacAudit(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  // Preserve the historical digest representation for existing artifacts.
  return sha256Bytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
// <<<END SHARED HELPER: signatureAuditDigest>>>

async function configuredAgreementDigest() {
  const digest = String(Deno.env.get('SIGNATURE_AGREEMENT_SHA256') || '').trim().toLowerCase();
  const text = String(Deno.env.get('SIGNATURE_AGREEMENT_TEXT') || '').trim();
  if (!exactDigest(digest) || text.length < 40 || text.length > 5_000 || await sha256(text) !== digest) {
    throw new PublicError(503, SIGNING_NOT_CONFIGURED, 'signature_agreement_not_configured');
  }
  return digest;
}

function oneString(form: FormData, name: string) {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string') throw new PublicError(400, `${name} is invalid`);
  return values[0];
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  if (!/^multipart\/form-data\s*;/i.test(req.headers.get('content-type') || '')) {
    throw new PublicError(415, 'multipart/form-data is required');
  }
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_MULTIPART_BYTES) throw new PublicError(413, 'Signature upload is too large');
  const form = await req.formData().catch(() => { throw new PublicError(400, 'Invalid multipart body'); });
  const allowed = new Set(['token', 'review_nonce', 'document_id', 'signature_file', 'typed_name', 'agreement_version', 'client_request_id']);
  for (const [key] of form.entries()) if (!allowed.has(key)) throw new PublicError(400, `Unsupported signature field: ${key}`);
  const token = oneString(form, 'token');
  const reviewNonce = oneString(form, 'review_nonce');
  const documentId = exactIdentifier(oneString(form, 'document_id'));
  const clientRequestId = exactIdentifier(oneString(form, 'client_request_id'));
  const agreementVersion = oneString(form, 'agreement_version');
  const typedName = oneString(form, 'typed_name').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{43}$/.test(reviewNonce)) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  if (!documentId || !clientRequestId || agreementVersion !== AGREEMENT_VERSION
      || typedName.length < 2 || typedName.length > 200
      || [...typedName].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) {
    throw new PublicError(400, 'Signature submission is invalid');
  }
  const files = form.getAll('signature_file');
  if (files.length !== 1 || typeof File === 'undefined' || !(files[0] instanceof File)) {
    throw new PublicError(400, 'signature_file must be a File');
  }
  const file = files[0] as File;
  const fileType = String(file.type || '').toLowerCase();
  const lowerName = String(file.name || '').toLowerCase();
  const extensionOk = fileType === 'image/png' ? lowerName.endsWith('.png')
    : fileType === 'image/jpeg' ? (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) : false;
  if (!extensionOk || !Number.isSafeInteger(file.size) || file.size < 100 || file.size > MAX_SIGNATURE_FILE_BYTES) {
    throw new PublicError(400, 'Signature file is invalid');
  }
  return { token, reviewNonce, documentId, clientRequestId, agreementVersion, typedName, file, fileType };
}

function validateSigner(raw: unknown, signerId: string, signerEmail: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicError(409, 'Signer authority is invalid');
  const signer = raw as Record<string, any>;
  if (signer.signer_id !== signerId || canonicalEmail(signer.email) !== signerEmail || signer.email !== signerEmail
      || typeof signer.signer_name !== 'string' || !signer.signer_name.trim() || signer.required !== true
      || !['pending', 'completed', 'declined'].includes(signer.status)
      || signer.signature_data != null || signer.ip_address != null || signer.device_info != null) {
    throw new PublicError(409, 'Signer authority is invalid');
  }
  if (signer.status === 'completed' && (!validInstant(signer.signed_at)
      || !exactIdentifier(signer.signature_artifact_id) || !exactDigest(signer.signature_sha256)
      || signer.agreement_version !== AGREEMENT_VERSION)) throw new PublicError(409, 'Signer completion integrity is invalid');
  if (signer.status !== 'completed' && (signer.signed_at != null || signer.signature_artifact_id != null
      || signer.signature_sha256 != null || signer.agreement_version != null)) {
    throw new PublicError(409, 'Signer completion integrity is invalid');
  }
  return signer;
}

async function exactOne(entity: Record<string, any>, query: Record<string, any>, label: string) {
  const rows = requireRows(await entity.filter(query, undefined, EXACT_ROW_LIMIT), `${label}.filter`);
  if (rows.length !== 1) throw new PublicError(401, 'Invalid or expired signing authority');
  for (const [key, value] of Object.entries(query)) {
    if (rows[0]?.[key] !== value) throw new PublicError(409, `${label} query scope could not be verified`);
  }
  return rows[0];
}

async function loadContext(
  entities: Record<string, any>,
  input: Record<string, any>,
  tokenDigest: string,
  grantDigest: string,
  agreementTextDigest: string,
  operationId: string | null = null,
  forArtifactLookup = false,
) {
  const token = await exactOne(entities.DocumentPackageToken, { token: tokenDigest, token_hashed: true }, 'DocumentPackageToken');
  const tokenId = exactIdentifier(token.id);
  const agencyId = exactIdentifier(token.agency_id);
  const packageId = exactIdentifier(token.package_id);
  const signerId = exactIdentifier(token.signer_id);
  const signerEmail = canonicalEmail(token.signer_email);
  const tokenClaimedForRequest = token.status === 'claimed'
    && token.claimed_by_request_id === input.clientRequestId
    && token.claimed_document_id === input.documentId;
  const tokenClaimedForOperation = tokenClaimedForRequest && operationId !== null
    && token.claimed_by_operation_id === operationId;
  const tokenCompletedForRequest = ['active', 'consumed'].includes(token.status)
    && token.last_completed_request_id === input.clientRequestId
    && token.last_completed_document_id === input.documentId;
  if (!tokenId || !agencyId || !packageId || !signerId || !signerEmail || token.signer_email !== signerEmail
      || (token.status !== 'active' && !tokenClaimedForRequest && !tokenCompletedForRequest)
      || (token.status === 'consumed' ? token.is_active !== false : token.is_active !== true)
      || !Number.isSafeInteger(token.authority_version) || token.authority_version < 1
      || !validInstant(token.expires_at)
      || (!forArtifactLookup && !tokenCompletedForRequest && Date.now() >= Date.parse(token.expires_at))) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const grant = await exactOne(entities.SignerReviewGrant, {
    grant_key: grantDigest, token_id: tokenId, document_signature_id: input.documentId,
  }, 'SignerReviewGrant');
  if (input.auditKeyId && signatureAuditKeyId(grant.hmac_key_id) !== input.auditKeyId) {
    throw new PublicError(409, 'Signature audit key identity changed');
  }
  const grantClaimedForRequest = grant.status === 'claimed'
    && grant.claimed_by_request_id === input.clientRequestId
    && grant.claimed_document_id === input.documentId;
  const grantClaimedForOperation = grantClaimedForRequest && operationId !== null
    && grant.claimed_by_operation_id === operationId;
  const grantCompletedForRequest = grant.status === 'consumed'
    && grant.claimed_by_request_id === input.clientRequestId
    && grant.claimed_document_id === input.documentId;
  if (grant.agency_id !== agencyId || grant.package_id !== packageId || grant.signer_id !== signerId
      || (grant.status !== 'active' && !grantClaimedForRequest && !grantCompletedForRequest)
      || !Number.isSafeInteger(grant.authority_version) || grant.authority_version < 1
      || !validInstant(grant.issued_at) || !validInstant(grant.expires_at)
      || (!forArtifactLookup && !grantCompletedForRequest && Date.now() >= Date.parse(grant.expires_at))
      || !exactDigest(grant.document_content_sha256)
      || grant.agreement_text_sha256 !== agreementTextDigest
      || !exactDigest(grant.signer_roster_sha256)
      || !exactIdentifier(grant.document_binding_id)
      || grant.document_binding_version !== 2
      || !Number.isSafeInteger(grant.package_authority_version)
      || !Number.isSafeInteger(grant.document_authority_version)) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const pkg = await exactOne(entities.DocumentPackage, { id: packageId, agency_id: agencyId }, 'DocumentPackage');
  const documentIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  const tokenDocumentIds = Array.isArray(token.document_ids) ? token.document_ids.map(exactIdentifier) : [];
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const creatorMembershipId = exactIdentifier(pkg.creator_membership_id);
  if (!patientId || !creatorId || !creatorEmail || !creatorMembershipId
      || pkg.signer_id !== signerId || canonicalEmail(pkg.signer_email) !== signerEmail
      || !Number.isSafeInteger(pkg.creator_membership_version) || pkg.creator_membership_version < 1
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || !(['pending', 'in_progress'].includes(pkg.status) || (forArtifactLookup && pkg.status === 'completed'))
      || (pkg.authority_version !== grant.package_authority_version
        && !(pkg.status === 'in_progress' && pkg.authority_version === grant.package_authority_version + 1)
        // Reconciling an already-recorded artifact only: sealing may have moved the package on.
        && !(forArtifactLookup && ['in_progress', 'completed'].includes(pkg.status)
          && pkg.authority_version > grant.package_authority_version))
      || !documentIds.includes(input.documentId) || JSON.stringify(documentIds) !== JSON.stringify(tokenDocumentIds)
      || documentIds.includes(null) || new Set(documentIds).size !== documentIds.length) {
    throw new PublicError(409, 'Signature package integrity check failed');
  }
  const agency = await exactOne(entities.Agency, { id: agencyId }, 'Agency');
  if (!['active', 'trial'].includes(agency.status)) throw new PublicError(401, 'Invalid or expired signing authority');
  const membership = await exactOne(entities.AgencyMembership, {
    id: creatorMembershipId, agency_id: agencyId, user_id: creatorId,
  }, 'AgencyMembership');
  if (membership.status !== 'active' || membership.version !== pkg.creator_membership_version
      || canonicalEmail(membership.user_email_normalized) !== creatorEmail) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const patient = await exactOne(entities.Patient, {
    id: patientId, agency_id: agencyId, is_sample: false, is_archived: false,
  }, 'Patient');
  if (patient.id !== patientId) throw new PublicError(409, 'Signature patient authority is invalid');
  const signature = await exactOne(entities.DocumentSignature, { id: input.documentId, agency_id: agencyId }, 'DocumentSignature');
  // Exact completed retries may reconcile their existing artifact after expiry;
  // they cannot create a new signature. Every new act uses current deadlines.
  if (!forArtifactLookup && (!tokenCompletedForRequest || !grantCompletedForRequest)) {
    const authoritySignatures = [signature];
    for (const id of documentIds) {
      if (id !== input.documentId) authoritySignatures.push(await exactOne(
        entities.DocumentSignature, { id, agency_id: agencyId }, 'DocumentSignature',
      ));
    }
    currentDeadline(token, pkg, authoritySignatures);
  }
  const signers = Array.isArray(signature.signers) ? signature.signers : [];
  const signerIndex = signers.findIndex((candidate) => candidate?.signer_id === signerId);
  const signer = signerIndex >= 0 ? validateSigner(signers[signerIndex], signerId, signerEmail) : null;
  const bindingId = exactIdentifier(signature.document_binding_id);
  const sourceDocumentId = exactIdentifier(signature.document_id);
  // A sealed document is reachable only to reconcile this signer's own,
  // already-recorded artifact (a retry whose response was lost).
  const sealedForSigner = forArtifactLookup && signer?.status === 'completed'
    && signature.status === 'completed' && signature.workflow_status === 'completed';
  if (!signer || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
      || canonicalEmail(signature.created_by_user_email_normalized) !== creatorEmail
      || signature.creator_membership_id !== creatorMembershipId
      || signature.creator_membership_version !== pkg.creator_membership_version
      || !bindingId || !sourceDocumentId || signature.document_binding_version !== 2
      || signature.document_content_sha256 !== grant.document_content_sha256
      || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
      || (!sealedForSigner && (!['pending', 'in_progress'].includes(signature.status)
        || !['pending', 'partial', 'signatures_collected'].includes(signature.workflow_status)
        || signature.completed_date != null || signature.completed_at != null))
      || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
    throw new PublicError(409, 'Signature document integrity check failed');
  }
  const binding = await exactOne(entities.DocumentTenantBinding, {
    id: bindingId, agency_id: agencyId, document_id: sourceDocumentId,
  }, 'DocumentTenantBinding');
  if (binding.patient_id !== patientId || binding.storage_mode !== 'private' || binding.version !== 2
      || binding.content_sha256 !== signature.document_content_sha256
      || binding.id !== grant.document_binding_id || binding.version !== grant.document_binding_version
      || typeof binding.file_uri !== 'string'
      || !isPrivateFileUri(binding.file_uri)) {
    throw new PublicError(409, 'Signature source-document binding is invalid');
  }
  const signerRosterDigest = await sha256(JSON.stringify(canonicalJson(signerAuthorityRoster(signers))));
  // A new act must sign exactly the reviewed revision. Reconciling this
  // signer's recorded artifact tolerates later revisions (other signers,
  // sealing), because no new signature is created on that path.
  const documentSnapshotMatches = signature.authority_version === grant.document_authority_version
    || (signer.status === 'completed' && signature.authority_version === grant.document_authority_version + 1)
    || (forArtifactLookup && signer.status === 'completed'
      && signature.authority_version > grant.document_authority_version);
  if (!documentSnapshotMatches || signerRosterDigest !== grant.signer_roster_sha256) {
    throw new PublicError(409, 'Signature review authority changed after document review');
  }
  return {
    token, tokenId, agencyId, packageId, signerId, signerEmail,
    tokenClaimedForRequest, tokenClaimedForOperation, tokenCompletedForRequest,
    grant, grantClaimedForRequest, grantClaimedForOperation, grantCompletedForRequest,
    pkg, documentIds: documentIds as string[],
    signature, signers, signer, signerIndex,
  };
}

async function ensureAudit(
  entities: Record<string, any>,
  payload: Record<string, any>,
  options: { laterRevisionAllowed?: boolean } = {},
) {
  const existing = requireRows(await entities.SignatureAuditEvent.filter(
    { event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (existing.length > 1) throw new Error('Signature audit identity is ambiguous');
  if (existing.length === 1) {
    const row = existing[0];
    for (const field of ['agency_id', 'package_id', 'document_signature_id', 'signer_id', 'token_id',
      'action', 'actor_type', 'request_id', 'authority_version', 'document_content_sha256',
      'artifact_content_sha256', 'client_ip_sha256', 'user_agent_sha256']) {
      // A reconciled replay may find the document moved on (another signer,
      // sealing); the recorded event keeps the revision it was written at.
      if (field === 'authority_version' && options.laterRevisionAllowed
        && Number.isSafeInteger(row[field]) && Number.isSafeInteger(payload[field])
        && row[field] <= payload[field]) continue;
      if ((row[field] ?? null) !== (payload[field] ?? null)) throw new Error('Signature audit identity conflicts with existing provenance');
    }
    if (signatureAuditKeyId(row.hmac_key_id) !== signatureAuditKeyId(payload.hmac_key_id)) throw new Error('Signature audit key identity conflicts');
    return row;
  }
  const row = await entities.SignatureAuditEvent.create(payload);
  if (!exactIdentifier(row?.id)) throw new Error('Signature audit could not be recorded');
  const readback = requireRows(await entities.SignatureAuditEvent.filter(
    { id: row.id, event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (readback.length !== 1 || readback[0]?.id !== row.id) throw new Error('Signature audit could not be verified');
  return readback[0];
}

async function loadSignerCompletion(entities: Record<string, any>, agencyId: string, signatureId: string, signerId: string, signerEmail: string) {
  const row = await exactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature');
  const signer = (Array.isArray(row.signers) ? row.signers : []).find((candidate) => candidate?.signer_id === signerId);
  return { row, signer: signer ? validateSigner(signer, signerId, signerEmail) : null };
}

function validateArtifact(
  artifact: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  artifactKey: string,
  signatureDigest: string,
  typedNameDigest: string,
  agreementTextDigest: string,
) {
  const artifactId = exactIdentifier(artifact.id);
  const fileUri = typeof artifact.file_uri === 'string' ? artifact.file_uri : '';
  if (!artifactId || artifact.artifact_key !== artifactKey || artifact.agency_id !== context.agencyId
      || artifact.package_id !== context.packageId || artifact.document_signature_id !== input.documentId
      || artifact.signer_id !== context.signerId || artifact.token_id !== context.tokenId
      || artifact.client_request_id !== input.clientRequestId || artifact.storage_mode !== 'private'
      || !isPrivateFileUri(fileUri) || fileUri.length > 4096
      || artifact.file_type !== input.fileType || artifact.file_size !== input.file.size
      || artifact.content_sha256 !== signatureDigest || artifact.typed_name_hmac_sha256 !== typedNameDigest
      || signatureAuditKeyId(artifact.hmac_key_id) !== signatureAuditKeyId(context.grant.hmac_key_id)
      || artifact.agreement_version !== input.agreementVersion
      || artifact.agreement_text_sha256 !== agreementTextDigest
      || artifact.source_document_sha256 !== context.signature.document_content_sha256
      || artifact.document_binding_id !== context.signature.document_binding_id
      || artifact.document_binding_version !== context.signature.document_binding_version
      || artifact.version !== 1
      || !exactDigest(artifact.client_ip_sha256) || !exactDigest(artifact.user_agent_sha256)
      || !validInstant(artifact.created_at) || !validInstant(artifact.binding_verified_at)) {
    throw new PublicError(409, 'Signature artifact integrity check failed');
  }
  return artifactId;
}

async function recordArtifactOnSignature(
  entities: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  artifactId: string,
  signatureDigest: string,
  occurredAt: string,
) {
  if (context.signer.status === 'completed') {
    if (context.signer.signature_artifact_id !== artifactId
        || context.signer.signature_sha256 !== signatureDigest
        || context.signer.agreement_version !== input.agreementVersion) {
      throw new PublicError(409, 'Recorded signer state conflicts with the private signature artifact');
    }
    return loadSignerCompletion(
      entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
    );
  }
  if (context.signer.status !== 'pending') {
    throw new PublicError(409, 'This signature can no longer be submitted');
  }
  const updatedSigners = context.signers.map((signer, index) => index === context.signerIndex ? {
    ...signer, status: 'completed', signed_at: occurredAt, signature_artifact_id: artifactId,
    signature_sha256: signatureDigest, agreement_version: input.agreementVersion,
  } : signer);
  const allRequiredSigned = updatedSigners.filter((signer) => signer?.required === true)
    .every((signer) => signer?.status === 'completed');
  const signatureUpdate = await entities.DocumentSignature.updateMany(
    { id: input.documentId, agency_id: context.agencyId,
      authority_version: context.signature.authority_version, status: context.signature.status },
    { $set: {
      signers: updatedSigners,
      // Signature capture is deliberately nonterminal. A separate reviewed
      // broker must stamp, integrity-bind, certificate, and privately archive
      // the composite before either this row or its package can be completed.
      status: 'in_progress', workflow_status: allRequiredSigned ? 'signatures_collected' : 'partial',
      signatures_collected_at: allRequiredSigned ? occurredAt : null,
      completed_date: null, completed_at: null,
      submit_claimed_by: input.clientRequestId, submit_claimed_at: occurredAt,
      authority_version: context.signature.authority_version + 1,
    } },
  );
  const completed = await loadSignerCompletion(
    entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
  );
  if ((!successfulSingleUpdate(signatureUpdate) && completed.signer?.signature_artifact_id !== artifactId)
      || completed.row.status !== 'in_progress'
      || completed.signer?.status !== 'completed'
      || completed.signer?.signature_artifact_id !== artifactId
      || completed.signer?.signature_sha256 !== signatureDigest
      || completed.signer?.agreement_version !== input.agreementVersion) {
    throw new PublicError(409, 'Signature state changed concurrently; reconciliation is required');
  }
  return completed;
}

async function finalizeRecordedSignature(
  entities: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  tokenDigest: string,
  grantDigest: string,
  artifactId: string,
  signatureDigest: string,
  occurredAt: string,
  clientIpDigest: string,
  userAgentDigest: string,
) {
  const completed = await loadSignerCompletion(
    entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
  );
  if (completed.signer?.status !== 'completed'
      || completed.signer.signature_artifact_id !== artifactId
      || completed.signer.signature_sha256 !== signatureDigest
      || completed.signer.agreement_version !== input.agreementVersion) {
    throw new PublicError(409, 'Signature completion requires reconciliation');
  }
  await ensureAudit(entities, {
    event_key: await sha256(`signature_recorded\0${artifactId}\0${input.clientRequestId}`),
    agency_id: context.agencyId, package_id: context.packageId,
    document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
    action: 'signature_recorded', actor_type: 'external_signer', request_id: input.clientRequestId,
    authority_version: completed.row.authority_version,
    document_content_sha256: context.signature.document_content_sha256,
    artifact_content_sha256: signatureDigest,
    hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id), client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
    occurred_at: occurredAt,
  }, { laterRevisionAllowed: true });

  const memberStates = [];
  for (const memberId of context.documentIds) {
    memberStates.push(await loadSignerCompletion(
      entities, context.agencyId, memberId, context.signerId, context.signerEmail,
    ));
  }
  const signerPackageComplete = memberStates.every((state) => state.signer?.status === 'completed');

  let grantVersion = context.grant.authority_version;
  if (context.grant.status === 'claimed') {
    const grantConsume = await entities.SignerReviewGrant.updateMany(
      { id: context.grant.id, grant_key: grantDigest, status: 'claimed',
        claimed_by_request_id: input.clientRequestId,
        claimed_by_operation_id: context.grant.claimed_by_operation_id,
        claimed_document_id: input.documentId,
        authority_version: grantVersion },
      { $set: { status: 'consumed', consumed_at: occurredAt, authority_version: grantVersion + 1 } },
    );
    if (!successfulSingleUpdate(grantConsume)) {
      const currentGrant = await exactOne(entities.SignerReviewGrant,
        { id: context.grant.id, grant_key: grantDigest }, 'SignerReviewGrant');
      if (currentGrant.status !== 'consumed' || currentGrant.claimed_by_request_id !== input.clientRequestId
          || currentGrant.claimed_by_operation_id !== context.grant.claimed_by_operation_id
          || currentGrant.claimed_document_id !== input.documentId
          || currentGrant.authority_version !== grantVersion + 1) {
        throw new PublicError(409, 'Review grant completion requires reconciliation');
      }
    }
    grantVersion += 1;
  } else if (context.grant.status !== 'consumed' || context.grant.claimed_by_request_id !== input.clientRequestId) {
    throw new PublicError(409, 'Review grant completion requires reconciliation');
  }
  await ensureAudit(entities, {
    event_key: await sha256(`review_grant_consumed\0${context.grant.id}\0${input.clientRequestId}`),
    agency_id: context.agencyId, package_id: context.packageId,
    document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
    action: 'review_grant_consumed', actor_type: 'external_signer', request_id: input.clientRequestId,
    authority_version: grantVersion,
    document_content_sha256: context.signature.document_content_sha256,
    hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id), client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
    occurred_at: occurredAt,
  });

  const tokenNextStatus = signerPackageComplete ? 'consumed' : 'active';
  let tokenVersion = context.token.authority_version;
  if (context.token.status === 'claimed') {
    const tokenUpdate = await entities.DocumentPackageToken.updateMany(
      { id: context.tokenId, token: tokenDigest, status: 'claimed',
        claimed_by_request_id: input.clientRequestId,
        claimed_by_operation_id: context.token.claimed_by_operation_id,
        claimed_document_id: input.documentId,
        authority_version: tokenVersion },
      { $set: {
        status: tokenNextStatus, is_active: !signerPackageComplete,
        consumed_at: signerPackageComplete ? occurredAt : null,
        claimed_at: null, claimed_by_request_id: null, claimed_by_operation_id: null,
        claimed_document_id: null,
        submission_upload_operation_id: null, submission_upload_started_at: null,
        last_completed_request_id: input.clientRequestId,
        last_completed_document_id: input.documentId,
        authority_version: tokenVersion + 1,
      } },
    );
    if (!successfulSingleUpdate(tokenUpdate)) {
      const currentToken = await exactOne(entities.DocumentPackageToken,
        { id: context.tokenId, token: tokenDigest, token_hashed: true }, 'DocumentPackageToken');
      if (currentToken.status !== tokenNextStatus || currentToken.is_active !== !signerPackageComplete
          || currentToken.last_completed_request_id !== input.clientRequestId
          || currentToken.last_completed_document_id !== input.documentId
          || currentToken.claimed_by_operation_id != null
          || currentToken.claimed_document_id != null
          || currentToken.submission_upload_operation_id != null || currentToken.submission_upload_started_at != null
          || currentToken.authority_version !== tokenVersion + 1) {
        throw new PublicError(409, 'Signer token completion requires reconciliation');
      }
    }
    tokenVersion += 1;
  } else if (!context.tokenCompletedForRequest || context.token.status !== tokenNextStatus
      || context.token.is_active !== !signerPackageComplete) {
    throw new PublicError(409, 'Signer token completion requires reconciliation');
  }

  const currentPackage = await exactOne(entities.DocumentPackage,
    { id: context.packageId, agency_id: context.agencyId }, 'DocumentPackage');
  if (currentPackage.status === 'pending') {
    const packageUpdate = await entities.DocumentPackage.updateMany(
      { id: context.packageId, agency_id: context.agencyId,
        status: 'pending', authority_version: currentPackage.authority_version },
      { $set: { status: 'in_progress', completed_at: null,
        authority_version: currentPackage.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(packageUpdate)) {
      const reconciled = await exactOne(entities.DocumentPackage,
        { id: context.packageId, agency_id: context.agencyId }, 'DocumentPackage');
      if (reconciled.status !== 'in_progress' || reconciled.completed_at != null) {
        throw new PublicError(409, 'Signature package transition requires reconciliation');
      }
    }
  } else if (!(currentPackage.status === 'in_progress' && currentPackage.completed_at == null)
      && !(currentPackage.status === 'completed' && signerPackageComplete)) {
    throw new PublicError(409, 'Signature package transition requires reconciliation');
  }
  if (signerPackageComplete) {
    await ensureAudit(entities, {
      event_key: await sha256(`token_consumed\0${context.tokenId}\0${input.clientRequestId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'token_consumed', actor_type: 'external_signer', request_id: input.clientRequestId,
      hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id),
      authority_version: tokenVersion, occurred_at: occurredAt,
    });
  }
  return {
    documentCompleted: false,
    signatureCollected: completed.signer.status === 'completed',
    allSigned: signerPackageComplete,
  };
}

// Seal the document once every required signer has signed. Sealing is a
// separate, idempotent stage: a failure here never undoes the recorded
// signature, and the sweep (checkPendingSignatureRequests) retries it.
async function sealIfCollected(base44: Record<string, any>, agencyId: string, documentId: string) {
  try {
    const sealed = await esignFinalizeSignature(base44, {
      agencyId, signatureId: documentId, actor: { type: 'system' },
    });
    return {
      completed: sealed.state === 'completed' || sealed.state === 'already_completed',
      pending: sealed.state === 'busy',
    };
  } catch {
    return { completed: false, pending: true };
  }
}

function configuredAuditKeyring() {
  try {
    return signatureAuditKeyring();
  } catch {
    // SIGNATURE_HMAC_SECRET (or SIGNATURE_HMAC_KEYRING + SIGNATURE_HMAC_ACTIVE_KEY_ID)
    // is required before any signature is claimed or uploaded.
    throw new PublicError(503, SIGNING_NOT_CONFIGURED, 'signature_audit_key_not_configured');
  }
}

Deno.serve(async (req) => {
  let tokenClaim: Record<string, any> | null = null;
  let uploadMarkerConfirmed = false;
  let storageInvoked = false;
  let grantClaim: Record<string, any> | null = null;
  let cleanupEntities: Record<string, any> | null = null;
  let irreversible = false;
  try {
    const input = await parseRequest(req);
    const auditKeys = configuredAuditKeyring();
    const [signatureBytes, tokenDigest, grantDigest, agreementTextDigest] = await Promise.all([
      input.file.arrayBuffer().then((value) => new Uint8Array(value)),
      sha256(input.token), sha256(input.reviewNonce),
      configuredAgreementDigest(),
    ]);
    if (signatureBytes.byteLength !== input.file.size || !validSignatureImage(signatureBytes, input.fileType)) {
      throw new PublicError(400, 'Signature file content is invalid');
    }
    const signatureDigest = await sha256Bytes(signatureBytes);
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const entities = base44.asServiceRole.entities;
    cleanupEntities = entities;
    const operationId = crypto.randomUUID();
    // Authority/status checks still apply here. Expiry is deferred only until
    // the exact immutable artifact lookup; it never authorizes a new upload.
    let context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, null, true);
    const auditKeyId = signatureAuditKeyId(context.grant.hmac_key_id);
    input.auditKeyId = auditKeyId;
    const auditKey = retainedSignatureAuditKey(auditKeys, auditKeyId);
    const typedNameDigest = await hmacAudit(`name\0${canonicalName(input.typedName)}`, auditKey);
    if (canonicalName(input.typedName) !== canonicalName(context.signer.signer_name)) {
      throw new PublicError(400, 'Typed signer name must match the authorized signer');
    }
    const artifactKey = await sha256(`${context.tokenId}\0${input.documentId}\0${context.signerId}\0${input.clientRequestId}`);

    const existingArtifacts = requireRows(await entities.SignatureArtifactBinding.filter(
      { artifact_key: artifactKey }, undefined, EXACT_ROW_LIMIT,
    ), 'SignatureArtifactBinding.filter');
    if (existingArtifacts.length > 1) throw new PublicError(409, 'Signature submission identity is ambiguous');
    if (existingArtifacts.length === 1) {
      const artifact = existingArtifacts[0];
      const artifactId = validateArtifact(
        artifact, context, input, artifactKey, signatureDigest, typedNameDigest, agreementTextDigest,
      );
      irreversible = true;
      await recordArtifactOnSignature(
        entities, context, input, artifactId, signatureDigest, artifact.created_at,
      );
      const result = await finalizeRecordedSignature(
        entities, context, input, tokenDigest, grantDigest, artifactId, signatureDigest,
        artifact.created_at, artifact.client_ip_sha256, artifact.user_agent_sha256,
      );
      const seal = await sealIfCollected(base44, context.agencyId, input.documentId);
      return Response.json({ success: true, idempotent: true, document_id: input.documentId,
        signature_collected: result.signatureCollected,
        document_completed: seal.completed, sealing_pending: seal.pending,
        all_signed: result.allSigned },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
    }
    if (context.token.submission_upload_operation_id != null || context.token.submission_upload_started_at != null) {
      irreversible = true;
      throw new PublicError(409, 'Prior signature upload requires reconciliation');
    }
    const freshContext = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest);
    if (freshContext.tokenId !== context.tokenId || freshContext.signerId !== context.signerId
      || freshContext.packageId !== context.packageId
      || canonicalName(input.typedName) !== canonicalName(freshContext.signer.signer_name)) {
      throw new PublicError(409, 'Signature authority changed');
    }
    context = freshContext;
    if (context.signer.status === 'completed') throw new PublicError(409, 'This signer has already completed the document');
    if (context.signer.status !== 'pending') throw new PublicError(409, 'This signature can no longer be submitted');

    const claimAt = new Date().toISOString();
    const grantClaimFilter: Record<string, any> = {
      id: context.grant.id, grant_key: grantDigest,
      status: context.grant.status, authority_version: context.grant.authority_version,
    };
    if (context.grant.status === 'claimed') {
      if (!context.grantClaimedForRequest || !exactIdentifier(context.grant.claimed_by_operation_id)
          || !validInstant(context.grant.claimed_at)
          || Date.parse(context.grant.claimed_at) > Date.now() - CLAIM_LEASE_MS) {
        throw new PublicError(409, 'This signature submission is already in progress');
      }
      grantClaimFilter.claimed_by_request_id = input.clientRequestId;
      grantClaimFilter.claimed_by_operation_id = context.grant.claimed_by_operation_id;
      grantClaimFilter.claimed_document_id = input.documentId;
      grantClaimFilter.claimed_at = context.grant.claimed_at;
    } else if (context.grant.status !== 'active') {
      throw new PublicError(409, 'Review grant was already used');
    }
    const grantResult = await entities.SignerReviewGrant.updateMany(
      grantClaimFilter,
      { $set: { status: 'claimed', claimed_at: claimAt,
        claimed_by_request_id: input.clientRequestId, claimed_by_operation_id: operationId,
        claimed_document_id: input.documentId,
        authority_version: context.grant.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(grantResult)) throw new PublicError(409, 'Review grant was already used');
    grantClaim = { id: context.grant.id, version: context.grant.authority_version + 1,
      grantDigest, operationId, documentId: input.documentId };

    const tokenClaimFilter: Record<string, any> = {
      id: context.tokenId, token: tokenDigest,
      status: context.token.status, authority_version: context.token.authority_version,
      submission_upload_operation_id: null, submission_upload_started_at: null,
    };
    if (context.token.status === 'claimed') {
      if (!context.tokenClaimedForRequest || !exactIdentifier(context.token.claimed_by_operation_id)
          || !validInstant(context.token.claimed_at)
          || Date.parse(context.token.claimed_at) > Date.now() - CLAIM_LEASE_MS) {
        throw new PublicError(409, 'This signature submission is already in progress');
      }
      tokenClaimFilter.claimed_by_request_id = input.clientRequestId;
      tokenClaimFilter.claimed_by_operation_id = context.token.claimed_by_operation_id;
      tokenClaimFilter.claimed_document_id = input.documentId;
      tokenClaimFilter.claimed_at = context.token.claimed_at;
    } else if (context.token.status !== 'active') {
      throw new PublicError(409, 'Signer token is unavailable');
    }
    const tokenResult = await entities.DocumentPackageToken.updateMany(
      tokenClaimFilter,
      { $set: { status: 'claimed', claimed_at: claimAt,
        claimed_by_request_id: input.clientRequestId, claimed_by_operation_id: operationId,
        claimed_document_id: input.documentId,
        authority_version: context.token.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(tokenResult)) throw new PublicError(409, 'Signer token is already in use');
    tokenClaim = { id: context.tokenId, version: context.token.authority_version + 1,
      tokenDigest, operationId, documentId: input.documentId };

    context = await loadContext(
      entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId,
    );
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation) {
      throw new PublicError(409, 'Signing claim could not be verified');
    }

    const now = new Date().toISOString();
    const ip = String(req.headers.get('cf-connecting-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown').slice(0, 128);
    const userAgent = String(req.headers.get('user-agent') || 'unknown').slice(0, 512);
    const [clientIpDigest, userAgentDigest] = await Promise.all([
      hmacAudit(`ip\0${ip}`, auditKey), hmacAudit(`ua\0${userAgent}`, auditKey),
    ]);
    await ensureAudit(entities, {
      event_key: await sha256(`signature_claimed\0${context.tokenId}\0${input.documentId}\0${input.clientRequestId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'signature_claimed', actor_type: 'external_signer', request_id: input.clientRequestId,
      authority_version: context.signature.authority_version,
      document_content_sha256: context.signature.document_content_sha256,
      hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id), client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      occurred_at: now,
    });
    await ensureAudit(entities, {
      event_key: await sha256(`review_grant_claimed\0${context.grant.id}\0${operationId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'review_grant_claimed', actor_type: 'external_signer', request_id: input.clientRequestId,
      authority_version: context.grant.authority_version,
      document_content_sha256: context.signature.document_content_sha256,
      hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id), client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      occurred_at: now,
    });

    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.grant.authority_version !== grantClaim.version
        || Date.parse(context.token.claimed_at) <= Date.now() - CLAIM_LEASE_MS
        || Date.parse(context.grant.claimed_at) <= Date.now() - CLAIM_LEASE_MS) {
      throw new PublicError(409, 'Signing claim changed before upload');
    }
    // Persist the irreversible boundary before invoking private storage. An
    // unacknowledged marker or upload must never make stale takeover re-upload.
    irreversible = true;
    const uploadStartedAt = new Date().toISOString();
    const uploadStart = await entities.DocumentPackageToken.updateMany({
      id: context.tokenId, token: tokenDigest, status: 'claimed', is_active: true,
      authority_version: tokenClaim.version, claimed_by_operation_id: operationId,
      claimed_by_request_id: input.clientRequestId, claimed_document_id: input.documentId,
      submission_upload_operation_id: null, submission_upload_started_at: null,
    }, { $set: { submission_upload_operation_id: operationId, submission_upload_started_at: uploadStartedAt,
      authority_version: tokenClaim.version + 1 } });
    if (!successfulSingleUpdate(uploadStart)) {
      if (uploadStart?.success === true && uploadStart.updated === 0 && uploadStart.has_more === false) irreversible = false;
      throw new PublicError(409, 'Signature upload boundary requires reconciliation');
    }
    tokenClaim.version += 1;
    uploadMarkerConfirmed = true;
    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.token.submission_upload_operation_id !== operationId
        || context.token.submission_upload_started_at !== uploadStartedAt) {
      throw new PublicError(409, 'Signature upload boundary requires reconciliation');
    }
    storageInvoked = true;
    const upload = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: input.file });
    const fileUri = typeof upload?.file_uri === 'string' ? upload.file_uri : '';
    if (!fileUri || !isPrivateFileUri(fileUri) || fileUri.length > 4096) {
      throw new Error('Private signature upload failed');
    }
    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.token.submission_upload_operation_id !== operationId) {
      throw new PublicError(409, 'Signature authority changed during upload');
    }
    const artifact = await entities.SignatureArtifactBinding.create({
      artifact_key: artifactKey, agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      client_request_id: input.clientRequestId, storage_mode: 'private', file_uri: fileUri,
      file_type: input.fileType, file_size: input.file.size, content_sha256: signatureDigest,
      typed_name_hmac_sha256: typedNameDigest, agreement_version: input.agreementVersion,
      agreement_text_sha256: agreementTextDigest,
      source_document_sha256: context.signature.document_content_sha256,
      document_binding_id: context.signature.document_binding_id,
      document_binding_version: context.signature.document_binding_version,
      hmac_key_id: signatureAuditKeyId(context.grant.hmac_key_id), client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      created_at: now, binding_verified_at: now, version: 1,
    });
    const artifactId = exactIdentifier(artifact?.id);
    if (!artifactId) throw new Error('Signature artifact binding could not be persisted');
    const artifactReadback = await exactOne(entities.SignatureArtifactBinding,
      { id: artifactId, artifact_key: artifactKey }, 'SignatureArtifactBinding');
    validateArtifact(
      artifactReadback, context, input, artifactKey, signatureDigest, typedNameDigest, agreementTextDigest,
    );

    await recordArtifactOnSignature(
      entities, context, input, artifactId, signatureDigest, now,
    );
    const result = await finalizeRecordedSignature(
      entities, context, input, tokenDigest, grantDigest, artifactId, signatureDigest, now,
      clientIpDigest, userAgentDigest,
    );
    const seal = await sealIfCollected(base44, context.agencyId, input.documentId);
    return Response.json({
      success: true, idempotent: false, document_id: input.documentId,
      signature_collected: result.signatureCollected,
      document_completed: seal.completed, sealing_pending: seal.pending,
      all_signed: result.allSigned,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    // This invocation knows storage was never called. Clear only its confirmed
    // marker with the exact current revision; an uncertain marker write or any
    // started storage call still retains the irreversible boundary.
    if (uploadMarkerConfirmed && !storageInvoked && tokenClaim && cleanupEntities) {
      try {
        const cleared = await cleanupEntities.DocumentPackageToken.updateMany({
          id: tokenClaim.id, token: tokenClaim.tokenDigest, status: 'claimed',
          claimed_by_operation_id: tokenClaim.operationId, claimed_document_id: tokenClaim.documentId,
          submission_upload_operation_id: tokenClaim.operationId, authority_version: tokenClaim.version,
        }, { $set: { submission_upload_operation_id: null, submission_upload_started_at: null,
          authority_version: tokenClaim.version + 1 } });
        if (successfulSingleUpdate(cleared)) {
          tokenClaim.version += 1;
          irreversible = false;
        }
      } catch { /* unknown acknowledgement retains reconciliation semantics */ }
    }
    // Before private upload, claims can safely be returned to active. After an
    // upload or write, retain them so a retry with the same client_request_id
    // reconciles instead of recording a second legal act.
    if (!irreversible && (tokenClaim || grantClaim)) {
      try {
        if (!cleanupEntities) throw new Error('Signature cleanup authority is unavailable');
        const entities = cleanupEntities;
        if (tokenClaim) {
          await entities.DocumentPackageToken.updateMany(
            { id: tokenClaim.id, token: tokenClaim.tokenDigest, status: 'claimed',
              claimed_by_operation_id: tokenClaim.operationId,
              claimed_document_id: tokenClaim.documentId, authority_version: tokenClaim.version },
            { $set: { status: 'active', claimed_at: null, claimed_by_request_id: null,
              claimed_by_operation_id: null, claimed_document_id: null,
              authority_version: tokenClaim.version + 1 } },
          );
        }
        if (grantClaim) {
          await entities.SignerReviewGrant.updateMany(
            { id: grantClaim.id, grant_key: grantClaim.grantDigest, status: 'claimed',
              claimed_by_operation_id: grantClaim.operationId,
              claimed_document_id: grantClaim.documentId, authority_version: grantClaim.version },
            { $set: { status: 'active', claimed_at: null, claimed_by_request_id: null,
              claimed_by_operation_id: null, claimed_document_id: null,
              authority_version: grantClaim.version + 1 } },
          );
        }
      } catch { /* fail closed; a claimed capability cannot be replayed */ }
    }
    const status = irreversible ? 202 : error instanceof PublicError ? error.status : 500;
    const message = irreversible
      ? 'Signature submission requires reconciliation; do not sign again with a new request'
      : error instanceof PublicError ? error.message : 'Unable to record signature';
    const code = !irreversible && error instanceof PublicError && error.code ? { code: error.code } : {};
    return Response.json({ error: message, requires_reconciliation: irreversible, ...code }, {
      status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  }
});
