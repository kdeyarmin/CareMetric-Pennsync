import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * submitSignerSignature — the ONLY authorized path for an external signer to
 * record a signature from the public /signer portal.
 *
 * The portal is unauthenticated; previously the signature was written straight
 * from the browser via the public SDK to the (RLS-less) DocumentSignature
 * entity, with the signer token never checked — so anyone could forge a
 * signature on any document as any signer. This function moves the write
 * server-side behind the token, mirroring validateSignerToken: the caller must
 * present a valid, active, unexpired token whose package actually contains the
 * document, and the signer identity is taken from the TOKEN, never the client.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { token, document_id, signature_image_url, typed_name } = await req.json();

    if (!token || !document_id) {
      return Response.json({ error: 'token and document_id are required' }, { status: 400 });
    }

    // 1) Validate the token (mirror validateSignerToken): exists, active, unexpired.
    //    Tokens are stored hashed; look up by hash, fall back to plaintext for
    //    legacy tokens issued before hashing.
    const tokenHash = await sha256Hex(token);
    let tokenRecords = await base44.asServiceRole.entities.DocumentPackageToken.filter(
      { token: tokenHash }, '-created_date', 1
    );
    if (!tokenRecords || tokenRecords.length === 0) {
      // Legacy-plaintext fallback, excluding hashed rows so a leaked stored hash
      // can't be replayed as a bearer token (see validateSignerToken).
      const legacy = await base44.asServiceRole.entities.DocumentPackageToken.filter(
        { token }, '-created_date', 1
      );
      tokenRecords = (legacy || []).filter((r) => r?.token_hashed !== true);
    }
    const tokenRecord = tokenRecords?.[0];
    if (!tokenRecord || tokenRecord.is_active === false) {
      return Response.json({ error: 'Invalid or inactive token' }, { status: 401 });
    }
    const now = new Date();
    const expiresAt = new Date(tokenRecord.expires_at);
    if (Number.isNaN(expiresAt.getTime()) || now > expiresAt) {
      await base44.asServiceRole.entities.DocumentPackageToken.update(tokenRecord.id, { is_active: false }).catch(() => {});
      return Response.json({ error: 'Token has expired' }, { status: 401 });
    }

    // 2) Bind token -> document: the document MUST belong to this token's package.
    const pkg = await base44.asServiceRole.entities.DocumentPackage.get(tokenRecord.package_id).catch(() => null);
    if (!pkg) {
      return Response.json({ error: 'Document package is no longer available' }, { status: 404 });
    }
    const memberIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [];
    // Empty [] is a valid mint-time snapshot — do not treat it as "no snapshot".
    const snapshot = Array.isArray(tokenRecord.document_ids) ? tokenRecord.document_ids : null;
    const allowedIds = snapshot !== null
      ? memberIds.filter((id) => snapshot.includes(id))
      : memberIds;
    if (!allowedIds.includes(document_id)) {
      return Response.json({ error: 'This document is not part of the signer\'s package' }, { status: 403 });
    }

    // 3) Fetch the signature; reject if already completed (single-use per document).
    const signature = await base44.asServiceRole.entities.DocumentSignature.get(document_id).catch(() => null);
    if (!signature) {
      return Response.json({ error: 'Document not found' }, { status: 404 });
    }
    if (signature.status === 'completed') {
      return Response.json({ error: 'This document has already been signed', already_signed: true }, { status: 409 });
    }

    // 4) Identify the signer ROW inside the signers[] array from the token's
    //    server-derived email. If the document declares specific signers, the
    //    token's signer must match one of them; otherwise it's assigned to a
    //    different signer.
    const signerEmail = String(tokenRecord.signer_email || '').toLowerCase();
    const existingSigners = Array.isArray(signature.signers) ? signature.signers : [];
    const matchIndex = signerEmail
      ? existingSigners.findIndex((s) => String(s?.email || '').toLowerCase() === signerEmail)
      : -1;

    if (existingSigners.length > 0 && signerEmail && matchIndex === -1) {
      return Response.json({ error: 'This document is assigned to a different signer' }, { status: 403 });
    }

    // 5) Record the signature INSIDE the signers[] array with merge-and-retry so
    //    concurrent required signers do not clobber each other's completed rows.
    //    Pattern mirrors appendPatientNoteHistory: re-read → merge this signer →
    //    write → verify our row still holds → bounded retry.
    const signedAt = new Date().toISOString();
    const applySigner = (signers) => {
      const list = Array.isArray(signers) ? signers : [];
      const idx = signerEmail
        ? list.findIndex((s) => String(s?.email || '').toLowerCase() === signerEmail)
        : matchIndex;
      if (idx >= 0) {
        return list.map((s, i) =>
          i === idx
            ? {
                ...s,
                status: 'completed',
                signed_date: signedAt,
                signature: signature_image_url || s.signature || null,
              }
            : s
        );
      }
      return [
        ...list,
        {
          name: tokenRecord.signer_name || typed_name || '',
          email: tokenRecord.signer_email || '',
          role: 'patient',
          required: true,
          status: 'completed',
          signed_date: signedAt,
          signature: signature_image_url || null,
          signature_method: signature_image_url ? 'signature_image' : 'digital_signature',
        },
      ];
    };
    const ourSignerSettled = (signers) => {
      const list = Array.isArray(signers) ? signers : [];
      if (!signerEmail) {
        return list.some((s) => s?.signed_date === signedAt || s?.status === 'completed');
      }
      const row = list.find((s) => String(s?.email || '').toLowerCase() === signerEmail);
      return !!(row && (row.signed_date || row.status === 'completed'));
    };

    let updatedSigners = applySigner(existingSigners);
    let allSigned = false;
    let rowStatus = 'in_progress';
    const MAX_ATTEMPTS = 3;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const latest = attempt === 0
        ? signature
        : await base44.asServiceRole.entities.DocumentSignature.get(document_id).catch(() => null);
      if (!latest) {
        return Response.json({ error: 'Document not found' }, { status: 404 });
      }
      if (latest.status === 'completed') {
        return Response.json({ error: 'This document has already been signed', already_signed: true }, { status: 409 });
      }
      updatedSigners = applySigner(latest.signers);
      const requiredSigners = updatedSigners.filter((s) => s?.required !== false);
      allSigned = requiredSigners.length > 0 &&
        requiredSigners.every((s) => s?.status === 'completed' || s?.signed_date);
      rowStatus = allSigned ? 'completed' : 'in_progress';
      const updatePayload = {
        status: rowStatus,
        signers: updatedSigners,
      };
      if (allSigned) {
        updatePayload.completed_date = signedAt;
      }
      await base44.asServiceRole.entities.DocumentSignature.update(document_id, updatePayload);
      const verify = await base44.asServiceRole.entities.DocumentSignature.get(document_id).catch(() => null);
      if (verify && ourSignerSettled(verify.signers)) {
        updatedSigners = Array.isArray(verify.signers) ? verify.signers : updatedSigners;
        const req = updatedSigners.filter((s) => s?.required !== false);
        allSigned = req.length > 0 && req.every((s) => s?.status === 'completed' || s?.signed_date);
        rowStatus = allSigned ? 'completed' : 'in_progress';
        break;
      }
      if (attempt === MAX_ATTEMPTS - 1) {
        return Response.json({
          error: 'Could not persist signature due to a concurrent update. Please try again.',
        }, { status: 409 });
      }
    }

    // 5a-bis) Stamp tamper-evidence over the now-completed record, exactly as
    //     submitDocumentSignatures does for the in-app path. Without this a
    //     document e-signed through the public signer portal carried no MAC at
    //     all and its Certificate of Completion always printed "NOT SEALED".
    //     Best-effort: never fail the signer's submit over it.
    if (allSigned) {
      try {
        await base44.asServiceRole.functions.invoke('signatureIntegrity', {
          action: 'stamp',
          signature_id: document_id,
          // Public signer portal has no user session; authorize the nested
          // stamp via the shared internal secret (same as stampSignatureOnPDF).
          internal_secret: Deno.env.get('INTERNAL_FN_SECRET') || '',
        });
      } catch (stampError) {
        console.error('submitSignerSignature: integrity stamp failed (non-fatal):', stampError?.message);
      }
    }

    // 5b) Once the document is fully signed, produce a stamped/archived PDF
    //     artifact best-effort. Never fail the submit if embedding fails — log
    //     and leave the row without signed_pdf_url so it can be retried.
    if (allSigned) {
      try {
        // Source must be the document PDF. Never fall back to the signature
        // image URL — stamping a non-PDF guarantees the embed fails and leaves
        // signed_pdf_url unset; better to skip and let it retry.
        const sourcePdf = signature.document_url || null;
        const stampImage = signature_image_url ||
          updatedSigners.find((s) => s?.signature)?.signature || null;
        if (sourcePdf && stampImage) {
          const embedResult = await base44.asServiceRole.functions.invoke('stampSignatureOnPDF', {
            pdf_url: sourcePdf,
            signature_data_url: stampImage,
            // Public signer portal has no user session; authorize the nested
            // stamp via the shared internal secret.
            internal_secret: Deno.env.get('INTERNAL_FN_SECRET') || '',
          });
          const signedUrl = embedResult?.data?.file_url;
          if (signedUrl) {
            await base44.asServiceRole.entities.DocumentSignature.update(document_id, {
              signed_pdf_url: signedUrl,
            }).catch(() => {});
          }
        }
      } catch (embedError) {
        console.error('submitSignerSignature: PDF stamp step failed (non-fatal):', embedError);
      }
    }

    // 6) Single-use on completion: once every document in the package is fully
    //    signed, deactivate the token so the link can't be replayed to keep
    //    reading PHI. (The onDocumentSigned entity-trigger handles marking the
    //    package complete and notifying admins.)
    const members = await Promise.all(
      memberIds.map((id) => base44.asServiceRole.entities.DocumentSignature.get(id).catch(() => null))
    );
    const present = members.filter(Boolean);
    const packageComplete = present.length === memberIds.length &&
      present.every((s) => s.status === 'completed');
    if (packageComplete) {
      await base44.asServiceRole.entities.DocumentPackageToken.update(tokenRecord.id, { is_active: false }).catch(() => {});
    }

    return Response.json({ success: true, document_id, document_completed: allSigned, all_signed: packageComplete });
  } catch (error) {
    console.error('submitSignerSignature error:', error);
    return Response.json({ error: 'Unable to record signature' }, { status: 500 });
  }
});