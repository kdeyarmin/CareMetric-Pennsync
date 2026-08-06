import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Mirror the frontend isAdminLike / the fax functions' isSchedulerAdmin so an
    // agency_admin who can open the provisioning UI can also READ (never see) the
    // config presence flags. Saving credentials stays super-admin-only in
    // saveTelnyxSecret; this endpoint returns no secret values.
    const isAdmin = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin';
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