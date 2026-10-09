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
 * markSmsRead — marks inbound texts addressed to the caller as read.
 *
 * Owner decision, 2026-10-08: SmsMessage has no browser write rule at all, so
 * that every field on a row — sending line, recipient, body, owner — is the
 * server's. redriveFailedSms re-sends rows and has to be able to trust them;
 * an update rule scoped to `nurse_email` let a nurse rewrite any field of a row
 * addressed to them. This broker is the one browser-initiated SmsMessage write
 * left, and it can set exactly one field to exactly one value:
 *   - the caller is the authenticated session (no id or email in the body);
 *   - only `message_ids` may be sent, 1..100 distinct bounded ids;
 *   - a row is touched only when it is inbound, addressed to the caller
 *     (nurse_email), and not yet read; anything else is skipped, not refused,
 *     so a stale id cannot be used to probe another person's rows;
 *   - the only write is `{ is_read: true }`.
 */

const MAX_IDS = 100;
const MAX_ID_LENGTH = 200;
const normalizeReadEmail = (value) => String(value || '').trim().toLowerCase();
const exactMessageId = (value) => typeof value === 'string' && value.length > 0
  && value.length <= MAX_ID_LENGTH && value.trim() === value && !value.startsWith('$');
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
    const email = normalizeReadEmail(user.email);

    const body = await req.json().catch(() => null);
    const ids = body?.message_ids;
    if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'message_ids')
      || !Array.isArray(ids) || ids.length < 1 || ids.length > MAX_IDS
      || !ids.every(exactMessageId) || new Set(ids).size !== ids.length) {
      return json({ error: 'message_ids must be 1 to 100 distinct message ids.' }, 400);
    }

    const rows = await base44.asServiceRole.entities.SmsMessage.filter(
      { id: { $in: ids } }, undefined, ids.length + 1,
    );
    const requested = new Set(ids);
    const mine = (Array.isArray(rows) ? rows : []).filter((row) => requested.has(row?.id)
      && row.direction === 'inbound'
      && normalizeReadEmail(row.nurse_email) === email
      && row.is_read !== true);
    for (const row of mine) {
      await base44.asServiceRole.entities.SmsMessage.update(row.id, { is_read: true });
    }
    return json({ success: true, marked: mine.length });
  } catch {
    // Errors can echo row content; never log them.
    console.error('markSmsRead failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
