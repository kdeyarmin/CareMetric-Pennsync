import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Server-owned telehealth session broker. Every action is scoped to the
// authenticated clinician (host_email); admins may see/manage all sessions.
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomHex = (n: number) => hex(crypto.getRandomValues(new Uint8Array(n)).buffer);
const sha256 = async (s: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
const FIELDS = ['room_name', 'patient_id', 'patient_name', 'host_email', 'host_name', 'status', 'scheduled_at',
  'started_at', 'ended_at', 'duration_minutes', 'visit_type', 'chief_complaint', 'assessment', 'plan', 'notes',
  'follow_up_needed', 'follow_up_timeframe', 'join_token_hash', 'invite_link'];
const UPDATABLE = ['status', 'notes', 'chief_complaint', 'assessment', 'plan', 'follow_up_needed', 'follow_up_timeframe', 'participant_list', 'vitals_captured', 'medications_reviewed', 'prescriptions_sent'];

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.email) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  const isAdmin = user.role === 'admin';
  const Sessions = base44.asServiceRole.entities.TelehealthSession;
  const body = await req.json().catch(() => ({}));
  const { action } = body;

  const loadOwned = async (id: string) => {
    const s = id ? await Sessions.get(id).catch(() => null) : null;
    if (!s || (!isAdmin && String(s.host_email).toLowerCase() !== user.email.toLowerCase())) return null;
    return s;
  };

  if (action === 'list') {
    const query: Record<string, unknown> = isAdmin && body.all ? {} : { host_email: user.email };
    if (body.patient_id) query.patient_id = body.patient_id;
    const page = await Sessions.filter(query, { sort: '-scheduled_at', limit: 50, fields: FIELDS });
    return Response.json({ sessions: page.items || [] });
  }

  if (action === 'create') {
    const patientName = String(body.patient_name || '').trim().slice(0, 200);
    if (!patientName) return Response.json({ error: 'Patient name is required' }, { status: 400 });
    const token = randomHex(32);
    const session = await Sessions.create({
      room_name: `th-${randomHex(12)}`,
      patient_id: body.patient_id || undefined,
      patient_name: patientName,
      host_email: user.email,
      host_name: user.full_name || user.email,
      status: 'scheduled',
      scheduled_at: body.scheduled_at || new Date().toISOString(),
      visit_type: body.visit_type || 'routine_followup',
      chief_complaint: body.chief_complaint || undefined,
      join_token_hash: await sha256(token),
    });
    return Response.json({ session, join_token: token });
  }

  const session = await loadOwned(body.session_id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

  if (action === 'update') {
    const patch: Record<string, unknown> = {};
    for (const k of UPDATABLE) if (k in (body.data || {})) patch[k] = body.data[k];
    if (patch.status === 'active' && !session.started_at) patch.started_at = new Date().toISOString();
    if (patch.status === 'completed') {
      patch.ended_at = new Date().toISOString();
      if (session.started_at) patch.duration_minutes = Math.round((Date.now() - Date.parse(session.started_at)) / 60000);
    }
    return Response.json({ session: await Sessions.update(session.id, patch) });
  }

  return Response.json({ error: 'Unknown action' }, { status: 400 });
});