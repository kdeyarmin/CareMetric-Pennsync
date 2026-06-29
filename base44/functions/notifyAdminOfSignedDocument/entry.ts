import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { data } = await req.json();

    // Entity-trigger (fires on DocumentSignature update): invoked by the platform
    // with no identity / no custom header, so a secret gate would 403 the
    // legitimate trigger when INTERNAL_FN_SECRET is set. The defense for a trigger
    // is to re-fetch the canonical record and act only on its real state, never
    // the posted body — so a forged id/status can't probe patients or spam admins.
    if (!data || !data.id) {
      return Response.json({ error: 'No signature data provided' }, { status: 400 });
    }

    const signature = await base44.asServiceRole.entities.DocumentSignature.get(data.id).catch(() => null);
    if (!signature) {
      return Response.json({ success: true, skipped: 'signature not found' });
    }

    // Only notify once the row is fully 'completed'
    if (signature.status !== 'completed') {
      return Response.json({ success: true, skipped: 'Not a completed status' });
    }

    // Shared idempotency with onDocumentSigned: both functions may be wired to
    // the same DocumentSignature-update trigger, and the trigger re-fires on
    // every later update. Claim the shared admin_notified flag so admins get at
    // most one "Document Signed" email per signature, whichever fires first.
    if (signature.admin_notified) {
      return Response.json({ success: true, skipped: 'admin already notified' });
    }
    await base44.asServiceRole.entities.DocumentSignature.update(signature.id, { admin_notified: true }).catch(() => {});

    // Fetch package info
    let pkg = null;
    try {
      // Find package containing this signature
      const packages = await base44.asServiceRole.entities.DocumentPackage.filter({
        document_signatures: signature.id,
      });
      pkg = packages.length > 0 ? packages[0] : null;
    } catch (e) {
      // Package may not exist yet
      console.log('Could not fetch package');
    }

    // Fetch patient info (tolerate a missing/invalid patient_id rather than
    // 500-ing the whole notification on a bad lookup)
    const patient = await base44.asServiceRole.entities.Patient.get(signature.patient_id).catch(() => null);
    const patientName = patient ? `${patient.first_name} ${patient.last_name}` : 'Unknown Patient';

    // Get all admins. A transient lookup failure must NOT leave the claim set
    // (that would permanently skip the notice on re-fire) — release and retry.
    const admins = await base44.asServiceRole.entities.User.filter({
      role: 'admin',
    }).catch(() => null);

    if (admins === null) {
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, { admin_notified: false }).catch(() => {});
      return Response.json({ success: false, error: 'Admin lookup failed' }, { status: 500 });
    }
    if (admins.length === 0) {
      // No admins to notify = nothing to send; leave it claimed (a real, stable
      // state, not a transient failure) so we don't churn the update-trigger.
      return Response.json({ success: true, skipped: 'No admins found' });
    }

    // Signer identity lives in the signers[] array; the document name is
    // document_title. There are no flat document_name/signer_* fields.
    const documentTitle = signature.document_title || 'Document';
    const completedSigners = (Array.isArray(signature.signers) ? signature.signers : [])
      .filter((s) => s?.status === 'completed' || s?.signed_date);
    const signedByText = completedSigners.length > 0
      ? completedSigners.map((s) => `${s.name || 'Signer'}${s.email ? ` (${s.email})` : ''}`).join(', ')
      : 'A signer';
    const lastSignedAt = completedSigners
      .map((s) => s.signed_date)
      .filter(Boolean)
      .sort()
      .slice(-1)[0] || signature.completed_date;

    const subject = `Document Signed: ${documentTitle}`;
    const documentLink = `/DocumentHub`;
    const body = `
A document has been successfully signed.

Patient: ${patientName}
Document: ${documentTitle}
Type: ${signature.document_type}
Signed By: ${signedByText}
Signed At: ${lastSignedAt ? new Date(lastSignedAt).toLocaleString() : new Date().toLocaleString()}
${pkg ? `Package: ${pkg.package_name}` : ''}

View details in the Document Hub for more information.

---
Document Management System
    `;

    // Send email to all admins. allSettled so one bad recipient doesn't reject
    // the batch; if NONE succeed, release the claim so a re-fire retries (admins
    // must not silently lose a completion notice on a transient outage).
    const results = await Promise.allSettled(
      admins.map((admin) =>
        base44.integrations.Core.SendEmail({
          to: admin.email,
          subject,
          body,
          from_name: 'Document Management',
        })
      )
    );
    const sent = results.filter((r) => r.status === 'fulfilled').length;
    if (sent === 0) {
      await base44.asServiceRole.entities.DocumentSignature.update(signature.id, { admin_notified: false }).catch(() => {});
    }

    return Response.json({
      success: true,
      admins_notified: sent,
    });
  } catch (error) {
    console.error('Error sending admin notification:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});