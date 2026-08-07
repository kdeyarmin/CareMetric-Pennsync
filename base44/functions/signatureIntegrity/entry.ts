import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * signatureIntegrity — server-side tamper-evidence for DocumentSignature records.
 *
 * Replaces the old client-side `generateSignatureHash` (a keyless 32-bit hash that
 * anyone could recompute, providing no real tamper-evidence or non-repudiation).
 * The MAC is computed HERE, over a canonical projection of the STORED record (the
 * single source of truth), using a server-held secret the client never sees.
 *
 *   action: 'stamp'  — compute and store the MAC once, at signing time.
 *   action: 'verify' — recompute and compare; reports valid / tampered / unsigned.
 *
 * Set SIGNATURE_HMAC_SECRET to get keyed HMAC-SHA-256 (forgery-resistant). Without
 * it, falls back to unkeyed SHA-256 — which still detects accidental corruption but
 * is NOT forgery-resistant, and is reported as such so the UI can be honest.
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Canonical, order-stable serialization of the integrity-relevant fields. Derived
// from the stored record so any post-signing edit to a covered field changes the
// recomputed value and fails verification.
//
// PAYLOAD VERSIONS — new stamps use the highest version; verify recomputes with
// the version a record was STAMPED with so legacy stamps stay verifiable:
//   v1: id, patient_id, document_type, document_title, document_url,
//       completed_date, signers
//   v2: v1 + document_content — template-created packages have NO document_url;
//       the signer sees and attests to document_content, so leaving it out let
//       the signed legal text be edited after signing while verification still
//       reported "valid".
const CANONICAL_PAYLOAD_VERSION = 2;

