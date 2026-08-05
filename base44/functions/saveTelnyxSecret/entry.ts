import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * saveTelnyxSecret — super-admin-only. Stores the Telnyx API key (and the
 * optional resource ids used by text / voice / video / fax) on the backend-only
 * IntegrationSecret entity (provider 'telnyx'), so the Telnyx integration can be
 * configured entirely in-app without touching dashboard environment variables.
 *
 * Every value is written via the service role and is
 * NEVER returned to the client — the response only carries presence + the last 4
 * characters so the UI can confirm what is set.
 *
 * Telnyx verifies inbound webhooks with an Ed25519 PUBLIC key (from the portal),
 * not the API key, so `public_key` is stored alongside the API key. It is not a
 * secret, but is kept here so all Telnyx config lives in one row.
 *
 * Body: {
 *   api_key: string,            // starts with "KEY"
 *   public_key?: string|null,   // Ed25519 webhook public key (base64)
 *   messaging_profile_id?: string|null,
 *   voice_connection_id?: string|null,
 *   fax_connection_id?: string|null,
 * }
 * Any omitted optional field is left unchanged; an explicit "" / null clears it.
 */

const lastFour = (s) => (s.length <= 4 ? s : s.slice(-4));

// Optional string field: present-and-blank/null → clear (''), present → trimmed.
function optionalField(body, key) {
  if (!(key in body)) return undefined;
  const v = body[key];
  return v == null ? '' : String(v).trim();
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const isSuperAdmin = user.account_type === 'super_admin';
    if (!isSuperAdmin) {
      return Response.json({ error: 'Only the super administrator can manage integration secrets.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const apiKey = typeof body.api_key === 'string' ? body.api_key.trim() : '';

    const optionalKeys = ['public_key', 'messaging_profile_id', 'voice_connection_id', 'fax_connection_id'];
    const hasOptionalOnly = optionalKeys.some((k) => k in body);

    // Optional-only update (e.g. adding a connection id without re-entering the
    // API key). Requires an existing row — the API key must be set first.
    if (!apiKey && hasOptionalOnly) {
      // Same ordering/selection as resolveTelnyxCreds, and no `.catch(() => [])`:
      // a failed read must not be reported to the admin as "Set your Telnyx API
      // key first", which is the message that sends someone to re-enter a key
      // that was never missing.
      const existing = await base44.asServiceRole.entities.IntegrationSecret
        .filter({ provider: 'telnyx' }, '-updated_date', 5000);
      const rows = Array.isArray(existing) ? existing : [];
      const target = rows.find((r) => r && r.is_active === true && String(r.api_key || '').trim())
        || rows.find((r) => r && String(r.api_key || '').trim())
        || rows[0]
        || null;
      if (!target?.id) {
        return Response.json({ error: 'Set your Telnyx API key first.' }, { status: 400 });
      }
      const update = { is_active: true, updated_by_email: user.email };
      for (const k of optionalKeys) {
        const v = optionalField(body, k);
        if (v !== undefined) update[k] = v;
      }
      const saved = await base44.asServiceRole.entities.IntegrationSecret.update(target.id, update);
      await base44.asServiceRole.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: user.email,
        user_role: user.role,
        action: 'telnyx_config_updated',
        details: Object.fromEntries(optionalKeys.filter((k) => k in body).map((k) => [`${k}_set`, Boolean(update[k])])),
      }).catch(() => {});
      return Response.json({
        success: true,
        provider: 'telnyx',
        configured: Boolean(existing[0].api_key),
        public_key_set: Boolean(saved?.public_key),
        messaging_profile_set: Boolean(saved?.messaging_profile_id),
        voice_connection_set: Boolean(saved?.voice_connection_id),
        fax_connection_set: Boolean(saved?.fax_connection_id),
        updated_by_email: user.email,
      });
    }

    if (!apiKey) {
      return Response.json({ error: 'api_key is required.' }, { status: 400 });
    }
    // Telnyx API keys (v2) start with "KEY" (matched case-insensitively; the key
    // itself is stored exactly as entered).
    if (!/^KEY/i.test(apiKey) || apiKey.length < 16) {
      return Response.json({ error: "That doesn't look like a valid Telnyx API key (must start with \"KEY\" and be at least 16 characters)." }, { status: 400 });
    }

    const update = {
      provider: 'telnyx',
      api_key: apiKey,
      secret_last_four: lastFour(apiKey),
      is_active: true,
      updated_by_email: user.email,
    };
    for (const k of optionalKeys) {
      const v = optionalField(body, k);
      if (v !== undefined) update[k] = v;
    }

    // Read the row the SENDERS will read. This used to be an unsorted query whose
    // `.catch(() => [])` turned a transient read failure into "no row exists" —
    // so a blip during a save created a SECOND provider:'telnyx' row. From then on
    // the admin updated existing[0] while resolveTelnyxCreds read its own rows[0]
    // from a differently-ordered query, and re-entering the key could never fix
    // it: the panel echoed the right last-four while every send reported "not
    // configured". Order and select exactly as resolveTelnyxCreds does, and never
    // create on a failed read.
    const existing = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, '-updated_date', 5000);
    const rows = Array.isArray(existing) ? existing : [];
    const target = rows.find((r) => r && r.is_active === true && String(r.api_key || '').trim())
      || rows.find((r) => r && String(r.api_key || '').trim())
      || rows[0]
      || null;

    let saved;
    if (target?.id) {
      saved = await base44.asServiceRole.entities.IntegrationSecret.update(target.id, update);
    } else {
      saved = await base44.asServiceRole.entities.IntegrationSecret.create(update);
    }

    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: user.email,
      user_role: user.role,
      action: 'telnyx_secret_saved',
      details: {
        api_key_last_four: lastFour(apiKey),
        public_key_set: Boolean(update.public_key ?? existing[0]?.public_key),
        messaging_profile_set: Boolean(update.messaging_profile_id ?? existing[0]?.messaging_profile_id),
      },
    }).catch(() => {});

    // Never echo the secret back.
    return Response.json({
      success: true,
      provider: 'telnyx',
      configured: true,
      api_key_last_four: lastFour(apiKey),
      public_key_set: Boolean(saved?.public_key),
      messaging_profile_set: Boolean(saved?.messaging_profile_id),
      voice_connection_set: Boolean(saved?.voice_connection_id),
      fax_connection_set: Boolean(saved?.fax_connection_id),
      updated_by_email: user.email,
    });
  } catch (error) {
    console.error('saveTelnyxSecret error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});