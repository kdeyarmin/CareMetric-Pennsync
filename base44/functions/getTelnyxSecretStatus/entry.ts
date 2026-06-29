import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getTelnyxSecretStatus — admin/super-admin read of whether the Telnyx API key
 * (and the optional resource ids that power text / voice / video / fax) are
 * configured, and HOW (in-app config vs. dashboard env), without ever returning
 * the secret values. Mirrors getTwilioSecretStatus.
 *
 * Returns: {
 *   configured, source: 'config'|'env'|'none', api_key_last_four,
 *   public_key_configured, public_key_source,
 *   messaging_profile_configured, voice_connection_configured, fax_connection_configured,
 *   updated_by_email, updated_at
 * }
 */

const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase() || null;

const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

const isSet = (v) => typeof v === 'string' && v.trim() !== '';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      (SUPER_ADMIN_EMAIL && sameEmail(user.email, SUPER_ADMIN_EMAIL));
    if (!isAdmin) {
      return Response.json({ error: 'Administrator access required.' }, { status: 403 });
    }

    const envApiKey = Deno.env.get('TELNYX_API_KEY');
    const envPublicKey = Deno.env.get('TELNYX_PUBLIC_KEY');
    const envMessagingProfile = Deno.env.get('TELNYX_MESSAGING_PROFILE_ID');
    const envVoiceConnection = Deno.env.get('TELNYX_VOICE_CONNECTION_ID') || Deno.env.get('TELNYX_CONNECTION_ID');
    const envFaxConnection = Deno.env.get('TELNYX_FAX_CONNECTION_ID');

    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' })
      .catch(() => []);
    const rec = rows[0] || {};

    const resolvedApiKey = isSet(envApiKey) ? envApiKey : isSet(rec.api_key) ? rec.api_key : null;
    const configured = Boolean(resolvedApiKey);

    let source;
    if (!configured) source = 'none';
    else if (isSet(envApiKey)) source = 'env';
    else source = 'config';

    const resolvedPublicKey = isSet(envPublicKey) ? envPublicKey : isSet(rec.public_key) ? rec.public_key : null;
    const publicKeyConfigured = Boolean(resolvedPublicKey);
    const publicKeySource = isSet(envPublicKey) ? 'env' : isSet(rec.public_key) ? 'config' : 'none';

    return Response.json({
      success: true,
      provider: 'telnyx',
      configured,
      source,
      // Only expose last-4 of the stored API key (never env values, which are
      // controlled outside the app).
      api_key_last_four: source === 'config' && resolvedApiKey ? resolvedApiKey.slice(-4) : null,
      public_key_configured: publicKeyConfigured,
      public_key_source: publicKeySource,
      messaging_profile_configured: isSet(envMessagingProfile) || isSet(rec.messaging_profile_id),
      voice_connection_configured: isSet(envVoiceConnection) || isSet(rec.voice_connection_id),
      fax_connection_configured: isSet(envFaxConnection) || isSet(rec.fax_connection_id),
      updated_by_email: rec.updated_by_email || null,
      updated_at: source === 'config' ? rec.updated_date || null : null,
    });
  } catch (error) {
    console.error('getTelnyxSecretStatus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});