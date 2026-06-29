import { base44 } from '@/api/base44Client';

/**
 * Verify a signature's tamper-evidence MAC SERVER-SIDE.
 *
 * The previous client-side `verifySignatureIntegrity` recomputed a keyless 32-bit
 * hash that anyone could forge, and read it from a top-level field the capture
 * never wrote — so it provided no real assurance and reported every captured
 * record as invalid. Verification now runs in the `signatureIntegrity` backend
 * function, which recomputes the MAC over the stored record with a server-held
 * secret and returns a verdict.
 *
 * @param {string} signatureId - DocumentSignature id
 * @returns {Promise<{isValid: boolean, status: string, alg?: string, reason?: string}>}
 */
export async function verifySignatureIntegrityRemote(signatureId) {
  if (!signatureId) return { isValid: false, status: 'unsigned' };
  try {
    const resp = await base44.functions.invoke('signatureIntegrity', {
      action: 'verify',
      signature_id: signatureId,
    });
    const data = resp?.data || {};
    return {
      isValid: Boolean(data.isValid),
      status: data.status || (data.isValid ? 'valid' : 'tampered'),
      alg: data.alg,
      reason: data.reason,
    };
  } catch (err) {
    console.error('Signature integrity verification failed:', err?.message);
    return { isValid: false, status: 'error' };
  }
}

export function getDocumentDisplayName(signatureRecord) {
  return (
    signatureRecord?.document_name
    || signatureRecord?.document_title
    || signatureRecord?.template_name
    || signatureRecord?.packet_name
    || signatureRecord?.document_type
    || 'Document'
  );
}

export function getSignatureDueDate(signatureRecord) {
  return signatureRecord?.due_date || signatureRecord?.expires_at || null;
}

export function getSignatureSignedAt(signatureRecord) {
  return signatureRecord?.signed_at || signatureRecord?.signed_date || signatureRecord?.completed_date || null;
}

export function getSignerProgress(signatureRecord) {
  const signers = Array.isArray(signatureRecord?.signers) && signatureRecord.signers.length > 0
    ? signatureRecord.signers
    : Array.isArray(signatureRecord?.required_signatures)
      ? signatureRecord.required_signatures.map((signer, index) => ({
          id: signer.signer_id || signer.id || `${index}`,
          required: signer.is_required !== false,
          signature: signer.signature,
          signed_date: signer.signed_date,
          is_signed: signer.is_signed,
        }))
      : [];

  const requiredSigners = signers.filter((signer) => signer.required !== false);
  const signedRequiredCount = requiredSigners.filter((signer) => signer.signature || signer.signed_date || signer.is_signed).length;

  return {
    totalSigners: signers.length,
    requiredSigners: requiredSigners.length,
    signedRequiredCount,
    allRequiredSigned: requiredSigners.length > 0 && signedRequiredCount === requiredSigners.length,
  };
}

export function getNormalizedSignatureStatus(signatureRecord) {
  const explicitStatus = signatureRecord?.status;

  if (explicitStatus === 'signed' || explicitStatus === 'completed') {
    return 'signed';
  }

  if (explicitStatus === 'rejected') {
    return 'declined';
  }

  if (explicitStatus === 'declined' || explicitStatus === 'expired') {
    return explicitStatus;
  }

  if (signatureRecord?.signature_data && getSignatureSignedAt(signatureRecord)) {
    return 'signed';
  }

  const progress = getSignerProgress(signatureRecord);
  if (progress.allRequiredSigned) {
    return 'signed';
  }

  return explicitStatus || 'pending';
}

export function getSignatureStatusLabel(signatureRecord) {
  const status = typeof signatureRecord === 'string'
    ? signatureRecord
    : getNormalizedSignatureStatus(signatureRecord);

  switch (status) {
    case 'signed':
      return 'Signed';
    case 'declined':
      return 'Declined';
    case 'expired':
      return 'Expired';
    case 'in_progress':
      return 'In Progress';
    default:
      return 'Pending';
  }
}

export function isSignatureOverdue(signatureRecord) {
  const dueDate = getSignatureDueDate(signatureRecord);
  const normalizedStatus = typeof signatureRecord === 'string'
    ? signatureRecord
    : getNormalizedSignatureStatus(signatureRecord);

  return Boolean(
    dueDate
    && normalizedStatus !== 'signed'
    && normalizedStatus !== 'declined'
    && normalizedStatus !== 'expired'
    && new Date(dueDate) < new Date()
  );
}
