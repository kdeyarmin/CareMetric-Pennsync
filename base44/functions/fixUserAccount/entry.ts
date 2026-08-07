import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Privileged operation: only an admin / super-admin may mutate User records.
    // Previously this was unauthenticated, so any caller could self-escalate via
    // { userId: <self>, updates: { role: 'admin', account_type: 'super_admin' } }.
    // Uses the canonical admin triad (a legitimate agency_admin was denied before).
    const currentUser = await base44.auth.me();
    if (!isAdminLike(currentUser)) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }
    if (isDeactivatedUser(currentUser)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(currentUser);
      if (_agencyAdminGate) return _agencyAdminGate;
    }

    const { userId, updates } = await req.json();
    if (!userId || !updates || typeof updates !== 'object') {
      return Response.json({ error: 'userId and updates are required' }, { status: 400 });
    }

    // Privilege-escalation guard: the role gate above admits a plain `admin`, but
    // the raw `updates` object was previously forwarded verbatim to a service-role
    // update — so an admin could POST { userId: <self>, updates: { account_type:
    // 'super_admin' } } and self-escalate (unlocking the Telnyx secret surface).
    // Only an existing super_admin may change the privilege fields; for everyone
    // else strip them so the rest of the repair still works.
    const isSuperAdmin = currentUser.account_type === 'super_admin';
    const safeUpdates = { ...updates };
    if (!isSuperAdmin) {
      for (const field of ['account_type', 'role']) {
        if (field in safeUpdates) delete safeUpdates[field];
      }
    }
    if (Object.keys(safeUpdates).length === 0) {
      return Response.json({ error: 'No permitted fields to update' }, { status: 400 });
    }

    // Target-privilege boundary: even after stripping the privilege fields, a
    // facility admin must not be able to tamper with a super_admin's other
    // fields (is_approved:false to lock them out, email/phone changes, …). Only
    // a super admin may edit another privileged account.
    const targetList = await base44.asServiceRole.entities.User.filter({ id: userId }, undefined, 5000).catch(() => []);
    const targetUser = Array.isArray(targetList) ? targetList[0] : null;
    const targetIsPrivileged = targetUser && (
      targetUser.account_type === 'super_admin' ||
      targetUser.account_type === 'agency_admin' ||
      targetUser.role === 'admin'
    );
    if (targetIsPrivileged && !isSuperAdmin && targetUser.id !== currentUser.id) {
      return Response.json({ error: 'Only a super admin can modify another administrator account.' }, { status: 403 });
    }

    // Agency admins may only mutate staff in their own agency.
    if (currentUser.account_type !== 'super_admin' && currentUser.agency_name && (currentUser.account_type === 'agency_admin' || currentUser.role === 'admin')) {
      if (!currentUser.agency_name || !targetUser || targetUser.agency_name !== currentUser.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    const result = await base44.asServiceRole.entities.User.update(userId, safeUpdates);

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('fixUserAccount error:', error);
    // Generic message — don't leak internals to the client.
    return Response.json({ error: 'Failed to update user account' }, { status: 500 });
  }
});