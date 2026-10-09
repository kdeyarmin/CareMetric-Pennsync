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
 * notifyAdminOfSignedDocument — (re)deliver the completion notice for a
 * sealed signature request to the staff member who requested it.
 *
 * The recipient is never chosen by the caller: it is the request's recorded
 * creator, and only while that person still holds an active membership in the
 * agency. The in-app notification is idempotent (one per document). The email
 * is sent once automatically when the document is sealed; `resend_email: true`
 * sends it again and is limited to the requester or an agency_admin/manager.
 * Neither the notification nor the email names the patient or any signer.
 * Email leaves only through the released outbound delivery gate.
 *
 * Body: { agency_id, document_signature_id, resend_email? }
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') return esignJson({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    await esignLoadCaller(base44);
    const body = esignOnlyKeys(await esignReadJson(req), ['agency_id', 'document_signature_id', 'resend_email']);
    if (body.resend_email != null && typeof body.resend_email !== 'boolean') {
      throw new EsignError(400, 'resend_email must be a boolean');
    }
    const authority = await esignStaffAuthority(base44, { agencyId: body.agency_id });
    const { row } = await esignLoadAuthorizedSignature(authority, body.document_signature_id);
    if (row.status !== 'completed' || row.workflow_status !== 'completed') {
      return esignJson({ error: 'This document has not been sealed yet', code: 'not_ready' }, 409);
    }
    const resend = body.resend_email === true;
    if (resend && !esignMayManageRequest(authority, row)) {
      throw new EsignError(403, 'Only the requester or an agency administrator or manager can resend this notice');
    }
    if (resend && !outboundDeliveryReleased()) return outboundDeliveryPausedResponse('email');
    const result = await esignNotifyCreator(base44, row, { forceEmail: resend });
    if (!result.notified) {
      return esignJson({ error: 'The requester no longer holds an active membership in this agency', code: 'recipient_inactive' }, 409);
    }
    await esignAudit(authority.entities, {
      event_key: await esignSha256('creator_notified\u0000' + row.id + '\u0000' + crypto.randomUUID()),
      agency_id: authority.agencyId, document_signature_id: row.id,
      action: 'creator_notified', actor_type: 'authenticated_user',
      actor_user_id: authority.caller.userId,
      ...(authority.membership ? { membership_id: authority.membership.id, membership_version: authority.membership.version } : {}),
      request_id: crypto.randomUUID(), occurred_at: new Date().toISOString(),
    }).catch(() => null);
    return esignJson({ success: true, notified: result.notified, emailed: result.emailed });
  } catch (error) {
    return esignErrorResponse(error, 'Unable to send the completion notice');
  }
});
