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

/**
 * bulkCreateDocumentPackages — the signature-request creation broker.
 *
 * One call creates one request for one chart: 1–25 private chart documents
 * (each already filed through createAuthorizedDocument, so each is a
 * version-2 DocumentTenantBinding with the SHA-256 of its exact bytes) and
 * 1–10 signers, producing one DocumentSignature per document and one
 * DocumentPackage per signer. "Bulk" sends call it once per chart.
 *
 * Authority, decided before any record the body names is read:
 *   - an active, verified built-in User;
 *   - an exact active AgencyMembership in the request's agency whose tenant
 *     role may create patient documents (agency_admin, manager, clinician);
 *   - chart access to the named patient (agency_admin/manager of that agency,
 *     the chart's creator, or an active PatientCareTeamAssignment).
 * No profile field (agency_id, agency_name, account_type, is_manager,
 * assigned_nurses) is consulted. Rows are stamped with the creator's User id
 * and exact membership id/version; every later link, review and signature
 * re-checks that membership is still active.
 *
 * Links are sent separately through generateSignerToken, so token minting and
 * delivery stay in the one reviewed issuer.
 */
const MAX_BODY_BYTES = 64_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return esignJson({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    await esignLoadCaller(base44);
    const spec = esignParseRequestSpec(await esignReadJson(req, MAX_BODY_BYTES));
    const authority = await esignStaffAuthority(base44, {
      agencyId: spec.agencyId,
      patientId: spec.patientId,
      requireMembership: true,
      roles: ESIGN_REQUEST_ROLES,
    });
    const sources = [];
    for (const documentId of spec.documentIds) {
      sources.push(await esignLoadChartSource(authority.entities, spec.agencyId, spec.patientId, documentId));
    }
    const result = await esignCreateSignatureRequest(base44, authority, spec, sources);
    return esignJson({
      success: true,
      created: result.created,
      request: {
        ...result.request,
        agency_id: spec.agencyId,
        patient_id: spec.patientId,
        package_name: spec.packageName,
        due_date: spec.dueDate,
        auto_reminders: spec.autoReminders,
        reminder_days_before: spec.reminderDays,
      },
    }, result.created ? 201 : 200);
  } catch (error) {
    return esignErrorResponse(error, 'Unable to create the signature request');
  }
});
