import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { token } = await req.json();

    if (!token) {
      return Response.json(
        { error: 'Token is required' },
        { status: 400 }
      );
    }

    // Find token record
    const tokenRecords = await base44.asServiceRole.entities.DocumentPackageToken.filter(
      { token },
      '-created_date',
      1
    );

    if (!tokenRecords || tokenRecords.length === 0) {
      return Response.json(
        { error: 'Invalid or expired token', valid: false },
        { status: 401 }
      );
    }

    const tokenRecord = tokenRecords[0];

    // Check if token is active
    if (!tokenRecord.is_active) {
      return Response.json(
        { error: 'Token has been deactivated', valid: false },
        { status: 401 }
      );
    }

    // Check expiration. A missing/malformed expires_at yields an Invalid Date,
    // and `now > Invalid Date` is false — which would treat a corrupt token as
    // valid forever. Treat an unparseable expiry as expired.
    const now = new Date();
    const expiresAt = new Date(tokenRecord.expires_at);

    if (Number.isNaN(expiresAt.getTime()) || now > expiresAt) {
      await base44.asServiceRole.entities.DocumentPackageToken.update(
        tokenRecord.id,
        { is_active: false }
      );

      return Response.json(
        { error: 'Token has expired', valid: false },
        { status: 401 }
      );
    }

    // Get package details. The package may have been deleted after the token
    // was issued, so guard against a missing package / signature list rather
    // than throwing a 500 at a legitimate signer.
    const pkg = await base44.asServiceRole.entities.DocumentPackage.get(
      tokenRecord.package_id
    ).catch(() => null);

    if (!pkg) {
      return Response.json(
        { error: 'Document package is no longer available', valid: false },
        { status: 404 }
      );
    }

    // Get signatures
    const signatureIds = Array.isArray(pkg.document_signatures)
      ? pkg.document_signatures
      : [];
    const signatures = await Promise.all(
      signatureIds.map((id) =>
        base44.asServiceRole.entities.DocumentSignature.get(id).catch(
          () => null
        )
      )
    );

    const validSignatures = signatures.filter((s) => s !== null);

    // Update access tracking
    const userAgent = req.headers.get('user-agent') || '';
    const clientIp = req.headers.get('cf-connecting-ip') ||
      req.headers.get('x-forwarded-for') || 'unknown';

    const updatedIPs = tokenRecord.ip_addresses || [];
    if (!updatedIPs.includes(clientIp)) {
      updatedIPs.push(clientIp);
    }

    const updatedUAs = tokenRecord.user_agents || [];
    if (!updatedUAs.includes(userAgent)) {
      updatedUAs.push(userAgent);
    }

    await base44.asServiceRole.entities.DocumentPackageToken.update(
      tokenRecord.id,
      {
        access_count: (tokenRecord.access_count || 0) + 1,
        last_accessed_at: new Date().toISOString(),
        ip_addresses: updatedIPs,
        user_agents: updatedUAs,
      }
    );

    return Response.json({
      valid: true,
      packageId: tokenRecord.package_id,
      packageName: pkg.package_name,
      signerName: tokenRecord.signer_name,
      signerEmail: tokenRecord.signer_email,
      dueDate: pkg.due_date,
      packageStatus: pkg.status,
      documents: validSignatures.map((sig) => {
        const signers = Array.isArray(sig.signers) ? sig.signers : [];
        const completedSigners = signers.filter(
          (s) => s?.status === 'completed' || s?.signed_date
        );
        const lastSignedAt = completedSigners
          .map((s) => s.signed_date)
          .filter(Boolean)
          .sort()
          .slice(-1)[0] || sig.completed_date || null;
        return {
          id: sig.id,
          name: sig.document_title,
          // Scoped to this token's package documents, so the public signer portal
          // can render the PDF from here instead of an unauthenticated entity read
          // by arbitrary documentId. The source PDF lives on document_url (see
          // submitSignerSignature); prefer the signed copy once it exists.
          pdf_url: sig.signed_pdf_url || sig.document_url || null,
          status: sig.status,
          signedAt: lastSignedAt,
          signers: signers.map((s) => ({
            name: s.name,
            email: s.email,
            role: s.role,
            required: s.required,
            status: s.status,
            signed_date: s.signed_date,
          })),
        };
      }),
      expiresAt: tokenRecord.expires_at,
    });
  } catch (error) {
    console.error('validateSignerToken error:', error);
    // Generic message — don't leak internals to an unauthenticated caller.
    return Response.json(
      { error: 'Unable to validate token', valid: false },
      { status: 500 }
    );
  }
});