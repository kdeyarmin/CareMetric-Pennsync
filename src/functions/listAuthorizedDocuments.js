import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PAGE_SIZE = 10;
const MAX_SCAN_CAP = 50;
const CURSOR_VERSION = 1;
const PAGE_SORT = 'document_id_asc';
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const CATEGORIES = new Set(['other', 'referral']);
const BINDING_PURPOSES = new Set(['patient_document', 'referral']);

const PURPOSE_FIELDS = Object.freeze({
  library: [
    'id', 'title', 'file_name', 'file_size', 'file_type', 'category', 'patient_id',
    'document_date', 'is_sensitive', 'expiration_date', 'is_signed', 'is_locked', 'updated_date',
  ],
  signature_queue: [
    'id', 'title', 'category', 'patient_id', 'document_date', 'expiration_date',
    'clinician_signed', 'clinician_signed_date', 'clinician_name', 'patient_signed',
    'patient_signed_date', 'patient_name', 'is_signed', 'is_locked', 'updated_date',
  ],
});

const PURPOSE_ROLES = Object.freeze({
  library: new Set([
    'platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care',
  ]),
  signature_queue: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
});

const CURSOR_KEYS = [
  'version', 'after_document_id', 'agency_id', 'purpose', 'patient_id', 'binding_purpose',
  'sort', 'page_size', 'subject_user_id', 'membership_id', 'membership_version', 'tenant_role',
];

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function validCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function validInstant(value) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function safeFileName(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_FILE_NAME_LENGTH
    && value.trim() === value
    && value !== '.'
    && value !== '..'
    && !value.includes('..')
    && /^[A-Za-z0-9][A-Za-z0-9._ ()-]*$/.test(value);
}

function validScope(scope, context) {
  if (
    !exactKeys(
      scope,
      ['agency_id', 'patient_id', 'membership_id', 'membership_version', 'tenant_role'],
    )
    || scope.agency_id !== context.agency_id
    || scope.patient_id !== context.patient_id
    || !PURPOSE_ROLES[context.purpose]?.has(scope.tenant_role)
  ) return false;
  if (
    context.patient_id === null
    && !['platform_owner', 'agency_admin', 'manager'].includes(scope.tenant_role)
  ) return false;
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null && scope.membership_version === null;
  }
  return exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1;
}

function validCursor(cursor, context, scope = null) {
  if (!exactKeys(cursor, CURSOR_KEYS)) return false;
  if (
    cursor.version !== CURSOR_VERSION
    || !exactIdentifier(cursor.after_document_id)
    || cursor.agency_id !== context.agency_id
    || cursor.purpose !== context.purpose
    || cursor.patient_id !== context.patient_id
    || cursor.binding_purpose !== context.binding_purpose
    || cursor.sort !== PAGE_SORT
    || cursor.page_size !== context.page_size
    || !exactIdentifier(cursor.subject_user_id)
    || (context.cursor != null
      && cursor.subject_user_id !== context.cursor.subject_user_id)
    || !PURPOSE_ROLES[context.purpose]?.has(cursor.tenant_role)
  ) return false;
  const membershipValid = cursor.tenant_role === 'platform_owner'
    ? cursor.membership_id === null && cursor.membership_version === null
    : exactIdentifier(cursor.membership_id)
      && Number.isSafeInteger(cursor.membership_version)
      && cursor.membership_version >= 1;
  return membershipValid && (scope === null || (
    cursor.membership_id === scope.membership_id
    && cursor.membership_version === scope.membership_version
    && cursor.tenant_role === scope.tenant_role
  ));
}

