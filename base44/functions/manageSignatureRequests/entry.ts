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

/**
 * manageSignatureRequests — the staff read broker (and cancel action) for
 * e-signature requests. Every signing row is server-only (RLS denies every
 * browser read), so the Document Hub, the admin dashboard, analytics and the
 * audit viewer all read through this one function.
 *
 * Authority: an exact active AgencyMembership in the named agency (or the
 * built-in administrator). Rows are then limited to charts the caller may
 * open — agency_admin/manager (and the built-in administrator) see the whole
 * agency; anyone else sees only charts they created or hold an active
 * PatientCareTeamAssignment on. Self-editable profile fields never decide this.
 *
 * Actions (body.action):
 *   list     { status?: open|completed|all, patient_id?, limit? }
 *   detail   { request_key }            — one request plus its audit trail
 *   summary  {}                         — counts for dashboards and analytics
 *   audit    { limit? }                 — recent events (agency_admin/manager)
 *   agreement {}                        — the configured consent text, for in-person signing
 *   templates {}                        — document templates a request can be generated from
 *   cancel  { request_key, reason? }   — requester or agency_admin/manager
 */
const ROW_SCAN_LIMIT = 500;
const EVENT_SCAN_LIMIT = 500;
const CHUNK = 100;
const AGREEMENT_VERSION = 'signature-consent-v1';

const EVENT_LABELS: Record<string, string> = {
  request_created: 'Request created',
  token_minted: 'Signing link issued',
  token_delivery_accepted: 'Signing link emailed',
  token_delivery_indeterminate: 'Signing link delivery needs review',
  token_revoked: 'Previous signing link revoked',
  token_validated: 'Signer opened the link',
  token_expired: 'Signing link expired',
  review_grant_issued: 'Document opened for review',
  review_grant_consumed: 'Review completed',
  signature_claimed: 'Signature submission started',
  signature_recorded: 'Signature recorded',
  token_consumed: 'Signer finished every document',
  reminder_scheduled: 'Reminder scheduled',
  reminder_accepted: 'Reminder emailed',
  reminder_indeterminate: 'Reminder delivery needs review',
  reminder_canceled: 'Reminder canceled',
  request_canceled: 'Request canceled',
  request_expired: 'Request expired',
  fields_updated: 'Field placement updated',
  document_finalized: 'Signed PDF sealed and filed to the chart',
  creator_notified: 'Requester notified',
  integrity_verified: 'Integrity verified',
};

function chunks<T>(values: T[]) {
  const out: T[][] = [];
  for (let index = 0; index < values.length; index += CHUNK) out.push(values.slice(index, index + CHUNK));
  return out;
}

async function visiblePatientIds(authority: Record<string, any>) {
  if (authority.caller.builtInAdmin || ESIGN_CHART_WIDE_ROLES.has(String(authority.membership?.tenant_role || ''))) {
    return null;
  }
  const entities = authority.entities;
  const ids = new Set<string>();
  const assignments = esignRows(await entities.PatientCareTeamAssignment.filter(
    { agency_id: authority.agencyId, user_id: authority.caller.userId, status: 'active' }, undefined, 2000,
  ), 'PatientCareTeamAssignment.filter');
  for (const row of assignments) {
    if (row?.agency_id === authority.agencyId && row?.user_id === authority.caller.userId
      && row?.status === 'active' && esignId(row.patient_id)) ids.add(row.patient_id);
  }
  const created = esignRows(await entities.Patient.filter(
    { agency_id: authority.agencyId, created_by_user_id: authority.caller.userId }, undefined, 2000,
  ), 'Patient.filter');
  for (const row of created) {
    if (row?.agency_id === authority.agencyId && row?.created_by_user_id === authority.caller.userId
      && esignId(row.id)) ids.add(row.id);
  }
  return ids;
}

