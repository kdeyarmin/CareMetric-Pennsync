import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * createTelehealthToken — mint a Telnyx Video join token for a telehealth
 * session, using the SAME authorization model as createTelehealthToken (the
 * Twilio Video path):
 *
 *  - PATIENT (guest) path: access via possession of the high-entropy, per-session
 *    join token carried in the private invite link (?t=...). Unguessable, scoped
 *    to one session, stops working once the visit is completed/cancelled.
 *  - STAFF path: only the authenticated host, a listed participant, or an admin
 *    may mint a grant.
 *
 * The Telnyx room is found-or-created by its unique_name (= session.room_name),
 * then a client token is generated for that room. Returns { token, room_id,
 * identity, room_name }.
 */

// A guest invite link (capability URL) is otherwise valid for as long as the
// session stays scheduled/active, so a forgotten or leaked link would grant
// audio/video access indefinitely. Bound the guest capability in time as well:
// reject joins more than this long past the scheduled start. 12h is generous
// enough to cover a full clinical day of early/late joins and reconnects while
// still expiring a stale link the same day. Staff joins are unaffected.
const GUEST_JOIN_WINDOW_MS = 12 * 60 * 60 * 1000;

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}

function extractJoinToken(inviteLink) {
  if (!inviteLink || typeof inviteLink !== 'string') return '';
  try {
    return new URL(inviteLink).searchParams.get('t') || '';
  } catch {
    const match = inviteLink.match(/[?&]t=([^&]+)/);
    return match ? decodeURIComponent(match[1]) : '';
  }
}

async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = pick(Deno.env.get('TELNYX_API_KEY'));
  if (!apiKey) {
    try {
      const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' });
      apiKey = pick(rows?.[0]?.api_key);
    } catch { /* ignore */ }
  }
  return { apiKey };
}

const TELNYX_API_BASE = 'https://api.telnyx.com/v2';

/** Find a Telnyx room by unique_name, creating it if it doesn't exist yet. */
async function findOrCreateRoom(apiKey, uniqueName) {
  const headers = { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
  const findUrl = `${TELNYX_API_BASE}/rooms?filter[unique_name]=${encodeURIComponent(uniqueName)}`;
  const findResp = await fetch(findUrl, { method: 'GET', headers });
  if (findResp.ok) {
    const found = await findResp.json().catch(() => ({}));
    const existing = Array.isArray(found?.data) ? found.data.find((r) => r.unique_name === uniqueName) : null;
    if (existing?.id) return existing.id;
  }
  const createResp = await fetch(`${TELNYX_API_BASE}/rooms`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ unique_name: uniqueName, enable_recording: false }),
  });
  const created = await createResp.json().catch(() => ({}));
  if (createResp.ok && created?.data?.id) return created.data.id;
  // A concurrent create can 422 on the unique_name — re-fetch before giving up.
  if (createResp.status === 422) {
    const retry = await fetch(findUrl, { method: 'GET', headers });
    if (retry.ok) {
      const found = await retry.json().catch(() => ({}));
      const existing = Array.isArray(found?.data) ? found.data.find((r) => r.unique_name === uniqueName) : null;
      if (existing?.id) return existing.id;
    }
  }
  const firstErr = Array.isArray(created?.errors) ? created.errors[0] : null;
  throw new Error(firstErr?.detail || firstErr?.title || `Could not provision Telnyx room (HTTP ${createResp.status})`);
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const { room_name, join_token } = await req.json();
    if (!room_name) return Response.json({ error: 'room_name is required' }, { status: 400 });

    const sessions = await base44.asServiceRole.entities.TelehealthSession.filter({ room_name }, '-created_date', 1);
    const session = sessions[0];
    if (!session) return Response.json({ error: 'Telehealth session not found' }, { status: 404 });

    let participantIdentity;

    if (join_token) {
      const expected = extractJoinToken(session.invite_link);
      if (!expected || !timingSafeEqual(String(join_token), expected)) {
        return Response.json({ error: 'Invalid or expired join link' }, { status: 403 });
      }
      if (session.status !== 'scheduled' && session.status !== 'active') {
        return Response.json({ error: 'This telehealth visit is no longer open' }, { status: 403 });
      }
      // Time-bound the capability token so a leaked/forgotten invite link can't
      // grant A/V access indefinitely. Fail open when scheduled_at is absent,
      // consistent with the rest of the codebase's "unknown → allow" convention.
      const scheduledAtMs = session.scheduled_at ? Date.parse(session.scheduled_at) : NaN;
      if (Number.isFinite(scheduledAtMs) && Date.now() - scheduledAtMs > GUEST_JOIN_WINDOW_MS) {
        return Response.json({ error: 'This telehealth invite link has expired' }, { status: 403 });
      }
      participantIdentity = session.patient_name || 'Patient';
    } else {
      const user = await base44.auth.me();
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      // Authorize on stable identity only (email / role), never on the mutable,
      // non-unique full_name: participant_list contains the patient's display name,
      // so a full_name match would let any authenticated user rename themselves to a
      // patient's name and join that patient's session. The host is covered by
      // host_email; supervisors by the admin role.
      const participants = Array.isArray(session.participant_list) ? session.participant_list : [];
      const authorized = user.role === 'admin'
        || session.host_email === user.email
        || participants.includes(user.email);
      if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 });
      participantIdentity = user.full_name || user.email;
    }

    const { apiKey } = await resolveTelnyxCreds(base44);
    if (!apiKey) return Response.json({ error: 'Telnyx credentials not configured' }, { status: 500 });

    const roomId = await findOrCreateRoom(apiKey, String(room_name));

    // Mint a per-session client token for this room (1 hour TTL, matching the
    // Twilio path). The token authorizes the bearer to join this room only.
    const tokenResp = await fetch(`${TELNYX_API_BASE}/rooms/${roomId}/actions/generate_join_client_token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token_ttl_secs: 3600, refresh_token_ttl_secs: 3600 }),
    });
    const tokenData = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData?.data?.token) {
      const firstErr = Array.isArray(tokenData?.errors) ? tokenData.errors[0] : null;
      console.error('Telnyx video token error', { status: tokenResp.status, code: firstErr?.code });
      return Response.json({ error: 'Could not mint a Telnyx video token' }, { status: 502 });
    }

    return Response.json({
      token: tokenData.data.token,
      refresh_token: tokenData.data.refresh_token || null,
      room_id: roomId,
      room_name,
      identity: participantIdentity,
      host_name: session.host_name || null,
    });
  } catch (error) {
    console.error('createTelnyxVideoToken error:', error?.message);
    return Response.json({ error: 'Failed to create video token' }, { status: 500 });
  }
});