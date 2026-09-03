import { base44 } from '@/api/base44Client';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_FILE_NAME_LENGTH = 200;
const MAX_FILE_BYTES = 25 * 1024 * 1024;
const PURPOSES = new Set(['patient_document', 'referral']);
const FILE_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);
const OPTION_NAMES = new Set([
  'file',
  'agencyId',
  'patientId',
  'purpose',
  'clientRequestId',
  'functions',
]);

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
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

function extensionMatches(name, type) {
  const lower = name.toLowerCase();
  if (type === 'application/pdf') return lower.endsWith('.pdf');
  if (type === 'image/png') return lower.endsWith('.png');
  if (type === 'image/jpeg') return lower.endsWith('.jpg') || lower.endsWith('.jpeg');
  return false;
}

function validHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 4096 || value.trim() !== value) {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && !url.username
      && !url.password
      && !url.hash
      && url.href === value;
  } catch {
    return false;
  }
}

function hasExactKeys(value, expected) {
  return !!value
    && typeof value === 'object'
    && !Array.isArray(value)
    && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort());
}

export function createDocumentRequestId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `document-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function validateResult(result, input) {
  const document = result?.document;
  const binding = result?.binding;
  const scope = result?.scope;
  if (
    !hasExactKeys(result, ['success', 'created', 'document', 'binding', 'scope'])
    || !hasExactKeys(document, [
      'id', 'file_url', 'file_name', 'file_type', 'file_size', 'category', 'patient_id',
    ])
    || !hasExactKeys(binding, ['id', 'version', 'client_request_id'])
    || !hasExactKeys(scope, [
      'agency_id', 'patient_id', 'membership_id', 'membership_version', 'tenant_role',
    ])
    || result?.success !== true
    || typeof result.created !== 'boolean'
    || !document
    || !exactIdentifier(document.id)
    || !validHttpsUrl(document.file_url)
    || document.file_name !== input.file.name
    || document.file_type !== input.file.type.toLowerCase()
    || document.file_size !== input.file.size
    || document.category !== (input.purpose === 'referral' ? 'referral' : 'other')
    || document.patient_id !== (input.patientId || null)
    || !binding
    || !exactIdentifier(binding.id)
    || binding.version !== 1
    || binding.client_request_id !== input.clientRequestId
    || !scope
    || scope.agency_id !== input.agencyId
    || scope.patient_id !== (input.patientId || null)
    || !exactIdentifier(scope.membership_id)
    || !Number.isSafeInteger(scope.membership_version)
    || scope.membership_version < 1
    || !['agency_admin', 'manager', 'clinician'].includes(scope.tenant_role)
  ) {
    throw new Error(result?.error || 'Document upload failed');
  }
  return result;
}

/**
 * Upload a File through the tenant-authorizing backend broker.
 *
 * This wrapper is deliberately unwired. Passing a File in the invoke payload
 * makes the Base44 SDK send multipart/form-data automatically; callers never
 * supply a URL, uploader identity, Document category, or tenant stamp.
 */
export async function createAuthorizedDocument(options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) {
    throw new Error('Document upload options must be an object');
  }
  const unsupported = Object.keys(options).filter((key) => !OPTION_NAMES.has(key));
  if (unsupported.length) {
    throw new Error(`Document upload contains unsupported options: ${unsupported.join(', ')}`);
  }
  const {
    file,
    agencyId,
    patientId = null,
    purpose,
    clientRequestId = createDocumentRequestId(),
    functions = null,
  } = options;
  if (typeof File === 'undefined' || !(file instanceof File)) {
    throw new Error('file must be a File');
  }
  if (!safeFileName(file.name)) throw new Error('file name is invalid');
  const normalizedType = typeof file.type === 'string' ? file.type.toLowerCase() : '';
  if (!FILE_TYPES.has(normalizedType) || !extensionMatches(file.name, normalizedType)) {
    throw new Error('file type is invalid');
  }
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > MAX_FILE_BYTES) {
    throw new Error('file size is invalid');
  }
  if (!exactIdentifier(agencyId)) throw new Error('agencyId is required');
  if (patientId !== null && !exactIdentifier(patientId)) throw new Error('patientId is invalid');
  if (!PURPOSES.has(purpose)) throw new Error('purpose is invalid');
  if (purpose === 'patient_document' && !patientId) {
    throw new Error('patientId is required for patient_document');
  }
  if (!exactIdentifier(clientRequestId)) throw new Error('clientRequestId is invalid');
  if (functions !== null && typeof functions?.invoke !== 'function') {
    throw new Error('functions client is invalid');
  }

  const payload = {
    file,
    agency_id: agencyId,
    purpose,
    client_request_id: clientRequestId,
    ...(patientId ? { patient_id: patientId } : {}),
  };
  const response = functions
    ? await functions.invoke('createAuthorizedDocument', payload)
    : await base44.functions.invoke('createAuthorizedDocument', payload);
  const result = response?.data ?? response;
  return validateResult(result, {
    file,
    agencyId,
    patientId,
    purpose,
    clientRequestId,
  });
}