function signerView(signer: Record<string, any>) {
  return {
    signer_id: signer?.signer_id ?? null,
    name: String(signer?.signer_name || ''),
    role: signer?.signer_role ?? null,
    email: signer?.email ?? null,
    status: signer?.status ?? 'pending',
    signed_at: signer?.signed_at ?? null,
    capture_method: signer?.status === 'completed' ? (signer?.capture_method || 'emailed_link') : null,
  };
}

function documentView(row: Record<string, any>) {
  return {
    id: row.id,
    document_id: row.document_id,
    title: row.document_title || row.document_name || 'Document',
    document_type: row.document_type ?? null,
    status: row.status,
    workflow_status: row.workflow_status,
    due_date: row.due_date ?? null,
    signers: (Array.isArray(row.signers) ? row.signers : []).map(signerView),
    has_field_layout: Array.isArray(row.signature_fields) && row.signature_fields.length > 0,
    signed_document_id: row.signed_document_id ?? null,
    signature_hash: row.signature_hash ?? null,
    finalized_at: row.finalized_at ?? null,
    sealing_pending: row.workflow_status === 'signatures_collected',
    cancelled_at: row.cancelled_at ?? null,
  };
}

function deriveStatus(documents: Array<Record<string, any>>, dueDate: unknown) {
  if (documents.length && documents.every((doc) => doc.status === 'completed')) return 'completed';
  const open = documents.filter((doc) => doc.status !== 'completed');
  if (open.length && open.every((doc) => doc.workflow_status === 'cancelled')) return 'cancelled';
  if (open.length && open.every((doc) => doc.workflow_status === 'expired')) return 'expired';
  if (open.some((doc) => doc.workflow_status === 'signatures_collected')) return 'sealing';
  const deadline = typeof dueDate === 'string' ? dueDateEnd(dueDate) : null;
  if (deadline !== null && deadline < Date.now()) return 'expired';
  const signedAny = documents.some((doc) => doc.signers.some((signer: Record<string, any>) => signer.status === 'completed'));
  return signedAny ? 'partially_signed' : 'awaiting_signatures';
}

async function loadTokensFor(entities: Record<string, any>, agencyId: string, packageIds: string[]) {
  const byPackage = new Map<string, Array<Record<string, any>>>();
  for (const part of chunks(packageIds)) {
    const rows = esignRows(await entities.DocumentPackageToken.filter(
      { agency_id: agencyId, package_id: { $in: part } }, '-created_date', 1000,
    ), 'DocumentPackageToken.filter');
    for (const row of rows) {
      if (row?.agency_id !== agencyId || !part.includes(row.package_id)) continue;
      const list = byPackage.get(row.package_id) || [];
      list.push(row);
      byPackage.set(row.package_id, list);
    }
  }
  return byPackage;
}

async function loadRemindersFor(entities: Record<string, any>, agencyId: string, packageIds: string[]) {
  const byPackage = new Map<string, Array<Record<string, any>>>();
  for (const part of chunks(packageIds)) {
    const rows = esignRows(await entities.ScheduledSignatureReminder.filter(
      { agency_id: agencyId, package_id: { $in: part } }, '-created_date', 1000,
    ), 'ScheduledSignatureReminder.filter');
    for (const row of rows) {
      if (row?.agency_id !== agencyId || !part.includes(row.package_id)) continue;
      const list = byPackage.get(row.package_id) || [];
      list.push(row);
      byPackage.set(row.package_id, list);
    }
  }
  return byPackage;
}

function linkView(tokens: Array<Record<string, any>> | undefined) {
  const latest = (tokens || []).slice().sort((left, right) =>
    String(right.token_created_at || right.created_date || '').localeCompare(String(left.token_created_at || left.created_date || '')))[0];
  if (!latest) return null;
  const expired = latest.status === 'active' && Date.parse(latest.expires_at) <= Date.now();
  return {
    status: expired ? 'expired' : latest.status,
    delivery_state: latest.delivery_state ?? null,
    sent_at: latest.delivery_settled_at ?? latest.token_created_at ?? null,
    expires_at: latest.expires_at ?? null,
    opened_count: Number.isSafeInteger(latest.access_count) ? latest.access_count : 0,
    last_opened_at: latest.last_accessed_at ?? null,
    links_issued: (tokens || []).length,
  };
}

