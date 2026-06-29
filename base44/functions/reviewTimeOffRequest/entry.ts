import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * reviewTimeOffRequest — approve or deny a pending time-off request.
 *
 * Authorization is enforced server-side: only an admin or the request's
 * designated manager may review, and a reviewer can never act on their own
 * request (no self-approval). The status write uses the service role because
 * the TimeOffRequest entity limits direct writes to admins.
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { request_id, decision, note = '' } = (await req.json()) || {};

    if (!request_id) {
      return Response.json({ error: 'request_id is required.' }, { status: 400 });
    }
    if (!['approved', 'denied'].includes(decision)) {
      return Response.json({ error: 'decision must be "approved" or "denied".' }, { status: 400 });
    }

    const request = await base44.asServiceRole.entities.TimeOffRequest.get(request_id).catch(() => null);
    if (!request) {
      return Response.json({ error: 'Time-off request not found.' }, { status: 404 });
    }

    const isAdmin = user.role === 'admin';
    const isAssignedManager = !!request.manager_email && request.manager_email === user.email;
    if (!isAdmin && !isAssignedManager) {
      return Response.json({ error: 'You are not authorized to review this request.' }, { status: 403 });
    }

    // A reviewer can never approve or deny their own request, even as an admin.
    if (request.employee_email === user.email || request.created_by === user.email) {
      return Response.json({ error: 'You cannot review your own time-off request.' }, { status: 403 });
    }

    if (request.status !== 'pending') {
      return Response.json({ error: `This request has already been ${request.status}.` }, { status: 409 });
    }

    const updated = await base44.asServiceRole.entities.TimeOffRequest.update(request_id, {
      status: decision,
      reviewed_by: user.email,
      reviewer_name: user.full_name || user.email,
      reviewed_at: new Date().toISOString(),
      review_notes: String(note || '').slice(0, 2000),
    });

    // Let the employee know the outcome (best-effort), in-app and by email.
    try {
      const trimmedNote = String(note || '').trim();
      const prettyType = request.request_type.replace(/_/g, ' ');
      const reviewerName = user.full_name || user.email;
      await base44.asServiceRole.entities.Notification.create({
        user_email: request.employee_email,
        title: decision === 'approved' ? 'Time off approved' : 'Time off denied',
        message: `Your ${prettyType} request (${request.start_date} → ${request.end_date}) was ${decision}${trimmedNote ? `: ${trimmedNote}` : '.'}`,
        type: decision === 'approved' ? 'info' : 'compliance_alert',
        priority: 'medium',
        action_url: '/TimeOff',
        action_label: 'View request',
        metadata: { time_off_request_id: request_id, reviewed_by: user.email },
      });
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: request.employee_email,
        from_name: 'Penn Sync Time Off',
        subject: decision === 'approved' ? 'Your time off was approved' : 'Your time-off request was denied',
        body: `Your ${prettyType} request for ${request.start_date} → ${request.end_date} was ${decision} by ${reviewerName}.` +
          `${trimmedNote ? `\n\nNote: ${trimmedNote}` : ''}\n\nView the details in Penn Sync under Time Off.`,
      }).catch(() => null);
    } catch (_notifyError) {
      // Best-effort notification/email.
    }

    return Response.json({ success: true, request: updated });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});