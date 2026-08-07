import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';


// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
/** True when the body carries a valid INTERNAL_FN_SECRET (nested service-role invoke). */
function isInternalInvoke(body) {
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expected) return false;
  return timingSafeEqualStr(String(body?.internal_secret || '').trim(), expected);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const body = await req.json();
    const internalOk = isInternalInvoke(body);

    // Admin UI path OR trusted nested invoke from notifySignerOfPackage (entity
    // trigger has no user session; asServiceRole.functions.invoke strips identity).
    if (!isAdminLike(user) && !internalOk) {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }
    if (user && isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { package_id, signer_email, signer_name, expires_in_days = 30 } = body;

    if (!package_id || !signer_email) {
      return Response.json(
        { error: 'Missing required fields: package_id, signer_email' },
        { status: 400 }
      );
    }

    // Verify package exists (service-role for internal/trigger callers)
    const pkg = await base44.asServiceRole.entities.DocumentPackage.get(package_id).catch(
      () => null
    );
    if (!pkg) {
      return Response.json({ error: 'Package not found' }, { status: 404 });
    }
    // Internal callers must mint for the package's own signer — never an
    // attacker-chosen address via a forged package_id + email pair.
    if (internalOk && pkg.signer_email &&
        String(pkg.signer_email).trim().toLowerCase() !== String(signer_email).trim().toLowerCase()) {
      return Response.json({ error: 'signer_email does not match package' }, { status: 403 });
    }
    // Interactive agency-scoped admins (agency_admin OR facility admin with an
    // agency_name) may only mint signing links for packages whose patient is
    // tied to their agency. Super_admin / admin-without-agency stay platform-wide.
    const isAgencyScopedAdmin = user
      && user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (!internalOk && isAgencyScopedAdmin) {
      if (!pkg.patient_id) {
        return Response.json({ error: 'Forbidden: package is outside your agency.' }, { status: 403 });
      }
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const patients = await base44.asServiceRole.entities.Patient
        .filter({ id: pkg.patient_id }, undefined, 5)
        .catch(() => []);
      const patient = patients?.[0];
      const inAgency = patient && (
        (patient.created_by && agencyEmails.has(patient.created_by))
        || (Array.isArray(patient.assigned_nurses) && patient.assigned_nurses.some((e) => agencyEmails.has(e)))
      );
      if (!inAgency) {
        return Response.json({ error: 'Forbidden: package is outside your agency.' }, { status: 403 });
      }
    }
    // Interactive mint must target a signer already on the package — otherwise
    // an admin can mint a PHI-bearing link for an arbitrary email.
    if (!internalOk) {
      const packageSignerEmail = String(pkg.signer_email || '').trim().toLowerCase();
      const requested = String(signer_email).trim().toLowerCase();
      const memberIds = Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [];
      let memberMatch = packageSignerEmail && packageSignerEmail === requested;
      if (!memberMatch && memberIds.length > 0) {
        const members = await Promise.all(
          memberIds.map((id) => base44.asServiceRole.entities.DocumentSignature.get(id).catch(() => null))
        );
        memberMatch = members.some((sig) =>
          Array.isArray(sig?.signers) && sig.signers.some((s) =>
            String(s?.email || '').trim().toLowerCase() === requested
          )
        );
      }
      if (!memberMatch) {
        return Response.json({ error: 'signer_email is not a signer on this package' }, { status: 403 });
      }
    }

    // Generate secure token. Persist ONLY its SHA-256 hash (in the token field):
    // the plaintext lives solely in the emailed signing link, so read access to
    // DocumentPackageToken rows (RLS gap, export, backup) no longer yields live,
    // PHI-bearing signing links. validateSignerToken/submitSignerSignature hash
    // the presented token before lookup.
    const token = generateSecureToken();
    const tokenHash = await sha256Hex(token);

    // Clamp the lifetime so an admin UI bug / crafted call can't mint a decade-long
    // signing link that keeps PHI reachable far past policy.
    const days = Math.min(Math.max(Number(expires_in_days) || 30, 1), 90);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + days);

    // Snapshot package membership at mint so later add/swap of documents cannot
    // expand the PHI this signing link can read or sign.
    const mintedDocumentIds = (Array.isArray(pkg.document_signatures) ? pkg.document_signatures : [])
      .map((id) => String(id || '').trim())
      .filter(Boolean);

    const tokenRecord = await base44.asServiceRole.entities.DocumentPackageToken.create({
      package_id,
      token: tokenHash,
      // Marks this row as storing a HASH (not plaintext). Validators use it to
      // refuse the legacy-plaintext fallback for hashed rows — otherwise a leaked
      // stored hash could itself be replayed as a bearer token.
      token_hashed: true,
      document_ids: mintedDocumentIds,
      signer_email,
      signer_name: signer_name || signer_email,
      token_created_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      is_active: true,
      access_count: 0,
      ip_addresses: [],
      user_agents: [],
    });

    // Generate signing link
    const signingLink = `${getAppBaseUrl()}/signer?token=${token}`;

    return Response.json({
      success: true,
      token,
      signerLink: signingLink,
      signerEmail: signer_email,
      expiresAt: expiresAt.toISOString(),
      tokenId: tokenRecord.id,
    });
  } catch (error) {
    console.error('generateSignerToken failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateSecureToken() {
  const charset =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let token = '';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) {
    token += charset[arr[i] % charset.length];
  }
  return token;
}

function getAppBaseUrl() {
  const fromEnv = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim().replace(/\/+$/, '');
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  return 'https://caremetricai.base44.app';
}