// Sealing pipeline for one DocumentSignature whose required signers have all
// signed. It re-reads the private source bytes and every private signature
// image, refuses any byte that no longer matches its recorded SHA-256, renders
// the signatures into their placed fields plus a certificate page, hashes the
// exact sealed bytes, files the sealed PDF into the patient's chart through the
// chart-document invariants, and only then marks the document (and any package
// whose every document is sealed) completed. A short lease on the row makes it
// single-writer; every step is idempotent so a retry resumes.
const ESIGN_FINALIZE_LEASE_MS = 10 * 60 * 1000;

async function esignActiveMember(entities, agencyId, userId, email) {
  if (!esignId(userId) || !email) return null;
  const rows = await entities.AgencyMembership.filter({ agency_id: agencyId, user_id: userId }, '-updated_date', ESIGN_ROW_LIMIT)
    .catch(() => null);
  if (!Array.isArray(rows) || rows.length !== 1) return null;
  const row = rows[0];
  return row?.agency_id === agencyId && row?.user_id === userId && row?.status === 'active'
    && row?.membership_key === agencyId + ':' + userId && esignEmail(row?.user_email_normalized) === email
    && Number.isSafeInteger(row?.version) && row.version >= 1 ? row : null;
}

// A request's documents share request_key; its packages share (agency_id,
// created_by_user_id, client_request_id) with the signature row.
async function esignSyncRequestPackages(entities, agencyId, row) {
  const requestKey = row?.request_key;
  if (!esignDigest(requestKey)) return 0;
  const signatures = esignRows(await entities.DocumentSignature.filter(
    { agency_id: agencyId, request_key: requestKey }, undefined, 50,
  ), 'DocumentSignature.filter');
  const byId = new Map(signatures.filter((doc) => doc?.agency_id === agencyId && doc?.request_key === requestKey)
    .map((doc) => [doc.id, doc]));
  const packages = await esignLoadRequestPackages(entities, agencyId, row.created_by_user_id, row.client_request_id);
  let completed = 0;
  for (const pkg of packages) {
    if (!['pending', 'in_progress'].includes(pkg.status) || !Number.isSafeInteger(pkg.authority_version)) continue;
    const ids = Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [];
    if (!ids.length || !ids.every((id) => byId.get(id)?.status === 'completed')) continue;
    const result = await entities.DocumentPackage.updateMany(
      { id: pkg.id, agency_id: agencyId, status: pkg.status, authority_version: pkg.authority_version },
      { $set: { status: 'completed', completed_at: new Date().toISOString(), authority_version: pkg.authority_version + 1 } },
    ).catch(() => null);
    if (esignSingleUpdate(result)) completed += 1;
  }
  return completed;
}

function esignCompletionEmailHtml() {
  const origin = String(Deno.env.get('APP_PUBLIC_URL') || '').trim();
  let link = '';
  try {
    const url = new URL(origin);
    if (url.protocol === 'https:' && !url.username && !url.password) link = url.origin + '/DocumentHub';
  } catch { link = ''; }
  return '<!doctype html><html><body>'
    + '<p>A document you sent for electronic signature has been signed by every required signer.</p>'
    + '<p>The sealed signed PDF and its signature certificate are filed to the patient’s chart in PennSync.</p>'
    + (link ? '<p><a href="' + link + '">Open the Document Hub</a></p>' : '<p>Sign in to PennSync to view it.</p>')
    + '<p>This message intentionally contains no patient or signer details.</p></body></html>';
}

