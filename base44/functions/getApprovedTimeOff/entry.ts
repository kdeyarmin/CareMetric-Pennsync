import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Returns APPROVED time-off requests for the whole team so the Team Calendar can
// show who is out — visible to every authenticated user. Privacy: only the
// employee name, type, dates and half-day flag are exposed (never the private
// reason, coverage notes, or reviewer notes). RLS on TimeOffRequest would
// otherwise limit a regular employee to their own rows, so this runs as the
// service role and hard-filters to status === "approved".
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const approved = await base44.asServiceRole.entities.TimeOffRequest.filter(
      { status: 'approved' },
      '-start_date',
      1000
    );

    // Strip to the minimum fields needed to render the calendar.
    const sanitized = approved.map((r) => ({
      id: r.id,
      employee_name: r.employee_name,
      // Intentionally NOT exposing the employee email here — this feed is visible
      // to every authenticated user, and the calendar renders on employee_name.
      // Returning the email leaked a full name->email directory of everyone
      // who's ever had approved time off. (Guarded by securityGuardrails.test.js.)
      request_type: r.request_type,
      start_date: r.start_date,
      end_date: r.end_date,
      half_day: r.half_day,
      status: 'approved',
    }));

    return Response.json({ requests: sanitized });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});