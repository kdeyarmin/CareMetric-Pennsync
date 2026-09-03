import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Source-only Document creation authority substrate.
 *
 * This function is intentionally not wired to any frontend callsite yet. It
 * accepts an actual multipart File, proves immutable tenant authority before
 * the public upload, and records an all-RLS-false DocumentTenantBinding beside
 * the legacy Document row. Existing Document RLS remains unchanged until
 * every writer and reader has migrated to binding-backed brokers.
 */

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const DOCUMENT_CREATE_ROLES = new Set(['agency_admin', 'manager', 'clinician']);
const AGENCY_WIDE_PATIENT_ROLES = new Set(['agency_admin', 'manager']);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const ALLOWED_FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const PURPOSE_CATEGORY: Record<string, string> = {
  patient_document: 'other',
  referral: 'referral',
};
const ALLOWED_MULTIPART_FIELDS = new Set([
  'file',
  'agency_id',
  'patient_id',
  'purpose',
  'client_request_id',
]);

class PublicError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

const normalizeEmail = (value: unknown) =>
  typeof value === 'string' ? value.trim().toLowerCase() : '';

function canonicalEmail(value: unknown) {
  const normalized = normalizeEmail(value);
  if (!normalized || normalized.length > 320 || !normalized.includes('@') || /\s/.test(normalized)) {
    return null;
  }
  return normalized;
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_IDENTIFIER_LENGTH || value.trim() !== value) return null;
  if (value.startsWith('$')) return null;
  return value;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function boundedReason(value: unknown) {
  if (typeof value !== 'string') return null;
  const reason = value.trim();
  return reason && reason.length <= 500 ? reason : null;
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function sameJson(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function safeFileName(value: unknown) {
  if (typeof value !== 'string') return null;
  if (!value || value.length > MAX_FILE_NAME_LENGTH || value.trim() !== value) return null;
  if (value === '.' || value === '..' || value.includes('..')) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/.test(value)) return null;
  return value;
}

function fileExtensionMatches(fileName: string, fileType: string) {
  const lowerName = fileName.toLowerCase();
  if (fileType === 'application/pdf') return lowerName.endsWith('.pdf');
  if (fileType === 'image/png') return lowerName.endsWith('.png');
  if (fileType === 'image/jpeg') {
    return lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg');
  }
  return false;
}

function formValues(form: FormData, field: string) {
  return form.getAll(field);
}

function requireSingleString(form: FormData, field: string, optional = false) {
  const values = formValues(form, field);
  if (optional && values.length === 0) return null;
  if (values.length !== 1 || typeof values[0] !== 'string') {
    throw new PublicError(400, `${field} is invalid`);
  }
  return values[0];
}

async function parseMultipartInput(req: Request) {
  const contentType = req.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    throw new PublicError(415, 'multipart/form-data is required');
  }
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_MULTIPART_BYTES) {
    throw new PublicError(413, 'Document upload is too large');
  }

  let form: FormData;
  try {
    // When Content-Length is absent, Request.formData() must materialize the
    // multipart body before File.size can be enforced below. The 25 MiB File
    // check still fails closed, but a platform/gateway body cap is required to
    // remove this bounded-function-memory exposure before production wiring.
    form = await req.formData();
  } catch {
    throw new PublicError(400, 'Invalid multipart body');
  }
  for (const [field] of form.entries()) {
    if (!ALLOWED_MULTIPART_FIELDS.has(field)) {
      throw new PublicError(400, `Unsupported upload field: ${field}`);
    }
  }

  const files = formValues(form, 'file');
  if (
    files.length !== 1
    || typeof File === 'undefined'
    || !(files[0] instanceof File)
  ) {
    throw new PublicError(400, 'file must be an uploaded File');
  }
  const file = files[0] as File;
  const fileName = safeFileName(file.name);
  const fileType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (!fileName) throw new PublicError(400, 'file name is invalid');
  if (!ALLOWED_FILE_TYPES.has(fileType) || !fileExtensionMatches(fileName, fileType)) {
    throw new PublicError(400, 'file type is invalid');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new PublicError(413, 'file size is invalid');
  }

  const agencyId = exactIdentifier(requireSingleString(form, 'agency_id'));
  const patientRaw = requireSingleString(form, 'patient_id', true);
  const patientId = patientRaw === null ? null : exactIdentifier(patientRaw);
  const purpose = requireSingleString(form, 'purpose');
  const clientRequestId = exactIdentifier(requireSingleString(form, 'client_request_id'));
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (patientRaw !== null && !patientId) throw new PublicError(400, 'patient_id is invalid');
  if (typeof purpose !== 'string' || !Object.hasOwn(PURPOSE_CATEGORY, purpose)) {
    throw new PublicError(400, 'purpose is invalid');
  }
  if (!clientRequestId) throw new PublicError(400, 'client_request_id is invalid');
  if (purpose === 'patient_document' && !patientId) {
    throw new PublicError(400, 'patient_id is required for patient_document');
  }

  return {
    file,
    fileName,
    fileType,
    fileSize: file.size,
    agencyId,
    patientId,
    purpose,
    category: PURPOSE_CATEGORY[purpose],
    clientRequestId,
  };
}

