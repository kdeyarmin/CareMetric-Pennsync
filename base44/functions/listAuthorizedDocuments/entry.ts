import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Bounded, keyset-paginated Document list broker.
 *
 * Non-agency-wide roles must provide one exact Patient scope whose creator or
 * active care-team authority is re-proved. This prevents a tenant member from
 * learning agency-wide Document volume while a capped binding scan validates
 * every returned DocumentTenantBinding and Document pair. It is unwired.
 */

const MAX_BODY_BYTES = 20_000;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_URI_LENGTH = 4096;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MEMBERSHIP_SCAN_LIMIT = 100;
const EXACT_ROW_LIMIT = 10;
const MAX_PAGE_SIZE = 10;
const MAX_SCAN_CAP = 50;
const SCAN_MULTIPLIER = 5;
const CURSOR_VERSION = 1;
const PAGE_SORT = 'document_id_asc';

const MEMBERSHIP_STATUSES = new Set(['pending', 'active', 'suspended', 'revoked']);
const TENANT_ROLES = new Set([
  'agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care',
]);
const ENABLED_AGENCY_STATUSES = new Set(['active', 'trial']);
const PATIENT_STATUSES = new Set(['active', 'hospitalized', 'discharged']);
const AGENCY_WIDE_ROLES = new Set(['agency_admin', 'manager', 'platform_owner']);
const ASSIGNMENT_STATUSES = new Set(['active', 'suspended', 'revoked']);
const ASSIGNMENT_SOURCES = new Set([
  'manual', 'patient_creator', 'legacy_assigned_nurses', 'legacy_provider_patient_assignment',
]);
const ASSIGNMENT_ACTIONS = new Set(['grant', 'activate', 'suspend', 'revoke']);
const BINDING_PURPOSES = new Set(['patient_document', 'referral']);
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const PURPOSE_CATEGORY: Record<string, string> = {
  patient_document: 'other',
  referral: 'referral',
};

// <<<BEGIN AUTHORIZED DOCUMENT LIST PURPOSE POLICY>>>
const PURPOSE_FIELDS: Record<string, readonly string[]> = {
  library: [
    'id',
    'title',
    'file_name',
    'file_size',
    'file_type',
    'category',
    'patient_id',
    'document_date',
    'is_sensitive',
    'expiration_date',
    'is_signed',
    'is_locked',
    'updated_date',
  ],
  signature_queue: [
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
};

const PURPOSE_ROLES: Record<string, ReadonlySet<string>> = {
  library: new Set([
    'platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care',
  ]),
  signature_queue: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
};
// <<<END AUTHORIZED DOCUMENT LIST PURPOSE POLICY>>>

const MEMBERSHIP_AUTHORITY_FIELDS = [
  'id', 'membership_key', 'agency_id', 'user_id', 'user_email_normalized', 'tenant_role',
  'status', 'created_by_user_id', 'activated_at', 'revoked_at', 'revocation_reason',
  'last_transition_by_user_id', 'last_transition_by_email_normalized', 'last_transition_at',
  'last_transition_reason', 'version',
];
const BINDING_AUTHORITY_FIELDS = [
  'id', 'binding_key', 'document_id', 'agency_id', 'patient_id', 'created_by_user_id',
  'created_by_user_email_normalized', 'membership_id', 'membership_version',
  'document_created_by_email_normalized', 'storage_mode', 'file_uri', 'file_name', 'file_type', 'file_size',
  'content_sha256', 'client_request_id', 'purpose', 'version', 'created_at', 'last_verified_at',
];
const DOCUMENT_AUTHORITY_FIELDS = [
  'id', 'title', 'file_url', 'file_name', 'file_size', 'file_type', 'category', 'patient_id',
  'tags', 'document_date', 'uploaded_by', 'created_by', 'is_sensitive', 'updated_date',
];
const PATIENT_AUTHORITY_FIELDS = [
  'id', 'agency_id', 'created_by_user_id', 'created_by_user_email_normalized', 'created_by',
  'client_request_id', 'patient_creation_key', 'is_sample', 'is_archived', 'status', 'updated_date',
];
const ASSIGNMENT_AUTHORITY_FIELDS = [
  'id', 'assignment_key', 'agency_id', 'patient_id', 'user_id', 'user_email_normalized',
  'assignee_membership_id', 'assignee_membership_version_at_enablement', 'status', 'source',
  'created_by_user_id', 'created_by_user_email_normalized', 'activated_at', 'suspended_at',
  'revoked_at', 'revocation_reason', 'last_transition_by_user_id',
  'last_transition_by_email_normalized', 'last_transition_at', 'last_transition_reason',
  'last_transition_action', 'last_transition_request_id', 'last_transition_request_key', 'version',
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
  return bytesToHex(new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)),
  ));
}

