import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/** Private-artifact, review-grant-bound external signature submit broker. */
const PUBLIC_SIGNATURE_RELEASE_ENABLED = false;
const MAX_IDENTIFIER_LENGTH = 200;
const EXACT_ROW_LIMIT = 10;
const MAX_SIGNATURE_FILE_BYTES = 1024 * 1024;
const MAX_MULTIPART_BYTES = MAX_SIGNATURE_FILE_BYTES + 32 * 1024;
const AGREEMENT_VERSION = 'signature-consent-v1';
const CLAIM_LEASE_MS = 5 * 60 * 1000;

class PublicError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = 'PublicError';
    this.status = status;
  }
}

function exactIdentifier(value: unknown) {
  if (typeof value !== 'string' || !value || value.length > MAX_IDENTIFIER_LENGTH
      || value.trim() !== value || value.startsWith('$')
      || [...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) return null;
  return value;
}

function canonicalEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email && email.length <= 320 && email.includes('@') && !/\s/.test(email) ? email : null;
}

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

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

function validInstant(value: unknown) {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function currentDeadline(token: Record<string, any>, pkg: Record<string, any>, signatures: Array<Record<string, any>>) {
  const deadlines = [Date.parse(token.expires_at)];
  for (const row of [pkg, ...signatures]) {
    if (row.due_date != null) {
      const millis = dueDateEnd(row.due_date);
      if (millis === null) {
        throw new PublicError(401, 'Invalid or expired signing authority');
      }
      deadlines.push(millis);
    }
    for (const field of ['expires_at', 'expiration_date']) {
      if (row[field] == null) continue;
      if (!validInstant(row[field])) throw new PublicError(401, 'Invalid or expired signing authority');
      deadlines.push(Date.parse(row[field]));
    }
  }
  const deadline = Math.min(...deadlines);
  if (!Number.isFinite(deadline) || Date.now() >= deadline || Date.parse(token.expires_at) > deadline) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  return new Date(deadline).toISOString();
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
}

function successfulSingleUpdate(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  return result.success === true && result.updated === 1 && result.has_more === false;
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]));
  }
  return value;
}

function signerAuthorityRoster(signers: Array<Record<string, any>>) {
  return signers.map((signer) => ({
    signer_id: signer.signer_id,
    signer_name: signer.signer_name,
    signer_role: signer.signer_role,
    email: signer.email,
    required: signer.required,
  }));
}

function canonicalName(value: unknown) {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en-US')
    : '';
}

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

function validSignatureImage(bytes: Uint8Array, fileType: string) {
  if (fileType === 'image/png') {
    const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const iend = [0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
    return bytes.length >= 33
      && png.every((value, index) => bytes[index] === value)
      && iend.every((value, index) => bytes[bytes.length - iend.length + index] === value);
  }
  return fileType === 'image/jpeg' && bytes.length >= 4
    && bytes[0] === 0xff && bytes[1] === 0xd8
    && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

async function hmacAudit(value: string) {
  const secret = String(Deno.env.get('SIGNATURE_HMAC_SECRET') || '');
  if (secret.length < 32) throw new PublicError(500, 'Signature audit is not configured');
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return sha256Bytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function configuredAgreementDigest() {
  const digest = String(Deno.env.get('SIGNATURE_AGREEMENT_SHA256') || '').trim().toLowerCase();
  const text = String(Deno.env.get('SIGNATURE_AGREEMENT_TEXT') || '').trim();
  if (!exactDigest(digest) || text.length < 40 || text.length > 5_000 || await sha256(text) !== digest) {
    throw new PublicError(500, 'Signature agreement is not configured');
  }
  return digest;
}

function oneString(form: FormData, name: string) {
  const values = form.getAll(name);
  if (values.length !== 1 || typeof values[0] !== 'string') throw new PublicError(400, `${name} is invalid`);
  return values[0];
}

async function parseRequest(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  if (!/^multipart\/form-data\s*;/i.test(req.headers.get('content-type') || '')) {
    throw new PublicError(415, 'multipart/form-data is required');
  }
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_MULTIPART_BYTES) throw new PublicError(413, 'Signature upload is too large');
  const form = await req.formData().catch(() => { throw new PublicError(400, 'Invalid multipart body'); });
  const allowed = new Set(['token', 'review_nonce', 'document_id', 'signature_file', 'typed_name', 'agreement_version', 'client_request_id']);
  for (const [key] of form.entries()) if (!allowed.has(key)) throw new PublicError(400, `Unsupported signature field: ${key}`);
  const token = oneString(form, 'token');
  const reviewNonce = oneString(form, 'review_nonce');
  const documentId = exactIdentifier(oneString(form, 'document_id'));
  const clientRequestId = exactIdentifier(oneString(form, 'client_request_id'));
  const agreementVersion = oneString(form, 'agreement_version');
  const typedName = oneString(form, 'typed_name').trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[A-Za-z0-9_-]{43}$/.test(reviewNonce)) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  if (!documentId || !clientRequestId || agreementVersion !== AGREEMENT_VERSION
      || typedName.length < 2 || typedName.length > 200
      || [...typedName].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)) {
    throw new PublicError(400, 'Signature submission is invalid');
  }
  const files = form.getAll('signature_file');
  if (files.length !== 1 || typeof File === 'undefined' || !(files[0] instanceof File)) {
    throw new PublicError(400, 'signature_file must be a File');
  }
  const file = files[0] as File;
  const fileType = String(file.type || '').toLowerCase();
  const lowerName = String(file.name || '').toLowerCase();
  const extensionOk = fileType === 'image/png' ? lowerName.endsWith('.png')
    : fileType === 'image/jpeg' ? (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) : false;
  if (!extensionOk || !Number.isSafeInteger(file.size) || file.size < 100 || file.size > MAX_SIGNATURE_FILE_BYTES) {
    throw new PublicError(400, 'Signature file is invalid');
  }
  return { token, reviewNonce, documentId, clientRequestId, agreementVersion, typedName, file, fileType };
}

