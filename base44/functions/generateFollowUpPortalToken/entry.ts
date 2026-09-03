import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

// generateFollowUpPortalToken — mint the capability link for the public
// provider follow-up response portal (mirrors generateSignerToken).
//
// Platform-owner-gated: the returned portalLink is a bearer capability sent on
// the provider information-request form (fax/PDF). Until referral tenant
// membership is immutable/server-verified, only the configured protected admin
// may mint one. validateFollowUpToken / submitFollowUpResponse remain the public,
// token-authenticated consumers.

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
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (user && user.is_active === false) {
      return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
    }
    // Gate before parsing referral_id: a forged mutable account/agency claim
    // must not trigger a privileged referral read or token mutation.
    if (!isProtectedSuperAdmin(user)) {
      return Response.json({ error: 'Forbidden: protected platform administrator required' }, { status: 403 });
    }

    const { referral_id, provider_name, expires_in_days = 30 } = await req.json();
    const referralId = typeof referral_id === 'string' ? referral_id.trim() : '';
    if (!referralId) {
      return Response.json({ error: 'referral_id is required' }, { status: 400 });
    }

    // Treat the backend filter as a query optimization, not an authorization
    // fact: re-check the exact requested id before a returned row can anchor a
    // new bearer capability.
    const referralRows = await base44.asServiceRole.entities.Referral.filter({ id: referralId }, undefined, 5000);
    const referral = (Array.isArray(referralRows) ? referralRows : [])
      .find((row) => row?.id === referralId);
    if (!referral) {
      return Response.json({ error: 'Referral not found' }, { status: 404 });
    }

    // One active token per referral: deactivate any predecessor so a re-sent
    // form always invalidates the previously mailed link.
    const priorRows = await base44.asServiceRole.entities.ProviderFollowUpToken.filter({
      referral_id: referralId,
      is_active: true,
    }, undefined, 5000);
    const prior = (Array.isArray(priorRows) ? priorRows : []).filter((row) =>
      row?.referral_id === referralId
      && row?.is_active === true
      && typeof row?.id === 'string'
      && row.id.length > 0
    );
    for (const t of prior) {
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
      referral_id: referralId,
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
