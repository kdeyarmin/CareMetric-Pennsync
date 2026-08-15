import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: resolveTelnyxCreds — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let record = null;
  let readError = null;
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret
      .filter({ provider: 'telnyx' }, '-updated_date', 5000);
    const list = Array.isArray(rows) ? rows : [];
    // Deterministic row selection. This read used to be unsorted with no is_active
    // filter and took rows[0], and saveTelnyxSecret picks from the same unordered
    // query — so with two telnyx rows the admin could be writing one row while the
    // senders read the other, and re-entering the key could never fix it.
    record = list.find((r) => r && r.is_active === true && pick(r.api_key))
      || list.find((r) => r && pick(r.api_key))
      || list[0]
      || null;
  } catch (err) {
    // Do NOT collapse this into "not configured". A failed read (this invocation
    // path carries no service token, entity 404, 401/403, rate limit, platform
    // blip) is a completely different problem from an unconfigured integration,
    // and reporting them identically is what sent operators chasing a credential
    // they had already entered correctly.
    readError = (err && err.message) ? String(err.message) : 'IntegrationSecret read failed';
    // The catch used to be bare, so an unreadable credential row left no
    // server-side breadcrumb at all — the only signal was a misleading
    // "not configured" reply. Log it; unattended runs have nowhere else to say so.
    console.error('resolveTelnyxCreds: could not read the Telnyx IntegrationSecret row:', readError);
  }
  const rec = record || {};
  return {
    apiKey: pick(rec.api_key),
    publicKey: pick(rec.public_key),
    messagingProfileId: pick(rec.messaging_profile_id),
    voiceConnectionId: pick(rec.voice_connection_id),
    faxConnectionId: pick(rec.fax_connection_id),
    record,
    readError,
  };
}

// Build the caller-facing message for a missing Telnyx credential. Distinguishing
// "could not read" from "not stored" is the whole point: the first is not fixed by
// entering a key, and telling an admin to enter one is what caused two reverted
// env-fallback regressions.
function telnyxCredsMessage(creds, what) {
  const label = what || 'credentials';
  if (creds && creds.readError) {
    return `Could not read Telnyx ${label} — the stored-credential lookup failed (${creds.readError}). This is NOT a missing key, so re-entering it will not help. Retry; if it persists, this function is running without service-role access to IntegrationSecret.`;
  }
  return `Telnyx ${label} not configured — add the API key in Admin › Telnyx (it is stored on the IntegrationSecret row; TELNYX_* environment variables are not read).`;
}
// <<<END SHARED HELPER: resolveTelnyxCreds>>>


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
 *  - Read-only in effect, not by HTTP method: Base44 clients invoke functions
 *    over POST, so the request method is not a meaningful gate here. What makes
 *    it read-only is that every upstream call is a GET and nothing is written —
 *    no entity, no secret. Choosing a value is a separate saveTelnyxSecret call.
 *  - Never throws on a partial failure: each resource type reports its own
 *    status so one unavailable endpoint doesn't block the other two.
 *
 * Returns { ok, resources: { messaging_profiles, voice_connections,
 * fax_connections }, current } where each resource is
 * { status: 'ok'|'fail', items: [{ id, name }], detail }.
 */

const PROBE_TIMEOUT_MS = 10000;

const PAGE_SIZE = 100;
// Bound the paging loop so a backend that ignores `page[number]` can't spin
// forever; far above any realistic Telnyx account.
const MAX_PAGES = 20;

/**
 * Read-only Telnyx list call, paged to exhaustion and normalised to { id, name }.
 *
 * Paging matters here rather than being theoretical: the UI swaps the free-text
 * field for a picker as soon as this returns anything, so a resource stranded on
 * page 2 would be neither selectable NOR enterable. `truncated` reports the case
 * where the cap was hit, so the UI can keep manual entry visible.
 */
async function listTelnyxResource(apiKey, path, nameField) {
  const items = [];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = `https://api.telnyx.com/v2/${path}?page[size]=${PAGE_SIZE}&page[number]=${page}`;
      const resp = await fetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' },
        signal: controller.signal,
      });
      if (resp.status === 401 || resp.status === 403) {
        return { status: 'fail', items: [], truncated: false, detail: `Telnyx rejected the credentials (HTTP ${resp.status}). Check the API key.` };
      }
      if (!resp.ok) {
        return { status: 'fail', items: [], truncated: false, detail: `Telnyx returned HTTP ${resp.status} for ${path}.` };
      }
      const body = await resp.json().catch(() => null);
      const rows = Array.isArray(body?.data) ? body.data : [];
      for (const row of rows) {
        const id = typeof row?.id === 'string' ? row.id : String(row?.id ?? '');
        if (!id) continue;
        items.push({
          // Fall back through the plausible name fields so a profile with no
          // friendly name still renders as something the admin can choose between.
          name: String(row?.[nameField] ?? row?.name ?? row?.friendly_name ?? '').trim() || '(unnamed)',
          id,
        });
      }
      // Stop on the last page. Prefer Telnyx's own page count; fall back to a
      // short page, and treat an empty page as the end either way.
      const totalPages = Number(body?.meta?.total_pages);
      const done = rows.length < PAGE_SIZE || (Number.isFinite(totalPages) && page >= totalPages);
      if (done) {
        return {
          status: 'ok',
          items,
          truncated: false,
          detail: items.length ? `${items.length} found.` : 'None found in this Telnyx account.',
        };
      }
    }
    return {
      status: 'ok',
      items,
      truncated: true,
      detail: `Showing the first ${items.length}. Enter the id manually if the one you need isn't listed.`,
    };
  } catch (err) {
    const aborted = err?.name === 'AbortError';
    return {
      status: 'fail',
      items: [],
      truncated: false,
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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    // Same gate as saveTelnyxSecret: these ids belong to the integration secret.
    if (user.account_type !== 'super_admin') {
      return Response.json({ error: 'Only the super administrator can manage integration secrets.' }, { status: 403 });
    }

    // Deterministic credential selection via the shared resolver (active row
    // with a key, newest-updated first) — an ad-hoc unsorted rows[0] read could
    // probe Telnyx with a stale/inactive key when two telnyx rows exist and
    // echo resource ids from the wrong account, diverging from what the senders
    // (resolveTelnyxCreds) and saveTelnyxSecret actually use.
    const creds = await resolveTelnyxCreds(base44);
    const secret = creds.record;
    const apiKey = creds.apiKey || '';
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
