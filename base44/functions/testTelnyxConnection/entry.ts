import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * testTelnyxConnection — admin-only setup diagnostic for the Telnyx integration
 * (text / voice / video / fax). Returns a structured readiness report so an admin
 * can verify the integration is wired up correctly without sending a real text,
 * call, or fax:
 *
 *  - Telnyx API key present (TELNYX_API_KEY or in-app config) — presence only.
 *  - a live, read-only probe of the Telnyx REST API (`/v2/whoami`) confirming the
 *    key authenticates and the account is reachable.
 *  - webhook Ed25519 public key present (required to verify inbound webhooks).
 *  - resource ids (messaging profile / voice + fax connections) for each channel.
 *
 * Returns { checks: [{ id, label, status: 'ok'|'warn'|'fail', detail }], stats,
 * generated_at }. It never sends anything and never returns a secret.
 */

const isSet = (v) => typeof v === 'string' && v.trim() !== '';

const PROBE_TIMEOUT_MS = 8000;

/**
 * Resolve Telnyx credentials + resource ids: env vars take precedence over the
 * in-app IntegrationSecret row (provider 'telnyx'). This is the single source of
 * truth for credential resolution, inlined into every Telnyx send/webhook
 * function (single-file Deno deploy model); drift is guarded by
 * base44/functions/telnyxCredsInlineParity.test.js.
 */
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = pick(Deno.env.get('TELNYX_API_KEY'));
  let publicKey = pick(Deno.env.get('TELNYX_PUBLIC_KEY'));
  let messagingProfileId = pick(Deno.env.get('TELNYX_MESSAGING_PROFILE_ID'));
  let voiceConnectionId = pick(Deno.env.get('TELNYX_VOICE_CONNECTION_ID')) || pick(Deno.env.get('TELNYX_CONNECTION_ID'));
  let faxConnectionId = pick(Deno.env.get('TELNYX_FAX_CONNECTION_ID'));
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' });
    const rec = rows?.[0] || {};
    if (!apiKey) apiKey = pick(rec.api_key);
    if (!publicKey) publicKey = pick(rec.public_key);
    if (!messagingProfileId) messagingProfileId = pick(rec.messaging_profile_id);
    if (!voiceConnectionId) voiceConnectionId = pick(rec.voice_connection_id);
    if (!faxConnectionId) faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

/**
 * Read-only probe of the Telnyx `/v2/whoami` endpoint, bounded by an
 * AbortController timeout so a slow/blackholed host can't hang the diagnostic.
 *   - network error / timeout → host unreachable or no egress (fail)
 *   - 401 / 403               → credentials rejected — definitive (fail)
 *   - 200                     → authenticated and reachable (ok)
 *   - other                   → reached Telnyx but unexpected response (warn)
 */
async function probeTelnyxApi(apiKey) {
  const url = 'https://api.telnyx.com/v2/whoami';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  const startedAt = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    const latencyMs = Date.now() - startedAt;
    await resp.text().catch(() => '');
    if (resp.status === 401 || resp.status === 403) {
      return { status: 'fail', detail: `Telnyx rejected the credentials (HTTP ${resp.status}). Check the API key.`, latencyMs };
    }
    if (resp.ok) {
      return { status: 'ok', detail: `Authenticated and reachable (HTTP ${resp.status}, ${latencyMs} ms).`, latencyMs };
    }
    return { status: 'warn', detail: `Reached Telnyx but received an unexpected response (HTTP ${resp.status}). Credentials were not rejected — send a test text to verify end to end.`, latencyMs };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      status: 'fail',
      detail: aborted
        ? `Timed out after ${PROBE_TIMEOUT_MS} ms reaching api.telnyx.com. Check that the function has network egress.`
        : `Could not reach api.telnyx.com — verify network egress. (${err.message})`,
      latencyMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      String(user.email || '').trim().toLowerCase() === ((Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null);
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can test the Telnyx connection' }, { status: 403 });
    }

    const creds = await resolveTelnyxCreds(base44);
    const checks = [];

    // --- API key (presence only — never echo the value) ---
    checks.push({
      id: 'telnyx_api_key',
      label: 'Telnyx API key',
      status: creds.apiKey ? 'ok' : 'fail',
      detail: creds.apiKey
        ? 'Telnyx API key is configured.'
        : 'No Telnyx API key found. Add it on the Administration → Super Admin page, or set TELNYX_API_KEY in the Base44 dashboard.',
    });

    // --- Webhook signature verification (Ed25519 public key) ---
    checks.push({
      id: 'telnyx_public_key',
      label: 'Webhook signature verification',
      status: creds.publicKey ? 'ok' : 'warn',
      detail: creds.publicKey
        ? 'Inbound Telnyx webhooks are verified with the Ed25519 public key (telnyx-signature-ed25519).'
        : 'No Telnyx public key — inbound delivery/status webhooks will be rejected fail-closed until you add it (Portal → Account → Keys & Credentials → Public Key).',
    });

    // --- Per-channel resource ids ---
    checks.push({
      id: 'telnyx_messaging_profile',
      label: 'Text (messaging profile)',
      status: creds.messagingProfileId ? 'ok' : 'warn',
      detail: creds.messagingProfileId
        ? 'Messaging profile configured for outbound SMS/MMS.'
        : 'No messaging profile id — Telnyx can still send from a number, but setting one enables profile-level routing/opt-out handling.',
    });
    checks.push({
      id: 'telnyx_voice_connection',
      label: 'Voice (Call Control connection)',
      status: creds.voiceConnectionId ? 'ok' : 'warn',
      detail: creds.voiceConnectionId
        ? 'Call Control connection configured for outbound/masked voice.'
        : 'No voice connection id — outbound Call Control calls require a Call Control Application connection id.',
    });
    checks.push({
      id: 'telnyx_fax_connection',
      label: 'Fax (Programmable Fax connection)',
      status: creds.faxConnectionId ? 'ok' : 'warn',
      detail: creds.faxConnectionId
        ? 'Fax connection configured for Programmable Fax.'
        : 'No fax connection id — outbound fax requires a Programmable Fax / FAX Application connection id.',
    });

    // --- Live Telnyx API probe ---
    if (!creds.apiKey) {
      checks.push({ id: 'telnyx_api_live', label: 'Live Telnyx API', status: 'fail', detail: 'Skipped — Telnyx API key not configured.' });
    } else {
      const probe = await probeTelnyxApi(creds.apiKey);
      checks.push({ id: 'telnyx_api_live', label: 'Live Telnyx API', status: probe.status, detail: probe.detail });
    }

    const stats = {
      messaging_ready: Boolean(creds.apiKey),
      voice_ready: Boolean(creds.apiKey && creds.voiceConnectionId),
      fax_ready: Boolean(creds.apiKey && creds.faxConnectionId),
      webhooks_verifiable: Boolean(creds.publicKey),
    };

    return Response.json({ success: true, checks, stats, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('testTelnyxConnection error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});