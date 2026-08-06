import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * rotateTelehealthJoinToken — mint (or re-mint) the patient's guest join token
 * for a telehealth session, storing only its SHA-256 hash at rest.
 *
 * The raw token is returned once to the authorized STAFF caller (host, listed
 * participant, or admin), who builds the patient invite link client-side. Any
 * previously issued token for the session stops working — rotation is the
 * point: staff re-sending a link get a fresh capability, and a link that
 * leaked earlier dies with the rotation.
 *
 * Guest joins validate against join_token_hash in createTelehealthToken, so
 * the plaintext capability never needs to be persisted anywhere.
 */

function generateToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { session_id } = await req.json();
    if (!session_id) return Response.json({ error: 'session_id is required' }, { status: 400 });

    const sessions = await base44.asServiceRole.entities.TelehealthSession.filter({ id: session_id }, undefined, 1);
    const session = sessions[0];
    if (!session) return Response.json({ error: 'Telehealth session not found' }, { status: 404 });

    // Same staff predicate as createTelehealthToken: stable identity only
    // (email/role), never the mutable, non-unique full_name.
    const participants = Array.isArray(session.participant_list) ? session.participant_list : [];
    const authorized = user.role === 'admin'
      || user.account_type === 'agency_admin'
      || user.account_type === 'super_admin'
      || session.host_email === user.email
      || participants.includes(user.email);
    if (!authorized) return Response.json({ error: 'Forbidden' }, { status: 403 });

    if (session.status !== 'scheduled' && session.status !== 'active') {
      return Response.json({ error: 'This telehealth visit is no longer open' }, { status: 409 });
    }

    const token = generateToken();
    const join_token_hash = await sha256Hex(token);
    // Rotating also retires any legacy plaintext invite_link: once a hash
    // exists, createTelehealthToken ignores invite_link entirely, so clear it
    // rather than leave a stale (now-dead) capability URL at rest.
    await base44.asServiceRole.entities.TelehealthSession.update(session.id, {
      join_token_hash,
      invite_link: null,
    });

    return Response.json({ success: true, token, room_name: session.room_name });
  } catch (error) {
    console.error('rotateTelehealthJoinToken error:', error?.message);
    return Response.json({ error: 'Failed to rotate the join token' }, { status: 500 });
  }
});
