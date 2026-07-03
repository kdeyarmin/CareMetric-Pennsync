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

function getAppBaseUrl() {
  // Hardcoded app URL (matches the links built by generateSignerToken).
  return 'https://hub.base44.app/apps/68ee80d98929370f9e8f2932';
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    const isAdmin = user?.role === 'admin' || user?.account_type === 'agency_admin' || user?.account_type === 'super_admin';
    if (!user || !isAdmin) {
      return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
    }

    const { referral_id, provider_name, expires_in_days = 30 } = await req.json();
    if (!referral_id) {
      return Response.json({ error: 'referral_id is required' }, { status: 400 });
    }

    // The referral must exist before a capability link is minted for it.
    const referrals = await base44.asServiceRole.entities.Referral.filter({ id: referral_id });
    if (!referrals || referrals.length === 0) {
      return Response.json({ error: 'Referral not found' }, { status: 404 });
    }

    // One active token per referral: deactivate any predecessor so a re-sent
    // form always invalidates the previously mailed link.
    const prior = await base44.asServiceRole.entities.ProviderFollowUpToken.filter({
      referral_id,
      is_active: true,
    });
    for (const t of prior || []) {
      await base44.asServiceRole.entities.ProviderFollowUpToken.update(t.id, { is_active: false });
    }

    const token = generateSecureToken();
    const days = Math.min(Math.max(Number(expires_in_days) || 30, 1), 90);
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const record = await base44.asServiceRole.entities.ProviderFollowUpToken.create({
      referral_id,
      token,
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
