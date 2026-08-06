import { isPastLocalDueDate } from '@/lib/dateLocal';

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

  // Date-only due_date/expires_at must compare on the local calendar — UTC
  // midnight parsing flagged packets overdue the evening before the due day.
  return Boolean(
    dueDate
    && normalizedStatus !== 'signed'
    && normalizedStatus !== 'declined'
    && normalizedStatus !== 'expired'
    && isPastLocalDueDate(dueDate)
  );
}