async function loadVisibleRequests(authority: Record<string, any>, options: Record<string, any>) {
  const entities = authority.entities;
  const query: Record<string, any> = { agency_id: authority.agencyId };
  if (options.patientId) query.patient_id = options.patientId;
  if (options.requestKey) query.request_key = options.requestKey;
  const signatureRows = esignRows(await entities.DocumentSignature.filter(query, '-created_date', ROW_SCAN_LIMIT),
    'DocumentSignature.filter')
    .filter((row) => row?.agency_id === authority.agencyId && esignDigest(row.request_key) && esignId(row.patient_id));
  const visible = await visiblePatientIds(authority);
  const rows = visible ? signatureRows.filter((row) => visible.has(row.patient_id)) : signatureRows;
  const requestKeys = [...new Set(rows.map((row) => row.request_key))];
  // A request's packages share (agency_id, created_by_user_id,
  // client_request_id) with its documents; DocumentPackage carries no request key.
  const requestKeyOf = new Map<string, string>();
  for (const row of rows) {
    if (esignId(row.created_by_user_id) && typeof row.client_request_id === 'string' && row.client_request_id) {
      requestKeyOf.set(row.created_by_user_id + '\u0000' + row.client_request_id, row.request_key);
    }
  }
  const clientRequestIds = [...new Set(rows.map((row) => row.client_request_id)
    .filter((id) => typeof id === 'string' && id))];
  const packageRows: Array<Record<string, any>> = [];
  for (const part of chunks(clientRequestIds)) {
    for (const row of esignRows(await entities.DocumentPackage.filter(
      { agency_id: authority.agencyId, client_request_id: { $in: part } }, '-created_date', 1000,
    ), 'DocumentPackage.filter')) {
      const requestKey = requestKeyOf.get(String(row?.created_by_user_id) + '\u0000' + String(row?.client_request_id));
      if (row?.agency_id === authority.agencyId && requestKey) packageRows.push({ ...row, request_key: requestKey });
    }
  }
  const patientIds = [...new Set(rows.map((row) => row.patient_id))];
  const patientNames = new Map<string, string>();
  for (const part of chunks(patientIds)) {
    const patients = esignRows(await entities.Patient.filter(
      { agency_id: authority.agencyId, id: { $in: part } }, undefined, 1000,
    ), 'Patient.filter');
    for (const patient of patients) {
      if (patient?.agency_id !== authority.agencyId || !part.includes(patient.id)) continue;
      patientNames.set(patient.id, [patient.first_name, patient.last_name].filter(Boolean).join(' ').trim() || 'Patient');
    }
  }
  const packageIds = packageRows.map((row) => row.id).filter((id) => esignId(id));
  const tokens = options.includeLinks ? await loadTokensFor(entities, authority.agencyId, packageIds) : new Map();
  const reminders = options.includeLinks ? await loadRemindersFor(entities, authority.agencyId, packageIds) : new Map();
  const requests = requestKeys.map((requestKey) => {
    const documents = rows.filter((row) => row.request_key === requestKey)
      .sort((left, right) => String(left.created_date || '').localeCompare(String(right.created_date || '')));
    const packages = packageRows.filter((row) => row.request_key === requestKey);
    const first = packages[0] || {};
    const roster = new Map((Array.isArray(documents[0]?.signers) ? documents[0].signers : [])
      .map((signer: Record<string, any>) => [signer?.signer_id, signer]));
    const views = documents.map(documentView);
    const signerTotal = views.reduce((sum, doc) => sum + doc.signers.length, 0);
    const signerSigned = views.reduce((sum, doc) => sum + doc.signers.filter((signer: Record<string, any>) => signer.status === 'completed').length, 0);
    return {
      request_key: requestKey,
      package_name: first.package_name || documents[0]?.document_title || 'Signature request',
      patient_id: documents[0].patient_id,
      patient_name: patientNames.get(documents[0].patient_id) || 'Patient',
      created_at: documents[0].created_date ?? null,
      created_by_email: documents[0].created_by_user_email_normalized ?? null,
      created_by_me: documents[0].created_by_user_id === authority.caller.userId,
      due_date: documents[0].due_date ?? first.due_date ?? null,
      message: documents.map((row) => row.message).find((value) => typeof value === 'string' && value) ?? null,
      auto_reminders: first.auto_reminder_enabled === true,
      reminder_days_before: first.reminder_days_before ?? null,
      status: deriveStatus(views, documents[0].due_date ?? first.due_date),
      completed_at: views.every((doc) => doc.status === 'completed')
        ? views.map((doc) => doc.finalized_at).filter(Boolean).sort().pop() ?? null : null,
      counts: { documents: views.length, signers_total: signerTotal, signers_signed: signerSigned },
      documents: views,
      packages: packages.map((pkg) => ({
        id: pkg.id,
        signer_id: pkg.signer_id,
        signer_name: pkg.signer_name,
        signer_email: pkg.signer_email,
        signer_role: roster.get(pkg.signer_id)?.signer_role ?? null,
        status: pkg.status,
        completed_at: pkg.completed_at ?? null,
        link: options.includeLinks ? linkView(tokens.get(pkg.id)) : null,
        reminders: options.includeLinks ? {
          pending: (reminders.get(pkg.id) || []).filter((row: Record<string, any>) => ['pending_audit', 'pending', 'sending'].includes(row.status)).length,
          sent: (reminders.get(pkg.id) || []).filter((row: Record<string, any>) => row.status === 'sent').length,
          next_send_at: (reminders.get(pkg.id) || []).filter((row: Record<string, any>) => row.status === 'pending')
            .map((row: Record<string, any>) => row.send_at).sort()[0] ?? null,
        } : null,
      })),
      can_manage: esignMayManageRequest(authority, documents[0]),
    };
  }).sort((left, right) => String(right.created_at || '').localeCompare(String(left.created_at || '')));
  return { requests, rows, packageRows };
}

