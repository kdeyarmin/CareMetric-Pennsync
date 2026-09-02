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

/**
 * ensureSuperAdmin — promotes the calling administrator to the super
 * administrator account so the rest of the app recognizes them:
 * account_type = 'super_admin', role = 'admin', approved.
 *
 * This is idempotent and only ever stamps the configured platform owner's own
 * account. Authorization requires BOTH Base44's protected built-in admin role
 * and an exact match to the backend SUPER_ADMIN_EMAIL setting. `account_type`
 * is a custom User field that any authenticated user can change through
 * auth.updateMe, so it is display/compatibility metadata and is never accepted
 * as proof of privilege.
 *
 * Keeping the stamp server-side preserves existing UI compatibility without
 * creating a self-promotion path. Missing SUPER_ADMIN_EMAIL fails closed.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(caller)) return DEACTIVATED_USER_RESPONSE();

    if (!isProtectedSuperAdmin(caller)) {
      return Response.json(
        { error: 'Only the configured platform administrator can run this.' },
        { status: 403 },
      );
    }

    const already = caller.account_type === 'super_admin' && caller.role === 'admin' && caller.is_approved === true;

    // account_type + approval are plain custom fields and always updatable.
    await base44.asServiceRole.entities.User.update(caller.id, {
      account_type: 'super_admin',
      is_approved: true,
    });

    // isProtectedSuperAdmin already proves the protected role; never write it
    // from this function. That keeps a custom-field spoof from becoming a
    // service-role promotion into Base44's protected role.
    const roleUpdated = true;

    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: caller.email,
      user_role: caller.role,
      action: 'super_admin_ensured',
      details: { target_email: caller.email, role_updated: roleUpdated, was_already_super_admin: already },
    }).catch(() => {});

    return Response.json({
      success: true,
      email: caller.email,
      account_type: 'super_admin',
      role: roleUpdated ? 'admin' : caller.role || 'user',
      role_updated: roleUpdated,
      already_super_admin: already,
    });
  } catch (error) {
    console.error('ensureSuperAdmin error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
