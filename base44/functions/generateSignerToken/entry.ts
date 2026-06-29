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

    // Generate secure token
    const token = generateSecureToken();

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expires_in_days);

    const tokenRecord = await base44.entities.DocumentPackageToken.create({
      package_id,
      token,
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
  const appId = Deno.env.get('BASE44_APP_ID');
  return `https://${appId}.base44.io`;
}