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

/**
 * generateSignatureCertificate — a standalone certificate of completion for a
 * sealed signature request: the document, the source and sealed SHA-256
 * digests, each signer's identity as the request recorded it, when and how
 * they signed, their consent version and signature-image digest, and the
 * request's audit trail. Every signature image is re-read from private storage
 * and re-verified against its digest before the certificate is issued.
 *
 * The PDF is returned in the response only; the sealed chart copy already
 * carries the same certificate as its last page.
 *
 * Authority: an exact active membership in the agency (or the built-in
 * administrator) with chart access to the document's own patient.
 *
 * Body: { agency_id, document_signature_id }
 */
const EVENT_LABELS: Record<string, string> = {
  request_created: 'Signature request created',
  token_minted: 'Signing link issued',
  token_delivery_accepted: 'Signing link emailed to the signer',
  token_revoked: 'Previous signing link revoked (reminder sent)',
  token_validated: 'Signer opened the signing link',
  review_grant_issued: 'Document opened for review',
  signature_claimed: 'Signature submission started',
  signature_recorded: 'Signature recorded',
  token_consumed: 'Signer completed every document',
  reminder_scheduled: 'Reminder scheduled',
  reminder_accepted: 'Reminder emailed',
  document_finalized: 'Signed document sealed and filed to the chart',
  creator_notified: 'Requester notified',
  integrity_verified: 'Integrity verified',
};

Deno.serve(async (req) => {
  if (req.method !== 'POST') return esignJson({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    await esignLoadCaller(base44);
    const body = esignOnlyKeys(await esignReadJson(req), ['agency_id', 'document_signature_id']);
    const authority = await esignStaffAuthority(base44, { agencyId: body.agency_id });
    const { row } = await esignLoadAuthorizedSignature(authority, body.document_signature_id);
    if (row.status !== 'completed' || row.workflow_status !== 'completed' || !esignDigest(row.signature_hash)) {
      return esignJson({ error: 'A certificate is issued once every required signer has signed and the document is sealed', code: 'not_ready' }, 409);
    }
    const signers = (await esignLoadSignerFacts(base44, row, { requireAll: true }))
      .filter((signer) => signer.status === 'completed');
    const packageIds = new Set((await esignLoadRequestPackages(authority.entities, authority.agencyId,
      row.created_by_user_id, row.client_request_id))
      .filter((pkg) => Array.isArray(pkg.document_signatures) && pkg.document_signatures.includes(row.id))
      .map((pkg) => pkg.id));
    const events = esignRows(await authority.entities.SignatureAuditEvent.filter(
      { agency_id: authority.agencyId }, '-occurred_at', 500,
    ), 'SignatureAuditEvent.filter')
      .filter((event) => event?.document_signature_id === row.id
        || (event?.package_id && packageIds.has(event.package_id) && !event.document_signature_id)
        || (event?.action === 'request_created' && event.request_id === row.client_request_id
          && event.actor_user_id === row.created_by_user_id))
      .filter((event) => Object.hasOwn(EVENT_LABELS, event.action))
      .sort((left, right) => String(left.occurred_at).localeCompare(String(right.occurred_at)))
      .slice(0, 60)
      .map((event) => ({ occurred_at: event.occurred_at, label: EVENT_LABELS[event.action] }));
    const bytes = await esignRenderCertificatePdf({
      meta: {
        title: row.document_title || row.document_name || 'Document',
        agencyName: authority.agency.agency_name,
        signatureId: row.id,
        sourceSha256: row.document_content_sha256,
        signedSha256: row.signature_hash,
        completedAt: row.finalized_at || row.completed_at,
      },
      signers,
      events,
    });
    return esignJson({
      success: true,
      file_name: esignSafeFileName('Signature certificate ' + String(row.document_title || 'document'), 'Signature certificate'),
      content_type: 'application/pdf',
      pdf_base64: esignBase64(bytes),
      signature_hash: row.signature_hash,
      signature_hash_alg: 'SHA-256',
    });
  } catch (error) {
    return esignErrorResponse(error, 'Unable to generate the signature certificate');
  }
});