function validField(field, value) {
  if (field === 'id') return exactIdentifier(value);
  if (field === 'title') return typeof value === 'string' && value.length > 0;
  if (field === 'file_name') return safeFileName(value);
  if (field === 'file_size') {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FILE_BYTES;
  }
  if (field === 'file_type') return FILE_TYPES.has(value);
  if (field === 'category') return CATEGORIES.has(value);
  if (field === 'patient_id') return value === null || exactIdentifier(value);
  if (field === 'document_date') return validCalendarDate(value);
  if (field === 'expiration_date') return value === null || validCalendarDate(value);
  if (field === 'updated_date') return validInstant(value);
  if (field.endsWith('_signed_date')) return value === null || validInstant(value);
  if (field === 'clinician_name' || field === 'patient_name') {
    return value === null || typeof value === 'string';
  }
  if (field === 'is_sensitive') return value === true;
  if (['clinician_signed', 'patient_signed', 'is_signed', 'is_locked'].includes(field)) {
    return value === null || typeof value === 'boolean';
  }
  return false;
}

function validDocuments(documents, purpose, patientId, maximumCount, afterDocumentId) {
  if (!Array.isArray(documents) || documents.length > maximumCount) return false;
  const fields = PURPOSE_FIELDS[purpose];
  const ids = new Set();
  let previous = afterDocumentId;
  return documents.every((document) => {
    if (!exactKeys(document, fields)) return false;
    if (document.patient_id !== patientId && patientId !== null) return false;
    if (ids.has(document.id) || (previous !== null && document.id <= previous)) return false;
    if (!fields.every((field) => validField(field, document[field]))) return false;
    ids.add(document.id);
    previous = document.id;
    return true;
  });
}

function validPage(page, payload, documents, scope) {
  if (!exactKeys(page, [
    'page_size', 'sort', 'after_document_id', 'scanned_count', 'returned_count',
    'has_more', 'next_cursor',
  ])) return false;
  if (
    page.page_size !== payload.page_size
    || page.sort !== PAGE_SORT
    || page.after_document_id !== (payload.cursor?.after_document_id ?? null)
    || !Number.isSafeInteger(page.scanned_count)
    || page.scanned_count < 0
    || page.scanned_count > MAX_SCAN_CAP
    || page.returned_count !== documents.length
    || page.scanned_count !== page.returned_count
    || typeof page.has_more !== 'boolean'
  ) return false;
  if (!page.has_more) return page.next_cursor === null;
  if (
    documents.length !== payload.page_size
    || page.next_cursor?.after_document_id !== documents[documents.length - 1].id
  ) return false;
  return validCursor(page.next_cursor, payload, scope);
}

export async function listAuthorizedDocuments(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Document list options must be an object');
  }
  const allowed = [
    'agencyId', 'purpose', 'patientId', 'bindingPurpose', 'sort', 'pageSize', 'cursor',
  ];
  if (Object.keys(options).some((key) => !allowed.includes(key))) {
    throw new Error('Document list contains unsupported options');
  }
  const {
    agencyId,
    purpose,
    patientId = null,
    bindingPurpose = null,
    sort = PAGE_SORT,
    pageSize = MAX_PAGE_SIZE,
    cursor = null,
  } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');
  if (patientId !== null && !exactIdentifier(patientId)) throw new Error('patientId is invalid');
  if (bindingPurpose !== null && !BINDING_PURPOSES.has(bindingPurpose)) {
    throw new Error('bindingPurpose is invalid');
  }
  if (sort !== PAGE_SORT) throw new Error('sort is invalid');
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    throw new Error('pageSize is invalid');
  }
  const payload = {
    agency_id: agencyId,
    purpose,
    patient_id: patientId,
    binding_purpose: bindingPurpose,
    sort,
    page_size: pageSize,
    cursor,
  };
  if (cursor !== null && !validCursor(cursor, payload)) throw new Error('cursor is invalid');

  const response = await base44.functions.invoke('listAuthorizedDocuments', payload);
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'purpose', 'documents', 'scope', 'page'])
    || result.success !== true
    || result.purpose !== purpose
    || !validScope(result.scope, payload)
    || (cursor !== null && !validCursor(cursor, payload, result.scope))
    || !validDocuments(
      result.documents,
      purpose,
      patientId,
      pageSize,
      cursor?.after_document_id ?? null,
    )
    || !validPage(result.page, payload, result.documents, result.scope)
  ) throw new Error(result?.error || 'Document list failed');
  return result;
}
