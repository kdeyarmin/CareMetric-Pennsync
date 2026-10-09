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
// <<<BEGIN SHARED HELPER: esignRequestCreation — generated, edit base44/_shared/backendHelpers.mjs>>>
// Secure creation of one signature request: one DocumentSignature per chart
// document (each bound to its private version-2 DocumentTenantBinding and the
// exact SHA-256 of its bytes) and one DocumentPackage per signer. Every row
// carries the creator's User id, normalized email and exact AgencyMembership
// id/version, so revoking the creator's membership invalidates every link the
// request ever issued. Identity is deterministic from (agency, creator,
// client_request_id): a retry returns the same request, and the agency-level
// creation reservation serializes concurrent duplicates.
const ESIGN_SIGNER_ROLES = new Set(['patient', 'caregiver', 'legal_representative', 'witness', 'provider']);
const ESIGN_DOCUMENT_TYPES = new Set([
  'consent', 'hipaa', 'treatment_agreement', 'financial_agreement', 'advance_directive', 'release', 'custom_request', 'other',
]);
const ESIGN_FIELD_TYPES = new Set(['signature', 'initials', 'date', 'text']);
const ESIGN_MAX_DOCUMENTS = 25;
const ESIGN_MAX_SIGNERS = 10;
const ESIGN_MAX_FIELDS = 100;
const ESIGN_MAX_DUE_DAYS = 90;

function esignBoundedText(value, min, max) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length < min || text.length > max
    || [...text].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return text;
}

function esignCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const millis = Date.parse(value + 'T00:00:00.000Z');
  return Number.isFinite(millis) && new Date(millis).toISOString().slice(0, 10) === value ? value : null;
}

function esignPercent(value, allowZero) {
  const number = Number(value);
  if (!Number.isFinite(number) || number > 100 || (allowZero ? number < 0 : number <= 0)) return null;
  return Math.round(number * 100) / 100;
}