function summarize(requests: Array<Record<string, any>>) {
  const counts: Record<string, number> = {
    total: requests.length, awaiting_signatures: 0, partially_signed: 0, sealing: 0,
    completed: 0, cancelled: 0, expired: 0,
  };
  let completedLast30 = 0;
  const durations: number[] = [];
  const thirtyDaysAgo = Date.now() - 30 * 86_400_000;
  let overdue = 0;
  let dueSoon = 0;
  for (const request of requests) {
    counts[request.status] = (counts[request.status] || 0) + 1;
    if (request.status === 'completed' && request.completed_at) {
      const done = Date.parse(request.completed_at);
      if (Number.isFinite(done) && done >= thirtyDaysAgo) completedLast30 += 1;
      const started = Date.parse(request.created_at || '');
      if (Number.isFinite(done) && Number.isFinite(started) && done >= started) durations.push((done - started) / 3_600_000);
    }
    if (['awaiting_signatures', 'partially_signed'].includes(request.status) && request.due_date) {
      const deadline = dueDateEnd(request.due_date);
      if (deadline !== null && deadline - Date.now() < 3 * 86_400_000) dueSoon += 1;
    }
    if (request.status === 'expired') overdue += 1;
  }
  const open = counts.awaiting_signatures + counts.partially_signed + counts.sealing;
  return {
    ...counts,
    open,
    completed_last_30_days: completedLast30,
    average_hours_to_complete: durations.length
      ? Math.round((durations.reduce((sum, value) => sum + value, 0) / durations.length) * 10) / 10 : null,
    completion_rate: requests.length ? Math.round((counts.completed / requests.length) * 1000) / 10 : null,
    due_within_3_days: dueSoon,
    overdue,
  };
}