// In-app notification (always, idempotent by dedupe_key) and one email (only
// when outbound delivery is released). Neither names the patient or signer.
async function esignNotifyCreator(base44, row, options) {
  const entities = base44.asServiceRole.entities;
  if (row?.status !== 'completed' || !esignId(row?.id)) return { notified: false, emailed: false };
  const creatorEmail = esignEmail(row.created_by_user_email_normalized);
  const recipient = await esignActiveMember(entities, row.agency_id, row.created_by_user_id, creatorEmail);
  if (!recipient) return { notified: false, emailed: false };
  const dedupeKey = 'esign-completed:' + row.agency_id + ':' + row.id;
  const existing = esignRows(await entities.Notification.filter({ dedupe_key: dedupeKey }, '-created_date', 5),
    'Notification.filter');
  let notified = existing.length > 0;
  if (!notified) {
    await entities.Notification.create({
      agency_id: row.agency_id,
      dedupe_key: dedupeKey,
      recipient_user_id: recipient.user_id,
      recipient_membership_id: recipient.id,
      recipient_membership_version: recipient.version,
      authority_version: 1,
      authority_state: 'active',
      version: 1,
      user_email: recipient.user_email_normalized,
      title: 'Signature request completed',
      message: 'Every required signer has signed. The sealed signed PDF and its certificate are filed to the patient chart.',
      type: 'signature_request',
      priority: 'medium',
      metadata: {
        agency_id: row.agency_id, related_entity: 'DocumentSignature',
        related_entity_id: row.id, workflow: 'esign_completed',
      },
      is_read: false,
      dismissed: false,
      action_url: '/DocumentHub?tab=signatures',
    });
    notified = true;
  }
  let emailed = row.admin_notified === true;
  if (!emailed && outboundDeliveryReleased()) {
    const claimId = crypto.randomUUID();
    const claimFilter = options?.forceEmail
      ? { id: row.id, agency_id: row.agency_id, status: 'completed' }
      : { id: row.id, agency_id: row.agency_id, status: 'completed', admin_notify_claimed_by: null };
    const claim = await entities.DocumentSignature.updateMany(claimFilter,
      { $set: { admin_notify_claimed_by: claimId } }).catch(() => null);
    if (esignSingleUpdate(claim)) {
      // A provider exception is indeterminate: the claim stays, so no automatic
      // resend happens; notifyAdminOfSignedDocument can resend deliberately.
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: recipient.user_email_normalized,
        from_name: 'PennSync by CareMetric',
        subject: 'A signature request is complete',
        body: esignCompletionEmailHtml(),
      });
      await entities.DocumentSignature.updateMany(
        { id: row.id, agency_id: row.agency_id, admin_notify_claimed_by: claimId },
        { $set: { admin_notified: true } },
      ).catch(() => null);
      emailed = true;
    }
  }
  return { notified, emailed };
}

/**
 * Seal one document. actor: { type: 'system'|'authenticated_user'|'scheduler',
 *   userId?, membershipId?, membershipVersion? }.
 * Returns { state: 'completed'|'already_completed'|'not_ready'|'busy', row, ... }.
 */
