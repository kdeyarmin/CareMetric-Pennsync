import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

// Inbox broker: returns only verified messages the signed-in user participates
// in for an agency they hold an active membership in, plus that agency's
// active staff directory for composing new threads.
Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user?.id) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const agencyId = typeof body.agency_id === 'string' ? body.agency_id : '';
  if (!agencyId) return Response.json({ error: 'agency_id is required' }, { status: 400 });

  const db = base44.asServiceRole.entities;
  const mine = await db.AgencyMembership.filter({ agency_id: agencyId, user_id: user.id, status: 'active' });
  if (mine.length !== 1) return Response.json({ error: 'No active membership for agency' }, { status: 403 });

  const page = await db.Message.filter(
    { agency_id: agencyId, provenance_status: 'verified_v2', participant_user_ids: user.id },
    { sort: '-created_date', limit: 300, fields: ['id', 'thread_id', 'thread_subject', 'sender_user_id', 'sender_name', 'message_text', 'priority', 'created_date', 'read_by_user_ids', 'participant_user_ids'] },
  );

  const members = await db.AgencyMembership.filter(
    { agency_id: agencyId, status: 'active' },
    { limit: 500, fields: ['user_id', 'user_email_normalized', 'tenant_role'] },
  );
  const users = await db.User.filter({ id: { $in: members.items.map((m) => m.user_id) } });
  const nameById = new Map(users.map((u) => [u.id, u.full_name || u.email]));

  return Response.json({
    me: user.id,
    messages: page.items,
    directory: members.items
      .filter((m) => m.user_id !== user.id)
      .map((m) => ({ id: m.user_id, name: nameById.get(m.user_id) || m.user_email_normalized, role: m.tenant_role })),
  });
});