async function loadEvents(authority: Record<string, any>, rows: Array<Record<string, any>>,
  packageRows: Array<Record<string, any>>, limit: number) {
  const documentIds = new Set(rows.map((row) => row.id));
  const packages = new Map(packageRows.map((row) => [row.id, row]));
  const documentsById = new Map(rows.map((row) => [row.id, row]));
  const requestIds = new Set(rows.map((row) => row.client_request_id).filter(Boolean));
  const events = esignRows(await authority.entities.SignatureAuditEvent.filter(
    { agency_id: authority.agencyId }, '-occurred_at', EVENT_SCAN_LIMIT,
  ), 'SignatureAuditEvent.filter');
  return events
    .filter((event) => event?.agency_id === authority.agencyId && (
      (event.document_signature_id && documentIds.has(event.document_signature_id))
      || (event.package_id && packages.has(event.package_id))
      || (event.action === 'request_created' && requestIds.has(event.request_id))))
    .slice(0, limit)
    .map((event) => {
      const pkg = event.package_id ? packages.get(event.package_id) : null;
      const doc = event.document_signature_id ? documentsById.get(event.document_signature_id) : null;
      const requestKey = doc?.request_key || pkg?.request_key
        || rows.find((row) => row.client_request_id === event.request_id)?.request_key || null;
      return {
        id: event.id,
        action: event.action,
        label: EVENT_LABELS[event.action] || event.action,
        actor_type: event.actor_type,
        occurred_at: event.occurred_at,
        request_key: requestKey,
        document_title: doc ? (doc.document_title || doc.document_name || 'Document') : null,
        signer_name: pkg ? pkg.signer_name : null,
        package_name: pkg ? pkg.package_name : null,
        sealed_sha256: event.action === 'document_finalized' ? event.artifact_content_sha256 ?? null : null,
      };
    });
}

