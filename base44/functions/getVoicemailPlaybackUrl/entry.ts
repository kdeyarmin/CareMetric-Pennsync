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
// <<<BEGIN SHARED HELPER: privateFileUri — generated, edit base44/_shared/backendHelpers.mjs>>>
function isPrivateFileUri(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096
    && !/\s/.test(value) && ![...value].some((character) => character.charCodeAt(0) <= 31 || character.charCodeAt(0) === 127)
    && (value.startsWith('private/') || value.startsWith('private://')
      || /^mp\/private\/[a-f0-9]{24}\/[^?#]+$/.test(value));
}
// <<<END SHARED HELPER: privateFileUri>>>

/**
 * getVoicemailPlaybackUrl — a short-lived link to play one stored voicemail.
 *
 * handleTelnyxStatusWebhook copies each voicemail recording into PRIVATE app
 * storage (Telnyx's own recording links expire after ten minutes) and keeps the
 * private reference in CallLog.voicemail_url. Playing it needs a signed link,
 * and this is the only place one is minted.
 *
 * Authorization is the caller's OWN read of the CallLog row: CallLog RLS admits
 * a non-admin only to rows whose nurse_email, sent_by or creator is them (and
 * the built-in admin to all). The service role is used only to sign the file
 * once that read has returned the row — never to decide whether the caller may
 * have it. A legacy row that still holds a provider https link has nothing to
 * sign; the browser plays such a row directly, as before.
 */

const VOICEMAIL_SIGNED_URL_TTL_SECONDS = 300;
const NO_STORE = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const exactCallLogId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200
  && value.trim() === value && !value.startsWith('$') && !/[\u0000-\u001f\u007f]/.test(value);

function exactHttpsUrl(value) {
  if (typeof value !== 'string' || !value || value.length > 8192 || value.trim() !== value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.hash ? url.toString() : null;
  } catch {
    return null;
  }
}

const refuse = (status, error, code) => Response.json({ success: false, error, code }, { status, headers: NO_STORE });

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') return refuse(405, 'Method not allowed', 'METHOD_NOT_ALLOWED');
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    let user = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user) return refuse(401, 'Unauthorized', 'UNAUTHORIZED');
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true) return refuse(403, 'Forbidden', 'FORBIDDEN');

    const body = await req.json().catch(() => null);
    const callLogId = body && typeof body === 'object' && !Array.isArray(body) ? body.call_log_id : null;
    if (!exactCallLogId(callLogId)) return refuse(400, 'call_log_id is required', 'INVALID_CALL_LOG_ID');

    // The caller's own read decides. A row RLS hides is indistinguishable from
    // one that does not exist.
    let rows;
    try {
      rows = await base44.entities.CallLog.filter({ id: callLogId }, undefined, 2);
    } catch {
      return refuse(503, 'Call history is temporarily unavailable', 'CALL_LOG_UNAVAILABLE');
    }
    const row = Array.isArray(rows) && rows.length === 1 && rows[0]?.id === callLogId ? rows[0] : null;
    if (!row || row.has_voicemail !== true) return refuse(404, 'Voicemail not found', 'VOICEMAIL_NOT_FOUND');
    if (!isPrivateFileUri(row.voicemail_url)) {
      return refuse(404, 'This voicemail is not held in app storage', 'VOICEMAIL_NOT_STORED');
    }

    let signed;
    try {
      signed = await base44.asServiceRole.integrations.Core.CreateFileSignedUrl({
        file_uri: row.voicemail_url,
        expires_in: VOICEMAIL_SIGNED_URL_TTL_SECONDS,
      });
    } catch {
      return refuse(502, 'Voicemail playback is temporarily unavailable', 'VOICEMAIL_SIGNING_FAILED');
    }
    const url = exactHttpsUrl(signed?.signed_url);
    if (!url) return refuse(502, 'Voicemail playback is temporarily unavailable', 'VOICEMAIL_SIGNING_FAILED');
    return Response.json({ success: true, url, expires_in: VOICEMAIL_SIGNED_URL_TTL_SECONDS }, { headers: NO_STORE });
  } catch {
    // No provider or SDK error text: it can echo file references.
    console.error('getVoicemailPlaybackUrl failed');
    return refuse(500, 'Internal server error', 'INTERNAL_ERROR');
  }
});
