import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Exact, purpose-bound Document read broker.
 *
 * Document has no trustworthy tenant column. This broker therefore treats the
 * immutable, all-RLS-false DocumentTenantBinding as the root of authority,
 * verifies its original membership and Document preimage, and then applies
 * current Patient creator/care-team access. Browser view/download paths use
 * this function instead of direct Document or stored-URL access.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_URI_LENGTH = 4096;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const SIGNED_URL_TTL_SECONDS = 60;

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin',
  'manager',
  'clinician',
  'office_staff',
  'social_worker',
  'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager', 'platform_owner']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual',
  'patient_creator',
  'legacy_assigned_nurses',
  'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const BINDING_PURPOSES = new Set(['patient_document', 'referral']);
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const PURPOSE_CATEGORY: Record<string, string> = {
  patient_document: 'other',
  referral: 'referral',
};

// <<<BEGIN AUTHORIZED DOCUMENT EXACT PURPOSE POLICY>>>
const PURPOSE_FIELDS: Record<string, readonly string[]> = {
  metadata: [
    'id',
    'title',
    'description',
    'file_name',
    'file_size',
    'file_type',
    'category',
    'patient_id',
    'tags',
    'document_date',
    'is_sensitive',
    'expiration_date',
    'is_signed',
    'is_locked',
    'updated_date',
  ],
  signature_review: [
    'id',
    'title',
    'category',
    'patient_id',
    'document_date',
    'expiration_date',
    'clinician_signed',
    'clinician_signed_date',
    'clinician_name',
    'patient_signed',
    'patient_signed_date',
    'patient_name',
    'is_signed',
    'is_locked',
    'updated_date',
  ],
  download: [
    'id',
    'file_name',
    'file_size',
    'file_type',
    'category',
    'patient_id',
  ],
};

const PURPOSE_ROLES: Record<string, ReadonlySet<string>> = {
  metadata: new Set([
    'platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care',
  ]),
  signature_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
  download: new Set([
    'platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care',
  ]),
};
// <<<END AUTHORIZED DOCUMENT EXACT PURPOSE POLICY>>>

const MEMBERSHIP_AUTHORITY_FIELDS = [
  'id',
  'membership_key',
  'agency_id',
  'user_id',
  'user_email_normalized',
  'tenant_role',
  'status',
  'created_by_user_id',
  'activated_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'version',
];
const BINDING_AUTHORITY_FIELDS = [
  'id',
  'binding_key',
  'document_id',
  'agency_id',
  'patient_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'membership_id',
  'membership_version',
  'document_created_by_email_normalized',
  'storage_mode',
  'file_uri',
  'file_name',
  'file_type',
  'file_size',
  'content_sha256',
  'client_request_id',
  'purpose',
  'version',
  'created_at',
  'last_verified_at',
];
const DOCUMENT_AUTHORITY_FIELDS = [
  'id',
  'title',
  'file_url',
  'file_name',
  'file_size',
  'file_type',
  'category',
  'patient_id',
  'tags',
  'document_date',
  'uploaded_by',
  'created_by',
  'is_sensitive',
  'updated_date',
];
const PATIENT_AUTHORITY_FIELDS = [
  'id',
  'agency_id',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'created_by',
  'client_request_id',
  'patient_creation_key',
  'is_sample',
  'is_archived',
  'status',
  'updated_date',
];
const ASSIGNMENT_AUTHORITY_FIELDS = [
  'id',
  'assignment_key',
  'agency_id',
  'patient_id',
  'user_id',
  'user_email_normalized',
  'assignee_membership_id',
  'assignee_membership_version_at_enablement',
  'status',
  'source',
  'created_by_user_id',
  'created_by_user_email_normalized',
  'activated_at',
  'suspended_at',
  'revoked_at',
  'revocation_reason',
  'last_transition_by_user_id',
  'last_transition_by_email_normalized',
  'last_transition_at',
  'last_transition_reason',
  'last_transition_action',
  'last_transition_request_id',
  'last_transition_request_key',
  'version',
];

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