/** Parse and bound a request spec. Unknown keys are refused, never ignored. */
function esignParseRequestSpec(raw, allowedExtraKeys) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new EsignError(400, 'Request body must be an object');
  const allowed = new Set(['agency_id', 'patient_id', 'document_ids', 'signers', 'package_name', 'document_type',
    'due_date', 'message', 'signature_fields', 'auto_reminders', 'reminder_days_before', 'client_request_id',
    ...(allowedExtraKeys || [])]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (unknown.length) throw new EsignError(400, 'Unsupported signature request field: ' + unknown[0]);
  const agencyId = esignId(raw.agency_id);
  const patientId = esignId(raw.patient_id);
  const clientRequestId = esignId(raw.client_request_id);
  if (!agencyId || !patientId || !clientRequestId) {
    throw new EsignError(400, 'agency_id, patient_id and client_request_id are required');
  }
  const documentIds = Array.isArray(raw.document_ids) ? raw.document_ids.map(esignId) : [];
  if (!allowedExtraKeys?.includes('template_id')) {
    if (documentIds.length < 1 || documentIds.length > ESIGN_MAX_DOCUMENTS || documentIds.includes(null)
      || new Set(documentIds).size !== documentIds.length) {
      throw new EsignError(400, 'Between 1 and ' + ESIGN_MAX_DOCUMENTS + ' distinct chart documents are required');
    }
  }
  const rawSigners = Array.isArray(raw.signers) ? raw.signers : [];
  if (rawSigners.length < 1 || rawSigners.length > ESIGN_MAX_SIGNERS) {
    throw new EsignError(400, 'Between 1 and ' + ESIGN_MAX_SIGNERS + ' signers are required');
  }
  const signers = rawSigners.map((signer) => {
    if (!signer || typeof signer !== 'object' || Array.isArray(signer)
      || Object.keys(signer).some((key) => !['name', 'email', 'role'].includes(key))) {
      throw new EsignError(400, 'Each signer needs exactly name, email and role');
    }
    const name = esignBoundedText(signer.name, 2, 200);
    const email = esignEmail(signer.email);
    const role = String(signer.role || '');
    if (!name || !email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !ESIGN_SIGNER_ROLES.has(role)) {
      throw new EsignError(400, 'Each signer needs a name, a valid email and a signer role');
    }
    return { name, email, role };
  });
  if (new Set(signers.map((signer) => signer.email)).size !== signers.length) {
    throw new EsignError(400, 'Each signer must have a distinct email address');
  }
  const packageName = raw.package_name == null ? 'Signature request' : esignBoundedText(raw.package_name, 1, 200);
  if (!packageName) throw new EsignError(400, 'package_name is invalid');
  const documentType = raw.document_type == null ? 'consent' : String(raw.document_type);
  if (!ESIGN_DOCUMENT_TYPES.has(documentType)) throw new EsignError(400, 'document_type is invalid');
  const dueDate = esignCalendarDate(raw.due_date);
  const today = new Date().toISOString().slice(0, 10);
  const latest = new Date(Date.now() + ESIGN_MAX_DUE_DAYS * 86_400_000).toISOString().slice(0, 10);
  if (!dueDate || dueDate < today || dueDate > latest) {
    throw new EsignError(400, 'due_date must be a calendar date from today through ' + ESIGN_MAX_DUE_DAYS + ' days out');
  }
  let message = null;
  if (raw.message != null && raw.message !== '') {
    if (typeof raw.message !== 'string' || raw.message.length > 1000
      || [...raw.message].some((character) => {
        const code = character.charCodeAt(0);
        return (code <= 31 && code !== 10) || code === 127;
      })) throw new EsignError(400, 'message is invalid');
    message = raw.message.trim() || null;
  }
  const rawFields = raw.signature_fields == null ? [] : raw.signature_fields;
  if (!Array.isArray(rawFields) || rawFields.length > ESIGN_MAX_FIELDS) throw new EsignError(400, 'signature_fields is invalid');
  const fields = rawFields.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) throw new EsignError(400, 'signature field is invalid');
    const documentId = field.document_id == null ? null : esignId(field.document_id);
    const signerIndex = Number(field.signer_index);
    const page = Number(field.page);
    const x = esignPercent(field.x, true);
    const y = esignPercent(field.y, true);
    const width = esignPercent(field.width, false);
    const height = esignPercent(field.height, false);
    if ((field.document_id != null && !documentId) || !Number.isSafeInteger(signerIndex) || signerIndex < 0
      || signerIndex >= signers.length || !ESIGN_FIELD_TYPES.has(String(field.type || ''))
      || !Number.isSafeInteger(page) || page < 1 || page > 500
      || x === null || y === null || width === null || height === null
      || x + width > 100.001 || y + height > 100.001) {
      throw new EsignError(400, 'signature field geometry is invalid');
    }
    return { documentId, signerIndex, type: field.type, page, x, y, width, height };
  });
  const autoReminders = raw.auto_reminders == null ? true : raw.auto_reminders === true;
  const reminderDays = raw.reminder_days_before == null ? 2 : Number(raw.reminder_days_before);
  if (!Number.isSafeInteger(reminderDays) || reminderDays < 1 || reminderDays > 14) {
    throw new EsignError(400, 'reminder_days_before must be 1 through 14');
  }
  return {
    agencyId, patientId, clientRequestId, documentIds, signers, packageName, documentType,
    dueDate, message, fields, autoReminders, reminderDays,
  };
}

/** The chart document a request may bind: private, version 2, same chart. */
async function esignLoadChartSource(entities, agencyId, patientId, documentId) {
  const document = await esignExactOne(entities.Document, { id: documentId }, 'Document', 404);
  const bindings = esignRows(await entities.DocumentTenantBinding.filter(
    { document_id: documentId, agency_id: agencyId }, '-created_date', ESIGN_ROW_LIMIT,
  ), 'DocumentTenantBinding.filter');
  const exact = bindings.filter((row) => row?.document_id === documentId && row?.agency_id === agencyId);
  if (exact.length !== 1 || bindings.length >= ESIGN_ROW_LIMIT) throw new EsignError(404, 'Chart document unavailable');
  const binding = exact[0];
  if (document.patient_id !== patientId || binding.patient_id !== patientId || document.file_url != null
    || binding.storage_mode !== 'private' || binding.version !== 2 || !isPrivateFileUri(binding.file_uri)
    || !esignDigest(binding.content_sha256) || !ESIGN_SOURCE_TYPES.has(String(binding.file_type || ''))
    || !esignId(binding.id)) {
    throw new EsignError(409, 'Only private PDF or image documents in this patient chart can be sent for signature');
  }
  return { document, binding };
}

