import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can run cleanup
    if (user?.account_type !== 'super_admin' && user?.role !== 'admin') {
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