function exactPrivateFileUri(value: unknown) {
  if (
    typeof value !== 'string'
    || !value
    || value.length > MAX_FILE_URI_LENGTH
    || value.trim() !== value
    || /[\u0000-\u0020\u007f]/.test(value)
  ) return null;
  if (!value.startsWith('private/') && !value.startsWith('private://')) return null;
  return value;
}

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function validCalendarDate(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
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

function pickFields(row: Record<string, any>, fields: readonly string[]) {
  return Object.fromEntries(fields.map((field) => [field, row[field]]));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalJson(nested)]),
    );
  }
  return value;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function bytesToHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256Text(value: string) {
  const bytes = new TextEncoder().encode(value);
  return bytesToHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
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
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new PublicError(400, 'Request body must be an object');
  }
  const record = body as Record<string, unknown>;
  if (Object.keys(record).some((key) => !['agency_id', 'document_id', 'purpose'].includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const documentId = exactIdentifier(record.document_id);
  const purpose = typeof record.purpose === 'string' ? record.purpose : '';
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!documentId) throw new PublicError(400, 'document_id is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new PublicError(400, 'purpose is invalid');
  return { agencyId, documentId, purpose };
}

function isProtectedPlatformOwner(user: Record<string, any>) {
  if (user.role !== 'admin') return false;
  const configuredEmail = canonicalEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail && canonicalEmail(user.email) === configuredEmail;
}

function validateMembershipIntegrity(row: Record<string, any>) {
  const id = exactIdentifier(row?.id);
  const agencyId = exactIdentifier(row?.agency_id);
  const userId = exactIdentifier(row?.user_id);
  const membershipKey = exactIdentifier(row?.membership_key);
  const storedEmail = canonicalEmail(row?.user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const status = typeof row?.status === 'string' ? row.status : '';
  if (
    !id
    || !agencyId
    || !userId
    || !membershipKey
    || membershipKey !== `${agencyId}:${userId}`
    || !storedEmail
    || row.user_email_normalized !== storedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || ''))
    || !MEMBERSHIP_STATUSES.has(status)
    || !Number.isSafeInteger(row.version)
    || row.version < 1
    || !exactIdentifier(row.created_by_user_id)
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
  ) {
    throw new PublicError(409, 'Tenant membership integrity check failed');
  }
  return row;
}

function validateMembershipRows(
  rows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) {
    throw new PublicError(409, 'Tenant membership is ambiguous');
  }
  if (rows.some((row) => row?.user_id !== userId)) {
    throw new PublicError(409, 'Tenant membership query scope could not be verified');
  }
  const ids = new Set<string>();
  const keys = new Set<string>();
  const agencies = new Set<string>();
  return rows.map((candidate) => {
    const row = validateMembershipIntegrity(candidate);
    if (row.user_email_normalized !== normalizedEmail) {
      throw new PublicError(409, 'Tenant membership integrity check failed');
    }
    if (ids.has(row.id) || keys.has(row.membership_key) || agencies.has(row.agency_id)) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    ids.add(row.id);
    keys.add(row.membership_key);
    agencies.add(row.agency_id);
    return row;
  });
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
  if (rows.length === 0) throw new PublicError(403, 'Agency is unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Agency is ambiguous');
  if (!ENABLED_AGENCY_STATUSES.has(String(rows[0].status || ''))) {
    throw new PublicError(403, 'Agency is unavailable');
  }
  return rows[0];
}

async function loadAuthority(
  base44: Record<string, any>,
  agencyId: string,
  expectedSnapshot: Record<string, any> | null = null,
) {
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

  const entities = base44.asServiceRole.entities;
  const isPlatformOwner = isProtectedPlatformOwner(user);
  if (!isPlatformOwner) {
    if (user.role !== 'user') throw new PublicError(403, 'Forbidden');
  }
  const rawMemberships = requireRows(
    await entities.AgencyMembership.filter(
      { user_id: userId },
      '-updated_date',
      MEMBERSHIP_SCAN_LIMIT,
      undefined,
      MEMBERSHIP_AUTHORITY_FIELDS,
    ),
    'AgencyMembership.filter',
  );
  let selected: Record<string, any> | null = null;
  if (isPlatformOwner) {
    if (rawMemberships.length >= MEMBERSHIP_SCAN_LIMIT) {
      throw new PublicError(409, 'Tenant membership is ambiguous');
    }
    if (rawMemberships.some((row) => row?.user_id !== userId)) {
      throw new PublicError(409, 'Tenant membership query scope could not be verified');
    }
    if (rawMemberships.length !== 0) {
      throw new PublicError(409, 'Platform owner tenant membership must not exist');
    }
  } else {
    const memberships = validateMembershipRows(rawMemberships, userId, normalizedEmail);
    selected = memberships.find(
      (row) => row.agency_id === agencyId && row.status === 'active',
    ) ?? null;
    if (!selected) throw new PublicError(403, 'No active membership for agency');
  }
  const agency = await loadExactEnabledAgency(entities, agencyId);
  const snapshot = {
    user: { id: userId, email: normalizedEmail, role: user.role },
    membership: selected ? pickFields(selected, MEMBERSHIP_AUTHORITY_FIELDS) : null,
    agency: { id: agency.id, status: agency.status },
    is_platform_owner: isPlatformOwner,
  };
  if (expectedSnapshot && !sameValue(snapshot, expectedSnapshot)) {
    throw new PublicError(409, 'Document read authority changed during request');
  }
  return {
    agencyId,
    userId,
    normalizedEmail,
    tenantRole: selected ? String(selected.tenant_role) : 'platform_owner',
    membership: selected,
    snapshot,
    entities,
  };
}

