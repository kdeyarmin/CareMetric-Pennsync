import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getTelnyxSecretStatus — admin/super-admin read of whether the Telnyx API key
 * (and the optional resource ids that power text / voice / video / fax) are
 * configured, without ever returning the secret values. Checks the in-app
 * IntegrationSecret row first, then falls back to dashboard env vars
 * (TELNYX_API_KEY, TELNYX_PUBLIC_KEY, TELNYX_CONNECTION_ID) — mirroring
 * resolveTelnyxCreds in the other Telnyx functions so the admin UI shows
 * the correct status regardless of where credentials are stored.
 *
 * Returns: {
 *   configured, source: 'config'|'env'|'none', api_key_last_four,
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

    // Merge env-var fallbacks so the status reflects what the other Telnyx
    // functions actually use (resolveTelnyxCreds checks the same env vars).
    const envApiKey = Deno.env.get('TELNYX_API_KEY');
    const envPublicKey = Deno.env.get('TELNYX_PUBLIC_KEY');
    const envConnectionId = Deno.env.get('TELNYX_CONNECTION_ID');

    const apiKey = isSet(rec.api_key) ? rec.api_key : (isSet(envApiKey) ? envApiKey : null);
    const publicKey = isSet(rec.public_key) ? rec.public_key : (isSet(envPublicKey) ? envPublicKey : null);
    const apiKeySource = isSet(rec.api_key) ? 'config' : (isSet(envApiKey) ? 'env' : 'none');
    const publicKeySource = isSet(rec.public_key) ? 'config' : (isSet(envPublicKey) ? 'env' : 'none');

    const messagingProfile = isSet(rec.messaging_profile_id) ? rec.messaging_profile_id : null;
    const voiceConnection = isSet(rec.voice_connection_id) ? rec.voice_connection_id : (isSet(envConnectionId) ? envConnectionId : null);
    const faxConnection = isSet(rec.fax_connection_id) ? rec.fax_connection_id : (isSet(envConnectionId) ? envConnectionId : null);

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