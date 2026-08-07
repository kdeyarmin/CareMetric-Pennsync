import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


/**
 * createTelehealthToken — mint a Telnyx Video join token for a telehealth
 * session. Two authorization paths:
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

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Guest tokens are stored hashed at rest (session.join_token_hash) so a leaked
 * database export or over-broad entity read can't be replayed into live A/V
 * access. Pre-hash sessions still carry the plaintext token inside invite_link;
 * fall back to that ONLY when no hash exists, so links already texted to
 * patients keep working until those sessions age out.
 */
async function isValidGuestToken(session, providedToken) {
  if (session.join_token_hash) {
    const providedHash = await sha256Hex(providedToken);
    return timingSafeEqual(providedHash, String(session.join_token_hash));
  }
  const expected = extractJoinToken(session.invite_link);
  return !!expected && timingSafeEqual(String(providedToken), expected);
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
      if (!(await isValidGuestToken(session, join_token))) {
        return Response.json({ error: 'Invalid or expired join link' }, { status: 403 });
      }
      if (session.status !== 'scheduled' && session.status !== 'active') {
        return Response.json({ error: 'This telehealth visit is no longer open' }, { status: 403 });
      }
      // Time-bound the capability token so a leaked/forgotten invite link can't
      // grant A/V access indefinitely. Fail CLOSED when scheduled_at is absent —
      // fall back to created_date, otherwise reject (unknown → allow let stale
      // invites live forever).
      const scheduledAtMs = session.scheduled_at ? Date.parse(session.scheduled_at) : NaN;
      const createdAtMs = session.created_date ? Date.parse(session.created_date) : NaN;
      const anchorMs = Number.isFinite(scheduledAtMs) ? scheduledAtMs
        : (Number.isFinite(createdAtMs) ? createdAtMs : NaN);
      if (!Number.isFinite(anchorMs)) {
        return Response.json({ error: 'This telehealth invite link has expired' }, { status: 403 });
      }
      if (Date.now() - anchorMs > GUEST_JOIN_WINDOW_MS) {
        return Response.json({ error: 'This telehealth invite link has expired' }, { status: 403 });
      }
      participantIdentity = session.patient_name || 'Patient';
    } else {
      const user = await base44.auth.me();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
      if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
      if (user.is_active === false) {
        return Response.json({ error: 'Unauthorized - account is deactivated' }, { status: 403 });
      }
      // Authorize on stable identity only (email / role), never on the mutable,
      // non-unique full_name: participant_list contains the patient's display name,
      // so a full_name match would let any authenticated user rename themselves to a
      // patient's name and join that patient's session. The host is covered by
      // host_email; supervisors by admin-like roles (agency-scoped below).
      const participants = Array.isArray(session.participant_list) ? session.participant_list : [];
      const isHostOrParticipant = session.host_email === user.email
        || participants.includes(user.email);
      const isAdminLike = user.role === 'admin'
        || user.account_type === 'agency_admin'
        || user.account_type === 'super_admin';
      if (!isHostOrParticipant && !isAdminLike) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      // Agency-scoped admins may supervise only sessions hosted by their agency.
      const isAgencyScopedAdmin = !isHostOrParticipant
        && user.account_type !== 'super_admin'
        && user.agency_name
        && (user.account_type === 'agency_admin' || user.role === 'admin');
      if (isAgencyScopedAdmin) {
        const [host] = await base44.asServiceRole.entities.User
          .filter({ email: session.host_email }, '-created_date', 1).catch(() => []);
        if (!host?.agency_name || host.agency_name !== user.agency_name) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }
      participantIdentity = user.full_name || user.email;
    }

    const telnyxCreds = await resolveTelnyxCreds(base44);

    const { apiKey } = telnyxCreds;
    if (!apiKey) return Response.json({ error: telnyxCredsMessage(telnyxCreds, "credentials") }, { status: 500 });

    const roomId = await findOrCreateRoom(apiKey, String(room_name));

    // Mint a per-session client token for this room. The token authorizes the
    // bearer to join this room only, and expires after an hour — long enough for
    // a full visit, short enough that a captured token is not a standing grant.
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