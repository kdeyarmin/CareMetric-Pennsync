import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


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
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { scheduled_id } = await req.json();
    if (!scheduled_id) return Response.json({ error: 'Missing scheduled_id' }, { status: 400 });

    const rows = await base44.asServiceRole.entities.ScheduledSms.filter({ id: scheduled_id }, undefined, 5000).catch(() => []);
    const row = rows[0];
    if (!row) return Response.json({ error: 'Scheduled message not found' }, { status: 404 });

    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isAdminLike = isPlatformAdmin || isAgencyScopedAdmin;
    if (row.nurse_email !== user.email && !isAdminLike) {
      return Response.json({ error: 'You can only cancel your own scheduled messages' }, { status: 403 });
    }
    // Agency-scope: facility/agency admins must not cancel another tenant's SMS.
    // Fail closed when the owner has no agency_name (orphan) — unknown tenant.
    if (row.nurse_email !== user.email && isAgencyScopedAdmin) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden: agency_name is required' }, { status: 403 });
      }
      const [owner] = await base44.asServiceRole.entities.User
        .filter({ email: row.nurse_email }, '-created_date', 1).catch(() => []);
      if (!owner?.agency_name || owner.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: message is outside your agency' }, { status: 403 });
      }
    }
    if (row.status !== 'pending') {
      return Response.json({ error: `This message can no longer be canceled (status: ${row.status}).` }, { status: 409 });
    }

    // The cancel write races the dispatcher's claim (pending -> sending). The
    // dispatcher re-reads the row after claiming and honors canceled_at (which
    // its claim never clears), so writing canceled_at here is what makes a
    // cancel that lands mid-claim actually stop the send.
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
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});