function requirePurposeRole(authority: Record<string, any>, purpose: string) {
  if (!PURPOSE_ROLES[purpose]?.has(authority.tenantRole)) {
    throw new PublicError(403, 'Tenant role cannot use this Document read purpose');
  }
}

async function validateBindingIntegrity(
  row: Record<string, any>,
  agencyId: string,
  documentId: string,
) {
  const id = exactIdentifier(row?.id);
  const bindingKey = typeof row?.binding_key === 'string' ? row.binding_key : '';
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const documentCreatorEmail = canonicalEmail(row?.document_created_by_email_normalized);
  const membershipId = exactIdentifier(row?.membership_id);
  const clientRequestId = exactIdentifier(row?.client_request_id);
  const patientId = row?.patient_id == null ? null : exactIdentifier(row.patient_id);
  const fileName = safeFileName(row?.file_name);
  const fileUri = exactPrivateFileUri(row?.file_uri);
  const purpose = typeof row?.purpose === 'string' ? row.purpose : '';
  if (
    !id
    || !/^[a-f0-9]{64}$/.test(bindingKey)
    || row.document_id !== documentId
    || row.agency_id !== agencyId
    || (row.patient_id != null && !patientId)
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !membershipId
    || !Number.isSafeInteger(row.membership_version)
    || row.membership_version < 1
    || !documentCreatorEmail
    || row.document_created_by_email_normalized !== documentCreatorEmail
    || documentCreatorEmail !== creatorEmail
    || row.storage_mode !== 'private'
    || !fileUri
    || !fileName
    || !FILE_TYPES.has(String(row.file_type || ''))
    || !fileExtensionMatches(fileName, String(row.file_type || ''))
    || !Number.isSafeInteger(row.file_size)
    || row.file_size < 1
    || row.file_size > MAX_FILE_BYTES
    || !/^[a-f0-9]{64}$/.test(String(row.content_sha256 || ''))
    || !clientRequestId
    || !BINDING_PURPOSES.has(purpose)
    || (purpose === 'patient_document' && !patientId)
    || row.version !== 2
    || !validInstant(row.created_at)
    || !validInstant(row.last_verified_at)
    || Date.parse(row.last_verified_at) < Date.parse(row.created_at)
  ) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  const expectedKey = await sha256Text(`${agencyId}\u0000${creatorId}\u0000${clientRequestId}`);
  if (bindingKey !== expectedKey) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  return { ...row, patient_id: patientId };
}

async function loadExactBinding(
  entities: Record<string, any>,
  agencyId: string,
  documentId: string,
) {
  const rows = requireRows(
    await entities.DocumentTenantBinding.filter(
      { agency_id: agencyId, document_id: documentId },
      '-created_date',
      EXACT_ROW_LIMIT,
      undefined,
      BINDING_AUTHORITY_FIELDS,
    ),
    'DocumentTenantBinding.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Document binding is ambiguous');
  if (rows.some((row) => row?.agency_id !== agencyId || row?.document_id !== documentId)) {
    throw new PublicError(409, 'Document binding query scope could not be verified');
  }
  if (rows.length === 0) throw new PublicError(404, 'Document unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Document binding is ambiguous');
  return validateBindingIntegrity(rows[0], agencyId, documentId);
}

