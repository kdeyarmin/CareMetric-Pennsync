import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// generateFollowUpPortalToken — mint the capability link for the public
// provider follow-up response portal (mirrors generateSignerToken).
//
// Admin-gated: only office/admin staff send follow-up requests. The returned
// portalLink goes on the provider information-request form (fax/PDF); the
// provider opens it and answers via validateFollowUpToken /
// submitFollowUpResponse (both service-role, token-authenticated).

function generateSecureToken() {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  let token = '';
  for (let i = 0; i < arr.length; i++) {
    token += charset[arr[i] % charset.length];
  }
  return token;
}

async function sha256Hex(input) {
  const data = new TextEncoder().encode(String(input));
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function getAppBaseUrl() {
  const fromEnv = String(Deno.env.get('APP_PUBLIC_URL') || Deno.env.get('APP_URL') || '').trim().replace(/\/+$/, '');
  if (fromEnv) {
    try { return new URL(fromEnv).origin; } catch { /* fall through */ }
  }
  return 'https://caremetricai.base44.app';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (user && user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    const isAdmin = user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';
    if (!user || !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const { referral_id, provider_name, expires_in_days = 30 } = await req.json();
    if (!referral_id) {
      return Response.json({ error: 'referral_id is required' }, { status: 400 });
    }

    // The referral must exist before a capability link is minted for it.
    const referrals = await base44.asServiceRole.entities.Referral.filter({ id: referral_id }, undefined, 5000);
    if (!referrals || referrals.length === 0) {
      return Response.json({ error: 'Referral not found' }, { status: 404 });
    }
    const referral = referrals[0];

    // Agency-scoped admins (agency_admin OR facility admin with agency_name)
    // may only mint follow-up links for referrals created by / assigned within
    // their agency.
    if (user.account_type === 'agency_admin' && !user.agency_name) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }
    const isAgencyScopedAdmin = user.account_type !== 'super_admin'
      && user.agency_name
      && (user.account_type === 'agency_admin' || user.role === 'admin');
    if (isAgencyScopedAdmin) {
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const ownerEmail = referral.created_by || referral.assigned_to || referral.intake_nurse_email;
      if (!ownerEmail || !agencyEmails.has(ownerEmail)) {
        return Response.json({ error: 'Forbidden: referral is outside your agency.' }, { status: 403 });
      }
    }

    // One active token per referral: deactivate any predecessor so a re-sent
    // form always invalidates the previously mailed link.
    const prior = await base44.asServiceRole.entities.ProviderFollowUpToken.filter({
      referral_id,
      is_active: true,
    }, undefined, 5000);
    for (const t of prior || []) {
      await base44.asServiceRole.entities.ProviderFollowUpToken.update(t.id, { is_active: false });
    }

    // Generate the secure token but persist ONLY its SHA-256 hash (in the token
    // field), mirroring generateSignerToken: the plaintext lives solely in the
    // portalLink handed to the provider, so read access to ProviderFollowUpToken
    // rows (RLS gap, export, backup) no longer yields live capability links.
    // validateFollowUpToken / submitFollowUpResponse hash the presented token
    // before lookup. Hash-only, no legacy-plaintext fallback — this entity has
    // no live production data, so hashed-at-rest is the only stored format.
    const token = generateSecureToken();
    const tokenHash = await sha256Hex(token);
    const days = Math.min(Math.max(Number(expires_in_days) || 30, 1), 90);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const record = await base44.asServiceRole.entities.ProviderFollowUpToken.create({
      referral_id,
      token: tokenHash,
      provider_name: provider_name || null,
      expires_at: expiresAt,
      is_active: true,
      access_count: 0,
    });

    return Response.json({
      success: true,
      tokenId: record.id,
      portalLink: `${getAppBaseUrl()}/followup?token=${token}`,
      expiresAt,
    });
  } catch (error) {
    console.error('generateFollowUpPortalToken error:', error);
    return Response.json({ error: 'Failed to generate portal link' }, { status: 500 });
  }
});
