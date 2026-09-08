import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

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

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function cleanupAuthorized(req, user) {
  if (isProtectedSuperAdmin(user)) return true;
  const expected = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  const provided = String(req.headers.get('x-internal-secret') || '').trim();
  return !!expected && timingSafeEqual(provided, expected);
}



Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    
    // This is a platform-wide destructive sweep. Only the configured platform
    // owner or a server-held scheduler secret may run it; self-editable custom
    // account/agency claims never grant access.
    if (!cleanupAuthorized(req, user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const now = new Date();

    // Find all expired cache entries
    // Explicit high limit: an unlimited filter() only sees the server's default
    // page (~50), so if entries expire faster than one page per run this sweep
    // never catches up and the cache grows without bound.
    const expiredCache = await base44.asServiceRole.entities.CertificatePacketCache.filter({
      expires_at: { $lt: now.toISOString() }
    }, undefined, 5000);

    let deletedCount = 0;

    // Delete expired entries
    for (const cache of expiredCache) {
      try {
        await base44.asServiceRole.entities.CertificatePacketCache.delete(cache.id);
        deletedCount++;
      } catch (error) {
        console.error('Failed to delete cache entry:', error?.message || error);
      }
    }

    return Response.json({
      success: true,
      expired_count: expiredCache.length,
      deleted_count: deletedCount,
      timestamp: now.toISOString()
    });

  } catch (error) {
    console.error('Cache cleanup failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