function parseCursor(value: unknown, expected: Record<string, any>) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new PublicError(400, 'cursor is invalid');
  }
  const cursor = value as Record<string, unknown>;
  const keys = [
    'version', 'after_document_id', 'agency_id', 'purpose', 'patient_id', 'binding_purpose',
    'sort', 'page_size', 'subject_user_id', 'membership_id', 'membership_version', 'tenant_role',
  ];
  if (Object.keys(cursor).length !== keys.length || keys.some((key) => !Object.hasOwn(cursor, key))) {
    throw new PublicError(400, 'cursor is invalid');
  }
  const normalized = {
    version: cursor.version,
    after_document_id: exactIdentifier(cursor.after_document_id),
    agency_id: exactIdentifier(cursor.agency_id),
    purpose: typeof cursor.purpose === 'string' ? cursor.purpose : '',
    patient_id: cursor.patient_id === null ? null : exactIdentifier(cursor.patient_id),
    binding_purpose: cursor.binding_purpose === null ? null : String(cursor.binding_purpose),
    sort: cursor.sort,
    page_size: cursor.page_size,
    subject_user_id: exactIdentifier(cursor.subject_user_id),
    membership_id: cursor.membership_id === null ? null : exactIdentifier(cursor.membership_id),
    membership_version: cursor.membership_version,
    tenant_role: typeof cursor.tenant_role === 'string' ? cursor.tenant_role : '',
  };
  if (
    normalized.version !== CURSOR_VERSION
    || !normalized.after_document_id
    || !normalized.agency_id
    || !Object.hasOwn(PURPOSE_FIELDS, normalized.purpose)
    || (cursor.patient_id !== null && !normalized.patient_id)
    || (normalized.binding_purpose !== null && !BINDING_PURPOSES.has(normalized.binding_purpose))
    || normalized.sort !== PAGE_SORT
    || !Number.isSafeInteger(normalized.page_size)
    || Number(normalized.page_size) < 1
    || Number(normalized.page_size) > MAX_PAGE_SIZE
    || !normalized.subject_user_id
    || !PURPOSE_ROLES[normalized.purpose]?.has(normalized.tenant_role)
    || (normalized.tenant_role === 'platform_owner'
      ? normalized.membership_id !== null || normalized.membership_version !== null
      : !normalized.membership_id
        || !Number.isSafeInteger(normalized.membership_version)
        || Number(normalized.membership_version) < 1)
  ) {
    throw new PublicError(400, 'cursor is invalid');
  }
  for (const field of [
    'agency_id', 'purpose', 'patient_id', 'binding_purpose', 'sort', 'page_size',
  ]) {
    if (normalized[field] !== expected[field]) {
      throw new PublicError(400, 'cursor does not match the Document list request');
    }
  }
  return normalized;
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
  const allowed = [
    'agency_id', 'purpose', 'patient_id', 'binding_purpose', 'sort', 'page_size', 'cursor',
  ];
  if (Object.keys(record).some((key) => !allowed.includes(key))) {
    throw new PublicError(400, 'Request contains unsupported fields');
  }
  const agencyId = exactIdentifier(record.agency_id);
  const purpose = typeof record.purpose === 'string' ? record.purpose : '';
  const patientId = record.patient_id == null ? null : exactIdentifier(record.patient_id);
  const bindingPurpose = record.binding_purpose == null ? null : String(record.binding_purpose);
  const sort = record.sort === undefined ? PAGE_SORT : String(record.sort);
  const pageSize = record.page_size === undefined ? MAX_PAGE_SIZE : Number(record.page_size);
  if (!agencyId) throw new PublicError(400, 'agency_id is invalid');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new PublicError(400, 'purpose is invalid');
  if (record.patient_id != null && !patientId) throw new PublicError(400, 'patient_id is invalid');
  if (bindingPurpose !== null && !BINDING_PURPOSES.has(bindingPurpose)) {
    throw new PublicError(400, 'binding_purpose is invalid');
  }
  if (sort !== PAGE_SORT) throw new PublicError(400, 'sort is invalid');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new PublicError(400, 'page_size is invalid');
  }
  const cursor = parseCursor(record.cursor, {
    agency_id: agencyId,
    purpose,
    patient_id: patientId,
    binding_purpose: bindingPurpose,
    sort,
    page_size: pageSize,
  });
  return { agencyId, purpose, patientId, bindingPurpose, sort, pageSize, cursor };
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
    !id || !agencyId || !userId || !membershipKey || membershipKey !== `${agencyId}:${userId}`
    || !storedEmail || row.user_email_normalized !== storedEmail
    || !TENANT_ROLES.has(String(row.tenant_role || '')) || !MEMBERSHIP_STATUSES.has(status)
    || !Number.isSafeInteger(row.version) || row.version < 1
    || !exactIdentifier(row.created_by_user_id) || !exactIdentifier(row.last_transition_by_user_id)
    || !transitionEmail || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at) || !boundedReason(row.last_transition_reason)
    || ((status === 'active' || status === 'suspended') && !validInstant(row.activated_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
  ) throw new PublicError(409, 'Tenant membership integrity check failed');
  return row;
}