function validateSigner(raw: unknown, signerId: string, signerEmail: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicError(409, 'Signer authority is invalid');
  const signer = raw as Record<string, any>;
  if (signer.signer_id !== signerId || canonicalEmail(signer.email) !== signerEmail || signer.email !== signerEmail
      || typeof signer.signer_name !== 'string' || !signer.signer_name.trim() || signer.required !== true
      || !['pending', 'completed', 'declined'].includes(signer.status)
      || signer.signature_data != null || signer.ip_address != null || signer.device_info != null) {
    throw new PublicError(409, 'Signer authority is invalid');
  }
  if (signer.status === 'completed' && (!validInstant(signer.signed_at)
      || !exactIdentifier(signer.signature_artifact_id) || !exactDigest(signer.signature_sha256)
      || signer.agreement_version !== AGREEMENT_VERSION)) throw new PublicError(409, 'Signer completion integrity is invalid');
  if (signer.status !== 'completed' && (signer.signed_at != null || signer.signature_artifact_id != null
      || signer.signature_sha256 != null || signer.agreement_version != null)) {
    throw new PublicError(409, 'Signer completion integrity is invalid');
  }
  return signer;
}

async function exactOne(entity: Record<string, any>, query: Record<string, any>, label: string) {
  const rows = requireRows(await entity.filter(query, undefined, EXACT_ROW_LIMIT), `${label}.filter`);
  if (rows.length !== 1) throw new PublicError(401, 'Invalid or expired signing authority');
  for (const [key, value] of Object.entries(query)) {
    if (rows[0]?.[key] !== value) throw new PublicError(409, `${label} query scope could not be verified`);
  }
  return rows[0];
}

