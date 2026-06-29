import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { event, data } = body;

    // This is a Base44 entity-trigger (fires when a DocumentSignature is updated):
    // the platform invokes it with NO user identity and no way to attach an
    // x-internal-secret header, so an auth/secret gate here would 403 the
    // legitimate trigger the moment INTERNAL_FN_SECRET is set. The integrity
    // defense for a trigger is to NOT trust the posted body — re-fetch the
    // canonical record by id and act only on its real, server-side state. The id
    // is always present on a real trigger, so we REQUIRE it and never fall back to
    // the body (otherwise a forged body with no id would be trusted verbatim).
    if (!event || event.type !== 'update') {
      return Response.json({ success: true });
    }

    if (!data?.id) {
      return Response.json({ success: true, skipped: 'no signature id' });
    }
    const signature = await base44.asServiceRole.entities.DocumentSignature.get(data.id).catch(() => null);
    if (!signature) {
      // No real record for this id → nothing to act on (ignore forged ids).
      return Response.json({ success: true, skipped: 'signature not found' });
    }

    // Only process once the signature row is fully "completed"
    if (signature.status !== 'completed') {
      return Response.json({ success: true });
    }

    // Resolve the package via membership rather than a flat package_id (which is
    // NOT a field on DocumentSignature). DocumentPackage.document_signatures is
    // the authoritative array of member signature ids.
    const packages = await base44.asServiceRole.entities.DocumentPackage.filter({
      document_signatures: signature.id,
    }).catch(() => []);
    const pkg = (packages && packages.length > 0) ? packages[0] : null;

    if (!pkg) {
      return Response.json({ success: true });
    }

    // Idempotency: once the package is completed, the completion side effects
    // (status stamp + admin email) have already run on the transition. This
    // entity-trigger re-fires on every later DocumentSignature update (another
    // signer, a re-save, a platform retry), so without this guard each re-fire
    // would re-stamp completed_at (last-write-wins, losing the true time) and send
    // a duplicate "Document Signed" email to every admin.
    if (pkg.status === 'completed') {
      return Response.json({ success: true, already_completed: true });
    }

    // Determine completion from the package's declared membership
    // (pkg.document_signatures = array of signature ids), the authoritative
    // source. The creators don't always back-fill package_id onto each
    // DocumentSignature, so filter({ package_id }) could return an EMPTY set and
    // [].every() === true would mark a package "completed" with NOTHING signed.
    // Mirror checkPendingSignatureRequests.
    const memberIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [];
    const members = await Promise.all(
      memberIds.map((id) => base44.asServiceRole.entities.DocumentSignature.get(id).catch(() => null))
    );
    const present = members.filter(Boolean);
    const allSigned = memberIds.length > 0 &&
      present.length === memberIds.length &&
      present.every((sig) => sig.status === 'completed');

    // Update package status if all documents are signed
    if (allSigned) {
      await base44.asServiceRole.entities.DocumentPackage.update(pkg.id, {
        status: 'completed',
        completed_at: pkg.completed_at || new Date().toISOString(),
      });
    }

    // Send notification email to admins about the signature. Resolve the real
    // admin recipients (mirroring notifyAdminOfSignedDocument / onUserSignup)
    // rather than the previous hardcoded 'admin@agency.com' placeholder, which
    // never reached a real inbox and risked leaking signer details to an
    // address the agency doesn't control.
    // Idempotency: this entity-trigger re-fires on every later DocumentSignature
    // update (a re-save to set signed_pdf_url, an integrity stamp, a platform
    // retry), and the sibling notifyAdminOfSignedDocument trigger emails admins
    // too. Send the admin notice at most once per signature by claiming the
    // shared admin_notified flag first.
    if (!signature.admin_notified) {
      // Claim the shared flag first so concurrent / re-fired triggers don't
      // double-send. But RELEASE it again if no email actually goes out, so a
      // transient SendEmail outage doesn't permanently suppress the admin notice.
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, { admin_notified: true }).catch(() => {});
      let releaseClaim = false;
      try {
        const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
        if (admins && admins.length > 0) {
          // Signer identity lives in the signers[] array, not flat fields. Report
          // the signers that have completed on this document.
          const signedSigners = (Array.isArray(signature.signers) ? signature.signers : [])
            .filter((s) => s?.status === 'completed' || s?.signed_date);
          const signedByText = signedSigners.length > 0
            ? signedSigners.map((s) => `${s.name || 'Signer'}${s.email ? ` (${s.email})` : ''}`).join(', ')
            : 'A signer';
          const results = await Promise.allSettled(
            admins.map((admin) =>
              base44.integrations.Core.SendEmail({
                to: admin.email,
                subject: `Document Signed: ${signature.document_title || pkg.package_name}`,
                body: `${signedByText} has signed the document.\n\nDocument: ${signature.document_title || 'Document'}\nPackage: ${pkg.package_name}\nStatus: ${allSigned ? 'COMPLETE - All documents signed' : 'In Progress'}`,
              })
            )
          );
          // Every send failed (transient integration outage) — release the claim
          // so a later trigger re-fire retries instead of permanently skipping.
          if (results.every((r) => r.status === 'rejected')) releaseClaim = true;
        }
        // No admins to email = nothing to send; leave it claimed so toggling the
        // flag doesn't churn the update-trigger.
      } catch (emailError) {
        console.error('Failed to send notification email:', emailError);
        // Recipient lookup threw (transient) — release so a re-fire can retry.
        releaseClaim = true;
      }
      if (releaseClaim) {
        await base44.asServiceRole.entities.DocumentSignature.update(signature.id, { admin_notified: false }).catch(() => {});
      }
    }

    return Response.json({
      success: true,
      package_updated: allSigned,
      all_signed: allSigned,
    });
  } catch (error) {
    console.error('Error in onDocumentSigned:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});