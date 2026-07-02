import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getTelnyxSecretStatus — admin/super-admin read of whether the Telnyx API key
 * (and the optional resource ids that power text / voice / video / fax) are
 * configured, without ever returning the secret values. All Telnyx config lives
 * in the in-app IntegrationSecret row (provider 'telnyx'); the dashboard-env
 * override path was retired. Mirrors getTwilioSecretStatus.
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

    const configured = isSet(rec.api_key);
    const publicKeyConfigured = isSet(rec.public_key);

    return Response.json({
      success: true,
      provider: 'telnyx',
      configured,
      source: configured ? 'config' : 'none',
      // Only expose last-4 of the stored API key.
      api_key_last_four: configured ? rec.api_key.slice(-4) : null,
      public_key_configured: publicKeyConfigured,
      public_key_source: publicKeyConfigured ? 'config' : 'none',
      messaging_profile_configured: isSet(rec.messaging_profile_id),
      voice_connection_configured: isSet(rec.voice_connection_id),
      fax_connection_configured: isSet(rec.fax_connection_id),
      updated_by_email: rec.updated_by_email || null,
      updated_at: configured ? rec.updated_date || null : null,
    });
  } catch (error) {
    console.error('getTelnyxSecretStatus error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});
