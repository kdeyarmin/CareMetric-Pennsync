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
      const users = await base44.asServiceRole.entities.User.list('-created_date', 200);
      const adminUsers = users.filter((candidate) => candidate.role === 'admin');

      if (adminUsers.length > 0) {
        await Promise.all(
          adminUsers.map((adminUser) =>
            base44.asServiceRole.entities.Notification.create({
              user_email: adminUser.email,
              title: `Urgent incident: ${payload.incident_name || payload.incident_type}`,
              message: `${user.full_name || user.email} submitted a ${payload.severity || 'high'} severity incident for ${payload.patient_name || 'a patient'}.`,
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
    return Response.json({ error: error.message }, { status: 500 });
  }
});