import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const { package_id, signer_email, signer_name, expires_in_days = 30 } =
      await req.json();

    if (!package_id || !signer_email) {
      return Response.json(
        { error: 'Missing required fields: package_id, signer_email' },
        { status: 400 }
      );
    }

    // Verify package exists
    const pkg = await base44.entities.DocumentPackage.get(package_id).catch(
      () => null
    );
    if (!pkg) {
      return Response.json({ error: 'Package not found' }, { status: 404 });
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

    const tokenRecord = await base44.entities.DocumentPackageToken.create({
      package_id,
      token: tokenHash,
      // Marks this row as storing a HASH (not plaintext). Validators use it to
      // refuse the legacy-plaintext fallback for hashed rows — otherwise a leaked
      // stored hash could itself be replayed as a bearer token.
      token_hashed: true,
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
    return Response.json({ error: error.message }, { status: 500 });
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
  // Hardcoded app URL (matches the signer links built by notifySignerOfPackage).
  return 'https://hub.base44.app/apps/68ee80d98929370f9e8f2932';
}