function esignSignerIdFor(requestKeyDigest, email) {
  return esignSha256(requestKeyDigest + '\u0000signer\u0000' + email).then((digest) => 'signer_' + digest.slice(0, 32));
}

async function esignBuildRequestPlan(authority, spec, sources) {
  const requestKey = await esignSha256(
    'esign-request\u0000' + spec.agencyId + '\u0000' + authority.caller.userId + '\u0000' + spec.clientRequestId,
  );
  const signers = [];
  for (const signer of spec.signers) {
    signers.push({ ...signer, signerId: await esignSignerIdFor(requestKey, signer.email) });
  }
  const creator = {
    created_by_user_id: authority.caller.userId,
    created_by_user_email_normalized: authority.caller.email,
    creator_membership_id: authority.membership.id,
    creator_membership_version: authority.membership.version,
  };
  const documents = [];
  for (const source of sources) {
    const documentId = source.document.id;
    const fields = spec.fields
      .filter((field) => field.documentId === null || field.documentId === documentId)
      .map((field, index) => ({
        id: 'field_' + (index + 1),
        signerId: signers[field.signerIndex].signerId,
        type: field.type,
        label: field.type === 'signature' ? 'Signature' : field.type === 'initials' ? 'Initials'
          : field.type === 'date' ? 'Date signed' : 'Printed name',
        required: true,
        page: field.page,
        position: { x: field.x, y: field.y },
        size: { width: field.width, height: field.height },
      }));
    documents.push({
      key: await esignSha256(requestKey + '\u0000document\u0000' + documentId),
      source,
      payload: {
        agency_id: spec.agencyId,
        request_key: requestKey,
        client_request_id: spec.clientRequestId,
        ...creator,
        created_by_email: authority.caller.email,
        document_id: documentId,
        document_binding_id: source.binding.id,
        document_binding_version: 2,
        document_content_sha256: source.binding.content_sha256,
        patient_id: spec.patientId,
        document_type: spec.documentType,
        document_title: String(source.document.title || source.binding.file_name || spec.packageName).slice(0, 200),
        document_name: String(source.binding.file_name || '').slice(0, 200),
        signature_fields: fields,
        signers: signers.map((signer) => ({
          signer_id: signer.signerId, signer_name: signer.name, signer_role: signer.role,
          email: signer.email, required: true, status: 'pending',
        })),
        status: 'pending',
        workflow_status: 'pending',
        authority_version: 1,
        due_date: spec.dueDate,
        ...(spec.message ? { message: spec.message } : {}),
        reminder_sent_count: 0,
      },
    });
  }
  const packages = [];
  for (const signer of signers) {
    packages.push({
      key: await esignSha256(requestKey + '\u0000package\u0000' + signer.signerId),
      signer,
      // A request's packages are the rows sharing (agency_id,
      // created_by_user_id, client_request_id); the package schema is carried
      // into the owned store, so it gains no request-level columns here.
      payload: {
        agency_id: spec.agencyId,
        client_request_id: spec.clientRequestId,
        ...creator,
        authority_version: 1,
        package_name: spec.packageName,
        patient_id: spec.patientId,
        status: 'pending',
        due_date: spec.dueDate,
        auto_reminder_enabled: spec.autoReminders,
        reminder_days_before: spec.reminderDays,
        signer_id: signer.signerId,
        signer_email: signer.email,
        signer_name: signer.name,
      },
    });
  }
  return { requestKey, signers, documents, packages };
}

function esignCanonical(value) {
  if (Array.isArray(value)) return value.map(esignCanonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, esignCanonical(value[key])]));
  }
  return value ?? null;
}

function esignSameValue(left, right) {
  return JSON.stringify(esignCanonical(left)) === JSON.stringify(esignCanonical(right));
}

function esignRowMatchesPlan(row, payload, ignored) {
  for (const [key, value] of Object.entries(payload)) {
    if (ignored && ignored.has(key)) continue;
    if (!esignSameValue(row?.[key], value)) return false;
  }
  return true;
}