async function loadActiveActor(base44: Record<string, any>) {
  const user = await base44.auth.me().catch(() => null);
  if (!user) throw new PublicError(401, 'Unauthorized');
  if (
    user.is_active === false
    || user.disabled === true
    || user.is_service === true
    || user.is_verified === false
  ) {
    throw new PublicError(403, 'Forbidden');
  }
  const userId = exactIdentifier(user.id);
  const normalizedEmail = canonicalEmail(user.email);
  if (!userId || !normalizedEmail) throw new PublicError(403, 'Forbidden');
  return { userId, normalizedEmail };
}

function validateActiveMembership(
  rawRows: Array<Record<string, any>>,
  actor: { userId: string; normalizedEmail: string },
  agencyId: string,
) {
  if (rawRows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  const exactRows = rawRows.filter(
    (row) => row?.user_id === actor.userId && row?.agency_id === agencyId,
  );
  if (exactRows.length === 0) throw new PublicError(403, 'No tenant membership for agency');
  if (exactRows.length !== 1) throw new PublicError(409, 'Tenant membership is ambiguous');

  const row = exactRows[0];
  const id = exactIdentifier(row.id);
  const membershipKey = exactIdentifier(row.membership_key);
  const storedEmail = canonicalEmail(row.user_email_normalized);
  const createdBy = exactIdentifier(row.created_by_user_id);
  const transitionedBy = exactIdentifier(row.last_transition_by_user_id);
  const transitionEmail = canonicalEmail(row.last_transition_by_email_normalized);
  const status = typeof row.status === 'string' ? row.status : '';
  const tenantRole = typeof row.tenant_role === 'string' ? row.tenant_role : '';
  if (
    !id
    || !membershipKey
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || storedEmail !== actor.normalizedEmail
    || membershipKey !== `${agencyId}:${actor.userId}`
    || !createdBy
    || !transitionedBy
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !MEMBERSHIP_STATUSES.has(status)
    || !TENANT_ROLES.has(tenantRole)
    || !Number.isSafeInteger(row.version)
    || Number(row.version) < 1
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  if (status !== 'active') throw new PublicError(403, 'No active membership for agency');
  if (!DOCUMENT_CREATE_ROLES.has(tenantRole)) {
    throw new PublicError(403, 'Tenant role cannot upload documents');
  }
  return row;
}

async function loadExactEnabledAgency(entities: Record<string, any>, agencyId: string) {
  const rawRows = requireRows(
    await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT),
    'Agency.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Agency is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === agencyId);
  if (exactRows.length !== 1) throw new PublicError(403, 'Agency is unavailable');
  if (!ENABLED_AGENCY_STATUSES.has(String(exactRows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return exactRows[0];
}

function patientAuthoritySnapshot(row: Record<string, any>) {
  return {
    id: row.id,
    agency_id: row.agency_id,
    created_by_user_id: row.created_by_user_id,
    created_by_user_email_normalized: row.created_by_user_email_normalized,
    created_by: row.created_by,
    client_request_id: row.client_request_id,
    patient_creation_key: row.patient_creation_key,
    status: row.status,
    is_sample: row.is_sample,
    is_archived: row.is_archived,
  };
}

async function loadExactAuthorizedPatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
  actor: { userId: string; normalizedEmail: string },
  membership: Record<string, any>,
) {
  const rawRows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false },
      undefined,
      EXACT_ROW_LIMIT,
    ),
    'Patient.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  const exactRows = rawRows.filter(
    (row) => row?.id === patientId
      && row?.agency_id === agencyId
      && row?.is_sample === false
      && row?.is_archived === false,
  );
  if (exactRows.length !== 1) throw new PublicError(404, 'Patient unavailable');
  const patient = exactRows[0];
  const creatorId = exactIdentifier(patient.created_by_user_id);
  const creatorEmail = canonicalEmail(patient.created_by_user_email_normalized);
  const clientRequestId = exactIdentifier(patient.client_request_id);
  if (
    !creatorId
    || !creatorEmail
    || patient.created_by_user_email_normalized !== creatorEmail
    || canonicalEmail(patient.created_by) !== creatorEmail
    || !clientRequestId
    || patient.patient_creation_key !== `${agencyId}:${creatorId}:${clientRequestId}`
    || !PATIENT_STATUSES.has(String(patient.status || ''))
  ) {
    throw new PublicError(409, 'Patient authority integrity check failed');
  }
  if (
    !AGENCY_WIDE_PATIENT_ROLES.has(String(membership.tenant_role || ''))
    && (creatorId !== actor.userId || creatorEmail !== actor.normalizedEmail)
  ) {
    throw new PublicError(404, 'Patient unavailable');
  }
  return patient;
}

function authoritySnapshot(
  actor: { userId: string; normalizedEmail: string },
  membership: Record<string, any>,
  agency: Record<string, any>,
  patient: Record<string, any> | null,
) {
  return {
    actor,
    membership: {
      id: membership.id,
      membership_key: membership.membership_key,
      agency_id: membership.agency_id,
      user_id: membership.user_id,
      user_email_normalized: membership.user_email_normalized,
      tenant_role: membership.tenant_role,
      status: membership.status,
      version: membership.version,
      last_transition_at: membership.last_transition_at,
    },
    agency: { id: agency.id, status: agency.status },
    patient: patient ? patientAuthoritySnapshot(patient) : null,
  };
}

async function loadAuthority(
  base44: Record<string, any>,
  input: { agencyId: string; patientId: string | null },
  expected: Record<string, any> | null = null,
) {
  const actor = await loadActiveActor(base44);
  const entities = base44.asServiceRole.entities;
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: actor.userId, agency_id: input.agencyId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
    ),
    'AgencyMembership.filter',
  );
  const membership = validateActiveMembership(rawMemberships, actor, input.agencyId);
  const agency = await loadExactEnabledAgency(entities, input.agencyId);
  const patient = input.patientId
    ? await loadExactAuthorizedPatient(
      entities,
      input.patientId,
      input.agencyId,
      actor,
      membership,
    )
    : null;
  const snapshot = authoritySnapshot(actor, membership, agency, patient);
  if (expected && !sameJson(snapshot, expected)) {
    throw new PublicError(409, 'Document upload authority changed during request');
  }
  return { actor, membership, snapshot, entities };
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Bytes(bytes: ArrayBuffer) {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

async function sha256Text(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function fileSignatureMatches(bytes: ArrayBuffer, fileType: string) {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 8));
  const startsWith = (signature: number[]) =>
    head.length >= signature.length
    && signature.every((byte, index) => head[index] === byte);
  if (fileType === 'application/pdf') return startsWith([0x25, 0x50, 0x44, 0x46, 0x2d]);
  if (fileType === 'image/jpeg') return startsWith([0xff, 0xd8, 0xff]);
  if (fileType === 'image/png') {
    return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  }
  return false;
}

