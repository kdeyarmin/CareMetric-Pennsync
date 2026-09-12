import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

/** Token-authenticated, projection-only signing review broker (release-gated). */
const PUBLIC_SIGNATURE_RELEASE_ENABLED = false;
const MAX_BODY_BYTES = 2_000;
const EXACT_ROW_LIMIT = 10;
const MAX_IDENTIFIER_LENGTH = 200;
const MAX_PACKAGE_DOCUMENTS = 25;
const SIGNED_URL_TTL_SECONDS = 60;
const REVIEW_GRANT_TTL_MS = 10 * 60 * 1000;
const AGREEMENT_VERSION = 'signature-consent-v1';
const MAX_REVIEW_ACCESSES = 20;

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

function exactDigest(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value) ? value : null;
}

async function configuredAgreement() {
  const digest = String(Deno.env.get('SIGNATURE_AGREEMENT_SHA256') || '').trim().toLowerCase();
  const text = String(Deno.env.get('SIGNATURE_AGREEMENT_TEXT') || '').trim();
  if (!exactDigest(digest) || text.length < 40 || text.length > 5_000 || await sha256(text) !== digest) {
    throw new PublicError(500, 'Signature agreement is not configured');
  }
  return { digest, text };
}

function requireRows(value: unknown, label: string) {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value as Array<Record<string, any>>;
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

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
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

async function sha256Bytes(bytes: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string) {
  return sha256Bytes(new TextEncoder().encode(value));
}

// <<<BEGIN SHARED HELPER: signatureAuditKeys — generated, edit base44/_shared/backendHelpers.mjs>>>
function signatureAuditKeyId(value) {
  if (value == null) return 'legacy';
  if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(value)) throw new PublicError(500, 'Signature audit key identity is invalid');
  return value;
}

function signatureAuditKeyring() {
  const configured = Deno.env.get('SIGNATURE_HMAC_KEYRING');
  if (!configured) {
    if (Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID')) throw new PublicError(500, 'Signature audit keyring is not configured');
    const secret = String(Deno.env.get('SIGNATURE_HMAC_SECRET') || '');
    if (secret.length < 32 || secret.length > 1024) throw new PublicError(500, 'Signature audit is not configured');
    return { activeId: 'legacy', keys: { legacy: secret } };
  }
  let keys;
  if (configured.length > 16384) throw new PublicError(500, 'Signature audit keyring is invalid');
  try { keys = JSON.parse(configured); } catch { throw new PublicError(500, 'Signature audit keyring is invalid'); }
  if (!keys || typeof keys !== 'object' || Array.isArray(keys) || Object.keys(keys).length < 1 || Object.keys(keys).length > 8) {
    throw new PublicError(500, 'Signature audit keyring is invalid');
  }
  for (const [id, secret] of Object.entries(keys)) {
    signatureAuditKeyId(id);
    if (typeof secret !== 'string' || secret.length < 32 || secret.length > 1024) throw new PublicError(500, 'Signature audit keyring is invalid');
  }
  const activeId = Deno.env.get('SIGNATURE_HMAC_ACTIVE_KEY_ID');
  if (!activeId || !Object.hasOwn(keys, signatureAuditKeyId(activeId))) throw new PublicError(500, 'Signature audit active key is unavailable');
  return { activeId, keys };
}

function retainedSignatureAuditKey(keyring, id) {
  const keyId = signatureAuditKeyId(id);
  if (!Object.hasOwn(keyring.keys, keyId)) throw new PublicError(500, 'Signature audit verification key is unavailable');
  return keyring.keys[keyId];
}

async function hmacAudit(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  // Preserve the historical digest representation for existing artifacts.
  return sha256Bytes(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}
// <<<END SHARED HELPER: signatureAuditKeys>>>

function generateOpaqueSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function parseToken(req: Request) {
  if (req.method !== 'POST') throw new PublicError(405, 'Method not allowed');
  const statedLength = Number(req.headers.get('content-length'));
  if (Number.isFinite(statedLength) && statedLength > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  const raw = await req.text().catch(() => { throw new PublicError(400, 'Invalid JSON body'); });
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) throw new PublicError(413, 'Request body is too large');
  let body: unknown;
  try { body = JSON.parse(raw); } catch { throw new PublicError(400, 'Invalid JSON body'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'token')) throw new PublicError(400, 'Invalid request body');
  const token = (body as Record<string, unknown>).token;
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new PublicError(401, 'Invalid or expired token');
  return token;
}

function validateSigner(raw: unknown, signerId: string, signerEmail: string) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicError(409, 'Signer authority is invalid');
  const signer = raw as Record<string, any>;
  if (signer.signer_id !== signerId || canonicalEmail(signer.email) !== signerEmail || signer.email !== signerEmail
      || typeof signer.signer_name !== 'string' || !signer.signer_name.trim() || signer.signer_name.length > 200
      || signer.required !== true || !['pending', 'completed', 'declined'].includes(signer.status)
      || signer.signature_data != null || signer.ip_address != null || signer.device_info != null) {
    throw new PublicError(409, 'Signer authority is invalid');
  }
  if (signer.status === 'completed' && (!validInstant(signer.signed_at)
      || !exactIdentifier(signer.signature_artifact_id) || !exactDigest(signer.signature_sha256)
      || !exactIdentifier(signer.agreement_version))) throw new PublicError(409, 'Signer completion integrity is invalid');
  if (signer.status !== 'completed' && (signer.signed_at != null || signer.signature_artifact_id != null
      || signer.signature_sha256 != null || signer.agreement_version != null)) {
    throw new PublicError(409, 'Signer completion integrity is invalid');
  }
  return signer;
}

function validateCanonicalSigner(raw: unknown) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new PublicError(409, 'Signer authority is invalid');
  const candidate = raw as Record<string, any>;
  const signerId = exactIdentifier(candidate.signer_id);
  const signerEmail = canonicalEmail(candidate.email);
  if (!signerId || !signerEmail) throw new PublicError(409, 'Signer authority is invalid');
  return validateSigner(candidate, signerId, signerEmail);
}

