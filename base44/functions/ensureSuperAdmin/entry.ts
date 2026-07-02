import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * ensureSuperAdmin — promotes the calling administrator to the super
 * administrator account so the rest of the app recognizes them:
 * account_type = 'super_admin', role = 'admin', approved.
 *
 * This is self-bootstrapping and safe to call repeatedly (idempotent). It is
 * authorized by the caller's existing platform standing: only a platform
 * admin (role 'admin' — which Base44 grants the app owner) or an existing
 * super_admin can run it, and it only ever promotes the caller's own account.
 * There is no owner-email override (the SUPER_ADMIN_EMAIL secret was retired);
 * super-admin status is carried entirely by account_type.
 *
 * Keeping this server-side (with the service role) means the very first visit
 * by the owner (whose platform role is 'admin') can establish their elevated
 * account without anyone having to hand-edit the database.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerIsAdmin = caller.role === 'admin' || caller.account_type === 'super_admin';
    if (!callerIsAdmin) {
      return Response.json(
        { error: 'Only a platform administrator can run this.' },
        { status: 403 },
      );
    }

    const already = caller.account_type === 'super_admin' && caller.role === 'admin' && caller.is_approved === true;

    // account_type + approval are plain custom fields and always updatable.
    await base44.asServiceRole.entities.User.update(caller.id, {
      account_type: 'super_admin',
      is_approved: true,
    });

    // role is a platform-managed field; set it best-effort so the owner gains
    // admin-gated surfaces. If the platform rejects a direct role change, the
    // account_type promotion above still stands and the app's super-admin
    // checks (which key off account_type) keep working.
    let roleUpdated = caller.role === 'admin';
    if (!roleUpdated) {
      try {
        await base44.asServiceRole.entities.User.update(caller.id, { role: 'admin' });
        roleUpdated = true;
      } catch (err) {
        console.error('ensureSuperAdmin: could not set role=admin directly:', err.message);
      }
    }

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
    return Response.json({ error: error.message }, { status: 500 });
  }
});