function exactHttpsUrl(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value) {
    return null;
  }
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:'
      || url.username
      || url.password
      || url.hash
      || url.href !== value
    ) return null;
    return value;
  } catch {
    return null;
  }
}

function optionalPatientMatches(value: unknown, expected: string | null) {
  return expected === null
    ? value === undefined || value === null
    : value === expected;
}

function documentMatches(
  row: Record<string, any>,
  expected: {
    documentId: string;
    fileUrl: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    category: string;
    purpose: string;
    patientId: string | null;
    normalizedEmail: string;
    documentDate: string;
  },
) {
  return row?.id === expected.documentId
    && row.title === expected.fileName
    && row.file_url === expected.fileUrl
    && row.file_name === expected.fileName
    && row.file_type === expected.fileType
    && row.file_size === expected.fileSize
    && row.category === expected.category
    && optionalPatientMatches(row.patient_id, expected.patientId)
    && row.uploaded_by === expected.normalizedEmail
    && canonicalEmail(row.uploaded_by) === expected.normalizedEmail
    && row.created_by === expected.normalizedEmail
    && canonicalEmail(row.created_by) === expected.normalizedEmail
    && row.document_date === expected.documentDate
    && sameJson(row.tags, [expected.purpose])
    && row.is_sensitive === true;
}