async function loadBindingMembership(
  entities: Record<string, any>,
  binding: Record<string, any>,
) {
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { id: binding.membership_id },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      MEMBERSHIP_AUTHORITY_FIELDS,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Binding membership is ambiguous');
  if (rows.some((row) => row?.id !== binding.membership_id)) {
    throw new PublicError(409, 'Binding membership query scope could not be verified');
  }
  if (rows.length !== 1) throw new PublicError(409, 'Document binding integrity check failed');
  const membership = validateMembershipIntegrity(rows[0]);
  if (
    membership.agency_id !== binding.agency_id
    || membership.user_id !== binding.created_by_user_id
    || membership.user_email_normalized !== binding.created_by_user_email_normalized
    || membership.version < binding.membership_version
  ) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  return membership;
}

function documentReadFields(purpose: string) {
  return [...new Set([...DOCUMENT_AUTHORITY_FIELDS, ...PURPOSE_FIELDS[purpose]])];
}

function validatePurposeProjection(row: Record<string, any>, purpose: string) {
  for (const field of PURPOSE_FIELDS[purpose]) {
    const value = row[field];
    if (value == null) continue;
    if (field === 'id' && !exactIdentifier(value)) throw new PublicError(409, 'Document data is invalid');
    if (field === 'file_name' && !safeFileName(value)) throw new PublicError(409, 'Document data is invalid');
    if (field === 'file_size' && (!Number.isSafeInteger(value) || value < 1 || value > MAX_FILE_BYTES)) {
      throw new PublicError(409, 'Document data is invalid');
    }
    if (field === 'patient_id' && !exactIdentifier(value)) throw new PublicError(409, 'Document data is invalid');
    if ((field === 'document_date' || field === 'expiration_date') && !validCalendarDate(value)) {
      throw new PublicError(409, 'Document data is invalid');
    }
    if ((field === 'updated_date' || field.endsWith('_signed_date')) && !validInstant(value)) {
      throw new PublicError(409, 'Document data is invalid');
    }
    if (field === 'tags' && (
      !Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length > 200)
    )) {
      throw new PublicError(409, 'Document data is invalid');
    }
    if (
      ['is_sensitive', 'clinician_signed', 'patient_signed', 'is_signed', 'is_locked'].includes(field)
      && typeof value !== 'boolean'
    ) {
      throw new PublicError(409, 'Document data is invalid');
    }
    if (
      ['title', 'description', 'file_type', 'category', 'clinician_name', 'patient_name'].includes(field)
      && typeof value !== 'string'
    ) {
      throw new PublicError(409, 'Document data is invalid');
    }
  }
}