function validateMembershipRows(
  rows: Array<Record<string, any>>,
  userId: string,
  normalizedEmail: string,
) {
  if (rows.length >= MEMBERSHIP_SCAN_LIMIT) throw new PublicError(409, 'Tenant membership is ambiguous');
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
    user.is_active === false || user.disabled === true || user.is_service === true
    || user.is_verified === false
  ) throw new PublicError(403, 'Forbidden');
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
      { user_id: userId }, '-updated_date', MEMBERSHIP_SCAN_LIMIT, undefined,
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
    throw new PublicError(409, 'Document list authority changed during request');
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
    throw new PublicError(403, 'Tenant role cannot use this Document list purpose');
  }
}

function cursorContext(input: Record<string, any>, authority: Record<string, any>, afterId: string) {
  return {
    version: CURSOR_VERSION,
    after_document_id: afterId,
    agency_id: authority.agencyId,
    purpose: input.purpose,
    patient_id: input.patientId,
    binding_purpose: input.bindingPurpose,
    sort: PAGE_SORT,
    page_size: input.pageSize,
    subject_user_id: authority.userId,
    membership_id: authority.membership?.id ?? null,
    membership_version: authority.membership?.version ?? null,
    tenant_role: authority.tenantRole,
  };
}

function requireCursorAuthority(
  cursor: Record<string, any> | null,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  if (cursor && !sameValue(cursor, cursorContext(input, authority, cursor.after_document_id))) {
    throw new PublicError(409, 'Document list continuation context changed');
  }
}

