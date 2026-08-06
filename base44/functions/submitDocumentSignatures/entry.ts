import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/**
 * submitDocumentSignatures — server-side completion for the internal (in-person)
 * signing flow used by /SignDocument.
 *
 * The page previously did a client-side DocumentSignature.update keyed only on a
 * signature_id from the URL, so ANY authenticated user who had/guessed an id could
 * blanket-complete every signer on a document they have no relationship to. This
 * function keeps the legitimate in-person flow (one device, multiple physically-
 * present signers) but:
 *   - authorizes the caller against the document (admin / owner / assigned nurse),
 *   - records WHO collected the signatures (the authenticated user) in the audit
 *     trail, with the request IP rather than a hardcoded "unknown",
 *   - re-reads the canonical record server-side and applies only the submitted
 *     per-signer signature fields,
 *   - stamps the tamper-evidence MAC once all required signers are complete.
 *
 * Body: { signature_id, signatures: [{ signer_id, signature, signature_method, signed_date }] }
 */

async function canActOnDocument(base44, user, sig) {
  // Platform-wide: super_admin or role:admin without agency. Agency-scoped
  // admins must match the document's patient (or owner) agency.
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  if (isPlatformAdmin) return true;
  if (sig.created_by === user.email || sig.created_by_email === user.email
    || sig.requested_by === user.email || sig.sender_email === user.email) return true;
  if (sig.patient_id) {
    const [p] = await base44.asServiceRole.entities.Patient.filter({ id: sig.patient_id }, undefined, 5000).catch(() => []);
    if (!p) return false;
    if (p.created_by === user.email
      || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.includes(user.email))) {
      return true;
    }
    if (isAgencyScopedAdmin && user.agency_name) {
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      return !!(p.created_by && agencyEmails.has(p.created_by))
        || (Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e)));
    }
  } else if (isAgencyScopedAdmin && user.agency_name) {
    const owner = sig.created_by || sig.created_by_email || sig.requested_by || sig.sender_email;
    if (!owner) return false;
    const [ownerUser] = await base44.asServiceRole.entities.User
      .filter({ email: owner }, undefined, 1).catch(() => []);
    return !!(ownerUser && ownerUser.agency_name === user.agency_name);
  }
  return false;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const body = await req.json().catch(() => ({}));
    const { signature_id, signatures } = body;
    if (!signature_id || !Array.isArray(signatures)) {
      return Response.json({ error: 'signature_id and signatures[] are required' }, { status: 400 });
    }

    const sig = await base44.asServiceRole.entities.DocumentSignature.get(signature_id).catch(() => null);
    if (!sig) return Response.json({ error: 'Document not found' }, { status: 404 });
    if (!Array.isArray(sig.signers)) {
      return Response.json({ error: 'Document has no signers' }, { status: 400 });
    }

    // Authorization: only someone connected to this document/patient may collect
    // its signatures — closes the "any authenticated user with an id" hole.
    if (!(await canActOnDocument(base44, user, sig))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    // Already-stamped/completed documents are immutable here — re-submitting could
    // overwrite captured signatures and re-open a finalized legal record.
    if (sig.signature_hash || sig.status === 'completed') {
      return Response.json({ error: 'This document is already completed.' }, { status: 409 });
    }

    // Claim before rewriting signers so concurrent collectors cannot clobber.
    const claimToken = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `submit-sig-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try {
      await base44.asServiceRole.entities.DocumentSignature.update(signature_id, {
        submit_claimed_by: claimToken,
        submit_claimed_at: new Date().toISOString(),
      });
    } catch {
      return Response.json({ error: 'Could not claim document for signature submit' }, { status: 409 });
    }
    const claimCheck = await base44.asServiceRole.entities.DocumentSignature
      .get(signature_id).catch(() => null);
    if (!claimCheck || claimCheck.submit_claimed_by !== claimToken) {
      return Response.json({ error: 'Document is being submitted by another session' }, { status: 409 });
    }
    if (claimCheck.signature_hash || claimCheck.status === 'completed') {
      return Response.json({ error: 'This document is already completed.' }, { status: 409 });
    }

    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'unknown';
    const now = new Date().toISOString();

    // Apply only the submitted signature fields onto the canonical signer rows;
    // never trust other posted signer attributes (name/role/email stay as stored).
    const submittedById = new Map(
      signatures.filter((s) => s && s.signer_id != null).map((s) => [String(s.signer_id), s]),
    );
    // Same fallback keying as the signing page (signer.id, else `idx_<n>`):
    // legacy signer rows have no id, so keying on String(undefined) collided
    // every id-less row on multi-signer documents.
    const updatedSigners = (Array.isArray(claimCheck.signers) ? claimCheck.signers : sig.signers).map((signer, index) => {
      const sub = submittedById.get(String(signer.id ?? `idx_${index}`));
      if (!sub || !sub.signature) return signer;
      return {
        ...signer,
        signature: sub.signature,
        signature_method: sub.signature_method || 'signature_image',
        signed_date: sub.signed_date || now,
        status: 'completed',
        ip_address: ip,
      };
    });

    // Completion requires (a) at least one signature — so an all-optional document
    // can still complete once an optional signer signs, while a zero-signature
    // document never auto-completes ([].every() is true) — and (b) every required
    // signer has signed.
    const requiredSigners = updatedSigners.filter((s) => s.required !== false);
    const anySigned = updatedSigners.some((s) => s.signature);
    const requiredComplete = anySigned && requiredSigners.every((s) => s.signature);
    if (!requiredComplete) {
      return Response.json({ error: 'All required signers must sign.' }, { status: 400 });
    }

    await base44.asServiceRole.entities.DocumentSignature.update(signature_id, {
      signers: updatedSigners,
      status: 'completed',
      completed_date: now,
      audit_trail: [
        ...(Array.isArray(claimCheck.audit_trail) ? claimCheck.audit_trail : (Array.isArray(sig.audit_trail) ? sig.audit_trail : [])),
        {
          action: 'all_signatures_completed',
          timestamp: now,
          // WHO collected the signatures, not just a count — real provenance.
          notes: `${updatedSigners.filter((s) => s.signature).length} signature(s) collected in person by ${user.full_name || user.email}; ip=${ip}`,
        },
      ],
    });

    // Stamp tamper-evidence over the now-completed record (re-reads canonical state).
    let integrityAlg = null;
    try {
      const stamp = await base44.functions.invoke('signatureIntegrity', {
        action: 'stamp', signature_id,
      });
      integrityAlg = stamp?.data?.alg || null;
    } catch (e) {
      console.error('submitDocumentSignatures: integrity stamp failed:', e?.message);
    }

    return Response.json({ success: true, status: 'completed', integrity_alg: integrityAlg });
  } catch (error) {
    console.error('submitDocumentSignatures error:', error);
    return Response.json({ error: 'Failed to submit signatures' }, { status: 500 });
  }
});
