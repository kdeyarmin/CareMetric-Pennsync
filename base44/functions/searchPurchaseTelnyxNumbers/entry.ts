import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * searchPurchaseTelnyxNumbers — admin-only. Search Telnyx for available local
 * phone numbers and order one straight into the local pool (PhoneNumber), so an
 * admin never has to leave the app to provision a line. Replaces the old Telnyx
 * numbers flow.
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
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(raw).trim().startsWith('+') && digits.length >= 8 && digits.length <= 15 && digits[0] !== '0') return `+${digits}`;
  return null;
}

async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = null;
  let publicKey = null;
  let messagingProfileId = null;
  let voiceConnectionId = null;
  let faxConnectionId = null;
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' }, undefined, 5000);
    const rec = rows?.[0] || {};
    apiKey = pick(rec.api_key);
    publicKey = pick(rec.public_key);
    messagingProfileId = pick(rec.messaging_profile_id);
    voiceConnectionId = pick(rec.voice_connection_id);
    faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

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

// Store `e164` as the single blind OUTBOUND fax line (the technical `from`
// every outbound fax transmits with; presented to recipients under the office
// fax number). One AgencySettings row is the source of truth app-wide (newest
// row wins everywhere it's read).
async function setOutboundFaxNumber(base44, e164) {
  const rows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
  if (rows[0]?.id) {
    await base44.asServiceRole.entities.AgencySettings.update(rows[0].id, { outbound_fax_number_e164: e164 });
  } else {
    await base44.asServiceRole.entities.AgencySettings.create({ outbound_fax_number_e164: e164 });
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
      user.account_type === 'agency_admin';
    if (!isAdmin) return Response.json({ error: 'Only administrators can manage numbers.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');
    const purpose = body.purpose === 'fax' ? 'fax' : 'voice_sms';

    const { apiKey, messagingProfileId, voiceConnectionId, faxConnectionId } = await resolveTelnyxCreds(base44);
    if (!apiKey) {
      return Response.json({ error: 'Telnyx API credentials not configured.' }, { status: 500 });
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

      if (setAsOutboundFax) await setOutboundFaxNumber(base44, e164);
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
      if (purpose === 'fax') {
        orderBody.connection_id = faxConnectionId;
      } else {
        if (messagingProfileId) orderBody.messaging_profile_id = messagingProfileId;
        if (voiceConnectionId) orderBody.connection_id = voiceConnectionId;
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
      if (setAsOutboundFax) await setOutboundFaxNumber(base44, e164);
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'phone_number_purchased', entity_type: 'PhoneNumber', entity_id: row.id,
        details: { e164, telnyx_number_id: telnyxNumberId, purpose, set_as_outbound_fax: setAsOutboundFax, timestamp: new Date().toISOString() }, status: 'success',
      }).catch(() => {});
      return Response.json({ success: true, e164, id: row.id, telnyx_number_id: telnyxNumberId, purpose, outbound_fax_set: setAsOutboundFax });
    }

    if (action === 'provision_fax') {
      // Default to the currently configured office fax number so "make my fax
      // line actually work" is a one-click action.
      let e164 = normalizeE164(body.e164);
      if (!e164 && !body.e164) {
        const rows = await base44.asServiceRole.entities.AgencySettings.list('-created_date', 1).catch(() => []);
        e164 = normalizeE164(rows[0]?.office_fax_number_e164);
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