async function cancelRequest(authority: Record<string, any>, requestKey: string, reason: string | null) {
  const entities = authority.entities;
  const { requests, rows, packageRows } = await loadVisibleRequests(authority, { requestKey, includeLinks: false });
  const request = requests[0];
  if (!request) throw new EsignError(404, 'Signature request unavailable');
  if (!esignMayManageRequest(authority, rows[0])) {
    throw new EsignError(403, 'Only the requester or an agency administrator or manager can cancel this request');
  }
  if (request.status === 'completed') throw new EsignError(409, 'This request is already complete');
  const now = new Date().toISOString();
  let cancelledDocuments = 0;
  for (const row of rows) {
    if (row.status === 'completed' || !['pending', 'partial'].includes(row.workflow_status)
      || !Number.isSafeInteger(row.authority_version)) continue;
    const result = await entities.DocumentSignature.updateMany(
      { id: row.id, agency_id: authority.agencyId, status: row.status, workflow_status: row.workflow_status,
        authority_version: row.authority_version },
      { $set: { status: 'rejected', workflow_status: 'cancelled', cancelled_at: now,
        cancelled_by_user_id: authority.caller.userId, ...(reason ? { cancel_reason: reason } : {}),
        authority_version: row.authority_version + 1 } },
    );
    if (esignSingleUpdate(result)) cancelledDocuments += 1;
  }
  // The cancellation itself lives on the documents, which every link, review
  // and reminder re-checks; bumping each package's authority_version also
  // retires any token issuance or review snapshot taken before it.
  const packageIds = packageRows.map((row) => row.id).filter((id) => esignId(id));
  for (const pkg of packageRows) {
    if (!['pending', 'in_progress'].includes(pkg.status) || !Number.isSafeInteger(pkg.authority_version)) continue;
    await entities.DocumentPackage.updateMany(
      { id: pkg.id, agency_id: authority.agencyId, status: pkg.status, authority_version: pkg.authority_version },
      { $set: { authority_version: pkg.authority_version + 1 } },
    ).catch(() => null);
  }
  let revokedLinks = 0;
  const tokens = await loadTokensFor(entities, authority.agencyId, packageIds);
  for (const list of tokens.values()) {
    for (const token of list) {
      if (!['active', 'delivery_pending', 'delivery_indeterminate'].includes(token.status)
        || !Number.isSafeInteger(token.authority_version)) continue;
      const result = await entities.DocumentPackageToken.updateMany(
        { id: token.id, agency_id: authority.agencyId, status: token.status, authority_version: token.authority_version },
        { $set: { status: 'revoked', is_active: false, revoked_at: now, authority_version: token.authority_version + 1 } },
      );
      if (esignSingleUpdate(result)) revokedLinks += 1;
    }
  }
  const reminders = await loadRemindersFor(entities, authority.agencyId, packageIds);
  for (const list of reminders.values()) {
    for (const reminder of list) {
      if (!['pending_audit', 'pending'].includes(reminder.status) || !Number.isSafeInteger(reminder.authority_version)) continue;
      await entities.ScheduledSignatureReminder.updateMany(
        { id: reminder.id, agency_id: authority.agencyId, status: reminder.status, authority_version: reminder.authority_version },
        { $set: { status: 'canceled', delivery_state: 'rejected', canceled_at: now, canceled_by: authority.caller.email,
          failure_reason: 'Signature request canceled', authority_version: reminder.authority_version + 1 } },
      ).catch(() => null);
    }
  }
  for (const pkg of packageRows) {
    await esignAudit(entities, {
      event_key: await esignSha256('request_canceled\u0000' + pkg.id + '\u0000' + now),
      agency_id: authority.agencyId, package_id: pkg.id, signer_id: pkg.signer_id,
      action: 'request_canceled', actor_type: 'authenticated_user', actor_user_id: authority.caller.userId,
      ...(authority.membership ? { membership_id: authority.membership.id, membership_version: authority.membership.version } : {}),
      request_id: requestKey, occurred_at: now,
    }).catch(() => null);
  }
  return { cancelled_documents: cancelledDocuments, revoked_links: revokedLinks };
}