async function loadTokenContext(entities: Record<string, any>, tokenDigest: string) {
  const tokenRows = requireRows(await entities.DocumentPackageToken.filter(
    { token: tokenDigest, token_hashed: true }, '-created_date', EXACT_ROW_LIMIT,
  ), 'DocumentPackageToken.filter');
  if (tokenRows.length !== 1 || tokenRows.some((row) => row?.token !== tokenDigest || row?.token_hashed !== true)) {
    throw new PublicError(401, 'Invalid or expired token');
  }
  const token = tokenRows[0];
  const tokenId = exactIdentifier(token.id);
  const agencyId = exactIdentifier(token.agency_id);
  const packageId = exactIdentifier(token.package_id);
  const signerId = exactIdentifier(token.signer_id);
  const signerEmail = canonicalEmail(token.signer_email);
  const documentIds = Array.isArray(token.document_ids) ? token.document_ids.map(exactIdentifier) : [];
  if (!tokenId || !agencyId || !packageId || !signerId || !signerEmail || token.signer_email !== signerEmail
      || token.status !== 'active' || token.is_active !== true || token.token_hashed !== true
      || !Number.isSafeInteger(token.authority_version) || token.authority_version < 1
      || !Number.isSafeInteger(token.access_count) || token.access_count < 0 || token.access_count > MAX_REVIEW_ACCESSES
      || !validInstant(token.token_created_at) || !validInstant(token.expires_at)
      || documentIds.length < 1 || documentIds.length > MAX_PACKAGE_DOCUMENTS || documentIds.includes(null)
      || new Set(documentIds).size !== documentIds.length || !exactIdentifier(token.token_request_id)) {
    throw new PublicError(401, 'Invalid or expired token');
  }
  if (Date.now() >= Date.parse(token.expires_at)) {
    await entities.DocumentPackageToken.updateMany(
      { id: tokenId, token: tokenDigest, status: 'active', authority_version: token.authority_version },
      { $set: { status: 'expired', is_active: false, authority_version: token.authority_version + 1 } },
    ).catch(() => null);
    throw new PublicError(401, 'Invalid or expired token');
  }

  const packages = requireRows(await entities.DocumentPackage.filter(
    { id: packageId, agency_id: agencyId }, undefined, EXACT_ROW_LIMIT,
  ), 'DocumentPackage.filter');
  if (packages.length !== 1 || packages[0]?.id !== packageId || packages[0]?.agency_id !== agencyId) {
    throw new PublicError(401, 'Invalid or expired token');
  }
  const pkg = packages[0];
  const liveIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures.map(exactIdentifier) : [];
  const patientId = exactIdentifier(pkg.patient_id);
  const creatorId = exactIdentifier(pkg.created_by_user_id);
  const creatorEmail = canonicalEmail(pkg.created_by_user_email_normalized);
  const creatorMembershipId = exactIdentifier(pkg.creator_membership_id);
  if (!patientId || !creatorId || !creatorEmail || !creatorMembershipId
      || pkg.created_by_user_email_normalized !== creatorEmail
      || pkg.signer_id !== signerId || canonicalEmail(pkg.signer_email) !== signerEmail
      || !Number.isSafeInteger(pkg.creator_membership_version) || pkg.creator_membership_version < 1
      || !Number.isSafeInteger(pkg.authority_version) || pkg.authority_version < 1
      || !['pending', 'in_progress'].includes(pkg.status)
      || liveIds.includes(null) || !sameValue(liveIds, documentIds)) {
    throw new PublicError(401, 'Invalid or expired token');
  }
  const agencies = requireRows(await entities.Agency.filter({ id: agencyId }, undefined, EXACT_ROW_LIMIT), 'Agency.filter');
  if (agencies.length !== 1 || !['active', 'trial'].includes(agencies[0]?.status)) throw new PublicError(401, 'Invalid or expired token');
  const memberships = requireRows(await entities.AgencyMembership.filter(
    { id: creatorMembershipId, agency_id: agencyId, user_id: creatorId }, undefined, EXACT_ROW_LIMIT,
  ), 'AgencyMembership.filter');
  if (memberships.length !== 1 || memberships[0].status !== 'active'
      || memberships[0].version !== pkg.creator_membership_version
      || canonicalEmail(memberships[0].user_email_normalized) !== creatorEmail) {
    throw new PublicError(401, 'Invalid or expired token');
  }
  const patients = requireRows(await entities.Patient.filter(
    { id: patientId, agency_id: agencyId, is_sample: false, is_archived: false }, undefined, EXACT_ROW_LIMIT,
  ), 'Patient.filter');
  if (patients.length !== 1 || patients[0]?.id !== patientId || patients[0]?.agency_id !== agencyId) {
    throw new PublicError(401, 'Invalid or expired token');
  }

  const documents: Array<Record<string, any>> = [];
  const authoritySignatures: Array<Record<string, any>> = [];
  for (const signatureId of documentIds as string[]) {
    const signatureRows = requireRows(await entities.DocumentSignature.filter(
      { id: signatureId, agency_id: agencyId }, undefined, EXACT_ROW_LIMIT,
    ), 'DocumentSignature.filter');
    if (signatureRows.length !== 1 || signatureRows[0]?.id !== signatureId || signatureRows[0]?.agency_id !== agencyId) {
      throw new PublicError(401, 'Invalid or expired token');
    }
    const signature = signatureRows[0];
    authoritySignatures.push(signature);
    const signers = (Array.isArray(signature.signers) ? signature.signers : [])
      .map(validateCanonicalSigner);
    if (new Set(signers.map((candidate) => candidate.signer_id)).size !== signers.length) {
      throw new PublicError(401, 'Invalid or expired token');
    }
    const signer = signers.find((candidate) => candidate.signer_id === signerId);
    const bindingId = exactIdentifier(signature.document_binding_id);
    const documentId = exactIdentifier(signature.document_id);
    if (!signer || signature.patient_id !== patientId || signature.created_by_user_id !== creatorId
        || canonicalEmail(signature.created_by_user_email_normalized) !== creatorEmail
        || signature.creator_membership_id !== creatorMembershipId
        || signature.creator_membership_version !== pkg.creator_membership_version
        || !bindingId || !documentId || signature.document_binding_version !== 2
        || !exactDigest(signature.document_content_sha256)
        || !Number.isSafeInteger(signature.authority_version) || signature.authority_version < 1
        || !['pending', 'in_progress', 'completed'].includes(signature.status)
        || signature.document_url != null || signature.document_content != null || signature.signed_pdf_url != null) {
      throw new PublicError(401, 'Invalid or expired token');
    }
    const bindings = requireRows(await entities.DocumentTenantBinding.filter(
      { id: bindingId, agency_id: agencyId, document_id: documentId }, undefined, EXACT_ROW_LIMIT,
    ), 'DocumentTenantBinding.filter');
    const binding = bindings[0];
    if (bindings.length !== 1 || binding?.id !== bindingId || binding?.patient_id !== patientId
        || binding?.storage_mode !== 'private' || binding?.version !== 2
        || binding?.content_sha256 !== signature.document_content_sha256
        || typeof binding?.file_uri !== 'string'
        || !isPrivateFileUri(binding.file_uri)) {
      throw new PublicError(401, 'Invalid or expired token');
    }
    documents.push({
      id: signatureId,
      name: String(signature.document_title || signature.document_name || 'Document').slice(0, 200),
      status: signer.status,
      signed_at: signer.signed_at ?? null,
      authority_version: signature.authority_version,
      document_content_sha256: signature.document_content_sha256,
      signature_authority_version: signature.authority_version,
      signer_roster_sha256: await sha256(JSON.stringify(canonicalJson(signerAuthorityRoster(signers)))),
      file_uri: binding.file_uri,
      binding_id: binding.id,
      binding_version: binding.version,
    });
  }
  const deadline = currentDeadline(token, pkg, authoritySignatures);
  return {
    token: {
      id: tokenId, agency_id: agencyId, package_id: packageId, signer_id: signerId,
      signer_email: signerEmail, signer_name: token.signer_name,
      expires_at: token.expires_at, authority_version: token.authority_version,
      access_count: token.access_count,
    },
    package: {
      id: packageId, agency_id: agencyId, patient_id: patientId, package_name: pkg.package_name,
      due_date: pkg.due_date, status: pkg.status, authority_version: pkg.authority_version,
      document_signatures: liveIds,
    },
    documents,
    deadline,
  };
}