function bindingMatchesReplay(
  row: Record<string, any>,
  expected: {
    bindingKey: string;
    agencyId: string;
    patientId: string | null;
    actor: { userId: string; normalizedEmail: string };
    membershipId: string;
    fileName: string;
    fileType: string;
    fileSize: number;
    contentSha256: string;
    clientRequestId: string;
    purpose: string;
  },
) {
  return !!exactIdentifier(row?.id)
    && row.binding_key === expected.bindingKey
    && !!exactIdentifier(row.document_id)
    && row.agency_id === expected.agencyId
    && optionalPatientMatches(row.patient_id, expected.patientId)
    && row.created_by_user_id === expected.actor.userId
    && row.created_by_user_email_normalized === expected.actor.normalizedEmail
    && canonicalEmail(row.created_by_user_email_normalized) === expected.actor.normalizedEmail
    && row.membership_id === expected.membershipId
    && Number.isSafeInteger(row.membership_version)
    && row.membership_version >= 1
    && row.document_created_by_email_normalized === expected.actor.normalizedEmail
    && canonicalEmail(row.document_created_by_email_normalized) === expected.actor.normalizedEmail
    && !!exactHttpsUrl(row.file_url)
    && row.file_name === expected.fileName
    && row.file_type === expected.fileType
    && row.file_size === expected.fileSize
    && row.content_sha256 === expected.contentSha256
    && row.client_request_id === expected.clientRequestId
    && row.purpose === expected.purpose
    && row.version === 1
    && validInstant(row.created_at)
    && validInstant(row.last_verified_at);
}

function bindingMatchesCreation(
  row: Record<string, any>,
  expected: Record<string, any>,
) {
  return bindingMatchesReplay(row, expected)
    && row.document_id === expected.documentId
    && row.membership_version === expected.membershipVersion
    && row.file_url === expected.fileUrl
    && row.created_at === expected.createdAt
    && row.last_verified_at === expected.lastVerifiedAt;
}

async function loadExactDocument(entities: Record<string, any>, documentId: string) {
  const rawRows = requireRows(
    await entities.Document.filter({ id: documentId }, undefined, EXACT_ROW_LIMIT),
    'Document.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Document is ambiguous');
  const exactRows = rawRows.filter((row) => row?.id === documentId);
  if (exactRows.length !== 1) throw new PublicError(409, 'Document binding integrity check failed');
  return exactRows[0];
}

