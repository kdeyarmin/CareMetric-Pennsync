import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const CATEGORIES = new Set(['other', 'referral']);

const PURPOSE_FIELDS = Object.freeze({
  metadata: [
    'id', 'title', 'description', 'file_name', 'file_size', 'file_type', 'category',
    'patient_id', 'tags', 'document_date', 'is_sensitive', 'expiration_date',
    'is_signed', 'is_locked', 'updated_date',
  ],
  signature_review: [
    'id', 'title', 'category', 'patient_id', 'document_date', 'expiration_date',
    'clinician_signed', 'clinician_signed_date', 'clinician_name', 'patient_signed',
    'patient_signed_date', 'patient_name', 'is_signed', 'is_locked', 'updated_date',
  ],
});

const PURPOSE_ROLES = Object.freeze({
  metadata: new Set([
    'platform_owner', 'agency_admin', 'manager', 'clinician', 'social_worker', 'spiritual_care',
  ]),
  signature_review: new Set(['platform_owner', 'agency_admin', 'manager', 'clinician']),
});

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

function validScope(scope, agencyId, purpose) {
  if (
    !exactKeys(scope, ['agency_id', 'membership_id', 'membership_version', 'tenant_role'])
    || scope.agency_id !== agencyId
    || !PURPOSE_ROLES[purpose]?.has(scope.tenant_role)
  ) return false;
  if (scope.tenant_role === 'platform_owner') {
    return scope.membership_id === null && scope.membership_version === null;
  }
  return exactIdentifier(scope.membership_id)
    && Number.isSafeInteger(scope.membership_version)
    && scope.membership_version >= 1;
}

function validNullableString(value) {
  return value === null || typeof value === 'string';
}

function validField(field, value, documentId) {
  if (field === 'id') return value === documentId && exactIdentifier(value);
  if (field === 'title') return typeof value === 'string' && value.length > 0;
  if (field === 'description' || field === 'clinician_name' || field === 'patient_name') {
    return validNullableString(value);
  }
  if (field === 'file_name') return safeFileName(value);
  if (field === 'file_size') {
    return Number.isSafeInteger(value) && value >= 1 && value <= MAX_FILE_BYTES;
  }
  if (field === 'file_type') return FILE_TYPES.has(value);
  if (field === 'category') return CATEGORIES.has(value);
  if (field === 'patient_id') return value === null || exactIdentifier(value);
  if (field === 'tags') {
    return Array.isArray(value)
      && value.length === 1
      && (value[0] === 'patient_document' || value[0] === 'referral');
  }
  if (field === 'document_date') return validCalendarDate(value);
  if (field === 'expiration_date') return value === null || validCalendarDate(value);
  if (field === 'updated_date') return validInstant(value);
  if (field.endsWith('_signed_date')) return value === null || validInstant(value);
  if (field === 'is_sensitive') return value === true;
  if (['clinician_signed', 'patient_signed', 'is_signed', 'is_locked'].includes(field)) {
    return value === null || typeof value === 'boolean';
  }
  return false;
}

function validProjection(document, documentId, purpose) {
  const fields = PURPOSE_FIELDS[purpose];
  return exactKeys(document, fields)
    && fields.every((field) => validField(field, document[field], documentId));
}

export async function getAuthorizedDocument(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Document lookup options must be an object');
  }
  if (Object.keys(options).some((key) => !['agencyId', 'documentId', 'purpose'].includes(key))) {
    throw new Error('Document lookup contains unsupported options');
  }
  const { agencyId, documentId, purpose } = options;
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (!exactIdentifier(documentId)) throw new Error('documentId is required');
  if (!Object.hasOwn(PURPOSE_FIELDS, purpose)) throw new Error('purpose is required');

  const response = await base44.functions.invoke('getAuthorizedDocument', {
    agency_id: agencyId,
    document_id: documentId,
    purpose,
  });
  const result = response?.data ?? response;
  if (
    !exactKeys(result, ['success', 'purpose', 'document', 'scope'])
    || result.success !== true
    || result.purpose !== purpose
    || !validProjection(result.document, documentId, purpose)
    || !validScope(result.scope, agencyId, purpose)
  ) {
    throw new Error(result?.error || 'Document lookup failed');
  }
  return result;
}
