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

// <<<BEGIN SHARED HELPER: activeMembershipAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeMembershipEmail = (value) => String(value || '').trim().toLowerCase();
async function hasExactActiveAgencyMembership(base44, user) {
  const userId = typeof user?.id === 'string' ? user.id.trim() : '';
  const userEmail = normalizeMembershipEmail(user?.email);
  if (!userId || !userEmail) return false;
  let rows;
  try {
    rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: userId, status: 'active' },
      undefined,
      2,
    );
  } catch {
    return false;
  }
  if (!Array.isArray(rows) || rows.length !== 1) return false;
  const row = rows[0];
  return !!row
    && String(row.user_id || '').trim() === userId
    && String(row.status || '') === 'active'
    && normalizeMembershipEmail(row.user_email_normalized) === userEmail
    && typeof row.agency_id === 'string'
    && !!row.agency_id.trim();
}
// <<<END SHARED HELPER: activeMembershipAuthz>>>


/**
 * cancelScheduledSms — cancel a still-pending scheduled text. A nurse may cancel
 * their own; only the protected platform owner may cancel another user's.
 * Only 'pending' rows can be canceled (one that's already sending/sent can't
 * be recalled).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (!isProtectedSuperAdmin(user)
      && !(await hasExactActiveAgencyMembership(base44, user))) {
      return Response.json({ error: 'Forbidden: active agency membership required' }, { status: 403 });
    }

    const body = await req.json().catch(() => null);
    const scheduledId = typeof body?.scheduled_id === 'string' ? body.scheduled_id.trim() : '';
    if (!scheduledId || scheduledId.length > 200) {
      return Response.json({ error: 'scheduled_id is invalid' }, { status: 400 });
    }

    const protectedOwner = isProtectedSuperAdmin(user);
    const lookup = protectedOwner
      ? { id: scheduledId }
      : { id: scheduledId, nurse_email: user.email };
    const rows = await base44.asServiceRole.entities.ScheduledSms
      .filter(lookup, undefined, 2).catch(() => []);
    const exactRows = Array.isArray(rows)
      ? rows.filter((candidate) => candidate?.id === scheduledId
        && (protectedOwner || candidate?.nurse_email === user.email))
      : [];
    // Use one normalized not-found response for foreign, missing, malformed,
    // and ambiguous results so this endpoint cannot be used as a row oracle.
    if (rows.length !== 1 || exactRows.length !== 1) {
      return Response.json({ error: 'Scheduled message not found' }, { status: 404 });
    }
    const row = exactRows[0];
    if (row.status !== 'pending') {
      return Response.json({ error: `This message can no longer be canceled (status: ${row.status}).` }, { status: 409 });
    }

    // The cancel write races the dispatcher's claim (pending -> sending). The
    // dispatcher re-reads the row after claiming and honors canceled_at (which
    // its claim never clears), so writing canceled_at here is what makes a
    // cancel that lands mid-claim actually stop the send.
    await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
      status: 'canceled',
      canceled_by: user.email,
      canceled_at: new Date().toISOString(),
    });

    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'sms_schedule_canceled',
      entity_type: 'ScheduledSms',
      entity_id: row.id,
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, scheduled_id: row.id });
  } catch (error) {
    console.error('cancelScheduledSms error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