async function claimReviewAccess(entities: Record<string, any>, tokenDigest: string, initial: Record<string, any>) {
  if (initial.token.access_count >= MAX_REVIEW_ACCESSES) {
    throw new PublicError(429, 'This signing link has reached its review limit; request a new link');
  }
  const result = await entities.DocumentPackageToken.updateMany({
    id: initial.token.id, token: tokenDigest, token_hashed: true,
    status: 'active', is_active: true, authority_version: initial.token.authority_version,
    access_count: initial.token.access_count, expires_at: initial.token.expires_at,
  }, { $set: {
    access_count: initial.token.access_count + 1,
    authority_version: initial.token.authority_version + 1,
    last_accessed_at: new Date().toISOString(),
  } });
  if (result?.success !== true || result?.updated !== 1 || result?.has_more !== false) {
    throw new PublicError(409, 'Signing access changed; retry document review');
  }
  const expected = { ...initial, token: { ...initial.token,
    access_count: initial.token.access_count + 1, authority_version: initial.token.authority_version + 1,
  } };
  const confirmed = await loadTokenContext(entities, tokenDigest);
  if (!sameValue(expected, confirmed)) throw new PublicError(409, 'Signing authority changed during document review');
  return confirmed;
}

Deno.serve(async (req) => {
  if (!PUBLIC_SIGNATURE_RELEASE_ENABLED) {
    return Response.json(
      { error: 'Secure document review and signing are temporarily unavailable.', code: 'signer_validation_unavailable' },
      { status: 503, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } },
    );
  }
  try {
    const token = await parseToken(req);
    const tokenDigest = await sha256(token);
    const agreement = await configuredAgreement();
    const auditKeys = signatureAuditKeyring();
    const auditKeyId = auditKeys.activeId;
    const auditKey = retainedSignatureAuditKey(auditKeys, auditKeyId);
    const base44 = createClientFromRequest(req);
    const entities = base44.asServiceRole.entities;
    const initial = await claimReviewAccess(entities, tokenDigest, await loadTokenContext(entities, tokenDigest));
    const requestId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    const ip = String(req.headers.get('cf-connecting-ip')
      || (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown').slice(0, 128);
    const userAgent = String(req.headers.get('user-agent') || 'unknown').slice(0, 512);
    const audit = await entities.SignatureAuditEvent.create({
      event_key: await sha256(`token_validated\0${initial.token.id}\0${requestId}`),
      agency_id: initial.token.agency_id, package_id: initial.package.id,
      signer_id: initial.token.signer_id, token_id: initial.token.id,
      action: 'token_validated', actor_type: 'external_signer', request_id: requestId,
      authority_version: initial.token.authority_version,
      hmac_key_id: auditKeyId, client_ip_sha256: await hmacAudit(`ip\0${ip}`, auditKey),
      user_agent_sha256: await hmacAudit(`ua\0${userAgent}`, auditKey), occurred_at: occurredAt,
    });
    if (!exactIdentifier(audit?.id)) throw new Error('Signature validation audit could not be recorded');

    const signedDocuments = [];
    for (const document of initial.documents) {
      if (document.status !== 'pending') continue;
      const reviewNonce = generateOpaqueSecret();
      const grantDigest = await sha256(reviewNonce);
      const grantExpiresAt = new Date(Math.min(
        Date.parse(initial.token.expires_at), Date.now() + REVIEW_GRANT_TTL_MS,
      )).toISOString();
      const grant = await entities.SignerReviewGrant.create({
        grant_key: grantDigest,
        agency_id: initial.token.agency_id,
        package_id: initial.package.id,
        document_signature_id: document.id,
        signer_id: initial.token.signer_id,
        token_id: initial.token.id,
        document_content_sha256: document.document_content_sha256,
        package_authority_version: initial.package.authority_version,
        document_authority_version: document.signature_authority_version,
        document_binding_id: document.binding_id,
        document_binding_version: document.binding_version,
        signer_roster_sha256: document.signer_roster_sha256,
        agreement_text_sha256: agreement.digest,
        hmac_key_id: auditKeyId,
        status: 'active',
        authority_version: 1,
        issued_at: occurredAt,
        expires_at: grantExpiresAt,
      });
      const grantId = exactIdentifier(grant?.id);
      if (!grantId) throw new Error('Review grant could not be persisted');
      const grantReadback = requireRows(await entities.SignerReviewGrant.filter(
        { id: grantId, grant_key: grantDigest, token_id: initial.token.id, document_signature_id: document.id },
        undefined, EXACT_ROW_LIMIT,
      ), 'SignerReviewGrant.filter');
      if (grantReadback.length !== 1 || grantReadback[0]?.status !== 'active'
          || grantReadback[0]?.authority_version !== 1
          || grantReadback[0]?.document_content_sha256 !== document.document_content_sha256
          || grantReadback[0]?.package_authority_version !== initial.package.authority_version
          || grantReadback[0]?.document_authority_version !== document.signature_authority_version
          || grantReadback[0]?.signer_roster_sha256 !== document.signer_roster_sha256
          || grantReadback[0]?.agreement_text_sha256 !== agreement.digest
          || grantReadback[0]?.hmac_key_id !== auditKeyId) {
        throw new Error('Review grant persistence could not be verified');
      }
      const grantAudit = await entities.SignatureAuditEvent.create({
        event_key: await sha256(`review_grant_issued\0${grantId}\0${requestId}`),
        agency_id: initial.token.agency_id, package_id: initial.package.id,
        document_signature_id: document.id, signer_id: initial.token.signer_id,
        token_id: initial.token.id, action: 'review_grant_issued',
        actor_type: 'external_signer', request_id: requestId, authority_version: 1,
        document_content_sha256: document.document_content_sha256,
        hmac_key_id: auditKeyId, client_ip_sha256: await hmacAudit(`ip\0${ip}`, auditKey),
        user_agent_sha256: await hmacAudit(`ua\0${userAgent}`, auditKey), occurred_at: occurredAt,
      });
      if (!exactIdentifier(grantAudit?.id)) throw new Error('Review grant audit could not be recorded');
      const result = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: document.file_uri,
        expires_in: SIGNED_URL_TTL_SECONDS,
      });
      let parsed: URL;
      try { parsed = new URL(result?.signed_url); } catch { throw new Error('Private document delivery failed'); }
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Private document delivery failed');
      signedDocuments.push({
        id: document.id, name: document.name, status: document.status,
        signed_at: document.signed_at, review_url: parsed.toString(), review_nonce: reviewNonce,
        review_nonce_expires_at: grantExpiresAt,
        review_url_expires_in_seconds: SIGNED_URL_TTL_SECONDS,
      });
    }
    const final = await loadTokenContext(entities, tokenDigest);
    if (!sameValue(initial, final)) throw new PublicError(409, 'Signing authority changed during document review');

    return Response.json({
      valid: true, package_id: initial.package.id, package_name: initial.package.package_name,
      package_status: initial.package.status, due_date: initial.package.due_date,
      signer_id: initial.token.signer_id, signer_name: initial.token.signer_name,
      agreement: { version: AGREEMENT_VERSION, text: agreement.text, sha256: agreement.digest },
      documents: signedDocuments, expires_at: initial.token.expires_at,
    }, { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } });
  } catch (error) {
    const status = error instanceof PublicError ? error.status : 500;
    const message = error instanceof PublicError ? error.message : 'Unable to validate token';
    return Response.json({ error: message, valid: false }, {
      status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' },
    });
  }
});
