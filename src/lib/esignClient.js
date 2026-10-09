import { base44 } from '@/api/base44Client';

/**
 * Staff-side electronic-signature calls. Every one goes to a reviewed broker
 * that authenticates the caller, decides agency membership and chart access
 * from AgencyMembership and the care-team assignment (never from a profile
 * field), and only then reads a record. The browser never reads a signing
 * entity directly and never receives a storage pointer.
 */

const MAX_IDENTIFIER_LENGTH = 200;

export class EsignClientError extends Error {
  constructor(message, { code = null, status = null } = {}) {
    super(message);
    this.name = 'EsignClientError';
    this.code = code;
    this.status = status;
  }
}

function exactIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_IDENTIFIER_LENGTH
    && value.trim() === value
    && !value.startsWith('$');
}

function requireAgency(agencyId) {
  if (!exactIdentifier(agencyId)) throw new EsignClientError('Select an authorized agency first');
  return agencyId;
}

function requireId(value, label) {
  if (!exactIdentifier(value)) throw new EsignClientError(`${label} is required`);
  return value;
}

export function newEsignRequestId(prefix = 'esign') {
  if (typeof globalThis.crypto?.randomUUID === 'function') return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Normalize an SDK response or rejection into data or an EsignClientError. */
export async function settleEsign(promise, fallback) {
  let response;
  try {
    response = await promise;
  } catch (error) {
    const data = error?.response?.data ?? error?.data ?? null;
    const message = typeof data?.error === 'string' && data.error.length <= 500 ? data.error : fallback;
    throw new EsignClientError(message, {
      code: typeof data?.code === 'string' ? data.code : null,
      status: Number.isInteger(error?.response?.status) ? error.response.status : null,
    });
  }
  const data = response && typeof response === 'object' && Object.hasOwn(response, 'data') ? response.data : response;
  if (!data || typeof data !== 'object' || data.success !== true) {
    throw new EsignClientError(typeof data?.error === 'string' ? data.error : fallback, {
      code: typeof data?.code === 'string' ? data.code : null,
    });
  }
  return data;
}

// ── Requests ────────────────────────────────────────────────────────────────

export async function listSignatureRequests({ agencyId, status = 'all', patientId = null, limit = 200 }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'list', agency_id: requireAgency(agencyId), status, limit,
    ...(patientId ? { patient_id: patientId } : {}),
  }), 'Signature requests could not be loaded');
}

export async function getSignatureRequest({ agencyId, requestKey }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'detail', agency_id: requireAgency(agencyId), request_key: requireId(requestKey, 'A request'),
  }), 'The signature request could not be loaded');
}

export async function getSignatureSummary({ agencyId }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'summary', agency_id: requireAgency(agencyId),
  }), 'Signature activity could not be loaded');
}

export async function listSignatureAuditEvents({ agencyId, limit = 200 }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'audit', agency_id: requireAgency(agencyId), limit,
  }), 'The signature audit trail could not be loaded');
}

export async function getSignatureAgreement({ agencyId }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'agreement', agency_id: requireAgency(agencyId),
  }), 'The signature consent text could not be loaded');
}

export async function listSignatureTemplates({ agencyId }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'templates', agency_id: requireAgency(agencyId),
  }), 'Document templates could not be loaded');
}

export async function cancelSignatureRequest({ agencyId, requestKey, reason = '' }) {
  return settleEsign(base44.functions.invoke('manageSignatureRequests', {
    action: 'cancel', agency_id: requireAgency(agencyId), request_key: requireId(requestKey, 'A request'),
    ...(reason ? { reason } : {}),
  }), 'The signature request could not be canceled');
}

/** One request from chart documents already filed to the patient's chart. */
export async function createSignatureRequest(spec) {
  return settleEsign(base44.functions.invoke('bulkCreateDocumentPackages', {
    ...spec, agency_id: requireAgency(spec?.agency_id),
  }), 'The signature request could not be created');
}

/** One request generated from a document template for one patient. */
export async function createSignatureRequestFromTemplate(spec) {
  return settleEsign(base44.functions.invoke('generateDocumentPackageFromTemplate', {
    ...spec, agency_id: requireAgency(spec?.agency_id),
  }), 'The document could not be generated for signature');
}

// ── Links and reminders ─────────────────────────────────────────────────────

