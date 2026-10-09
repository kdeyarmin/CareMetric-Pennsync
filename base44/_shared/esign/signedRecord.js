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