function validatePatientIntegrity(row: Record<string, any>, patientId: string, agencyId: string) {
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const clientRequestId = exactIdentifier(row?.client_request_id);
  if (
    row?.id !== patientId || row.agency_id !== agencyId || !creatorId || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail || row.created_by !== creatorEmail
    || canonicalEmail(row.created_by) !== creatorEmail || !clientRequestId
    || row.patient_creation_key !== `${agencyId}:${creatorId}:${clientRequestId}`
    || row.is_sample !== false || row.is_archived !== false
    || !PATIENT_STATUSES.has(String(row.status || '')) || !validInstant(row.updated_date)
  ) throw new PublicError(409, 'Patient authority integrity check failed');
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
      undefined, EXACT_ROW_LIMIT, undefined, PATIENT_AUTHORITY_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Patient is ambiguous');
  if (rows.some((row) => (
    row?.id !== patientId || row?.agency_id !== agencyId
    || row?.is_sample !== false || row?.is_archived !== false
  ))) throw new PublicError(409, 'Patient query scope could not be verified');
  if (rows.length === 0) throw new PublicError(404, 'Patient unavailable');
  if (rows.length !== 1) throw new PublicError(409, 'Patient is ambiguous');
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
    !exactIdentifier(row?.id) || row.assignment_key !== key
    || row.agency_id !== authority.agencyId || row.patient_id !== patientId
    || row.user_id !== authority.userId || !userEmail || row.user_email_normalized !== userEmail
    || userEmail !== authority.normalizedEmail
    || !exactIdentifier(row.assignee_membership_id)
    || !Number.isSafeInteger(row.assignee_membership_version_at_enablement)
    || row.assignee_membership_version_at_enablement < 1
    || !ASSIGNMENT_STATUSES.has(status) || !ASSIGNMENT_SOURCES.has(String(row.source || ''))
    || !exactIdentifier(row.created_by_user_id) || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail || !validInstant(row.activated_at)
    || (row.suspended_at != null && !validInstant(row.suspended_at))
    || (status === 'suspended' && !validInstant(row.suspended_at))
    || (row.revoked_at != null && !validInstant(row.revoked_at))
    || (status === 'revoked' && (
      !validInstant(row.revoked_at) || !boundedReason(row.revocation_reason)
    ))
    || (status !== 'revoked' && (row.revoked_at != null || row.revocation_reason != null))
    || !exactIdentifier(row.last_transition_by_user_id) || !transitionEmail
    || row.last_transition_by_email_normalized !== transitionEmail
    || !validInstant(row.last_transition_at) || !boundedReason(row.last_transition_reason)
    || !ASSIGNMENT_ACTIONS.has(action)
    || (status === 'active' && action !== 'grant' && action !== 'activate')
    || (status === 'suspended' && action !== 'suspend')
    || (status === 'revoked' && action !== 'revoke')
    || !requestId || row.last_transition_request_key !== `${key}:${requestId}`
    || !Number.isSafeInteger(row.version) || row.version < 1
  ) throw new PublicError(409, 'Care-team assignment integrity check failed');
  return row;
}

async function loadPatientScope(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  if (!input.patientId) {
    if (!AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
      throw new PublicError(403, 'patient_id is required for this tenant role');
    }
    return { patient: null, access: { basis: 'agency_wide', assignment: null } };
  }
  const patient = await loadExactPatient(entities, input.patientId, authority.agencyId);
  if (AGENCY_WIDE_ROLES.has(authority.tenantRole)) {
    return { patient, access: { basis: 'agency_wide', assignment: null } };
  }
  if (
    patient.created_by_user_id === authority.userId
    && patient.created_by_user_email_normalized === authority.normalizedEmail
  ) {
    return { patient, access: { basis: 'patient_creator', assignment: null } };
  }
  const key = assignmentKey(authority.agencyId, patient.id, authority.userId);
  const rows = requireRows(
    await entities.PatientCareTeamAssignment.filter(
      {
        assignment_key: key,
        agency_id: authority.agencyId,
        patient_id: patient.id,
        user_id: authority.userId,
      },
      '-updated_date', EXACT_ROW_LIMIT, undefined, ASSIGNMENT_AUTHORITY_FIELDS,
    ),
    'PatientCareTeamAssignment.filter',
  );
  if (rows.length >= EXACT_ROW_LIMIT) throw new PublicError(409, 'Care-team assignment is ambiguous');
  if (rows.some((row) => (
    row?.assignment_key !== key || row?.agency_id !== authority.agencyId
    || row?.patient_id !== patient.id || row?.user_id !== authority.userId
  ))) throw new PublicError(409, 'Care-team assignment query scope could not be verified');
  if (rows.length > 1) throw new PublicError(409, 'Care-team assignment is ambiguous');
  const assignment = rows.length === 1
    ? validateAssignmentIntegrity(rows[0], patient.id, authority)
    : null;
  if (!assignment || assignment.status !== 'active') throw new PublicError(404, 'Patient unavailable');
  if (
    !authority.membership || assignment.user_email_normalized !== authority.normalizedEmail
    || assignment.assignee_membership_id !== authority.membership.id
    || assignment.assignee_membership_version_at_enablement !== authority.membership.version
  ) throw new PublicError(409, 'Care-team assignment binding is invalid');
  return {
    patient,
    access: {
      basis: 'care_team_assignment',
      assignment: pickFields(assignment, ASSIGNMENT_AUTHORITY_FIELDS),
    },
  };
}

