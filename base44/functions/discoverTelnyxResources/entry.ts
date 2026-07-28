import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * discoverTelnyxResources — read-only lookup of the resource ids the Telnyx
 * integration needs, so the super admin doesn't have to copy them by hand.
 *
 * Setting up telephony previously meant pasting FIVE values from the Telnyx
 * portal: the API key, the Ed25519 webhook key, and three resource ids
 * (messaging profile, Call Control application, Fax application). The three ids
 * are all discoverable from the account the API key already authenticates, so
 * this lists them and lets the UI fill them in — one pasted credential instead
 * of four.
 *
 * Contract:
 *  - super-admin only, matching saveTelnyxSecret (these are integration secrets).
 *  - Uses the STORED api key, read service-role. The key is never accepted from
 *    the client and never returned — only resource ids and display names, which
 *    are not secrets.
 *  - Read-only: GET only, and it creates/updates nothing. Choosing a value is a
 *    separate, explicit saveTelnyxSecret call.
 *  - Never throws on a partial failure: each resource type reports its own
 *    status so one unavailable endpoint doesn't block the other two.
 *
 * Returns { ok, resources: { messaging_profiles, voice_connections,
 * fax_connections }, current } where each resource is
 * { status: 'ok'|'fail', items: [{ id, name }], detail }.
 */

const PROBE_TIMEOUT_MS = 10000;

/** One read-only Telnyx list call, normalised to { id, name } rows. */
async function listTelnyxResource(apiKey, path, nameField) {
  const url = `https://api.telnyx.com/v2/${path}?page[size]=100`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (resp.status === 401 || resp.status === 403) {
      return { status: 'fail', items: [], detail: `Telnyx rejected the credentials (HTTP ${resp.status}). Check the API key.` };
    }
    if (!resp.ok) {
      return { status: 'fail', items: [], detail: `Telnyx returned HTTP ${resp.status} for ${path}.` };
    }
    const body = await resp.json().catch(() => null);
    const rows = Array.isArray(body?.data) ? body.data : [];
    const items = rows
      .map((row) => ({
        id: typeof row?.id === 'string' ? row.id : String(row?.id ?? ''),
        // Fall back through the plausible name fields so a profile with no
        // friendly name still renders as something the admin can choose between.
        name: String(row?.[nameField] ?? row?.name ?? row?.friendly_name ?? '').trim() || '(unnamed)',
      }))
      .filter((row) => row.id);
    return {
      status: 'ok',
      items,
      detail: items.length ? `${items.length} found.` : 'None found in this Telnyx account.',
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      status: 'fail',
      items: [],
      detail: aborted
        ? `Timed out after ${PROBE_TIMEOUT_MS} ms reaching api.telnyx.com.`
        : `Could not reach api.telnyx.com — verify network egress. (${err?.message})`,
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

    // Same gate as saveTelnyxSecret: these ids belong to the integration secret.
    if (user.account_type !== 'super_admin') {
      return Response.json({ error: 'Only the super administrator can manage integration secrets.' }, { status: 403 });
    }

    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, undefined, 5000)
      .catch(() => []);
    const secret = rows[0];
    const apiKey = typeof secret?.api_key === 'string' ? secret.api_key.trim() : '';
    if (!apiKey) {
      return Response.json({ error: 'Set your Telnyx API key first, then discover resources.' }, { status: 400 });
    }

    const [messagingProfiles, voiceConnections, faxConnections] = await Promise.all([
      listTelnyxResource(apiKey, 'messaging_profiles', 'name'),
      listTelnyxResource(apiKey, 'call_control_applications', 'application_name'),
      listTelnyxResource(apiKey, 'fax_applications', 'application_name'),
    ]);

    return Response.json({
      ok: true,
      resources: {
        messaging_profiles: messagingProfiles,
        voice_connections: voiceConnections,
        fax_connections: faxConnections,
      },
      // What is configured today, so the UI can mark the current selection and
      // avoid presenting a "change" as if nothing were set.
      current: {
        messaging_profile_id: secret?.messaging_profile_id || '',
        voice_connection_id: secret?.voice_connection_id || '',
        fax_connection_id: secret?.fax_connection_id || '',
      },
    });
  } catch (error) {
    console.error('discoverTelnyxResources error:', error?.message || error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