function canonicalPayload(rec, version = CANONICAL_PAYLOAD_VERSION) {
  const signers = (Array.isArray(rec?.signers) ? rec.signers : [])
    .map((s) => ({
      id: s?.id ?? null,
      email: s?.email ?? null,
      name: s?.name ?? null,
      role: s?.role ?? null,
      status: s?.status ?? null,
      signed_date: s?.signed_date ?? null,
      signature: s?.signature ?? null,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const payload = {
    id: rec?.id ?? null,
    patient_id: rec?.patient_id ?? null,
    document_type: rec?.document_type ?? null,
    document_title: rec?.document_title ?? null,
    document_url: rec?.document_url ?? null,
    completed_date: rec?.completed_date ?? null,
    signers,
  };
  if (version >= 2) payload.document_content = rec?.document_content ?? null;
  return JSON.stringify(payload);
}

// The payload version a stored record was stamped with (legacy records
// predate the field → v1).
function storedPayloadVersion(rec) {
  const v = Number(rec?.signature_hash_payload_v);
  return Number.isInteger(v) && v >= 1 ? v : 1;
}

function toHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Compute the integrity hash. `forceAlg` lets verify recompute with the SAME
// algorithm a record was signed with (e.g. an old sha256-unkeyed record stays
// verifiable even after a secret is later configured).
async function computeHash(message, forceAlg) {
  const enc = new TextEncoder();
  const secret = (Deno.env.get('SIGNATURE_HMAC_SECRET') || '').trim();
  const alg = forceAlg || (secret ? 'hmac-sha256' : 'sha256-unkeyed');
  if (alg === 'hmac-sha256') {
    if (!secret) return { hash: null, alg, error: 'secret_unconfigured' };
    const key = await crypto.subtle.importKey(
      'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
    return { hash: toHex(sig), alg };
  }
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(message));
  return { hash: toHex(digest), alg: 'sha256-unkeyed' };
}

// Is this record's stored algorithm one we can still cryptographically vouch for?
//
// Verification recomputes with the algorithm recorded ON the record it is meant
// to protect. That is deliberate for legacy records stamped before a secret
// existed — but it also meant anyone who could write to DocumentSignature could
// downgrade a hmac-sha256 record to 'sha256-unkeyed', recompute the plain digest
// of a forged payload (no secret required) and be handed a "valid" verdict.
// Once a secret is configured, an unkeyed record is no longer trustworthy: it is
// unverifiable, not valid. (A payload-version downgrade is not separately
// exploitable — the MAC still covers whatever payload version is claimed.)
function unkeyedButSecretConfigured(rec) {
  const secretConfigured = !!(Deno.env.get('SIGNATURE_HMAC_SECRET') || '').trim();
  return secretConfigured && rec?.signature_hash_alg !== 'hmac-sha256';
}

// Constant-time string compare to avoid timing oracles on the MAC.
function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Admin / owner / assigned nurse. Facility admins with an agency are scoped to
// in-agency patients (dead roles clinician/nurse_manager removed — not in model).
async function canMutate(base44, user, sig) {
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
    // No patient: allow only if an owner field is staff in-agency.
    const owner = sig.created_by || sig.created_by_email || sig.requested_by || sig.sender_email;
    if (!owner) return false;
    const [ownerUser] = await base44.asServiceRole.entities.User
      .filter({ email: owner }, undefined, 1).catch(() => []);
    return !!(ownerUser && ownerUser.agency_name === user.agency_name);
  }
  return false;
}

// Trusted nested invoke from submitSignerSignature. The public capability-token
// signer portal has no user session, so a document e-signed there could never be
// stamped and its Certificate of Completion always read "NOT SEALED". Mirrors
// stampSignatureOnPDF's isInternalInvoke, and is honoured for the 'stamp' action
// ONLY — verify/certificate return the signer roster (PHI) and still require a
// real, authorized user.
function isInternalInvoke(body) {
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expected) return false;
  return timingSafeEqual(String(body?.internal_secret || '').trim(), expected);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);

    const body = await req.json();
    const { action, signature_id } = body;
    const internal = action === 'stamp' && isInternalInvoke(body);
    if (!user && !internal) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user && isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!signature_id) return Response.json({ error: 'signature_id is required' }, { status: 400 });

    const sig = await base44.asServiceRole.entities.DocumentSignature.get(signature_id).catch(() => null);
    if (!sig) return Response.json({ error: 'Signature not found' }, { status: 404 });

    // Authorize EVERY action (the record is fetched via asServiceRole). verify and
    // certificate return integrity status + the signer roster, which is PHI — so an
    // unauthorized caller must not read them for an arbitrary signature_id (IDOR).
    if (!internal && !(await canMutate(base44, user, sig))) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    if (action === 'stamp') {
      // Stamp exactly once, at signing. Re-stamping would let someone edit a signed
      // record and then recompute a fresh "valid" MAC over the tampered data, which
      // would defeat the entire tamper-evidence guarantee.
      if (sig.signature_hash) {
        return Response.json({ error: 'Signature is already stamped; re-stamping is not allowed.' }, { status: 409 });
      }
      const stampedAt = new Date().toISOString();
      const { hash, alg } = await computeHash(canonicalPayload(sig, CANONICAL_PAYLOAD_VERSION));
      // Append (never rewrite) an audit-trail entry recording the integrity stamp —
      // an immutable record of who sealed the document, when, and with which alg.
      const auditEntry = {
        action: 'integrity_stamped',
        timestamp: stampedAt,
        notes: `Tamper-evidence MAC computed (${alg}) by ${user?.full_name || user?.email || 'the signer portal'}.`,
      };
      await base44.asServiceRole.entities.DocumentSignature.update(signature_id, {
        signature_hash: hash,
        signature_hash_alg: alg,
        signature_hash_payload_v: CANONICAL_PAYLOAD_VERSION,
        signature_hash_at: stampedAt,
        audit_trail: [...(Array.isArray(sig.audit_trail) ? sig.audit_trail : []), auditEntry],
      });
      return Response.json({ success: true, alg, stamped_at: stampedAt });
    }

    if (action === 'certificate') {
      // Verification summary for a certificate of completion — the integrity verdict
      // plus the signer roster and the document's identity/timestamps.
      const stored = sig.signature_hash || null;
      let verification = { isValid: false, status: 'unsigned', alg: null };
      if (stored) {
        if (unkeyedButSecretConfigured(sig)) {
          verification = {
            isValid: false,
            status: 'unverifiable',
            reason: 'unkeyed_hash_with_secret_configured',
            alg: sig.signature_hash_alg || 'sha256-unkeyed',
          };
        } else {
          const { hash, error } = await computeHash(canonicalPayload(sig, storedPayloadVersion(sig)), sig.signature_hash_alg);
          if (error === 'secret_unconfigured') {
            verification = { isValid: false, status: 'unverifiable', alg: sig.signature_hash_alg };
          } else {
            const ok = timingSafeEqual(hash, stored);
            verification = { isValid: ok, status: ok ? 'valid' : 'tampered', alg: sig.signature_hash_alg || 'sha256-unkeyed' };
          }
        }
      }
      const signers = (Array.isArray(sig.signers) ? sig.signers : []).map((s) => ({
        name: s?.name ?? null,
        email: s?.email ?? null,
        role: s?.role ?? null,
        status: s?.status ?? null,
        signed_date: s?.signed_date ?? null,
      }));
      return Response.json({
        success: true,
        certificate: {
          document_id: sig.id,
          document_title: sig.document_title || sig.document_type || 'Document',
          patient_id: sig.patient_id || null,
          status: sig.status || null,
          completed_date: sig.completed_date || null,
          stamped_at: sig.signature_hash_at || null,
          verification,
          signers,
          generated_at: new Date().toISOString(),
        },
      });
    }

    // Default action: verify.
    const stored = sig.signature_hash || null;
    if (!stored) {
      return Response.json({ success: true, isValid: false, status: 'unsigned', reason: 'no_integrity_hash' });
    }
    if (unkeyedButSecretConfigured(sig)) {
      return Response.json({
        success: true,
        isValid: false,
        status: 'unverifiable',
        reason: 'unkeyed_hash_with_secret_configured',
        alg: sig.signature_hash_alg || 'sha256-unkeyed',
      });
    }
    const { hash, error } = await computeHash(canonicalPayload(sig, storedPayloadVersion(sig)), sig.signature_hash_alg);
    if (error === 'secret_unconfigured') {
      // The record was HMAC-signed but the secret isn't available to verify it now.
      return Response.json({ success: true, isValid: false, status: 'unverifiable', reason: 'secret_unconfigured', alg: sig.signature_hash_alg });
    }
    const isValid = timingSafeEqual(hash, stored);
    return Response.json({
      success: true,
      isValid,
      alg: sig.signature_hash_alg || 'sha256-unkeyed',
      status: isValid ? 'valid' : 'tampered',
    });
  } catch (error) {
    console.error('signatureIntegrity error:', error);
    return Response.json({ error: 'Integrity operation failed' }, { status: 500 });
  }
});