async function validateBindingIntegrity(
  row: Record<string, any>,
  agencyId: string,
) {
  const id = exactIdentifier(row?.id);
  const documentId = exactIdentifier(row?.document_id);
  const bindingKey = typeof row?.binding_key === 'string' ? row.binding_key : '';
  const creatorId = exactIdentifier(row?.created_by_user_id);
  const creatorEmail = canonicalEmail(row?.created_by_user_email_normalized);
  const documentCreatorEmail = canonicalEmail(row?.document_created_by_email_normalized);
  const membershipId = exactIdentifier(row?.membership_id);
  const clientRequestId = exactIdentifier(row?.client_request_id);
  const patientId = row?.patient_id == null ? null : exactIdentifier(row.patient_id);
  const purpose = typeof row?.purpose === 'string' ? row.purpose : '';
  if (
    !id || !documentId || !/^[a-f0-9]{64}$/.test(bindingKey) || row.agency_id !== agencyId
    || (row.patient_id != null && !patientId) || !creatorId || !creatorEmail
    || row.created_by_user_email_normalized !== creatorEmail || !membershipId
    || !Number.isSafeInteger(row.membership_version) || row.membership_version < 1
    || !documentCreatorEmail || row.document_created_by_email_normalized !== documentCreatorEmail
    || documentCreatorEmail !== creatorEmail || row.storage_mode !== 'private'
    || !exactPrivateFileUri(row.file_uri)
    || !safeFileName(row.file_name) || !FILE_TYPES.has(String(row.file_type || ''))
    || !fileExtensionMatches(String(row.file_name || ''), String(row.file_type || ''))
    || !Number.isSafeInteger(row.file_size) || row.file_size < 1 || row.file_size > MAX_FILE_BYTES
    || !/^[a-f0-9]{64}$/.test(String(row.content_sha256 || '')) || !clientRequestId
    || !BINDING_PURPOSES.has(purpose) || (purpose === 'patient_document' && !patientId)
    || row.version !== 2 || !validInstant(row.created_at) || !validInstant(row.last_verified_at)
    || Date.parse(row.last_verified_at) < Date.parse(row.created_at)
  ) throw new PublicError(409, 'Document binding integrity check failed');
  const expectedKey = await sha256Text(`${agencyId}\u0000${creatorId}\u0000${clientRequestId}`);
  if (bindingKey !== expectedKey) throw new PublicError(409, 'Document binding integrity check failed');
  return { ...row, patient_id: patientId };
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
    if (
      ['is_sensitive', 'clinician_signed', 'patient_signed', 'is_signed', 'is_locked'].includes(field)
      && typeof value !== 'boolean'
    ) throw new PublicError(409, 'Document data is invalid');
    if (
      ['title', 'file_type', 'category', 'clinician_name', 'patient_name'].includes(field)
      && typeof value !== 'string'
    ) throw new PublicError(409, 'Document data is invalid');
  }
}

