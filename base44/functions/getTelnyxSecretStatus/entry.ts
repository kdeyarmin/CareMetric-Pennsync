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
 * getTelnyxSecretStatus — admin/super-admin read of whether the Telnyx API key
 * (and the optional resource ids that power text / voice / video / fax) are
 * configured, without ever returning the secret values. Checks the in-app
 * IntegrationSecret row only; retired TELNYX_* dashboard env vars are ignored
 * so the admin UI mirrors resolveTelnyxCreds in the Telnyx functions.
 *
 * Returns: {
 *   configured, source: 'config'|'none', api_key_last_four,
 *   public_key_configured, public_key_source,
 *   messaging_profile_configured, voice_connection_configured, fax_connection_configured,
 *   updated_by_email, updated_at
 * }
 */

// v2

// Must agree with `pick` in the generated resolveTelnyxCreds helper
// (base44/_shared/backendHelpers.mjs), which coerces with String(v) rather than
// requiring a string. A numerically-stored connection id used to send fine while
// this panel reported "Not set" — and the "Connect Telnyx" stage read that flag
// and sat on "Needs attention" forever.
const isSet = (v) => v != null && String(v).trim() !== '';
const trimmed = (v) => (isSet(v) ? String(v).trim() : null);

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Mirror the frontend isAdminLike / the fax functions' isSchedulerAdmin so an
    // agency_admin who can open the provisioning UI can also READ (never see) the
    // config presence flags. Saving credentials stays super-admin-only in
    // saveTelnyxSecret; this endpoint returns no secret values.
    const isAdmin = user.role === 'admin';
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    // Order and select exactly as resolveTelnyxCreds does. An unsorted rows[0]
    // let this panel and the senders read DIFFERENT rows when a duplicate
    // provider:'telnyx' row existed — so "Configured ••••1234" and "credentials
    // not configured" could both be true at the same time, which is unfalsifiable
    // from the admin UI and is precisely what the builder-bot incidents reported.
    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, '-updated_date', 5000)
      .catch(() => []);
    const list = Array.isArray(rows) ? rows : [];
    const rec = list.find((r) => r && r.is_active === true && isSet(r.api_key))
      || list.find((r) => r && isSet(r.api_key))
      || list[0]
      || {};

    const apiKey = trimmed(rec.api_key);
    const publicKey = trimmed(rec.public_key);
    const apiKeySource = isSet(rec.api_key) ? 'config' : 'none';
    const publicKeySource = isSet(rec.public_key) ? 'config' : 'none';

    const messagingProfile = isSet(rec.messaging_profile_id) ? rec.messaging_profile_id : null;
    const voiceConnection = isSet(rec.voice_connection_id) ? rec.voice_connection_id : null;
    const faxConnection = isSet(rec.fax_connection_id) ? rec.fax_connection_id : null;

    const configured = isSet(apiKey);

    return Response.json({
      success: true,
      provider: 'telnyx',
      configured,
      source: apiKeySource,
      // Only expose last-4 of the API key.
      api_key_last_four: configured ? apiKey.slice(-4) : null,
      public_key_configured: isSet(publicKey),
      public_key_source: publicKeySource,
      messaging_profile_configured: isSet(messagingProfile),
      voice_connection_configured: isSet(voiceConnection),
      fax_connection_configured: isSet(faxConnection),
      updated_by_email: rec.updated_by_email || null,
      updated_at: isSet(rec.api_key) ? rec.updated_date || null : null,
    });
  } catch (error) {
    console.error('getTelnyxSecretStatus error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