function validateDocumentIntegrity(
  row: Record<string, any>,
  binding: Record<string, any>,
  purpose: string,
) {
  const patientId = row?.patient_id == null ? null : row.patient_id;
  const expectedDate = String(binding.created_at).slice(0, 10);
  if (
    row?.id !== binding.document_id
    || row.title !== binding.file_name
    || row.file_url != null
    || row.file_name !== binding.file_name
    || row.file_type !== binding.file_type
    || row.file_size !== binding.file_size
    || row.category !== PURPOSE_CATEGORY[binding.purpose]
    || patientId !== binding.patient_id
    || canonicalEmail(row.uploaded_by) !== binding.document_created_by_email_normalized
    || row.uploaded_by !== binding.document_created_by_email_normalized
    || canonicalEmail(row.created_by) !== binding.document_created_by_email_normalized
    || row.created_by !== binding.document_created_by_email_normalized
    || row.document_date !== expectedDate
    || !sameValue(row.tags, [binding.purpose])
    || row.is_sensitive !== true
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  validatePurposeProjection(row, purpose);
  return row;
}

async function loadExactDocument(
  entities: Record<string, any>,
  binding: Record<string, any>,
  purpose: string,
) {
  const rows = requireRows(
    await entities.Document.filter(
      { id: binding.document_id },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      documentReadFields(purpose),
    ),
    'Document.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Document is ambiguous');
  if (rows.some((row) => row?.id !== binding.document_id)) {
    throw new PublicError(409, 'Document query scope could not be verified');
  }
  if (rows.length !== 1) throw new PublicError(409, 'Document binding integrity check failed');
  return validateDocumentIntegrity(rows[0], binding, purpose);
}

function validatePatientIntegrity(
  row: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const clientRequestId = exactIdentifier(row?.client_request_id);
  if (
    row?.id !== patientId
    || row.agency_id !== agencyId
    || !creatorId
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || row.created_by !== creatorEmail
    || canonicalEmail(row.created_by) !== creatorEmail
    || !clientRequestId
    || row.patient_creation_key !== `${agencyId}:${creatorId}:${clientRequestId}`
    || row.is_sample !== false
    || row.is_archived !== false
    || !PATIENT_STATUSES.has(String(row.status || ''))
    || !validInstant(row.updated_date)
  ) {
    throw new PublicError(409, 'Patient authority integrity check failed');
  }
  return row;
}

async function loadExactPatient(
  entities: Record<string, any>,
  patientId: string,
  agencyId: string,
) {
  const rows = requireRows(
    await entities.Patient.filter(
      { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false },
      undefined,
      EXACT_ROW_LIMIT,
      undefined,
      PATIENT_AUTHORITY_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => (
    row?.id !== patientId
    || row?.agency_id !== agencyId
    || row?.is_sample !== false
    || row?.is_archived !== false
  ))) {
    throw new PublicError(409, 'Patient query scope could not be verified');
  }
  if (rows.length !== 1) throw new PublicError(409, 'Document binding integrity check failed');
  return validatePatientIntegrity(rows[0], patientId, agencyId);
}

function assignmentKey(agencyId: string, patientId: string, userId: string) {
  return `${agencyId}:${patientId}:${userId}`;
}

function validateAssignmentIntegrity(
  row: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const userEmail = canonicalEmail(row?.user_email_normalized);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const transitionEmail = canonicalEmail(row?.last_transition_by_email_normalized);
  const requestId = exactIdentifier(row?.last_transition_request_id);
  const status = typeof row?.status === 'string' ? row.status : '';
  const action = typeof row?.last_transition_action === 'string' ? row.last_transition_action : '';
  if (
    !exactIdentifier(row?.id)
    || row.assignment_key !== key
    || row.agency_id !== authority.agencyId
    || row.patient_id !== patientId
    || row.user_id !== authority.userId
    || !userEmail
    || row.user_email_normalized !== userEmail
    || userEmail !== authority.normalizedEmail
    || !exactIdentifier(row.assignee_membership_id)
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status)
    || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id)
    || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail
    || !validInstant(row.activated_at)
    || (row.suspended_at != null && !validInstant(row.suspended_at))
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (row.revoked_at != null && !validInstant(row.revoked_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
    || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at)
    || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId
    || row.last_transition_request_key !== `${key}:${requestId}`
    || !Number.isSafeInteger(row.version)
    || row.version < 1
  ) {
    throw new PublicError(409, 'Care-team assignment integrity check failed');
  }
  return row;
}

async function loadExactAssignment(
  entities: Record<string, any>,
  patientId: string,
  authority: Record<string, any>,
) {
  const key = assignmentKey(authority.agencyId, patientId, authority.userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: authority.agencyId,
        patient_id: patientId,
        user_id: authority.userId,
      },
      '-updated_date',
      EXACT_ROW_LIMIT,
      undefined,
      ASSIGNMENT_AUTHORITY_FIELDS,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) {
    throw new PublicError(409, 'Care-team assignment is ambiguous');
  }
  if (rows.some((row) => (
    row?.assignment_key !== key
    || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patientId
    || row?.user_id !== authority.userId
  ))) {
    throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  }
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  return rows.length === 1 ? validateAssignmentIntegrity(rows[0], patientId, authority) : null;
}

async function resolveAccess(
  entities: Record<string, any>,
  binding: Record<string, any>,
  patient: Record<string, any> | null,
  authority: Record<string, any>,
) {
  if (AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
    return { basis: 'agency_wide', assignment: null };
  }
  if (!patient) {
    if (
      binding.created_by_user_id === authority.userId
      && binding.created_by_user_email_normalized === authority.normalizedEmail
    ) {
      return { basis: 'document_creator', assignment: null };
    }
    throw new PublicError(404, 'Document unavailable');
  }
  if (
    patient.created_by_user_id === authority.userId
    && patient.created_by_user_email_normalized === authority.normalizedEmail
  ) {
    return { basis: 'patient_creator', assignment: null };
  }
  const assignment = await loadExactAssignment(entities, patient.id, authority);
  if (!assignment || assignment.status !== 'active') {
    throw new PublicError(404, 'Document unavailable');
  }
  if (
    !authority.membership
    || assignment.user_email_normalized !== authority.normalizedEmail
    || assignment.assignee_membership_id !== authority.membership.id
    || assignment.assignee_membership_version_at_enablement !== authority.membership.version
  ) {
    throw new PublicError(409, 'Care-team assignment binding is invalid');
  }
  return {
    basis: 'care_team_assignment',
    assignment: pickFields(assignment, ASSIGNMENT_AUTHORITY_FIELDS),
  };
}