function validateDocumentIntegrity(
  row: Record<string, any>,
  binding: Record<string, any>,
  purpose: string,
) {
  const patientId = row?.patient_id == null ? null : row.patient_id;
  if (
    row?.id !== binding.document_id || row.title !== binding.file_name
    || row.file_url != null || row.file_name !== binding.file_name
    || row.file_type !== binding.file_type || row.file_size !== binding.file_size
    || row.category !== PURPOSE_CATEGORY[binding.purpose] || patientId !== binding.patient_id
    || row.uploaded_by !== binding.document_created_by_email_normalized
    || canonicalEmail(row.uploaded_by) !== binding.document_created_by_email_normalized
    || row.created_by !== binding.document_created_by_email_normalized
    || canonicalEmail(row.created_by) !== binding.document_created_by_email_normalized
    || row.document_date !== String(binding.created_at).slice(0, 10)
    || !sameValue(row.tags, [binding.purpose]) || row.is_sensitive !== true
    || !validInstant(row.updated_date)
  ) throw new PublicError(409, 'Document binding integrity check failed');
  validatePurposeProjection(row, purpose);
  return row;
}

function scanLimit(input: Record<string, any>) {
  return Math.min(MAX_SCAN_CAP, input.pageSize * SCAN_MULTIPLIER);
}

async function loadBindingWindow(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const query: Record<string, any> = { agency_id: authority.agencyId };
  if (input.patientId) query.patient_id = input.patientId;
  if (input.bindingPurpose) query.purpose = input.bindingPurpose;
  if (input.cursor) query.document_id = { $gt: input.cursor.after_document_id };
  const limit = scanLimit(input);
  const raw = requireRows(
    await entities.DocumentTenantBinding.filter(
      query, 'document_id', limit + 1, undefined, BINDING_AUTHORITY_FIELDS,
    ),
    'DocumentTenantBinding.filter',
  );
  if (raw.length > limit + 1) throw new PublicError(409, 'Document binding scan cap was exceeded');
  if (raw.some((row) => (
    row?.agency_id !== authority.agencyId
    || (input.patientId && row?.patient_id !== input.patientId)
    || (input.bindingPurpose && row?.purpose !== input.bindingPurpose)
  ))) throw new PublicError(409, 'Document binding result scope check failed');
  const bindingIds = new Set<string>();
  const ids = new Set<string>();
  const keys = new Set<string>();
  let previous = input.cursor?.after_document_id ?? null;
  const bindings: Array<Record<string, any>> = [];
  for (const candidate of raw) {
    const binding = await validateBindingIntegrity(candidate, authority.agencyId);
    if (
      bindingIds.has(binding.id) || ids.has(binding.document_id) || keys.has(binding.binding_key)
      || (previous !== null && binding.document_id <= previous)
    ) throw new PublicError(409, 'Document binding page is ambiguous');
    bindingIds.add(binding.id);
    ids.add(binding.document_id);
    keys.add(binding.binding_key);
    previous = binding.document_id;
    bindings.push(binding);
  }
  return { bindings, limit };
}

async function loadBindingMemberships(
  entities: Record<string, any>,
  bindings: Array<Record<string, any>>,
) {
  if (bindings.length === 0) return new Map<string, Record<string, any>>();
  const wanted = [...new Set(bindings.map((row) => row.membership_id))];
  const rows = requireRows(
    await entities.AgencyMembership.filter(
      { id: { $in: wanted } }, undefined, wanted.length + 1, undefined,
      MEMBERSHIP_AUTHORITY_FIELDS,
    ),
    'AgencyMembership.filter',
  );
  if (rows.length > wanted.length) throw new PublicError(409, 'Binding membership batch is ambiguous');
  if (rows.some((row) => !wanted.includes(row?.id))) {
    throw new PublicError(409, 'Binding membership query scope could not be verified');
  }
  const byId = new Map<string, Record<string, any>>();
  for (const candidate of rows) {
    const membership = validateMembershipIntegrity(candidate);
    if (byId.has(membership.id)) throw new PublicError(409, 'Binding membership batch is ambiguous');
    byId.set(membership.id, membership);
  }
  for (const binding of bindings) {
    const membership = byId.get(binding.membership_id);
    if (
      !membership || membership.agency_id !== binding.agency_id
      || membership.user_id !== binding.created_by_user_id
      || membership.user_email_normalized !== binding.created_by_user_email_normalized
      || membership.version < binding.membership_version
    ) throw new PublicError(409, 'Document binding integrity check failed');
  }
  return byId;
}

