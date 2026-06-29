import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * cancelScheduledSms — cancel a still-pending scheduled text. A nurse may cancel
 * their own; an admin may cancel any. Only 'pending' rows can be canceled (one
 * that's already sending/sent can't be recalled).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { scheduled_id } = await req.json();
    if (!scheduled_id) return Response.json({ error: 'Missing scheduled_id' }, { status: 400 });

    const rows = await base44.asServiceRole.entities.ScheduledSms.filter({ id: scheduled_id }).catch(() => []);
    const row = rows[0];
    if (!row) return Response.json({ error: 'Scheduled message not found' }, { status: 404 });

    if (row.nurse_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'You can only cancel your own scheduled messages' }, { status: 403 });
    }
    if (row.status !== 'pending') {
      return Response.json({ error: `This message can no longer be canceled (status: ${row.status}).` }, { status: 409 });
    }

    await base44.asServiceRole.entities.ScheduledSms.update(row.id, {
      status: 'canceled',
      canceled_by: user.email,
      canceled_at: new Date().toISOString(),
    });

    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'sms_schedule_canceled',
      entity_type: 'ScheduledSms',
      entity_id: row.id,
      details: { to_number: row.to_number, send_at: row.send_at, timestamp: new Date().toISOString() },
      status: 'success',
    }).catch((err) => console.error('Failed to log activity:', err));

    return Response.json({ success: true, scheduled_id: row.id });
  } catch (error) {
    console.error('cancelScheduledSms error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});