function projectDocument(row: Record<string, any>, purpose: string) {
  return Object.fromEntries(
    PURPOSE_FIELDS[purpose].map((field) => [field, row[field] ?? null]),
  );
}

async function loadDocumentRead(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const binding = await loadExactBinding(entities, input.agencyId, input.documentId);
  const bindingMembership = await loadBindingMembership(entities, binding);
  const document = await loadExactDocument(entities, binding, input.purpose);
  const patient = binding.patient_id
    ? await loadExactPatient(entities, binding.patient_id, authority.agencyId)
    : null;
  const access = await resolveAccess(entities, binding, patient, authority);
  return {
    binding,
    bindingMembership,
    document,
    patient,
    access,
    snapshot: {
      binding: pickFields(binding, BINDING_AUTHORITY_FIELDS),
      binding_membership: pickFields(bindingMembership, MEMBERSHIP_AUTHORITY_FIELDS),
      document: pickFields(document, documentReadFields(input.purpose)),
      patient: patient ? pickFields(patient, PATIENT_AUTHORITY_FIELDS) : null,
      access,
    },
  };
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
    const base44 = createClientFromRequest(req);
    const initialAuthority = await loadAuthority(base44, input.agencyId);
    requirePurposeRole(initialAuthority, input.purpose);
    const initial = await loadDocumentRead(initialAuthority.entities, input, initialAuthority);

    const finalAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(finalAuthority, input.purpose);
    const final = await loadDocumentRead(finalAuthority.entities, input, finalAuthority);
    if (!sameValue(final.snapshot, initial.snapshot)) {
      throw new PublicError(409, 'Document read authority changed during request');
    }
    // Re-read every authority and content preimage immediately before
    // disclosure. Private storage authority is never projected to the caller.
    const disclosureAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(disclosureAuthority, input.purpose);
    const disclosure = await loadDocumentRead(
      disclosureAuthority.entities,
      input,
      disclosureAuthority,
    );
    if (!sameValue(disclosure.snapshot, final.snapshot)) {
      throw new PublicError(409, 'Document read authority changed during request');
    }

    if (input.purpose === 'download') {
      const signedResult = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: disclosure.binding.file_uri,
        expires_in: SIGNED_URL_TTL_SECONDS,
      });
      const downloadUrl = exactHttpsUrl(signedResult?.signed_url);
      if (!downloadUrl) throw new Error('CreateFileSignedUrl returned an invalid URL');

      // Signing is an asynchronous disclosure boundary. Re-prove the complete
      // authority/content snapshot once more and discard the capability if any
      // membership, assignment, binding, Patient, or Document state changed.
      const postSignAuthority = await loadAuthority(
        base44,
        input.agencyId,
        initialAuthority.snapshot,
      );
      requirePurposeRole(postSignAuthority, input.purpose);
      const postSign = await loadDocumentRead(
        postSignAuthority.entities,
        input,
        postSignAuthority,
      );
      if (!sameValue(postSign.snapshot, disclosure.snapshot)) {
        throw new PublicError(409, 'Document read authority changed during request');
      }

      return Response.json({
        success: true,
        purpose: input.purpose,
        document: projectDocument(postSign.document, input.purpose),
        delivery: {
          download_url: downloadUrl,
          expires_in_seconds: SIGNED_URL_TTL_SECONDS,
        },
        scope: {
          agency_id: postSignAuthority.agencyId,
          membership_id: postSignAuthority.membership?.id ?? null,
          membership_version: postSignAuthority.membership?.version ?? null,
          tenant_role: postSignAuthority.tenantRole,
        },
      }, {
        headers: {
          'Cache-Control': 'no-store',
          Pragma: 'no-cache',
        },
      });
    }

    return Response.json({
      success: true,
      purpose: input.purpose,
      document: projectDocument(disclosure.document, input.purpose),
      scope: {
        agency_id: disclosureAuthority.agencyId,
        membership_id: disclosureAuthority.membership?.id ?? null,
        membership_version: disclosureAuthority.membership?.version ?? null,
        tenant_role: disclosureAuthority.tenantRole,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Provider errors may include predicates, URLs, filenames, or PHI.
    console.error('getAuthorizedDocument failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