async function loadDocuments(
  entities: Record<string, any>,
  bindings: Array<Record<string, any>>,
  purpose: string,
) {
  if (bindings.length === 0) return new Map<string, Record<string, any>>();
  const ids = bindings.map((row) => row.document_id);
  const rows = requireRows(
    await entities.Document.filter(
      { id: { $in: ids } }, undefined, ids.length + 1, undefined, documentReadFields(purpose),
    ),
    'Document.filter',
  );
  if (rows.length > ids.length) throw new PublicError(409, 'Document batch is ambiguous');
  if (rows.some((row) => !ids.includes(row?.id))) {
    throw new PublicError(409, 'Document query scope could not be verified');
  }
  const byId = new Map<string, Record<string, any>>();
  for (const row of rows) {
    if (byId.has(row.id)) throw new PublicError(409, 'Document batch is ambiguous');
    byId.set(row.id, row);
  }
  for (const binding of bindings) {
    const document = byId.get(binding.document_id);
    if (!document) throw new PublicError(409, 'Document binding integrity check failed');
    validateDocumentIntegrity(document, binding, purpose);
  }
  return byId;
}

async function loadBoundPatients(
  entities: Record<string, any>,
  bindings: Array<Record<string, any>>,
  agencyId: string,
) {
  const ids = [...new Set(bindings.flatMap((row) => row.patient_id ? [row.patient_id] : []))];
  if (ids.length === 0) return new Map<string, Record<string, any>>();
  const rows = requireRows(
    await entities.Patient.filter(
      { id: { $in: ids }, agency_id: agencyId, is_sample: false, is_archived: false },
      undefined, ids.length + 1, undefined, PATIENT_AUTHORITY_FIELDS,
    ),
    'Patient.filter',
  );
  if (rows.length > ids.length) throw new PublicError(409, 'Patient batch is ambiguous');
  if (rows.some((row) => (
    !ids.includes(row?.id) || row?.agency_id !== agencyId
    || row?.is_sample !== false || row?.is_archived !== false
  ))) throw new PublicError(409, 'Patient query scope could not be verified');
  const byId = new Map<string, Record<string, any>>();
  for (const candidate of rows) {
    const patient = validatePatientIntegrity(candidate, candidate.id, agencyId);
    if (byId.has(patient.id)) throw new PublicError(409, 'Patient batch is ambiguous');
    byId.set(patient.id, patient);
  }
  if (ids.some((id) => !byId.has(id))) {
    throw new PublicError(409, 'Document binding integrity check failed');
  }
  return byId;
}

function projectDocument(row: Record<string, any>, purpose: string) {
  return Object.fromEntries(PURPOSE_FIELDS[purpose].map((field) => [field, row[field] ?? null]));
}