async function esignFinalizeSignature(base44, input) {
  const entities = base44.asServiceRole.entities;
  const agencyId = esignId(input?.agencyId);
  const signatureId = esignId(input?.signatureId);
  if (!agencyId || !signatureId) throw new EsignError(400, 'Exact agency and document ids are required');
  let row = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 404);
  if (row.status === 'completed' && row.workflow_status === 'completed' && esignId(row.signed_document_id)) {
    await esignSyncRequestPackages(entities, agencyId, row).catch(() => 0);
    await esignNotifyCreator(base44, row).catch(() => null);
    return { state: 'already_completed', row };
  }
  if (row.status !== 'in_progress' || row.workflow_status !== 'signatures_collected'
    || !Number.isSafeInteger(row.authority_version)) return { state: 'not_ready', row };
  const roster = Array.isArray(row.signers) ? row.signers : [];
  if (!roster.length || roster.some((signer) => signer?.required === true && signer?.status !== 'completed')) {
    return { state: 'not_ready', row };
  }
  if (esignId(row.finalize_claimed_by) && esignInstant(row.finalize_claimed_at)
    && Date.parse(row.finalize_claimed_at) > Date.now() - ESIGN_FINALIZE_LEASE_MS) {
    return { state: 'busy', row };
  }
  const creator = {
    userId: esignId(row.created_by_user_id),
    email: esignEmail(row.created_by_user_email_normalized),
    membershipId: esignId(row.creator_membership_id),
    membershipVersion: row.creator_membership_version,
  };
  if (!creator.userId || !creator.email || !creator.membershipId
    || !Number.isSafeInteger(creator.membershipVersion) || creator.membershipVersion < 1) {
    throw new EsignError(409, 'Signature request creator provenance is invalid');
  }
  const claimId = crypto.randomUUID();
  const claimFilter = {
    id: signatureId, agency_id: agencyId, status: 'in_progress',
    workflow_status: 'signatures_collected', authority_version: row.authority_version,
  };
  const claim = await entities.DocumentSignature.updateMany(claimFilter, { $set: {
    finalize_claimed_by: claimId, finalize_claimed_at: new Date().toISOString(),
    authority_version: row.authority_version + 1,
  } });
  if (!esignSingleUpdate(claim)) return { state: 'busy', row };
  row = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 409);
  if (row.finalize_claimed_by !== claimId) return { state: 'busy', row };
  const claimedVersion = row.authority_version;
  try {
    const agency = await esignExactOne(entities.Agency, { id: agencyId }, 'Agency', 409);
    const completedAt = new Date().toISOString();
    const clientRequestId = 'esign-sealed-' + signatureId;
    const fileInput = {
      agencyId, patientId: row.patient_id, creator, clientRequestId,
      fileName: 'Signed ' + String(row.document_title || row.document_name || 'document'),
      render: () => esignRenderRow(base44, row, { preview: false, completedAt, agencyName: agency.agency_name }),
      extra: { is_signed: true, is_locked: true, description: 'Sealed electronic signature record' },
    };
    let filed;
    try {
      filed = await esignFileChartDocument(base44, fileInput);
    } catch (error) {
      if (!(error instanceof EsignError) || error.code !== 'filing_in_progress') throw error;
      // This invocation holds the exclusive sealing lease, so a reservation for
      // this filing key can only belong to a dead attempt.
      await esignClearStaleFiling(base44, agencyId, clientRequestId, creator.userId);
      filed = await esignFileChartDocument(base44, fileInput);
    }
    const sealedSha256 = filed.binding.content_sha256;
    const sealedAt = filed.binding.created_at || completedAt;
    const completion = await entities.DocumentSignature.updateMany(
      { id: signatureId, agency_id: agencyId, finalize_claimed_by: claimId,
        workflow_status: 'signatures_collected', authority_version: claimedVersion },
      { $set: {
        status: 'completed', workflow_status: 'completed',
        completed_at: sealedAt, completed_date: sealedAt, finalized_at: sealedAt,
        signature_hash: sealedSha256, signature_hash_alg: 'SHA-256', signature_hash_at: sealedAt,
        signature_hash_payload_v: 3,
        signed_document_id: filed.document.id, signed_document_binding_id: filed.binding.id,
        signed_file_size: filed.binding.file_size, archived: true,
        finalize_claimed_by: null, finalize_claimed_at: null,
        authority_version: claimedVersion + 1,
      } },
    );
    const sealed = await esignExactOne(entities.DocumentSignature, { id: signatureId, agency_id: agencyId }, 'DocumentSignature', 409);
    if ((!esignSingleUpdate(completion) && sealed.signed_document_id !== filed.document.id)
      || sealed.status !== 'completed' || sealed.signature_hash !== sealedSha256) {
      throw new EsignError(409, 'Signature completion requires reconciliation');
    }
    await esignAudit(entities, {
      event_key: await esignSha256('document_finalized\u0000' + signatureId + '\u0000' + sealedSha256),
      agency_id: agencyId, document_signature_id: signatureId,
      action: 'document_finalized', actor_type: input?.actor?.type || 'system',
      ...(esignId(input?.actor?.userId) ? { actor_user_id: input.actor.userId } : {}),
      ...(esignId(input?.actor?.membershipId) ? { membership_id: input.actor.membershipId,
        membership_version: input.actor.membershipVersion } : {}),
      request_id: claimId, authority_version: sealed.authority_version,
      document_content_sha256: row.document_content_sha256, artifact_content_sha256: sealedSha256,
      occurred_at: sealedAt,
    }).catch(() => null);
    await esignSyncRequestPackages(entities, agencyId, row).catch(() => 0);
    const notice = await esignNotifyCreator(base44, sealed).catch(() => null);
    return {
      state: 'completed', row: sealed, signedDocumentId: filed.document.id,
      signedSha256: sealedSha256, notified: !!notice?.notified,
    };
  } catch (error) {
    // Return the lease at once unless a chart-filing create started without
    // being verified: then the lease expires on its own and the retry resumes
    // that exact filing (a verified filing is always reused, never repeated).
    if (error?.esignFilingStarted !== true) {
      await entities.DocumentSignature.updateMany(
        { id: signatureId, agency_id: agencyId, finalize_claimed_by: claimId, authority_version: claimedVersion },
        { $set: { finalize_claimed_by: null, finalize_claimed_at: null, authority_version: claimedVersion + 1 } },
      ).catch(() => null);
    }
    throw error;
  }
}
