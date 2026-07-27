import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();

    if (!payload.patient_id || !payload.incident_type || !payload.incident_date || !payload.report) {
      return Response.json({ error: 'Missing required incident fields' }, { status: 400 });
    }

    const incident = await base44.entities.Incident.create({
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