async function loadContext(
  entities: Record<string, any>,
  input: Record<string, any>,
  tokenDigest: string,
  grantDigest: string,
  agreementTextDigest: string,
  operationId: string | null = null,
  forArtifactLookup = false,
) {
  const token = await exactOne(entities.DocumentPackageToken, { token: tokenDigest, token_hashed: true }, 'DocumentPackageToken');
  const tokenId = exactIdentifier(token.id);
  const agencyId = exactIdentifier(token.agency_id);
  const packageId = exactIdentifier(token.package_id);
  const signerId = exactIdentifier(token.signer_id);
  const signerEmail = canonicalEmail(token.signer_email);
  const tokenClaimedForRequest = token.status === 'claimed'
    && token.claimed_by_request_id === input.clientRequestId
    && token.claimed_document_id === input.documentId;
  const tokenClaimedForOperation = tokenClaimedForRequest && operationId !== null
    && token.claimed_by_operation_id === operationId;
  const tokenCompletedForRequest = ['active', 'consumed'].includes(token.status)
    && token.last_completed_request_id === input.clientRequestId
    && token.last_completed_document_id === input.documentId;
  if (!tokenId || !agencyId || !packageId || !signerId || !signerEmail || token.signer_email !== signerEmail
      || (token.status !== 'active' && !tokenClaimedForRequest && !tokenCompletedForRequest)
      || (token.status === 'consumed' ? token.is_active !== false : token.is_active !== true)
      || !Number.isSafeInteger(token.authority_version) || token.authority_version < 1
      || !validInstant(token.expires_at)
      || (!forArtifactLookup && !tokenCompletedForRequest && Date.now() >= Date.parse(token.expires_at))) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const grant = await exactOne(entities.SignerReviewGrant, {
    grant_key: grantDigest, token_id: tokenId, document_signature_id: input.documentId,
  }, 'SignerReviewGrant');
  const grantClaimedForRequest = grant.status === 'claimed'
    && grant.claimed_by_request_id === input.clientRequestId
    && grant.claimed_document_id === input.documentId;
  const grantClaimedForOperation = grantClaimedForRequest && operationId !== null
    && grant.claimed_by_operation_id === operationId;
  const grantCompletedForRequest = grant.status === 'consumed'
    && grant.claimed_by_request_id === input.clientRequestId
    && grant.claimed_document_id === input.documentId;
  if (grant.agency_id !== agencyId || grant.package_id !== packageId || grant.signer_id !== signerId
      || (grant.status !== 'active' && !grantClaimedForRequest && !grantCompletedForRequest)
      || !Number.isSafeInteger(grant.authority_version) || grant.authority_version < 1
      || !validInstant(grant.issued_at) || !validInstant(grant.expires_at)
      || (!forArtifactLookup && !grantCompletedForRequest && Date.now() >= Date.parse(grant.expires_at))
      || !exactDigest(grant.document_content_sha256)
      || grant.agreement_text_sha256 !== agreementTextDigest
      || !exactDigest(grant.signer_roster_sha256)
      || !exactIdentifier(grant.document_binding_id)
      || grant.document_binding_version !== 2
      || !Number.isSafeInteger(grant.package_authority_version)
      || !Number.isSafeInteger(grant.document_authority_version)) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const pkg = await exactOne(entities.DocumentPackage, { id: packageId, agency_id: agencyId }, 'DocumentPackage');
  const documentIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  const tokenDocumentIds = Array.isArray(token.document_ids) ? token.document_ids.map(exactIdentifier) : [];
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const creatorMembershipId = exactIdentifier(pkg.creator_membership_id);
  if (!patientId || !creatorId || !creatorEmail || !creatorMembershipId
      || pkg.signer_id !== signerId || canonicalEmail(pkg.signer_email) !== signerEmail
      || !Number.isSafeInteger(pkg.creator_membership_version) || pkg.creator_membership_version < 1
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || !['pending', 'in_progress'].includes(pkg.status)
      || (pkg.authority_version !== grant.package_authority_version
        && !(pkg.status === 'in_progress' && pkg.authority_version === grant.package_authority_version + 1))
      || !documentIds.includes(input.documentId) || JSON.stringify(documentIds) !== JSON.stringify(tokenDocumentIds)
      || documentIds.includes(null) || new Set(documentIds).size !== documentIds.length) {
    throw new PublicError(409, 'Signature package integrity check failed');
  }
  const agency = await exactOne(entities.Agency, { id: agencyId }, 'Agency');
  if (!['active', 'trial'].includes(agency.status)) throw new PublicError(401, 'Invalid or expired signing authority');
  const membership = await exactOne(entities.AgencyMembership, {
    id: creatorMembershipId, agency_id: agencyId, user_id: creatorId,
  }, 'AgencyMembership');
  if (membership.status !== 'active' || membership.version !== pkg.creator_membership_version
      || canonicalEmail(membership.user_email_normalized) !== creatorEmail) {
    throw new PublicError(401, 'Invalid or expired signing authority');
  }
  const patient = await exactOne(entities.Patient, {
    id: patientId, agency_id: agencyId, is_sample: false, is_archived: false,
  }, 'Patient');
  if (patient.id !== patientId) throw new PublicError(409, 'Signature patient authority is invalid');
  const signature = await exactOne(entities.DocumentSignature, { id: input.documentId, agency_id: agencyId }, 'DocumentSignature');
  // Exact completed retries may reconcile their existing artifact after expiry;
  // they cannot create a new signature. Every new act uses current deadlines.
  if (!forArtifactLookup && (!tokenCompletedForRequest || !grantCompletedForRequest)) {
    const authoritySignatures = [signature];
    for (const id of documentIds) {
      if (id !== input.documentId) authoritySignatures.push(await exactOne(
        entities.DocumentSignature, { id, agency_id: agencyId }, 'DocumentSignature',
      ));
    }
    currentDeadline(token, pkg, authoritySignatures);
  }
  const signers = Array.isArray(signature.signers) ? signature.signers : [];
  const signerIndex = signers.findIndex((candidate) => candidate?.signer_id === signerId);
  const signer = signerIndex >= 0 ? validateSigner(signers[signerIndex], signerId, signerEmail) : null;
  const bindingId = exactIdentifier(signature.document_binding_id);
  const sourceDocumentId = exactIdentifier(signature.document_id);
  if (!signer || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
      || canonicalEmail(signature.created_by_user_email_normalized) !== creatorEmail
      || signature.creator_membership_id !== creatorMembershipId
      || signature.creator_membership_version !== pkg.creator_membership_version
      || !bindingId || !sourceDocumentId || signature.document_binding_version !== 2
      || signature.document_content_sha256 !== grant.document_content_sha256
      || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
      || !['pending', 'in_progress'].includes(signature.status)
      || !['pending', 'partial', 'signatures_collected'].includes(signature.workflow_status)
      || signature.completed_date != null || signature.completed_at != null
      || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
    throw new PublicError(409, 'Signature document integrity check failed');
  }
  const binding = await exactOne(entities.DocumentTenantBinding, {
    id: bindingId, agency_id: agencyId, document_id: sourceDocumentId,
  }, 'DocumentTenantBinding');
  if (binding.patient_id !== patientId || binding.storage_mode !== 'private' || binding.version !== 2
      || binding.content_sha256 !== signature.document_content_sha256
      || binding.id !== grant.document_binding_id || binding.version !== grant.document_binding_version
      || typeof binding.file_uri !== 'string'
      || !isPrivateFileUri(binding.file_uri)) {
    throw new PublicError(409, 'Signature source-document binding is invalid');
  }
  const signerRosterDigest = await sha256(JSON.stringify(canonicalJson(signerAuthorityRoster(signers))));
  const documentSnapshotMatches = signature.authority_version === grant.document_authority_version
    || (signer.status === 'completed' && signature.authority_version === grant.document_authority_version + 1);
  if (!documentSnapshotMatches || signerRosterDigest !== grant.signer_roster_sha256) {
    throw new PublicError(409, 'Signature review authority changed after document review');
  }
  return {
    token, tokenId, agencyId, packageId, signerId, signerEmail,
    tokenClaimedForRequest, tokenClaimedForOperation, tokenCompletedForRequest,
    grant, grantClaimedForRequest, grantClaimedForOperation, grantCompletedForRequest,
    pkg, documentIds: documentIds as string[],
    signature, signers, signer, signerIndex,
  };
}

