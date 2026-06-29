import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * ensureSuperAdmin — promotes the designated platform owner
 * (kdeyarmin@comcast.net) to the super administrator account so the rest of the
 * app recognizes them: account_type = 'super_admin', role = 'admin', approved.
 *
 * This is self-bootstrapping and safe to call repeatedly (idempotent). It is
 * authorized in one of two ways:
 *   - the caller IS the designated owner (they can claim their own account), or
 *   - the caller is already an admin / super_admin (they can repair it).
 *
 * Keeping this server-side (with the service role) means the very first sign-in
 * by the owner can establish their elevated account without anyone having to
 * hand-edit the database.
 */

// This is the ONE place that keeps an owner-email fallback: it is the bootstrap
// target (who to PROMOTE to account_type 'super_admin'), not a runtime privilege
// gate. Prefer SUPER_ADMIN_EMAIL; the literal fallback ensures the platform owner
// can always self-promote even before the env var is configured, so the account
// is never locked out of super-admin. All the actual privilege CHECKS elsewhere
// only honor the email override when SUPER_ADMIN_EMAIL is explicitly set.
const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || 'kdeyarmin@comcast.net').trim().toLowerCase();

const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const caller = await base44.auth.me();
    if (!caller) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const callerIsOwner = sameEmail(caller.email, SUPER_ADMIN_EMAIL);
    const callerIsAdmin = caller.role === 'admin' || caller.account_type === 'super_admin';
    if (!callerIsOwner && !callerIsAdmin) {
      return Response.json(
        { error: 'Only the platform owner or an existing administrator can run this.' },
        { status: 403 },
      );
    }

    // Locate the owner's User record (the caller, or any record with that email).
    const matches = await base44.asServiceRole.entities.User.filter({ email: SUPER_ADMIN_EMAIL }).catch(() => []);
    const target = matches[0];
    if (!target) {
      return Response.json(
        { error: `No user found for ${SUPER_ADMIN_EMAIL}. The owner must sign in once before being promoted.` },
        { status: 404 },
      );
    }

    const already = target.account_type === 'super_admin' && target.role === 'admin' && target.is_approved === true;

    // account_type + approval are plain custom fields and always updatable.
    await base44.asServiceRole.entities.User.update(target.id, {
      account_type: 'super_admin',
      is_approved: true,
    });

    // role is a platform-managed field; set it best-effort so the owner gains
    // admin-gated surfaces. If the platform rejects a direct role change, the
    // account_type promotion above still stands and the app's super-admin checks
    // (which also key off the owner email) keep working.
    let roleUpdated = target.role === 'admin';
    if (!roleUpdated) {
      try {
        await base44.asServiceRole.entities.User.update(target.id, { role: 'admin' });
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
      details: { target_email: SUPER_ADMIN_EMAIL, role_updated: roleUpdated, was_already_super_admin: already },
    }).catch(() => {});

    return Response.json({
      success: true,
      email: SUPER_ADMIN_EMAIL,
      account_type: 'super_admin',
      role: roleUpdated ? 'admin' : target.role || 'user',
      role_updated: roleUpdated,
      already_super_admin: already,
    });
  } catch (error) {
    console.error('ensureSuperAdmin error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});