import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * searchPurchaseTelnyxNumbers — admin-only. Search Telnyx for available local
 * phone numbers and order one straight into the local pool (PhoneNumber), so an
 * admin never has to leave the app to provision a line.
 *
 * Body: { action: 'search'|'purchase'|'provision_fax', ... }
 *   - search        { area_code?, country?, limit?, purpose? }
 *   - purchase      { e164, label?, purpose?, set_as_outbound_fax? }
 *   - provision_fax { e164?, set_as_outbound_fax? }
 *
 * `purpose` selects what the number is for and how it is wired at order time:
 *   - 'voice_sms' (default) — a nurse line. Search filters SMS+voice-capable
 *     numbers; purchase attaches the messaging profile + voice connection.
 *   - 'fax' — the single blind OUTBOUND fax line. Search filters fax-capable
 *     numbers; purchase attaches the Programmable Fax connection instead, and
 *     (unless set_as_outbound_fax === false) stores the number as
 *     AgencySettings.outbound_fax_number_e164, the technical from sendFax /
 *     sendBatchFax transmit with. Recipients never reply to it: outbound faxes
 *     are presented under the OFFICE fax number (office_fax_number_e164, the
 *     physical office machine), so fax-backs go straight to the office and the
 *     app expects no inbound faxes.
 *
 * `provision_fax` provisions fax capacity on a number the account ALREADY owns:
 * it looks the number up in Telnyx, re-points its connection at the Programmable
 * Fax connection, and stores it as the outbound fax line. Use it when the fax
 * line was purchased outside the app (or bought in-app before fax support).
 *
 * The purchased Telnyx phone-number id is stored in the existing
 * PhoneNumber.twilio_phone_number_sid field (kept as a provider-neutral
 * identifier column to avoid a live-data migration).
 */

const REQUEST_TIMEOUT_MS = 15000;

function normalizeE164(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/[^\d]/g, '');
  // Already-+ international is decided FIRST and never falls through to the NANP
  // branches. A 10-digit international number ("+49 89 123456") was otherwise
  // rewritten as an unrelated "+1..." US subscriber, which also slipped past the
  // +1-only international cost control. Mirrors src/components/voice/phoneUtils.js.
  if (String(raw).trim().startsWith('+')) {
    return digits.length >= 8 && digits.length <= 15 && digits[0] !== '0' ? `+${digits}` : null;
  }
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

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