async function ensureAudit(entities: Record<string, any>, payload: Record<string, any>) {
  const existing = requireRows(await entities.SignatureAuditEvent.filter(
    { event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (existing.length > 1) throw new Error('Signature audit identity is ambiguous');
  if (existing.length === 1) {
    const row = existing[0];
    for (const field of ['agency_id', 'package_id', 'document_signature_id', 'signer_id', 'token_id',
      'action', 'actor_type', 'request_id', 'authority_version', 'document_content_sha256',
      'artifact_content_sha256', 'client_ip_sha256', 'user_agent_sha256']) {
      if ((row[field] ?? null) !== (payload[field] ?? null)) throw new Error('Signature audit identity conflicts with existing provenance');
    }
    return row;
  }
  const row = await entities.SignatureAuditEvent.create(payload);
  if (!exactIdentifier(row?.id)) throw new Error('Signature audit could not be recorded');
  const readback = requireRows(await entities.SignatureAuditEvent.filter(
    { id: row.id, event_key: payload.event_key }, undefined, EXACT_ROW_LIMIT,
  ), 'SignatureAuditEvent.filter');
  if (readback.length !== 1 || readback[0]?.id !== row.id) throw new Error('Signature audit could not be verified');
  return readback[0];
}

async function loadSignerCompletion(entities: Record<string, any>, agencyId: string, signatureId: string, signerId: string, signerEmail: string) {
  const row = await exactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature');
  const signer = (Array.isArray(row.signers) ? row.signers : []).find((candidate) => candidate?.signer_id === signerId);
  return { row, signer: signer ? validateSigner(signer, signerId, signerEmail) : null };
}

function validateArtifact(
  artifact: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  artifactKey: string,
  signatureDigest: string,
  typedNameDigest: string,
  agreementTextDigest: string,
) {
  const artifactId = exactIdentifier(artifact.id);
  const fileUri = typeof artifact.file_uri === 'string' ? artifact.file_uri : '';
  if (!artifactId || artifact.artifact_key !== artifactKey || artifact.agency_id !== context.agencyId
      || artifact.package_id !== context.packageId || artifact.document_signature_id !== input.documentId
      || artifact.signer_id !== context.signerId || artifact.token_id !== context.tokenId
      || artifact.client_request_id !== input.clientRequestId || artifact.storage_mode !== 'private'
      || !isPrivateFileUri(fileUri) || fileUri.length > 4096
      || artifact.file_type !== input.fileType || artifact.file_size !== input.file.size
      || artifact.content_sha256 !== signatureDigest || artifact.typed_name_hmac_sha256 !== typedNameDigest
      || artifact.agreement_version !== input.agreementVersion
      || artifact.agreement_text_sha256 !== agreementTextDigest
      || artifact.source_document_sha256 !== context.signature.document_content_sha256
      || artifact.document_binding_id !== context.signature.document_binding_id
      || artifact.document_binding_version !== context.signature.document_binding_version
      || artifact.version !== 1
      || !exactDigest(artifact.client_ip_sha256) || !exactDigest(artifact.user_agent_sha256)
      || !validInstant(artifact.created_at) || !validInstant(artifact.binding_verified_at)) {
    throw new PublicError(409, 'Signature artifact integrity check failed');
  }
  return artifactId;
}

async function recordArtifactOnSignature(
  entities: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  artifactId: string,
  signatureDigest: string,
  occurredAt: string,
) {
  if (context.signer.status === 'completed') {
    if (context.signer.signature_artifact_id !== artifactId
        || context.signer.signature_sha256 !== signatureDigest
        || context.signer.agreement_version !== input.agreementVersion) {
      throw new PublicError(409, 'Recorded signer state conflicts with the private signature artifact');
    }
    return loadSignerCompletion(
      entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
    );
  }
  if (context.signer.status !== 'pending') {
    throw new PublicError(409, 'This signature can no longer be submitted');
  }
  const updatedSigners = context.signers.map((signer, index) => index === context.signerIndex ? {
    ...signer, status: 'completed', signed_at: occurredAt, signature_artifact_id: artifactId,
    signature_sha256: signatureDigest, agreement_version: input.agreementVersion,
  } : signer);
  const allRequiredSigned = updatedSigners.filter((signer) => signer?.required === true)
    .every((signer) => signer?.status === 'completed');
  const signatureUpdate = await entities.DocumentSignature.updateMany(
    { id: input.documentId, agency_id: context.agencyId,
      authority_version: context.signature.authority_version, status: context.signature.status },
    { $set: {
      signers: updatedSigners,
      // Signature capture is deliberately nonterminal. A separate reviewed
      // broker must stamp, integrity-bind, certificate, and privately archive
      // the composite before either this row or its package can be completed.
      status: 'in_progress', workflow_status: allRequiredSigned ? 'signatures_collected' : 'partial',
      signatures_collected_at: allRequiredSigned ? occurredAt : null,
      completed_date: null, completed_at: null,
      submit_claimed_by: input.clientRequestId, submit_claimed_at: occurredAt,
      authority_version: context.signature.authority_version + 1,
    } },
  );
  const completed = await loadSignerCompletion(
    entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
  );
  if ((!successfulSingleUpdate(signatureUpdate) && completed.signer?.signature_artifact_id !== artifactId)
      || completed.row.status !== 'in_progress'
      || completed.signer?.status !== 'completed'
      || completed.signer?.signature_artifact_id !== artifactId
      || completed.signer?.signature_sha256 !== signatureDigest
      || completed.signer?.agreement_version !== input.agreementVersion) {
    throw new PublicError(409, 'Signature state changed concurrently; reconciliation is required');
  }
  return completed;
}

async function finalizeRecordedSignature(
  entities: Record<string, any>,
  context: Record<string, any>,
  input: Record<string, any>,
  tokenDigest: string,
  grantDigest: string,
  artifactId: string,
  signatureDigest: string,
  occurredAt: string,
  clientIpDigest: string,
  userAgentDigest: string,
) {
  const completed = await loadSignerCompletion(
    entities, context.agencyId, input.documentId, context.signerId, context.signerEmail,
  );
  if (completed.signer?.status !== 'completed'
      || completed.signer.signature_artifact_id !== artifactId
      || completed.signer.signature_sha256 !== signatureDigest
      || completed.signer.agreement_version !== input.agreementVersion) {
    throw new PublicError(409, 'Signature completion requires reconciliation');
  }
  await ensureAudit(entities, {
    event_key: await sha256(`signature_recorded\0${artifactId}\0${input.clientRequestId}`),
    agency_id: context.agencyId, package_id: context.packageId,
    document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
    action: 'signature_recorded', actor_type: 'external_signer', request_id: input.clientRequestId,
    authority_version: completed.row.authority_version,
    document_content_sha256: context.signature.document_content_sha256,
    artifact_content_sha256: signatureDigest,
    client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
    occurred_at: occurredAt,
  });

  const memberStates = [];
  for (const memberId of context.documentIds) {
    memberStates.push(await loadSignerCompletion(
      entities, context.agencyId, memberId, context.signerId, context.signerEmail,
    ));
  }
  const signerPackageComplete = memberStates.every((state) => state.signer?.status === 'completed');

  let grantVersion = context.grant.authority_version;
  if (context.grant.status === 'claimed') {
    const grantConsume = await entities.SignerReviewGrant.updateMany(
      { id: context.grant.id, grant_key: grantDigest, status: 'claimed',
        claimed_by_request_id: input.clientRequestId,
        claimed_by_operation_id: context.grant.claimed_by_operation_id,
        claimed_document_id: input.documentId,
        authority_version: grantVersion },
      { $set: { status: 'consumed', consumed_at: occurredAt, authority_version: grantVersion + 1 } },
    );
    if (!successfulSingleUpdate(grantConsume)) {
      const currentGrant = await exactOne(entities.SignerReviewGrant,
        { id: context.grant.id, grant_key: grantDigest }, 'SignerReviewGrant');
      if (currentGrant.status !== 'consumed' || currentGrant.claimed_by_request_id !== input.clientRequestId
          || currentGrant.claimed_by_operation_id !== context.grant.claimed_by_operation_id
          || currentGrant.claimed_document_id !== input.documentId
          || currentGrant.authority_version !== grantVersion + 1) {
        throw new PublicError(409, 'Review grant completion requires reconciliation');
      }
    }
    grantVersion += 1;
  } else if (context.grant.status !== 'consumed' || context.grant.claimed_by_request_id !== input.clientRequestId) {
    throw new PublicError(409, 'Review grant completion requires reconciliation');
  }
  await ensureAudit(entities, {
    event_key: await sha256(`review_grant_consumed\0${context.grant.id}\0${input.clientRequestId}`),
    agency_id: context.agencyId, package_id: context.packageId,
    document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
    action: 'review_grant_consumed', actor_type: 'external_signer', request_id: input.clientRequestId,
    authority_version: grantVersion,
    document_content_sha256: context.signature.document_content_sha256,
    client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
    occurred_at: occurredAt,
  });

  const tokenNextStatus = signerPackageComplete ? 'consumed' : 'active';
  let tokenVersion = context.token.authority_version;
  if (context.token.status === 'claimed') {
    const tokenUpdate = await entities.DocumentPackageToken.updateMany(
      { id: context.tokenId, token: tokenDigest, status: 'claimed',
        claimed_by_request_id: input.clientRequestId,
        claimed_by_operation_id: context.token.claimed_by_operation_id,
        claimed_document_id: input.documentId,
        authority_version: tokenVersion },
      { $set: {
        status: tokenNextStatus, is_active: !signerPackageComplete,
        consumed_at: signerPackageComplete ? occurredAt : null,
        claimed_at: null, claimed_by_request_id: null, claimed_by_operation_id: null,
        claimed_document_id: null,
        submission_upload_operation_id: null, submission_upload_started_at: null,
        last_completed_request_id: input.clientRequestId,
        last_completed_document_id: input.documentId,
        authority_version: tokenVersion + 1,
      } },
    );
    if (!successfulSingleUpdate(tokenUpdate)) {
      const currentToken = await exactOne(entities.DocumentPackageToken,
        { id: context.tokenId, token: tokenDigest, token_hashed: true }, 'DocumentPackageToken');
      if (currentToken.status !== tokenNextStatus || currentToken.is_active !== !signerPackageComplete
          || currentToken.last_completed_request_id !== input.clientRequestId
          || currentToken.last_completed_document_id !== input.documentId
          || currentToken.claimed_by_operation_id != null
          || currentToken.claimed_document_id != null
          || currentToken.submission_upload_operation_id != null || currentToken.submission_upload_started_at != null
          || currentToken.authority_version !== tokenVersion + 1) {
        throw new PublicError(409, 'Signer token completion requires reconciliation');
      }
    }
    tokenVersion += 1;
  } else if (!context.tokenCompletedForRequest || context.token.status !== tokenNextStatus
      || context.token.is_active !== !signerPackageComplete) {
    throw new PublicError(409, 'Signer token completion requires reconciliation');
  }

  const currentPackage = await exactOne(entities.DocumentPackage,
    { id: context.packageId, agency_id: context.agencyId }, 'DocumentPackage');
  if (currentPackage.status === 'pending') {
    const packageUpdate = await entities.DocumentPackage.updateMany(
      { id: context.packageId, agency_id: context.agencyId,
        status: 'pending', authority_version: currentPackage.authority_version },
      { $set: { status: 'in_progress', completed_at: null,
        authority_version: currentPackage.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(packageUpdate)) {
      const reconciled = await exactOne(entities.DocumentPackage,
        { id: context.packageId, agency_id: context.agencyId }, 'DocumentPackage');
      if (reconciled.status !== 'in_progress' || reconciled.completed_at != null) {
        throw new PublicError(409, 'Signature package transition requires reconciliation');
      }
    }
  } else if (currentPackage.status !== 'in_progress' || currentPackage.completed_at != null) {
    throw new PublicError(409, 'Signature package transition requires reconciliation');
  }
  if (signerPackageComplete) {
    await ensureAudit(entities, {
      event_key: await sha256(`token_consumed\0${context.tokenId}\0${input.clientRequestId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'token_consumed', actor_type: 'external_signer', request_id: input.clientRequestId,
      authority_version: tokenVersion, occurred_at: occurredAt,
    });
  }
  return {
    documentCompleted: false,
    signatureCollected: completed.signer.status === 'completed',
    allSigned: signerPackageComplete,
  };
}

Deno.serve(async (req) => {
  if (!PUBLIC_SIGNATURE_RELEASE_ENABLED) {
    return Response.json(
      { error: 'Secure document review and signing are temporarily unavailable.', code: 'signer_submission_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }
  let tokenClaim: Record<string, any> | null = null;
  let uploadMarkerConfirmed = false;
  let storageInvoked = false;
  let grantClaim: Record<string, any> | null = null;
  let cleanupEntities: Record<string, any> | null = null;
  let irreversible = false;
  try {
    const input = await parseRequest(req);
    const [signatureBytes, tokenDigest, grantDigest, typedNameDigest, agreementTextDigest] = await Promise.all([
      input.file.arrayBuffer().then((value) => new Uint8Array(value)),
      sha256(input.token), sha256(input.reviewNonce), hmacAudit(`name\0${canonicalName(input.typedName)}`),
      configuredAgreementDigest(),
    ]);
    if (signatureBytes.byteLength !== input.file.size || !validSignatureImage(signatureBytes, input.fileType)) {
      throw new PublicError(400, 'Signature file content is invalid');
    }
    const signatureDigest = await sha256Bytes(signatureBytes);
    const base44 = createClientFromRequest(req);
    const entities = base44.asServiceRole.entities;
    cleanupEntities = entities;
    const operationId = crypto.randomUUID();
    // Authority/status checks still apply here. Expiry is deferred only until
    // the exact immutable artifact lookup; it never authorizes a new upload.
    let context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, null, true);
    if (canonicalName(input.typedName) !== canonicalName(context.signer.signer_name)) {
      throw new PublicError(400, 'Typed signer name must match the authorized signer');
    }
    const artifactKey = await sha256(`${context.tokenId}\0${input.documentId}\0${context.signerId}\0${input.clientRequestId}`);

    const existingArtifacts = requireRows(await entities.SignatureArtifactBinding.filter(
      { artifact_key: artifactKey }, undefined, EXACT_ROW_LIMIT,
    ), 'SignatureArtifactBinding.filter');
    if (existingArtifacts.length > 1) throw new PublicError(409, 'Signature submission identity is ambiguous');
    if (existingArtifacts.length === 1) {
      const artifact = existingArtifacts[0];
      const artifactId = validateArtifact(
        artifact, context, input, artifactKey, signatureDigest, typedNameDigest, agreementTextDigest,
      );
      irreversible = true;
      await recordArtifactOnSignature(
        entities, context, input, artifactId, signatureDigest, artifact.created_at,
      );
      const result = await finalizeRecordedSignature(
        entities, context, input, tokenDigest, grantDigest, artifactId, signatureDigest,
        artifact.created_at, artifact.client_ip_sha256, artifact.user_agent_sha256,
      );
      return Response.json({ success: true, idempotent: true, document_id: input.documentId,
        signature_collected: result.signatureCollected,
        document_completed: result.documentCompleted, all_signed: result.allSigned },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
    }
    if (context.token.submission_upload_operation_id != null || context.token.submission_upload_started_at != null) {
      irreversible = true;
      throw new PublicError(409, 'Prior signature upload requires reconciliation');
    }
    const freshContext = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest);
    if (freshContext.tokenId !== context.tokenId || freshContext.signerId !== context.signerId
      || freshContext.packageId !== context.packageId
      || canonicalName(input.typedName) !== canonicalName(freshContext.signer.signer_name)) {
      throw new PublicError(409, 'Signature authority changed');
    }
    context = freshContext;
    if (context.signer.status === 'completed') throw new PublicError(409, 'This signer has already completed the document');
    if (context.signer.status !== 'pending') throw new PublicError(409, 'This signature can no longer be submitted');

    const claimAt = new Date().toISOString();
    const grantClaimFilter: Record<string, any> = {
      id: context.grant.id, grant_key: grantDigest,
      status: context.grant.status, authority_version: context.grant.authority_version,
    };
    if (context.grant.status === 'claimed') {
      if (!context.grantClaimedForRequest || !exactIdentifier(context.grant.claimed_by_operation_id)
          || !validInstant(context.grant.claimed_at)
          || Date.parse(context.grant.claimed_at) > Date.now() - CLAIM_LEASE_MS) {
        throw new PublicError(409, 'This signature submission is already in progress');
      }
      grantClaimFilter.claimed_by_request_id = input.clientRequestId;
      grantClaimFilter.claimed_by_operation_id = context.grant.claimed_by_operation_id;
      grantClaimFilter.claimed_document_id = input.documentId;
      grantClaimFilter.claimed_at = context.grant.claimed_at;
    } else if (context.grant.status !== 'active') {
      throw new PublicError(409, 'Review grant was already used');
    }
    const grantResult = await entities.SignerReviewGrant.updateMany(
      grantClaimFilter,
      { $set: { status: 'claimed', claimed_at: claimAt,
        claimed_by_request_id: input.clientRequestId, claimed_by_operation_id: operationId,
        claimed_document_id: input.documentId,
        authority_version: context.grant.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(grantResult)) throw new PublicError(409, 'Review grant was already used');
    grantClaim = { id: context.grant.id, version: context.grant.authority_version + 1,
      grantDigest, operationId, documentId: input.documentId };

    const tokenClaimFilter: Record<string, any> = {
      id: context.tokenId, token: tokenDigest,
      status: context.token.status, authority_version: context.token.authority_version,
      submission_upload_operation_id: null, submission_upload_started_at: null,
    };
    if (context.token.status === 'claimed') {
      if (!context.tokenClaimedForRequest || !exactIdentifier(context.token.claimed_by_operation_id)
          || !validInstant(context.token.claimed_at)
          || Date.parse(context.token.claimed_at) > Date.now() - CLAIM_LEASE_MS) {
        throw new PublicError(409, 'This signature submission is already in progress');
      }
      tokenClaimFilter.claimed_by_request_id = input.clientRequestId;
      tokenClaimFilter.claimed_by_operation_id = context.token.claimed_by_operation_id;
      tokenClaimFilter.claimed_document_id = input.documentId;
      tokenClaimFilter.claimed_at = context.token.claimed_at;
    } else if (context.token.status !== 'active') {
      throw new PublicError(409, 'Signer token is unavailable');
    }
    const tokenResult = await entities.DocumentPackageToken.updateMany(
      tokenClaimFilter,
      { $set: { status: 'claimed', claimed_at: claimAt,
        claimed_by_request_id: input.clientRequestId, claimed_by_operation_id: operationId,
        claimed_document_id: input.documentId,
        authority_version: context.token.authority_version + 1 } },
    );
    if (!successfulSingleUpdate(tokenResult)) throw new PublicError(409, 'Signer token is already in use');
    tokenClaim = { id: context.tokenId, version: context.token.authority_version + 1,
      tokenDigest, operationId, documentId: input.documentId };

    context = await loadContext(
      entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId,
    );
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation) {
      throw new PublicError(409, 'Signing claim could not be verified');
    }

    const now = new Date().toISOString();
    const ip = String(req.headers.get('cf-connecting-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown').slice(0, 128);
    const userAgent = String(req.headers.get('user-agent') || 'unknown').slice(0, 512);
    const [clientIpDigest, userAgentDigest] = await Promise.all([
      hmacAudit(`ip\0${ip}`), hmacAudit(`ua\0${userAgent}`),
    ]);
    await ensureAudit(entities, {
      event_key: await sha256(`signature_claimed\0${context.tokenId}\0${input.documentId}\0${input.clientRequestId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'signature_claimed', actor_type: 'external_signer', request_id: input.clientRequestId,
      authority_version: context.signature.authority_version,
      document_content_sha256: context.signature.document_content_sha256,
      client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      occurred_at: now,
    });
    await ensureAudit(entities, {
      event_key: await sha256(`review_grant_claimed\0${context.grant.id}\0${operationId}`),
      agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      action: 'review_grant_claimed', actor_type: 'external_signer', request_id: input.clientRequestId,
      authority_version: context.grant.authority_version,
      document_content_sha256: context.signature.document_content_sha256,
      client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      occurred_at: now,
    });

    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.grant.authority_version !== grantClaim.version
        || Date.parse(context.token.claimed_at) <= Date.now() - CLAIM_LEASE_MS
        || Date.parse(context.grant.claimed_at) <= Date.now() - CLAIM_LEASE_MS) {
      throw new PublicError(409, 'Signing claim changed before upload');
    }
    // Persist the irreversible boundary before invoking private storage. An
    // unacknowledged marker or upload must never make stale takeover re-upload.
    irreversible = true;
    const uploadStartedAt = new Date().toISOString();
    const uploadStart = await entities.DocumentPackageToken.updateMany({
      id: context.tokenId, token: tokenDigest, status: 'claimed', is_active: true,
      authority_version: tokenClaim.version, claimed_by_operation_id: operationId,
      claimed_by_request_id: input.clientRequestId, claimed_document_id: input.documentId,
      submission_upload_operation_id: null, submission_upload_started_at: null,
    }, { $set: { submission_upload_operation_id: operationId, submission_upload_started_at: uploadStartedAt,
      authority_version: tokenClaim.version + 1 } });
    if (!successfulSingleUpdate(uploadStart)) throw new PublicError(409, 'Signature upload boundary requires reconciliation');
    tokenClaim.version += 1;
    uploadMarkerConfirmed = true;
    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.token.submission_upload_operation_id !== operationId
        || context.token.submission_upload_started_at !== uploadStartedAt) {
      throw new PublicError(409, 'Signature upload boundary requires reconciliation');
    }
    storageInvoked = true;
    const upload = await base44.asServiceRole.integrations.Core.UploadPrivateFile({ file: input.file });
    const fileUri = typeof upload?.file_uri === 'string' ? upload.file_uri : '';
    if (!fileUri || !isPrivateFileUri(fileUri) || fileUri.length > 4096) {
      throw new Error('Private signature upload failed');
    }
    context = await loadContext(entities, input, tokenDigest, grantDigest, agreementTextDigest, operationId);
    if (!context.tokenClaimedForOperation || !context.grantClaimedForOperation
        || context.token.authority_version !== tokenClaim.version
        || context.token.submission_upload_operation_id !== operationId) {
      throw new PublicError(409, 'Signature authority changed during upload');
    }
    const artifact = await entities.SignatureArtifactBinding.create({
      artifact_key: artifactKey, agency_id: context.agencyId, package_id: context.packageId,
      document_signature_id: input.documentId, signer_id: context.signerId, token_id: context.tokenId,
      client_request_id: input.clientRequestId, storage_mode: 'private', file_uri: fileUri,
      file_type: input.fileType, file_size: input.file.size, content_sha256: signatureDigest,
      typed_name_hmac_sha256: typedNameDigest, agreement_version: input.agreementVersion,
      agreement_text_sha256: agreementTextDigest,
      source_document_sha256: context.signature.document_content_sha256,
      document_binding_id: context.signature.document_binding_id,
      document_binding_version: context.signature.document_binding_version,
      client_ip_sha256: clientIpDigest, user_agent_sha256: userAgentDigest,
      created_at: now, binding_verified_at: now, version: 1,
    });
    const artifactId = exactIdentifier(artifact?.id);
    if (!artifactId) throw new Error('Signature artifact binding could not be persisted');
    const artifactReadback = await exactOne(entities.SignatureArtifactBinding,
      { id: artifactId, artifact_key: artifactKey }, 'SignatureArtifactBinding');
    validateArtifact(
      artifactReadback, context, input, artifactKey, signatureDigest, typedNameDigest, agreementTextDigest,
    );

    await recordArtifactOnSignature(
      entities, context, input, artifactId, signatureDigest, now,
    );
    const result = await finalizeRecordedSignature(
      entities, context, input, tokenDigest, grantDigest, artifactId, signatureDigest, now,
      clientIpDigest, userAgentDigest,
    );
    return Response.json({
      success: true, idempotent: false, document_id: input.documentId,
      signature_collected: result.signatureCollected,
      document_completed: result.documentCompleted, all_signed: result.allSigned,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    // This invocation knows storage was never called. Clear only its confirmed
    // marker with the exact current revision; an uncertain marker write or any
    // started storage call still retains the irreversible boundary.
    if (uploadMarkerConfirmed && !storageInvoked && tokenClaim && cleanupEntities) {
      try {
        const cleared = await cleanupEntities.DocumentPackageToken.updateMany({
          id: tokenClaim.id, token: tokenClaim.tokenDigest, status: 'claimed',
          claimed_by_operation_id: tokenClaim.operationId, claimed_document_id: tokenClaim.documentId,
          submission_upload_operation_id: tokenClaim.operationId, authority_version: tokenClaim.version,
        }, { $set: { submission_upload_operation_id: null, submission_upload_started_at: null,
          authority_version: tokenClaim.version + 1 } });
        if (successfulSingleUpdate(cleared)) {
          tokenClaim.version += 1;
          irreversible = false;
        }
      } catch { /* unknown acknowledgement retains reconciliation semantics */ }
    }
    // Before private upload, claims can safely be returned to active. After an
    // upload or write, retain them so a retry with the same client_request_id
    // reconciles instead of recording a second legal act.
    if (!irreversible && (tokenClaim || grantClaim)) {
      try {
        if (!cleanupEntities) throw new Error('Signature cleanup authority is unavailable');
        const entities = cleanupEntities;
        if (tokenClaim) {
          await entities.DocumentPackageToken.updateMany(
            { id: tokenClaim.id, token: tokenClaim.tokenDigest, status: 'claimed',
              claimed_by_operation_id: tokenClaim.operationId,
              claimed_document_id: tokenClaim.documentId, authority_version: tokenClaim.version },
            { $set: { status: 'active', claimed_at: null, claimed_by_request_id: null,
              claimed_by_operation_id: null, claimed_document_id: null,
              authority_version: tokenClaim.version + 1 } },
          );
        }
        if (grantClaim) {
          await entities.SignerReviewGrant.updateMany(
            { id: grantClaim.id, grant_key: grantClaim.grantDigest, status: 'claimed',
              claimed_by_operation_id: grantClaim.operationId,
              claimed_document_id: grantClaim.documentId, authority_version: grantClaim.version },
            { $set: { status: 'active', claimed_at: null, claimed_by_request_id: null,
              claimed_by_operation_id: null, claimed_document_id: null,
              authority_version: grantClaim.version + 1 } },
          );
        }
      } catch { /* fail closed; a claimed capability cannot be replayed */ }
    }
    const status = irreversible ? 202 : error instanceof PublicError ? error.status : 500;
    const message = irreversible
      ? 'Signature submission requires reconciliation; do not sign again with a new request'
      : error instanceof PublicError ? error.message : 'Unable to record signature';
    return Response.json({ error: message, requires_reconciliation: irreversible }, {
      status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  }
});