async function configuredAgreement() {
  const digest = String(Deno.env.get('SIGNATURE_AGREEMENT_SHA256') || '').trim().toLowerCase();
  const text = String(Deno.env.get('SIGNATURE_AGREEMENT_TEXT') || '').trim();
  if (!esignDigest(digest) || text.length < 40 || text.length > 5_000 || await esignSha256(text) !== digest) {
    throw new EsignError(503, 'The electronic signature consent text is not configured (SIGNATURE_AGREEMENT_TEXT and SIGNATURE_AGREEMENT_SHA256)', 'signature_agreement_not_configured');
  }
  return { version: AGREEMENT_VERSION, text, sha256: digest };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return esignJson({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    await esignLoadCaller(base44);
    const body = esignOnlyKeys(await esignReadJson(req),
      ['action', 'agency_id', 'status', 'patient_id', 'limit', 'request_key', 'reason']);
    const action = String(body.action || '');
    if (!['list', 'detail', 'summary', 'audit', 'agreement', 'templates', 'cancel'].includes(action)) {
      throw new EsignError(400, 'action must be list, detail, summary, audit, agreement, templates or cancel');
    }
    const authority = await esignStaffAuthority(base44, { agencyId: body.agency_id });
    const scope = {
      agency_id: authority.agencyId,
      tenant_role: authority.tenantRole,
      membership_id: authority.membership?.id ?? null,
    };
    if (action === 'templates') {
      // The document templates a request may be generated from (a shared
      // reference catalog); only names and categories leave the broker.
      if (!authority.caller.builtInAdmin && !ESIGN_REQUEST_ROLES.has(String(authority.membership?.tenant_role || ''))) {
        throw new EsignError(403, 'Your agency role cannot send documents for signature');
      }
      const templates = esignRows(await authority.entities.DocumentTemplate.list('-created_date', 200),
        'DocumentTemplate.list')
        .filter((row) => esignId(row?.id) && typeof (row.content ?? '') === 'string' && String(row.content || '').trim())
        .map((row) => ({
          id: row.id,
          name: String(row.template_name || row.name || 'Document').slice(0, 200),
          category: typeof row.category === 'string' ? row.category : null,
          description: typeof row.description === 'string' ? row.description.slice(0, 300) : null,
        }));
      return esignJson({ success: true, scope, templates });
    }
    if (action === 'agreement') {
      if (!authority.caller.builtInAdmin && !ESIGN_REQUEST_ROLES.has(String(authority.membership?.tenant_role || ''))) {
        throw new EsignError(403, 'Your agency role cannot collect signatures in person');
      }
      return esignJson({ success: true, scope, agreement: await configuredAgreement() });
    }
    if (action === 'list') {
      const status = body.status == null ? 'all' : String(body.status);
      if (!['open', 'completed', 'all'].includes(status)) throw new EsignError(400, 'status must be open, completed or all');
      const patientId = body.patient_id == null ? null : esignId(body.patient_id);
      if (body.patient_id != null && !patientId) throw new EsignError(400, 'patient_id is invalid');
      if (patientId) await esignRequireChartAccess(authority, patientId);
      const limit = body.limit == null ? 200 : Number(body.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new EsignError(400, 'limit must be 1 through 500');
      const { requests } = await loadVisibleRequests(authority, { patientId, includeLinks: true });
      const filtered = requests.filter((request) => status === 'all'
        || (status === 'completed' ? request.status === 'completed'
          : ['awaiting_signatures', 'partially_signed', 'sealing'].includes(request.status)));
      return esignJson({ success: true, scope, requests: filtered.slice(0, limit), truncated: filtered.length > limit });
    }
    if (action === 'summary') {
      const { requests } = await loadVisibleRequests(authority, { includeLinks: false });
      return esignJson({ success: true, scope, summary: summarize(requests) });
    }
    if (action === 'audit') {
      if (!authority.caller.builtInAdmin && !ESIGN_CHART_WIDE_ROLES.has(String(authority.membership?.tenant_role || ''))) {
        throw new EsignError(403, 'The signature audit trail is available to agency administrators and managers');
      }
      const limit = body.limit == null ? 200 : Number(body.limit);
      if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) throw new EsignError(400, 'limit must be 1 through 500');
      const { rows, packageRows } = await loadVisibleRequests(authority, { includeLinks: false });
      return esignJson({ success: true, scope, events: await loadEvents(authority, rows, packageRows, limit) });
    }
    const requestKey = esignDigest(body.request_key);
    if (!requestKey) throw new EsignError(400, 'request_key is required');
    if (action === 'detail') {
      const { requests, rows, packageRows } = await loadVisibleRequests(authority, { requestKey, includeLinks: true });
      if (!requests.length) throw new EsignError(404, 'Signature request unavailable');
      return esignJson({ success: true, scope, request: requests[0], events: await loadEvents(authority, rows, packageRows, 200) });
    }
    let reason: string | null = null;
    if (body.reason != null && body.reason !== '') {
      if (typeof body.reason !== 'string' || body.reason.trim().length > 500) throw new EsignError(400, 'reason must be at most 500 characters');
      reason = body.reason.trim();
    }
    const result = await cancelRequest(authority, requestKey, reason);
    return esignJson({ success: true, scope, ...result });
  } catch (error) {
    return esignErrorResponse(error, 'Unable to load signature requests');
  }
});
