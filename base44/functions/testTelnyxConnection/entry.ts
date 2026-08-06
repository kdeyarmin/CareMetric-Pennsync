// Telnyx connection diagnostic — redeployed to resolve endpoint 404.
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * testTelnyxConnection — admin-only setup diagnostic for the Telnyx integration
 * (text / voice / video / fax). Returns a structured readiness report so an admin
 * can verify the integration is wired up correctly without sending a real text,
 * call, or fax:
 *
 *  - Telnyx API key present in in-app config — presence only.
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


// <<<BEGIN SHARED HELPER: resolveAgencySettings — generated, edit base44/_shared/backendHelpers.mjs>>>
async function resolveAgencySettings(base44, agencyName) {
  let settings = [];
  const key = String(agencyName || '').trim();
  if (key) {
    settings = await base44.asServiceRole.entities.AgencySettings
      .filter({ agency_code: key }, '-created_date', 1)
      .catch(() => []);
    if (!settings?.length) {
      settings = await base44.asServiceRole.entities.AgencySettings
        .filter({ office_name: key }, '-created_date', 1)
        .catch(() => []);
    }
  }
  if (!settings?.length) {
    // Fail closed when the agency hint missed (or no hint but multiple tenant
    // rows exist). Newest-row-wins would silently apply another agency's fax
    // line / dial allowlist / wage index / quiet-hour timezone.
    if (key) return null;
    const newest = await base44.asServiceRole.entities.AgencySettings
      .list('-created_date', 5)
      .catch(() => []);
    if ((newest || []).length > 1) return null;
    settings = (newest || []).slice(0, 1);
  }
  return settings?.[0] || null;
}
// <<<END SHARED HELPER: resolveAgencySettings>>>

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    // Same admin surface as the panels that invoke this (isAdminLike) — an
    // agency_admin can reach the "Test live connection" button, so accept them.
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin';
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
        : 'No Telnyx API key found. Add it on the Administration → Super Admin page.',
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

    // --- Fax numbers (saved AgencySettings, strict-ish E.164) ---
    // Faxes TRANSMIT from the single blind outbound line and are PRESENTED
    // under the office fax machine's number (replies go straight to the
    // office). A missing/malformed outbound line (with no office fallback)
    // fails every send, so surface both here alongside the connection check.
    const validFaxNumber = (raw) => {
      const d = raw.replace(/[^\d]/g, '');
      return (
        d.length === 10 ||
        (d.length === 11 && d.startsWith('1')) ||
        (raw.startsWith('+') && d.length >= 8 && d.length <= 15 && d[0] !== '0')
      );
    };
    const settingsRows = [await resolveAgencySettings(base44, user?.agency_name)].filter(Boolean);
    const officeFaxRaw = (settingsRows[0]?.office_fax_number_e164 || '').toString().trim();
    const outboundFaxRaw = (settingsRows[0]?.outbound_fax_number_e164 || '').toString().trim();
    const officeFaxValid = officeFaxRaw !== '' && validFaxNumber(officeFaxRaw);
    const outboundFaxValid = outboundFaxRaw !== '' && validFaxNumber(outboundFaxRaw);
    const faxFromValid = outboundFaxValid || officeFaxValid;
    checks.push({
      id: 'telnyx_fax_from',
      label: 'Outbound fax line',
      status: faxFromValid ? 'ok' : 'warn',
      detail: outboundFaxValid
        ? `Blind outbound fax line configured (${outboundFaxRaw}) — all faxes transmit from it.`
        : officeFaxValid
          ? 'No dedicated outbound line — faxes fall back to transmitting from the office fax number (set the outbound line so the office machine stays reply-only).'
          : outboundFaxRaw || officeFaxRaw
            ? 'Saved fax number doesn\'t look like a valid phone number — every outbound fax will fail until it\'s fixed.'
            : 'No outbound fax number saved — outbound faxing is disabled until one is set in Agency Settings.',
    });
    checks.push({
      id: 'telnyx_fax_reply',
      label: 'Office fax machine (reply-to)',
      status: officeFaxValid ? 'ok' : 'warn',
      detail: officeFaxValid
        ? `Recipients are shown ${officeFaxRaw} as the sender, so fax replies go straight to the office machine.`
        : 'No office fax machine number saved — recipients won\'t be pointed at the office for replies.',
    });

    // --- Live Telnyx API probe ---
    if (!creds.apiKey) {
      checks.push({ id: 'telnyx_api_live', label: 'Live Telnyx API', status: 'fail', detail: 'Skipped — Telnyx API key not configured.' });
    } else {
      const probe = await probeTelnyxApi(creds.apiKey);
      checks.push({ id: 'telnyx_api_live', label: 'Live Telnyx API', status: probe.status, detail: probe.detail });
    }

    // Provisioning stats — rendered by PhoneProvisioningPanel under the live
    // checklist ("X/Y users have a work number").
    const allUsers = await base44.asServiceRole.entities.User.list('full_name', 2000).catch(() => []);
    const isSetStr = (v) => v != null && String(v).trim() !== '';
    const stats = {
      messaging_ready: Boolean(creds.apiKey),
      voice_ready: Boolean(creds.apiKey && creds.voiceConnectionId),
      fax_ready: Boolean(creds.apiKey && creds.faxConnectionId && faxFromValid),
      webhooks_verifiable: Boolean(creds.publicKey),
      total_users: allUsers.length,
      nurses_with_work_number: allUsers.filter((u) => isSetStr(u.work_phone_number)).length,
    };

    return Response.json({ success: true, checks, stats, generated_at: new Date().toISOString() });
  } catch (error) {
    console.error('testTelnyxConnection error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});