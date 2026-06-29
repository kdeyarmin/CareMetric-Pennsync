import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * searchPurchaseTelnyxNumbers — admin-only. Search Telnyx for available local
 * phone numbers and order one straight into the local pool (PhoneNumber), so an
 * admin never has to leave the app to provision a line. Replaces the old Twilio
 * numbers flow.
 *
 * Body: { action: 'search'|'purchase', ... }
 *   - search   { area_code?, country?, limit? }
 *   - purchase { e164, label? }
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

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin' ||
      user.account_type === 'agency_admin' ||
      String(user.email || '').trim().toLowerCase() === ((Deno.env.get('SUPER_ADMIN_EMAIL') || '').trim().toLowerCase() || null);
    if (!isAdmin) return Response.json({ error: 'Only administrators can manage numbers.' }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || '');

    const { apiKey, messagingProfileId, voiceConnectionId } = await resolveTelnyxCreds(base44);
    if (!apiKey) {
      return Response.json({ error: 'Telnyx API credentials not configured.' }, { status: 500 });
    }

    const authHeaders = { 'Authorization': `Bearer ${apiKey}`, 'Accept': 'application/json' };

    if (action === 'search') {
      const country = String(body.country || 'US').toUpperCase();
      const areaCode = body.area_code ? String(body.area_code).replace(/[^\d]/g, '') : '';
      const limit = Math.min(Number(body.limit) || 20, 50);
      // Telnyx available-numbers search: filter on country + features + (optional)
      // national destination code (US area code). Only SMS+voice capable locals.
      const qs = new URLSearchParams();
      qs.set('filter[country_code]', country);
      qs.set('filter[phone_number_type]', 'local');
      qs.append('filter[features][]', 'sms');
      qs.append('filter[features][]', 'voice');
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
      return Response.json({ success: true, count: numbers.length, numbers });
    }

    if (action === 'purchase') {
      const e164 = normalizeE164(body.e164);
      if (!e164) return Response.json({ error: 'Enter a valid number to purchase.' }, { status: 400 });

      // Don't double-buy: if it's already in the pool, just report it.
      const existing = await base44.asServiceRole.entities.PhoneNumber.filter({ e164 }).catch(() => []);
      if (existing.length > 0) {
        return Response.json({ success: true, already_in_pool: true, e164 });
      }

      // Create a Telnyx number order. Attach the messaging profile + voice
      // connection so the number is immediately usable for SMS and Call Control.
      const orderBody = { phone_numbers: [{ phone_number: e164 }] };
      if (messagingProfileId) orderBody.messaging_profile_id = messagingProfileId;
      if (voiceConnectionId) orderBody.connection_id = voiceConnectionId;
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
        label: typeof body.label === 'string' ? body.label.trim() : '',
        status: 'available',
        twilio_phone_number_sid: telnyxNumberId || '',
        notes: 'Purchased in-app via Telnyx numbers API',
      });
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email, user_name: user.full_name,
        action: 'phone_number_purchased', entity_type: 'PhoneNumber', entity_id: row.id,
        details: { e164, telnyx_number_id: telnyxNumberId, timestamp: new Date().toISOString() }, status: 'success',
      }).catch(() => {});
      return Response.json({ success: true, e164, id: row.id, telnyx_number_id: telnyxNumberId });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('searchPurchaseTelnyxNumbers error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});