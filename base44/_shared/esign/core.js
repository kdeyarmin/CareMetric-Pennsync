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
