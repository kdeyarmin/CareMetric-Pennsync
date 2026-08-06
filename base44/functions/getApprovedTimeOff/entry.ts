import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Returns APPROVED time-off requests for the whole team so the Team Calendar can
// show who is out — visible to every authenticated user. Privacy: only the
// employee name, type, dates and half-day flag are exposed (never the private
// reason, coverage notes, or reviewer notes). RLS on TimeOffRequest would
// otherwise limit a regular employee to their own rows, so this runs as the
// service role and hard-filters to status === "approved".
// Non-platform callers are further scoped to their own agency via employee
// email → User.agency_name (TimeOffRequest has no agency_name field).
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    let approved = await base44.asServiceRole.entities.TimeOffRequest.filter(
      { status: 'approved' },
      '-start_date',
      1000
    );

    const isPlatformAdmin = user.account_type === 'super_admin'
      || (user.role === 'admin' && !user.agency_name);
    if (!isPlatformAdmin) {
      // Fail closed without agency membership — otherwise every authenticated
      // user receives every agency's approved leave via the service role.
      if (!user.agency_name) {
        return Response.json({ requests: [] });
      }
      const agencyUsers = await base44.asServiceRole.entities.User
        .list('-created_date', 5000)
        .catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name)
          .map((u) => u.email)
      );
      approved = (approved || []).filter((r) => agencyEmails.has(r.employee_email));
    }

    // Strip to the minimum fields needed to render the calendar.
    const sanitized = (approved || []).map((r) => ({
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
    console.error('getApprovedTimeOff failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});