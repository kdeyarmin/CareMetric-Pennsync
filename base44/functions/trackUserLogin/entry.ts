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

/**
 * trackUserLogin — records the signed-in caller's own sign-in on the activity
 * trail (owner decision, 2026-10-08: login tracking is back).
 *
 * What makes it safe to call from a browser:
 *   - the identity is the authenticated caller (base44.auth.me on the pinned
 *     client). Nothing in the body names a person; any key other than
 *     `device_type` is refused, so a caller can only ever record themselves;
 *   - the row is written by the service role with a server timestamp, never a
 *     client-supplied time;
 *   - no fingerprint: no user agent, no IP address. `device_type` is the same
 *     coarse mobile/tablet/desktop category activityLogger already stores, and
 *     anything else is refused;
 *   - replay is bounded: a caller whose last recorded sign-in is younger than
 *     LOGIN_DEDUPE_MS gets `recorded: false` and no new row, and when that last
 *     sign-in cannot be read nothing is written (503), so a reload loop cannot
 *     flood the trail.
 */

const LOGIN_DEDUPE_MS = 30 * 60 * 1000;
const DEVICE_TYPES = new Set(['mobile', 'tablet', 'desktop']);
const ALLOWED_KEYS = new Set(['device_type']);
const normalizeLoginEmail = (value) => String(value || '').trim().toLowerCase();
const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' },
});

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user?.id || !user?.email) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) return json({ error: 'Forbidden' }, 403);
    const email = normalizeLoginEmail(user.email);

    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !ALLOWED_KEYS.has(key))) {
      return json({ error: 'Only device_type may be sent.' }, 400);
    }
    if (body.device_type != null && !DEVICE_TYPES.has(body.device_type)) {
      return json({ error: 'device_type must be mobile, tablet or desktop.' }, 400);
    }

    let recent;
    try {
      recent = await base44.asServiceRole.entities.UserActivity.filter(
        { user_email: email, action: 'login' }, '-created_date', 1,
      );
    } catch {
      recent = null;
    }
    if (!Array.isArray(recent)) {
      return json({ error: 'Sign-in history is unavailable; nothing was recorded.' }, 503);
    }
    const lastAt = Date.parse(recent[0]?.created_date || '');
    if (Number.isFinite(lastAt) && Date.now() - lastAt < LOGIN_DEDUPE_MS) {
      return json({ success: true, recorded: false });
    }

    const loginTime = new Date().toISOString();
    const row = await base44.asServiceRole.entities.UserActivity.create({
      user_email: email,
      user_name: typeof user.full_name === 'string' ? user.full_name.slice(0, 120) : undefined,
      action: 'login',
      page: 'login',
      device_type: body.device_type || undefined,
      details: {
        login_time: loginTime,
        user_role: user.role === 'admin' ? 'admin' : 'user',
      },
      status: 'success',
    });
    return json({ success: true, recorded: true, activity_id: row?.id || null });
  } catch {
    // Errors can echo row content; never log them.
    console.error('trackUserLogin failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
