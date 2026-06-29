import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * cancelTimeOffRequest — withdraw a time-off request.
 *
 * Only the employee who owns the request (or an admin) may cancel it, and only
 * while it is still pending or approved. The write uses the service role
 * because the TimeOffRequest entity limits direct writes to admins.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { request_id } = (await req.json()) || {};
    if (!request_id) {
      return Response.json({ error: 'request_id is required.' }, { status: 400 });
    }

    const request = await base44.asServiceRole.entities.TimeOffRequest.get(request_id).catch(() => null);
    if (!request) {
      return Response.json({ error: 'Time-off request not found.' }, { status: 404 });
    }

    const isOwner = request.employee_email === user.email || request.created_by === user.email;
    if (!isOwner && user.role !== 'admin') {
      return Response.json({ error: 'You can only cancel your own time-off requests.' }, { status: 403 });
    }

    if (!['pending', 'approved'].includes(request.status)) {
      return Response.json({ error: `A ${request.status} request cannot be cancelled.` }, { status: 409 });
    }

    const updated = await base44.asServiceRole.entities.TimeOffRequest.update(request_id, {
      status: 'cancelled',
    });

    // If a manager had this on their plate, let them know it was withdrawn.
    try {
      if (request.status === 'approved' && request.manager_email && request.manager_email !== user.email) {
        const who = request.employee_name || request.employee_email;
        const prettyType = request.request_type.replace(/_/g, ' ');
        await base44.asServiceRole.entities.Notification.create({
          user_email: request.manager_email,
          title: 'Time off cancelled',
          message: `${who} cancelled their ${prettyType} (${request.start_date} → ${request.end_date}).`,
          type: 'info',
          priority: 'low',
          action_url: '/TimeOff',
          action_label: 'View calendar',
          metadata: { time_off_request_id: request_id },
        });
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: request.manager_email,
          from_name: 'Penn Sync Time Off',
          subject: `Time off cancelled by ${who}`,
          body: `${who} has cancelled their previously approved ${prettyType} for ${request.start_date} → ${request.end_date}.`,
        }).catch(() => null);
      }
    } catch (_notifyError) {
      // Best-effort notification.
    }

    return Response.json({ success: true, request: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});