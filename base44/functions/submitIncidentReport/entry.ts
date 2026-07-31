import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    if (!payload.patient_id || !payload.incident_type || !payload.incident_date || !payload.report) {
      return Response.json({ error: 'Missing required incident fields' }, { status: 400 });
    }

    // Service role: Incident write RLS is service-role-only so the CAP
    // lifecycle cannot be bypassed by a direct client write (see
    // functions/updateIncident). created_by must therefore be stamped here --
    // the platform would otherwise attribute it to the service identity, and
    // read RLS keys off created_by to show reporters their own incidents.
    // The offline drain dedupes retries by filtering Incident on
    // client_request_id, so the key has to survive into the stored row. Drop it
    // and an interrupted drain (server committed, queue removal failed) creates
    // a second copy of the same safety event on the next pass.
    const clientRequestId = payload.client_request_id;
    if (clientRequestId) {
      const existing = await base44.asServiceRole.entities.Incident.filter(
        { client_request_id: clientRequestId },
        undefined,
        1,
      ).catch(() => []);
      if (existing?.[0]) {
        return Response.json({ success: true, incident: existing[0], deduplicated: true });
      }
    }

    const incident = await base44.asServiceRole.entities.Incident.create({
      created_by: user.email,
      ...(clientRequestId ? { client_request_id: clientRequestId } : {}),
      patient_id: payload.patient_id,
      patient_name: payload.patient_name,
      incident_type: payload.incident_type,
      incident_name: payload.incident_name,
      incident_date: payload.incident_date,
      incident_time: payload.incident_time,
      severity: payload.severity || 'medium',
      details: payload.details || {},
      report: payload.report,
      photo_urls: payload.photo_urls || [],
      physician_notified: !!payload.physician_notified,
      office_notified: !!payload.immediate_alert,
      alert_triggered: !!payload.immediate_alert,
      status: 'reported',
    });

    if (payload.immediate_alert) {
      // Query admins directly rather than filtering the 200 newest users — in an
      // agency with >200 users the early-created admins (typically owners) were
      // silently dropped and never alerted. Mirrors submitStateReportableIncident.
      // Same admin-tier predicate as isAdminLike — role==='admin' alone missed
    // agency_admin/super_admin accounts, notifying nobody at some agencies.
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000);
    const users = (Array.isArray(allUsers) ? allUsers : []).filter((u) =>
      u && (u.role === 'admin' || u.role === 'agency_admin' ||
        u.account_type === 'agency_admin' || u.account_type === 'super_admin'));
      // Notify every admin-tier recipient — an extra role==='admin' re-filter
      // here re-dropped the account_type-based admins the list above includes.
      if (users.length > 0) {
        await Promise.all(
          users.map((adminUser) =>
            base44.asServiceRole.entities.Notification.create({
              user_email: adminUser.email,
              title: `Urgent incident: ${payload.incident_name || payload.incident_type}`,
              message: `${user.full_name || user.email} submitted a ${payload.severity || 'medium'} severity incident for ${payload.patient_name || 'a patient'}.`,
              type: payload.severity === 'high' ? 'critical_alert' : 'patient_alert',
              priority: payload.severity === 'high' ? 'critical' : 'high',
              action_url: '/Incidents',
              action_label: 'Review incident',
              metadata: {
                incident_id: incident.id,
                patient_id: payload.patient_id,
                patient_name: payload.patient_name,
                reported_by: user.email,
              },
            })
          )
        );
      }
    }

    return Response.json({ success: true, incident });
  } catch (error) {
    console.error('submitIncidentReport failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});