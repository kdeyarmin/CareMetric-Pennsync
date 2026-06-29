import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Privileged operation: only an admin / super-admin may mutate User records.
    // Previously this was unauthenticated, so any caller could self-escalate via
    // { userId: <self>, updates: { role: 'admin', account_type: 'super_admin' } }.
    const currentUser = await base44.auth.me();
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.account_type !== 'super_admin')) {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
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

    const result = await base44.asServiceRole.entities.User.update(userId, safeUpdates);

    return Response.json({ success: true, result });
  } catch (error) {
    console.error('fixUserAccount error:', error);
    // Generic message — don't leak internals to the client.
    return Response.json({ error: 'Failed to update user account' }, { status: 500 });
  }
});