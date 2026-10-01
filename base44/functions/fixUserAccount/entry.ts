import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
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
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    // Privileged operation: only an admin / super-admin may mutate User records.
    // Previously this was unauthenticated, so any caller could self-escalate via
    // { userId: <self>, updates: { role: 'admin', account_type: 'super_admin' } }.
    // Custom User fields are self-mutable, so only Base44's protected role is
    // accepted here.
    const currentUser = await base44.auth.me();
    if (!isProtectedAdmin(currentUser)) {
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
    const isSuperAdmin = isProtectedSuperAdmin(currentUser);
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
    const targetIsPrivileged = targetUser?.role === 'admin';
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