/** Email the signer their first link (the issuer refuses a second live link). */
export async function sendSigningLink({ agencyId, packageId, signerId }) {
  return settleEsign(base44.functions.invoke('generateSignerToken', {
    agency_id: requireAgency(agencyId), package_id: requireId(packageId, 'A package'),
    signer_id: requireId(signerId, 'A signer'), request_id: newEsignRequestId('link'),
  }), 'The signing link could not be sent');
}

/** Revoke the signer's current link and email a fresh one. */
export async function sendSignatureReminder({ agencyId, packageId, signerId }) {
  return settleEsign(base44.functions.invoke('sendSignatureReminder', {
    agency_id: requireAgency(agencyId), package_id: requireId(packageId, 'A package'),
    signer_id: requireId(signerId, 'A signer'), request_id: newEsignRequestId('reminder'),
  }), 'The reminder could not be sent');
}

export async function scheduleSignatureReminder({ agencyId, packageId, signerId, documentId, sendAt }) {
  return settleEsign(base44.functions.invoke('scheduleSignatureReminders', {
    agency_id: requireAgency(agencyId), package_id: requireId(packageId, 'A package'),
    signer_id: requireId(signerId, 'A signer'), document_id: requireId(documentId, 'A document'),
    send_at: sendAt, client_request_id: newEsignRequestId('schedule'),
  }), 'The reminder could not be scheduled');
}

// ── Documents ───────────────────────────────────────────────────────────────

function documentBody({ agencyId, documentSignatureId }, extra = {}) {
  return {
    agency_id: requireAgency(agencyId),
    document_signature_id: requireId(documentSignatureId, 'A document'),
    ...extra,
  };
}

// Each call names its broker literally so every function route stays reviewable.
export async function sealSignedDocument(input) {
  return settleEsign(base44.functions.invoke('onDocumentSigned', documentBody(input)),
    'The signed document could not be sealed');
}
export async function archiveSignedDocument(input) {
  return settleEsign(base44.functions.invoke('archiveSignedDocument', documentBody(input)),
    'The signed document could not be verified');
}
export async function previewSignatureDocument(input) {
  return settleEsign(base44.functions.invoke('stampSignatureOnPDF', documentBody(input)),
    'The document preview could not be built');
}
export async function downloadSignatureCertificate(input) {
  return settleEsign(base44.functions.invoke('generateSignatureCertificate', documentBody(input)),
    'The signature certificate could not be generated');
}
export async function verifySignatureIntegrity(input) {
  return settleEsign(base44.functions.invoke('signatureIntegrity', documentBody(input)),
    'Integrity could not be verified');
}
export async function resendCompletionNotice(input) {
  return settleEsign(base44.functions.invoke('notifyAdminOfSignedDocument', documentBody(input, { resend_email: true })),
    'The completion notice could not be sent');
}
export async function updateSignatureFields(input, fields) {
  return settleEsign(base44.functions.invoke('embedAnnotationsToPDF', documentBody(input, { signature_fields: fields })),
    'Field placement could not be saved');
}

// ── Signatures captured by staff ────────────────────────────────────────────

/** A signer signs on the staff member's device, after the staff member confirms who they are. */
export async function signInPerson({ agencyId, documentSignatureId, signerId, typedName, agreementVersion, file, clientRequestId }) {
  return settleEsign(base44.functions.invoke('submitDocumentSignatures', {
    mode: 'in_person',
    agency_id: requireAgency(agencyId),
    document_signature_id: requireId(documentSignatureId, 'A document'),
    signer_id: requireId(signerId, 'A signer'),
    typed_name: typedName,
    agreement_version: agreementVersion,
    identity_confirmed: 'true',
    client_request_id: requireId(clientRequestId, 'A request id'),
    signature_file: file,
  }), 'The signature could not be recorded');
}

export const DISCHARGE_ATTESTATION_VERSION = 'discharge-attestation-v1';

/** The authenticated clinician signs a reviewed discharge summary. */
export async function signDischargeSummary({ agencyId, dischargeSummaryId, file, clientRequestId }) {
  return settleEsign(base44.functions.invoke('submitDocumentSignatures', {
    mode: 'discharge_summary',
    agency_id: requireAgency(agencyId),
    discharge_summary_id: requireId(dischargeSummaryId, 'A discharge summary'),
    attestation_version: DISCHARGE_ATTESTATION_VERSION,
    client_request_id: requireId(clientRequestId, 'A request id'),
    signature_file: file,
  }), 'The discharge summary could not be signed');
}

// ── Bytes ───────────────────────────────────────────────────────────────────

export { base64ToBytes, signatureFileFromDataUrl } from '@/lib/signatureFile';