async function loadBindingRows(entities: Record<string, any>, bindingKey: string) {
  const rawRows = requireRows(
    await entities.DocumentTenantBinding.filter(
      { binding_key: bindingKey },
      '-created_date',
      EXACT_ROW_LIMIT,
    ),
    'DocumentTenantBinding.filter',
  );
  if (rawRows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Document upload request is ambiguous');
  }
  const exactRows = rawRows.filter((row) => row?.binding_key === bindingKey);
  if (exactRows.length > 1) throw new PublicError(409, 'Document upload request is ambiguous');
  return exactRows;
}

function narrowResult(
  created: boolean,
  document: Record<string, any>,
  binding: Record<string, any>,
  authority: Record<string, any>,
) {
  return {
    success: true,
    created,
    document: {
      id: document.id,
      file_url: document.file_url,
      file_name: document.file_name,
      file_type: document.file_type,
      file_size: document.file_size,
      category: document.category,
      patient_id: document.patient_id ?? null,
    },
    binding: {
      id: binding.id,
      version: binding.version,
      client_request_id: binding.client_request_id,
    },
    scope: {
      agency_id: authority.snapshot.agency.id,
      patient_id: authority.snapshot.patient?.id ?? null,
      membership_id: authority.membership.id,
      membership_version: authority.membership.version,
      tenant_role: authority.membership.tenant_role,
    },
  };
}