async function fetchJson(url, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const data = await resp.json().catch(() => ({}));
    return { ok: resp.ok, status: resp.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

// Store `e164` as the outbound fax line on the caller's agency settings row
// (not newest-row-wins — multi-tenant must not overwrite another agency's line).
async function setOutboundFaxNumber(base44, e164, agencyName) {
  const row = await resolveAgencySettings(base44, agencyName);
  if (row?.id) {
    await base44.asServiceRole.entities.AgencySettings.update(row.id, { outbound_fax_number_e164: e164 });
  } else {
    const createPayload = { outbound_fax_number_e164: e164 };
    if (agencyName) createPayload.agency_code = agencyName;
    await base44.asServiceRole.entities.AgencySettings.create(createPayload);
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin';
    if (!isAdmin) return Response.json({ error: 'Only administrators can manage numbers.' }, { status: 403 });
    // Fail closed: an agency_admin without an agency_name would resolve to no
    // agency, so a fax provision would overwrite a lone tenant's outbound fax
    // line or create an unscoped AgencySettings row that no sender ever resolves
    // (reporting success while every send stays "not configured").
    if (user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
      return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const purpose = body.purpose === 'fax' ? 'fax' : 'voice_sms';

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey, messagingProfileId, voiceConnectionId, faxConnectionId } = telnyxCreds;
    if (!apiKey) {
      return Response.json({ error: telnyxCredsMessage(telnyxCreds, "API credentials") }, { status: 500 });
    }

    const authHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' };

    const audit = (auditAction, details) =>
      base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: auditAction, entity_type: 'PhoneNumber',
        details: { ...details, timestamp: new Date().toISOString() }, status: 'success',
      }).catch(() => {});

    // Point an already-owned Telnyx number at the Programmable Fax connection
    // and (optionally) store it as the outbound fax line. Shared by the
    // 'provision_fax' action and a fax-purpose purchase of a number that's
    // already in the pool.
    async function provisionExistingFax(e164, { setAsOutboundFax }) {
      // Resolve the Telnyx phone-number id by looking the number up in the
      // account (authoritative — the locally stored id can be a number-ORDER id
      // from an old purchase, which the phone_numbers PATCH would reject).
      const poolRows = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 5000).catch(() => []);
      const lookup = await fetchJson(
        `${TELNYX_API_BASE}/phone_numbers?filter[phone_number]=${encodeURIComponent(e164)}`,
        { method: 'GET', headers: authHeaders },
      ).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
      if (!lookup.ok) {
        return Response.json({ error: 'Could not look the number up in Telnyx.', status: lookup.status, details: lookup.data }, { status: 502 });
      }
      const owned = Array.isArray(lookup.data?.data) ? lookup.data.data : [];
      const numberId = owned[0]?.id || null;
      if (!numberId) {
        return Response.json({ error: `${e164} isn't in your Telnyx account. Purchase it first, then provision fax on it.` }, { status: 404 });
      }

      const patch = await fetchJson(`${TELNYX_API_BASE}/phone_numbers/${encodeURIComponent(numberId)}`, {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ connection_id: faxConnectionId }),
      }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
      if (!patch.ok) {
        const firstErr = Array.isArray(patch.data?.errors) ? patch.data.errors[0] : null;
        return Response.json({ error: 'Telnyx rejected the fax-connection update.', status: patch.status, details: firstErr || patch.data }, { status: 502 });
      }

      if (setAsOutboundFax) await setOutboundFaxNumber(base44, e164, user?.agency_name);
      // Refresh the stored id from the authoritative lookup (it may hold a
      // number-order id from an old in-app purchase).
      if (poolRows[0]?.id && poolRows[0].twilio_phone_number_sid !== numberId) {
        await base44.asServiceRole.entities.PhoneNumber.update(poolRows[0].id, { twilio_phone_number_sid: numberId }).catch(() => {});
      }
      await audit('fax_capacity_provisioned', { e164, telnyx_number_id: numberId, set_as_outbound_fax: setAsOutboundFax });
      return Response.json({ success: true, e164, telnyx_number_id: numberId, fax_connection_id: faxConnectionId, outbound_fax_set: setAsOutboundFax });
    }

    if (action === 'search') {
      const country = String(body.country || 'US').toUpperCase();
      const areaCode = body.area_code ? String(body.area_code).replace(/[^\d]/g, '') : '';
      const limit = Math.min(Number(body.limit) || 20, 50);
      // Telnyx available-numbers search: filter on country + features + (optional)
      // national destination code (US area code). Feature set follows `purpose`:
      // fax lines need fax capability; nurse lines need SMS + voice.
      const qs = new URLSearchParams();
      qs.set('filter[country_code]', country);
      qs.set('filter[phone_number_type]', 'local');
      if (purpose === 'fax') {
        qs.append('filter[features][]', 'fax');
      } else {
        qs.append('filter[features][]', 'sms');
        qs.append('filter[features][]', 'voice');
      }
      qs.set('filter[limit]', String(limit));
      if (areaCode) qs.set('filter[national_destination_code]', areaCode);
      const url = `${TELNYX_API_BASE}/available_phone_numbers?${qs.toString()}`;
      const res = await fetchJson(url, { method: 'GET', headers: authHeaders })
        .catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
      if (!res.ok) {
        return Response.json({ error: 'Telnyx number search failed.', status: res.status, details: res.data }, { status: 502 });
      }
      const list = Array.isArray(res.data?.data) ? res.data.data : [];
      const numbers = list.map((n) => ({ e164: normalizeE164(n.phone_number) })).filter((n) => n.e164);
      return Response.json({ success: true, count: numbers.length, numbers, purpose });
    }

    if (action === 'purchase') {
      const e164 = normalizeE164(body.e164);
      if (!e164) return Response.json({ error: 'Enter a valid number to purchase.' }, { status: 400 });
      const setAsOutboundFax = purpose === 'fax' && body.set_as_outbound_fax !== false;
      if (purpose === 'fax' && !faxConnectionId) {
        return Response.json({ error: 'Add your Telnyx fax connection id first (Telnyx Credentials → Advanced) so the number can be wired for fax.' }, { status: 400 });
      }

      // Don't double-buy: if it's already in the pool, just report it — but a
      // fax-purpose "purchase" of an owned number still provisions fax on it,
      // so the admin's intent (make this my fax line) is honored either way.
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }, undefined, 5000).catch(() => []);
      if (existing.length > 0) {
        if (purpose === 'fax') return await provisionExistingFax(e164, { setAsOutboundFax });
        return Response.json({ success: true, already_in_pool: true, e164 });
      }

      // Create a Telnyx number order. Attach the connection matching the
      // purpose so the number is immediately usable: messaging profile + voice
      // connection for a nurse line, the Programmable Fax connection for the
      // office fax line.
      const orderBody = { phone_numbers: [{ phone_number: e164 }] };
      // A nurse line with no voice/messaging connection still ORDERS fine, but
      // it can't route calls/texts until wired. We allow the purchase (admins
      // may intentionally buy first, wire later) but return a warning so the UI
      // can tell them what's still needed rather than leaving a silent dud.
      const warnings = [];
      if (purpose === 'fax') {
        orderBody.connection_id = faxConnectionId;
      } else {
        if (messagingProfileId) orderBody.messaging_profile_id = messagingProfileId;
        else warnings.push('No Messaging Profile is set, so this number can\'t send texts yet — add the Messaging Profile ID in Telnyx Credentials.');
        if (voiceConnectionId) orderBody.connection_id = voiceConnectionId;
        else warnings.push('No Voice (Call Control) connection is set, so this number can\'t route calls yet — add the Voice connection ID in Telnyx Credentials.');
      }
      const res = await fetchJson(`${TELNYX_API_BASE}/number_orders`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(orderBody),
      }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));

      if (!res.ok) {
        const firstErr = Array.isArray(res.data?.errors) ? res.data.errors[0] : null;
        return Response.json({ error: 'Telnyx number purchase failed.', status: res.status, details: firstErr || res.data }, { status: 502 });
      }

      // The ordered number's Telnyx id (phone_numbers[0].id) is the durable
      // identifier; fall back to the order id.
      const orderedNumber = Array.isArray(res.data?.data?.phone_numbers) ? res.data.data.phone_numbers[0] : null;
      const telnyxNumberId = orderedNumber?.id || res.data?.data?.id || null;
      const row = await base44.asServiceRole.entities.PhoneNumber.create({
        e164,
        label: typeof body.label === 'string' && body.label.trim()
          ? body.label.trim()
          : (purpose === 'fax' ? 'Outbound fax line' : ''),
        status: 'available',
        twilio_phone_number_sid: telnyxNumberId || '',
        notes: purpose === 'fax'
          ? 'Purchased in-app via Telnyx numbers API (fax line — attached to the Programmable Fax connection)'
          : 'Purchased in-app via Telnyx numbers API',
      });
      if (setAsOutboundFax) await setOutboundFaxNumber(base44, e164, user?.agency_name);

      // Auto-enroll a new SMS-capable line in the agency's approved A2P 10DLC
      // campaign (AgencySettings.a2p_campaign_id) so its texts are carrier-
      // registered from day one — an unregistered US 10DLC number is heavily
      // filtered. Fax lines don't text, so they skip this. A failure here is a
      // WARNING, not a failed purchase: the number is owned either way and can
      // be enrolled manually in the Telnyx portal.
      let campaignAssigned = false;
      if (purpose !== 'fax') {
        const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
        const campaignId = String(agencySettings?.a2p_campaign_id || '').trim();
        if (!campaignId) {
          warnings.push('No A2P 10DLC campaign id is saved in Agency Settings, so this number was NOT campaign-registered — US carriers may filter its texts until you register it.');
        } else {
          const assign = await fetchJson(`${TELNYX_API_BASE}/10dlc/phone_number_campaigns`, {
            method: 'POST',
            headers: { ...authHeaders, 'Content-Type': 'application/json' },
            body: JSON.stringify({ phoneNumber: e164, campaignId }),
          }).catch((err) => ({ ok: false, status: 0, data: { message: String(err?.message || err) } }));
          if (assign.ok) {
            campaignAssigned = true;
          } else {
            const firstErr = Array.isArray(assign.data?.errors) ? assign.data.errors[0] : null;
            warnings.push(`Purchased, but enrolling it in A2P campaign ${campaignId} failed (${firstErr?.detail || firstErr?.title || `HTTP ${assign.status}`}) — enroll it in the Telnyx portal or its texts may be carrier-filtered.`);
          }
        }
      }

      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'phone_number_purchased', entity_type: 'PhoneNumber', entity_id: row.id,
        details: { e164, telnyx_number_id: telnyxNumberId, purpose, set_as_outbound_fax: setAsOutboundFax, campaign_assigned: campaignAssigned, warnings, timestamp: new Date().toISOString() }, status: 'success',
      }).catch(() => {});
      return Response.json({ success: true, e164, id: row.id, telnyx_number_id: telnyxNumberId, purpose, outbound_fax_set: setAsOutboundFax, campaign_assigned: campaignAssigned, warnings });
    }

    if (action === 'provision_fax') {
      // Default to the currently configured office fax number so "make my fax
      // line actually work" is a one-click action.
      let e164 = normalizeE164(body.e164);
      if (!e164 && !body.e164) {
        const agencySettings = await resolveAgencySettings(base44, user?.agency_name);
        e164 = normalizeE164(agencySettings?.office_fax_number_e164);
      }
      if (!e164) return Response.json({ error: 'Enter a valid fax number to provision.' }, { status: 400 });
      if (!faxConnectionId) {
        return Response.json({ error: 'Add your Telnyx fax connection id first (Telnyx Credentials → Advanced) so the number can be wired for fax.' }, { status: 400 });
      }
      return await provisionExistingFax(e164, { setAsOutboundFax: body.set_as_outbound_fax !== false });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('searchPurchaseTelnyxNumbers error:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