async function esignLoadRequestRows(entities, agencyId, requestKey, creatorId, clientRequestId) {
  const signatures = esignRows(await entities.DocumentSignature.filter(
    { agency_id: agencyId, request_key: requestKey }, 'created_date', 50,
  ), 'DocumentSignature.filter').filter((row) => row?.agency_id === agencyId && row?.request_key === requestKey);
  const packages = await esignLoadRequestPackages(entities, agencyId, creatorId, clientRequestId);
  return { signatures, packages };
}

function esignRequestView(plan, rows) {
  const signatureByKey = new Map(rows.signatures.map((row) => [row.signature_request_key, row]));
  const packageByKey = new Map(rows.packages.map((row) => [row.package_key, row]));
  return {
    request_key: plan.requestKey,
    documents: plan.documents.map((entry) => {
      const row = signatureByKey.get(entry.key);
      return { id: row.id, document_id: row.document_id, title: row.document_title, status: row.status };
    }),
    packages: plan.packages.map((entry) => {
      const row = packageByKey.get(entry.key);
      return {
        id: row.id, signer_id: row.signer_id, signer_name: row.signer_name,
        signer_email: row.signer_email, signer_role: entry.signer.role, status: row.status,
      };
    }),
  };
}

function esignVerifyRequestRows(plan, rows) {
  const signatureByKey = new Map();
  for (const row of rows.signatures) {
    if (signatureByKey.has(row.signature_request_key)) throw new EsignError(409, 'Signature request rows are ambiguous');
    signatureByKey.set(row.signature_request_key, row);
  }
  const packageByKey = new Map();
  for (const row of rows.packages) {
    if (packageByKey.has(row.package_key)) throw new EsignError(409, 'Signature request rows are ambiguous');
    packageByKey.set(row.package_key, row);
  }
  for (const key of signatureByKey.keys()) {
    if (!plan.documents.some((entry) => entry.key === key)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  for (const key of packageByKey.keys()) {
    if (!plan.packages.some((entry) => entry.key === key)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  // A replayed request may legitimately have progressed (sent, signed); compare
  // only the immutable creation snapshot, never lifecycle fields.
  const lifecycle = new Set(['status', 'workflow_status', 'signers', 'authority_version', 'reminder_sent_count']);
  for (const entry of plan.documents) {
    const row = signatureByKey.get(entry.key);
    if (row && !esignRowMatchesPlan(row, entry.payload, lifecycle)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
    if (row) {
      const roster = (Array.isArray(row.signers) ? row.signers : []).map((signer) => [signer?.signer_id, signer?.email]);
      const planned = entry.payload.signers.map((signer) => [signer.signer_id, signer.email]);
      if (JSON.stringify(roster) !== JSON.stringify(planned)) {
        throw new EsignError(409, 'client_request_id conflicts with another signature request');
      }
    }
  }
  const packageLifecycle = new Set(['status', 'authority_version', 'document_signatures']);
  for (const entry of plan.packages) {
    const row = packageByKey.get(entry.key);
    if (row && !esignRowMatchesPlan(row, entry.payload, packageLifecycle)) {
      throw new EsignError(409, 'client_request_id conflicts with another signature request');
    }
  }
  return {
    complete: plan.documents.every((entry) => signatureByKey.has(entry.key))
      && plan.packages.every((entry) => packageByKey.has(entry.key)),
    signatureByKey, packageByKey,
  };
}

/**
 * Create (or replay) one request. `sources` are esignLoadChartSource results in
 * document order. Returns { created, request }.
 */
async function esignCreateSignatureRequest(base44, authority, spec, sources) {
  const entities = authority.entities;
  const plan = await esignBuildRequestPlan(authority, spec, sources);
  const loadRows = () => esignLoadRequestRows(entities, spec.agencyId, plan.requestKey,
    authority.caller.userId, spec.clientRequestId);
  let rows = await loadRows();
  let state = esignVerifyRequestRows(plan, rows);
  if (state.complete) {
    const anyRow = rows.signatures[0];
    await releaseRecoveredFaxQueueCreation(entities, spec.agencyId, 'esign_request', plan.requestKey,
      { queue_creation_reservation_token: anyRow?.creation_reservation_token ?? null }).catch(() => false);
    return { created: false, request: esignRequestView(plan, rows), plan };
  }
  let reservation = await reserveFaxQueueCreation(entities, spec.agencyId, 'esign_request', plan.requestKey);
  if (!reservation) {
    // Resume only this request's own partial write: the document rows (always
    // written first) must all carry the reservation token still held for this
    // exact request key.
    const key = await faxQueueCreationKey('esign_request', plan.requestKey);
    const agency = await esignExactOne(entities.Agency, { id: spec.agencyId }, 'Agency', 409);
    const token = agency.fax_workflow_reservations?.[key];
    const written = rows.signatures;
    if (typeof token !== 'string' || !written.length
      || written.some((row) => row.creation_reservation_token !== token)) {
      throw new EsignError(409, 'This signature request is already being created; retry shortly', 'request_in_progress');
    }
    reservation = { agencyId: spec.agencyId, key, token };
  }
  let createStarted = false;
  try {
    rows = await loadRows();
    state = esignVerifyRequestRows(plan, rows);
    const signatureIds = [];
    for (const entry of plan.documents) {
      let row = state.signatureByKey.get(entry.key);
      if (!row) {
        createStarted = true;
        row = await entities.DocumentSignature.create({
          ...entry.payload, signature_request_key: entry.key, creation_reservation_token: reservation.token,
          sent_date: new Date().toISOString(),
        });
        if (!esignId(row?.id)) throw new Error('DocumentSignature.create returned no exact id');
      }
      signatureIds.push(row.id);
    }
    for (const entry of plan.packages) {
      if (state.packageByKey.get(entry.key)) continue;
      createStarted = true;
      const row = await entities.DocumentPackage.create({
        ...entry.payload, package_key: entry.key, document_signatures: signatureIds,
      });
      if (!esignId(row?.id)) throw new Error('DocumentPackage.create returned no exact id');
    }
    rows = await loadRows();
    state = esignVerifyRequestRows(plan, rows);
    if (!state.complete) throw new EsignError(409, 'Signature request persistence could not be verified');
    for (const row of rows.packages) {
      if (JSON.stringify(row.document_signatures) !== JSON.stringify(signatureIds)) {
        throw new EsignError(409, 'Signature request persistence could not be verified');
      }
    }
    await esignAudit(entities, {
      event_key: await esignSha256('request_created\u0000' + plan.requestKey),
      agency_id: spec.agencyId,
      action: 'request_created', actor_type: 'authenticated_user',
      actor_user_id: authority.caller.userId,
      membership_id: authority.membership.id, membership_version: authority.membership.version,
      request_id: spec.clientRequestId, authority_version: 1,
      occurred_at: new Date().toISOString(),
    });
    await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    return { created: true, request: esignRequestView(plan, rows), plan };
  } catch (error) {
    if (!createStarted) await releaseFaxQueueCreation(entities, reservation).catch(() => false);
    throw error;
  }
}
// <<<END SHARED HELPER: esignRequestCreation>>>
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

/**
 * generateDocumentPackageFromTemplate — turn a document template into a signed
 * request for one patient in one call.
 *
 * The template's text is merged with the patient's name and the agency name,
 * rendered to a PDF with a signature and date line for each signer, filed to
 * the patient's chart exactly like an upload (private storage, a version-2
 * DocumentTenantBinding with the bytes' SHA-256), and then handed to the same
 * creation broker bulkCreateDocumentPackages uses, so the request is
 * indistinguishable from one built from an uploaded file. The Bulk tab calls
 * this once per patient and template.
 *
 * Signers come from the chart (`signer_source: patient` uses the patient's
 * email, `caregiver` the caregiver's) or are listed explicitly
 * (`signer_source: custom` with `signers`). Links are sent separately through
 * generateSignerToken.
 *
 * Authority: identical to bulkCreateDocumentPackages — an exact active
 * membership in the agency with a document-creating role (agency_admin,
 * manager, clinician) and chart access to the patient.
 */
const MAX_BODY_BYTES = 32_000;
const PAGE = [612, 792];
const MARGIN = 60;

function templateText(content: unknown) {
  return String(content || '')
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\s*\/(p|div|h[1-6]|li|tr|section)\s*>/gi, '\n')
    .replace(/<\s*li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mergePlaceholders(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (whole, key) => {
    const value = values[String(key).toLowerCase()];
    return typeof value === 'string' ? value : whole;
  });
}

async function renderTemplatePdf(
  title: string,
  header: string[],
  body: string,
  signers: Array<Record<string, any>>,
) {
  const doc = await PDFDocument.create();
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const width = PAGE[0] - MARGIN * 2;
  let page = doc.addPage(PAGE);
  let cursor = PAGE[1] - MARGIN;
  const ensure = (height: number) => {
    if (cursor - height < MARGIN) {
      page = doc.addPage(PAGE);
      cursor = PAGE[1] - MARGIN;
    }
  };
  const write = (text: string, size: number, font: any, gapAfter = 4) => {
    for (const line of esignWrapText(font, text, size, width)) {
      ensure(size + gapAfter);
      page.drawText(line, { x: MARGIN, y: cursor - size, size, font, color: rgb(0.07, 0.1, 0.17) });
      cursor -= size + gapAfter;
    }
  };
  write(title, 16, bold, 8);
  for (const line of header) write(line, 10, regular, 3);
  cursor -= 10;
  for (const paragraph of body.split('\n')) {
    if (!paragraph.trim()) { cursor -= 8; continue; }
    write(paragraph, 11, regular, 4);
  }
  cursor -= 16;
  const fields: Array<Record<string, any>> = [];
  signers.forEach((signer, index) => {
    const blockHeight = 86;
    ensure(blockHeight);
    const pageNumber = doc.getPages().indexOf(page) + 1;
    write(esignPdfText(signer.name, 120) + ' (' + esignRoleLabel(signer.role) + ')', 10, bold, 6);
    const boxTop = cursor;
    const sigBox = { x: MARGIN, y: boxTop - 44, width: 300, height: 40 };
    const dateBox = { x: MARGIN + 320, y: boxTop - 44, width: 150, height: 40 };
    page.drawLine({ start: { x: sigBox.x, y: sigBox.y }, end: { x: sigBox.x + sigBox.width, y: sigBox.y }, thickness: 0.75, color: rgb(0.2, 0.25, 0.35) });
    page.drawLine({ start: { x: dateBox.x, y: dateBox.y }, end: { x: dateBox.x + dateBox.width, y: dateBox.y }, thickness: 0.75, color: rgb(0.2, 0.25, 0.35) });
    page.drawText('Signature', { x: sigBox.x, y: sigBox.y - 11, size: 8, font: regular, color: rgb(0.33, 0.4, 0.5) });
    page.drawText('Date', { x: dateBox.x, y: dateBox.y - 11, size: 8, font: regular, color: rgb(0.33, 0.4, 0.5) });
    for (const [type, box] of [['signature', sigBox], ['date', dateBox]] as Array<[string, Record<string, number>]>) {
      fields.push({
        signer_index: index, type, page: pageNumber,
        x: Math.round((box.x / PAGE[0]) * 10000) / 100,
        y: Math.round(((PAGE[1] - (box.y + box.height)) / PAGE[1]) * 10000) / 100,
        width: Math.round((box.width / PAGE[0]) * 10000) / 100,
        height: Math.round((box.height / PAGE[1]) * 10000) / 100,
      });
    }
    cursor = boxTop - 44 - 24;
  });
  doc.setTitle(esignPdfText(title, 200));
  doc.setProducer('PennSync e-signature');
  doc.setCreator('PennSync by CareMetric');
  return { bytes: await doc.save({ useObjectStreams: false }), fields };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return esignJson({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    await esignLoadCaller(base44);
    const raw = await esignReadJson(req, MAX_BODY_BYTES);
    esignOnlyKeys(raw, ['agency_id', 'patient_id', 'template_id', 'signer_source', 'signers', 'package_name',
      'document_type', 'due_date', 'message', 'auto_reminders', 'reminder_days_before', 'client_request_id']);
    const authority = await esignStaffAuthority(base44, {
      agencyId: raw.agency_id,
      patientId: raw.patient_id,
      requireMembership: true,
      roles: ESIGN_REQUEST_ROLES,
    });
    const templateId = esignId(raw.template_id);
    if (!templateId) throw new EsignError(400, 'template_id is required');
    const template = await esignExactOne(authority.entities.DocumentTemplate, { id: templateId }, 'DocumentTemplate', 404);
    const patient = authority.patient;
    const patientName = [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim() || 'Patient';
    const source = String(raw.signer_source || 'patient');
    let signers = raw.signers;
    if (source === 'patient') {
      if (!esignEmail(patient.email)) throw new EsignError(409, 'This patient has no email address on file to send a signing link to', 'signer_email_missing');
      signers = [{ name: patientName, email: patient.email, role: 'patient' }];
    } else if (source === 'caregiver') {
      if (!esignEmail(patient.caregiver_email) || !String(patient.caregiver_name || '').trim()) {
        throw new EsignError(409, 'This patient has no caregiver name and email on file', 'signer_email_missing');
      }
      signers = [{ name: String(patient.caregiver_name), email: patient.caregiver_email, role: 'caregiver' }];
    } else if (source !== 'custom') {
      throw new EsignError(400, 'signer_source must be patient, caregiver or custom');
    } else if (raw.signers == null) {
      throw new EsignError(400, 'signers are required for signer_source custom');
    }
    const spec = esignParseRequestSpec({
      agency_id: raw.agency_id,
      patient_id: raw.patient_id,
      document_ids: [],
      signers,
      package_name: raw.package_name ?? String(template.template_name || template.name || 'Document').slice(0, 200),
      document_type: raw.document_type ?? (template.category === 'consent' ? 'consent' : 'other'),
      due_date: raw.due_date,
      message: raw.message,
      auto_reminders: raw.auto_reminders,
      reminder_days_before: raw.reminder_days_before,
      client_request_id: raw.client_request_id,
    }, ['template_id']);
    const title = String(template.template_name || template.name || 'Document').slice(0, 200);
    const today = new Date().toISOString().slice(0, 10);
    const merged = mergePlaceholders(templateText(template.content), {
      patient_name: patientName,
      patient_first_name: String(patient.first_name || ''),
      patient_last_name: String(patient.last_name || ''),
      agency_name: String(authority.agency.agency_name || ''),
      date: today,
      today,
      signer_name: spec.signers[0].name,
    });
    if (!merged.trim()) throw new EsignError(409, 'This template has no content to send for signature');
    const clientRequestId = 'tpl-' + (await esignSha256(spec.clientRequestId + '\u0000' + templateId)).slice(0, 48);
    let rendered: { bytes: Uint8Array; fields: Array<Record<string, any>> } | null = null;
    const filed = await esignFileChartDocument(base44, {
      agencyId: authority.agencyId,
      patientId: patient.id,
      creator: {
        userId: authority.caller.userId,
        email: authority.caller.email,
        membershipId: authority.membership.id,
        membershipVersion: authority.membership.version,
      },
      clientRequestId,
      fileName: title,
      render: async () => {
        rendered = await renderTemplatePdf(title, [
          String(authority.agency.agency_name || ''),
          'Patient: ' + patientName,
          'Prepared: ' + today,
        ].filter(Boolean), merged, spec.signers);
        return rendered.bytes;
      },
    });
    const fields = rendered
      ? rendered.fields
      : (await renderTemplatePdf(title, [], merged, spec.signers)).fields;
    const finalSpec = {
      ...spec,
      documentIds: [filed.document.id],
      fields: fields.map((field) => ({
        documentId: filed.document.id, signerIndex: field.signer_index, type: field.type,
        page: field.page, x: field.x, y: field.y, width: field.width, height: field.height,
      })),
    };
    const chartSource = await esignLoadChartSource(authority.entities, authority.agencyId, patient.id, filed.document.id);
    const result = await esignCreateSignatureRequest(base44, authority, finalSpec, [chartSource]);
    return esignJson({
      success: true,
      created: result.created,
      template_document_id: filed.document.id,
      request: {
        ...result.request,
        agency_id: authority.agencyId,
        patient_id: patient.id,
        package_name: finalSpec.packageName,
        due_date: finalSpec.dueDate,
        auto_reminders: finalSpec.autoReminders,
        reminder_days_before: finalSpec.reminderDays,
      },
    }, result.created ? 201 : 200);
  } catch (error) {
    return esignErrorResponse(error, 'Unable to create the request from this template');
  }
});