async function resolveReplay(
  entities: Record<string, any>,
  rows: Array<Record<string, any>>,
  expected: Record<string, any>,
  authority: Record<string, any>,
) {
  if (rows.length === 0) return null;
  const binding = rows[0];
  if (!bindingMatchesReplay(binding, expected)) {
    throw new PublicError(409, 'client_request_id conflicts with another document upload');
  }
  const documentId = exactIdentifier(binding.document_id);
  if (!documentId) throw new PublicError(409, 'Document binding integrity check failed');
  const document = await loadExactDocument(entities, documentId);
  const documentExpected = {
    documentId,
    fileUrl: binding.file_url,
    fileName: expected.fileName,
    fileType: expected.fileType,
    fileSize: expected.fileSize,
    category: PURPOSE_CATEGORY[expected.purpose],
    purpose: expected.purpose,
    patientId: expected.patientId,
    normalizedEmail: expected.actor.normalizedEmail,
    documentDate: String(binding.created_at).slice(0, 10),
  };
  if (!documentMatches(document, documentExpected)) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  return narrowResult(false, document, binding, authority);
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json(
        { error: 'Method not allowed' },
        { status: 405, headers: { Allow: 'POST' } },
      );
    }

    const base44 = createClientFromRequest(req);
    await loadActiveActor(base44);
    const input = await parseMultipartInput(req);
    const initial = await loadAuthority(base44, input);

    const exactBytes = await input.file.arrayBuffer();
    if (exactBytes.byteLength !== input.fileSize) {
      throw new PublicError(409, 'File changed while being read');
    }
    if (!fileSignatureMatches(exactBytes, input.fileType)) {
      throw new PublicError(400, 'file content does not match file type');
    }
    const contentSha256 = await sha256Bytes(exactBytes);
    const bindingKey = await sha256Text(
      `${input.agencyId}\u0000${initial.actor.userId}\u0000${input.clientRequestId}`,
    );
    const replayExpected = {
      bindingKey,
      agencyId: input.agencyId,
      patientId: input.patientId,
      actor: initial.actor,
      membershipId: initial.membership.id,
      fileName: input.fileName,
      fileType: input.fileType,
      fileSize: input.fileSize,
      contentSha256,
      clientRequestId: input.clientRequestId,
      purpose: input.purpose,
    };

    const existingRows = await loadBindingRows(initial.entities, bindingKey);
    const replay = await resolveReplay(initial.entities, existingRows, replayExpected, initial);
    if (replay) {
      await loadAuthority(base44, input, initial.snapshot);
      return Response.json(replay);
    }

    // Re-prove immediately before the irreversible public upload. Public file
    // deletion is not exposed by this SDK; an authority change after this point
    // can leave an unbound object, which is a documented staging blocker.
    await loadAuthority(base44, input, initial.snapshot);
    const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file: input.file });
    const fileUrl = exactHttpsUrl(uploadResult?.file_url);
    if (!fileUrl) throw new Error('UploadFile returned an invalid URL');

    const beforeCreate = await loadAuthority(base44, input, initial.snapshot);
    const concurrentRows = await loadBindingRows(beforeCreate.entities, bindingKey);
    const concurrentReplay = await resolveReplay(
      beforeCreate.entities,
      concurrentRows,
      replayExpected,
      beforeCreate,
    );
    if (concurrentReplay) {
      await loadAuthority(base44, input, initial.snapshot);
      return Response.json(concurrentReplay);
    }

    const now = new Date().toISOString();
    const documentDate = now.slice(0, 10);
    const documentPayload = {
      title: input.fileName,
      file_url: fileUrl,
      file_name: input.fileName,
      file_size: input.fileSize,
      file_type: input.fileType,
      category: input.category,
      ...(input.patientId ? { patient_id: input.patientId } : {}),
      tags: [input.purpose],
      document_date: documentDate,
      uploaded_by: initial.actor.normalizedEmail,
      created_by: initial.actor.normalizedEmail,
      is_sensitive: true,
    };
    const createdDocument = await beforeCreate.entities.Document.create(documentPayload);
    const documentId = exactIdentifier(createdDocument?.id);
    if (!documentId) throw new Error('Document.create returned no exact id');

    try {
      const bindingPayload = {
        binding_key: bindingKey,
        document_id: documentId,
        agency_id: input.agencyId,
        ...(input.patientId ? { patient_id: input.patientId } : {}),
        created_by_user_id: initial.actor.userId,
        created_by_user_email_normalized: initial.actor.normalizedEmail,
        membership_id: initial.membership.id,
        membership_version: initial.membership.version,
        document_created_by_email_normalized: initial.actor.normalizedEmail,
        file_url: fileUrl,
        file_name: input.fileName,
        file_type: input.fileType,
        file_size: input.fileSize,
        content_sha256: contentSha256,
        client_request_id: input.clientRequestId,
        purpose: input.purpose,
        version: 1,
        created_at: now,
        last_verified_at: now,
      };
      const createdBinding = await beforeCreate.entities.DocumentTenantBinding.create(bindingPayload);
      const bindingId = exactIdentifier(createdBinding?.id);
      if (!bindingId) throw new Error('DocumentTenantBinding.create returned no exact id');

      const exactDocument = await loadExactDocument(beforeCreate.entities, documentId);
      if (!documentMatches(exactDocument, {
        documentId,
        fileUrl,
        fileName: input.fileName,
        fileType: input.fileType,
        fileSize: input.fileSize,
        category: input.category,
        purpose: input.purpose,
        patientId: input.patientId,
        normalizedEmail: initial.actor.normalizedEmail,
        documentDate,
      })) {
        throw new Error('Document post-create verification failed');
      }

      const exactBindings = await loadBindingRows(beforeCreate.entities, bindingKey);
      const exactBinding = exactBindings.length === 1 ? exactBindings[0] : null;
      const bindingExpected = {
        ...replayExpected,
        documentId,
        membershipVersion: initial.membership.version,
        fileUrl,
        createdAt: now,
        lastVerifiedAt: now,
      };
      if (
        !exactBinding
        || exactBinding.id !== bindingId
        || !bindingMatchesCreation(exactBinding, bindingExpected)
      ) {
        throw new PublicError(409, 'Document binding post-create verification failed');
      }

      const finalAuthority = await loadAuthority(base44, input, initial.snapshot);
      return Response.json(narrowResult(true, exactDocument, exactBinding, finalAuthority));
    } catch (error) {
      // Never delete a replayed/pre-existing record. Only the Document created
      // in this request is compensated; Base44 exposes no transaction or public
      // file deletion primitive, and binding rows are immutable evidence.
      await beforeCreate.entities.Document.delete(documentId).catch(() => {});
      throw error;
    }
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Static only: filenames, patient identifiers, URLs, and SDK error details
    // can contain PHI and must never be emitted to function logs.
    console.error('createAuthorizedDocument failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
