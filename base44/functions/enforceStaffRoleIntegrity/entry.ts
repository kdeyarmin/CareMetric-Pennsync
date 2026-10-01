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
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

const READ_LIMIT = 5000;
const STAFF_ROLES = new Set(['nurse', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
// Only Base44's protected built-in role may opt a row out of discipline
// reconciliation. `account_type` is a self-mutable custom User field and must
// not let a user preserve a spoofed staff_role indefinitely.
const isAdminUser = (user) => !!user && user.role === 'admin';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));

    const user = await base44.auth.me().catch(() => null);
    const authError = getSchedulerAuthError(req, user);
    if (authError) return authError;
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const [usersRaw, invitationsRaw] = await Promise.all([
      base44.asServiceRole.entities.User.list('-created_date', READ_LIMIT),
      base44.asServiceRole.entities.UserInvitation.list('-updated_date', READ_LIMIT),
    ]);
    const users = Array.isArray(usersRaw) ? usersRaw : [];
    const invitations = Array.isArray(invitationsRaw) ? invitationsRaw : [];

    const invitationByEmail = new Map();
    for (const invitation of invitations) {
      // Only a successfully consumed invitation is authoritative. A newer
      // pending, expired, or cancelled row must never revert an active user's
      // discipline.
      if (invitation?.status !== 'accepted') continue;
      const email = normalizeEmail(invitation.email || invitation.invited_email);
      if (!email || invitationByEmail.has(email)) continue;
      invitationByEmail.set(email, invitation);
    }

    const summary = {
      success: true,
      users_checked: users.length,
      invitations_loaded: invitations.length,
      skipped_admin: 0,
      skipped_no_invitation: 0,
      skipped_invalid_invitation: 0,
      already_in_sync: 0,
      reverted: 0,
      details: [],
    };

    for (const row of users) {
      if (!row?.id || !row.email) continue;
      if (isAdminUser(row)) {
        summary.skipped_admin += 1;
        continue;
      }

      const invitation = invitationByEmail.get(normalizeEmail(row.email));
      if (!invitation) {
        summary.skipped_no_invitation += 1;
        continue;
      }

      const authoritativeRole = String(invitation.staff_role || '');
      if (!STAFF_ROLES.has(authoritativeRole)) {
        summary.skipped_invalid_invitation += 1;
        continue;
      }

      if (row.staff_role === authoritativeRole) {
        summary.already_in_sync += 1;
        continue;
      }

      await base44.asServiceRole.entities.User.update(row.id, { staff_role: authoritativeRole });
      const detail = {
        user_id: row.id,
        email: row.email,
        from: row.staff_role || null,
        to: authoritativeRole,
        invitation_id: invitation.id || null,
      };
      summary.details.push(detail);
      summary.reverted += 1;
      console.log('enforceStaffRoleIntegrity reverted staff_role:', detail);
    }

    console.log('enforceStaffRoleIntegrity summary:', summary);
    return Response.json(summary);
  } catch (error) {
    console.error('enforceStaffRoleIntegrity error:', error?.message || error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
