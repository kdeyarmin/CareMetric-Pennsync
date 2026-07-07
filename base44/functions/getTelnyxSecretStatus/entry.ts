import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getTelnyxSecretStatus — admin/super-admin read of whether the Telnyx API key
 * (and the optional resource ids that power text / voice / video / fax) are
 * configured, without ever returning the secret values. Reads the in-app
 * IntegrationSecret row only — the TELNYX_* dashboard-env fallback was
 * retired — mirroring resolveTelnyxCreds in the other Telnyx functions so
 * the admin UI shows the correct status.
 *
 * Returns: {
 *   configured, source: 'config'|'none', api_key_last_four,
 *   public_key_configured, public_key_source,
 *   messaging_profile_configured, voice_connection_configured, fax_connection_configured,
 *   updated_by_email, updated_at
 * }
 */

// v2

const isSet = (v) => typeof v === 'string' && v.trim() !== '';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin = user.role === 'admin' || user.account_type === 'super_admin';
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' })
      .catch(() => []);
    const rec = rows[0] || {};

    // IntegrationSecret is the only credential source; the TELNYX_* dashboard
    // env fallback was retired (resolveTelnyxCreds no longer reads env vars).
    const apiKey = isSet(rec.api_key) ? rec.api_key : null;
    const publicKey = isSet(rec.public_key) ? rec.public_key : null;
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});