async function loadListState(
  entities: Record<string, any>,
  input: Record<string, any>,
  authority: Record<string, any>,
) {
  const patientScope = await loadPatientScope(entities, input, authority);
  const window = await loadBindingWindow(entities, input, authority);
  const bindingMemberships = await loadBindingMemberships(entities, window.bindings);
  const documents = await loadDocuments(entities, window.bindings, input.purpose);
  const patients = await loadBoundPatients(entities, window.bindings, authority.agencyId);
  const entries = window.bindings.map((binding) => ({
    binding,
    binding_membership: bindingMemberships.get(binding.membership_id),
    document: documents.get(binding.document_id),
    patient: binding.patient_id ? patients.get(binding.patient_id) : null,
  }));
  return {
    entries,
    limit: window.limit,
    patientScope,
    snapshot: {
      patient_scope: {
        patient: patientScope.patient
          ? pickFields(patientScope.patient, PATIENT_AUTHORITY_FIELDS)
          : null,
        access: patientScope.access,
      },
      entries: entries.map((entry) => ({
        binding: pickFields(entry.binding, BINDING_AUTHORITY_FIELDS),
        binding_membership: pickFields(entry.binding_membership, MEMBERSHIP_AUTHORITY_FIELDS),
        document: pickFields(entry.document, documentReadFields(input.purpose)),
        patient: entry.patient ? pickFields(entry.patient, PATIENT_AUTHORITY_FIELDS) : null,
      })),
    },
  };
}

function paginate(state: Record<string, any>, input: Record<string, any>) {
  const visible: Array<Record<string, any>> = [];
  const consumed: Array<Record<string, any>> = [];
  const candidates = state.entries.slice(0, state.limit);
  for (const entry of candidates) {
    consumed.push(entry);
    visible.push(entry);
    if (visible.length === input.pageSize) break;
  }
  const hasMore = consumed.length < state.entries.length;
  const afterId = consumed.at(-1)?.binding?.document_id ?? null;
  if (hasMore && !exactIdentifier(afterId)) {
    throw new PublicError(409, 'Document binding page is ambiguous');
  }
  return { visible, consumed, hasMore, afterId };
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
    requireCursorAuthority(input.cursor, input, initialAuthority);
    const initial = await loadListState(initialAuthority.entities, input, initialAuthority);

    const finalAuthority = await loadAuthority(base44, input.agencyId, initialAuthority.snapshot);
    requirePurposeRole(finalAuthority, input.purpose);
    requireCursorAuthority(input.cursor, input, finalAuthority);
    const final = await loadListState(finalAuthority.entities, input, finalAuthority);
    if (!sameValue(final.snapshot, initial.snapshot)) {
      throw new PublicError(409, 'Document list authority changed during request');
    }
    // Re-read the caller, Patient access, bindings, historical memberships,
    // Documents, and bound Patients after the final scan and before disclosure.
    const disclosureAuthority = await loadAuthority(
      base44,
      input.agencyId,
      initialAuthority.snapshot,
    );
    requirePurposeRole(disclosureAuthority, input.purpose);
    requireCursorAuthority(input.cursor, input, disclosureAuthority);
    const disclosure = await loadListState(
      disclosureAuthority.entities,
      input,
      disclosureAuthority,
    );
    if (!sameValue(disclosure.snapshot, final.snapshot)) {
      throw new PublicError(409, 'Document list authority changed during request');
    }
    const page = paginate(disclosure, input);
    return Response.json({
      success: true,
      purpose: input.purpose,
      documents: page.visible.map((entry) => projectDocument(entry.document, input.purpose)),
      scope: {
        agency_id: disclosureAuthority.agencyId,
        patient_id: input.patientId,
        membership_id: disclosureAuthority.membership?.id ?? null,
        membership_version: disclosureAuthority.membership?.version ?? null,
        tenant_role: disclosureAuthority.tenantRole,
      },
      page: {
        page_size: input.pageSize,
        sort: PAGE_SORT,
        after_document_id: input.cursor?.after_document_id ?? null,
        scanned_count: page.consumed.length,
        returned_count: page.visible.length,
        has_more: page.hasMore,
        next_cursor: page.hasMore
          ? cursorContext(input, disclosureAuthority, page.afterId)
          : null,
      },
    });
  } catch (error) {
    if (error instanceof PublicError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    // Never log provider details that may embed predicates, filenames, URLs, or PHI.
    console.error('listAuthorizedDocuments failed');
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
