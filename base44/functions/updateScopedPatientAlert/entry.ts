import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


/**
 * updateScopedPatientAlert — applies an Acknowledge/Resolve/Dismiss/flag-urgent
 * transition to a PatientAlert, authorized the same way getScopedPatientAlerts
 * authorizes reads (admin, OR the patient's assigned nurse, OR the alert's own
 * creator) rather than PatientAlert's own RLS (created_by/admin only), which
 * would otherwise silently reject the write for a nurse who can see the alert
 * (via getScopedPatientAlerts) for a patient assigned to, but not created by,
 * them.
 *
 * Only a fixed set of transitions is accepted — this is a service-role write,
 * so the caller cannot pass through arbitrary fields (e.g. patient_id,
 * severity); each transition's persisted fields are constructed here, not
 * taken verbatim from the request body.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { alert_id, action, resolution_notes } = await req.json().catch(() => ({}));
    if (!alert_id || typeof alert_id !== 'string') {
      return Response.json({ error: 'alert_id is required' }, { status: 400 });
    }
    if (!['acknowledge', 'resolve', 'dismiss', 'toggle_flagged_urgent'].includes(action)) {
      return Response.json({ error: 'action must be one of acknowledge, resolve, dismiss, toggle_flagged_urgent' }, { status: 400 });
    }

    const [alert] = await base44.asServiceRole.entities.PatientAlert.filter({ id: alert_id }, undefined, 5000);
    if (!alert) return Response.json({ error: 'Alert not found' }, { status: 404 });

    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'agency_admin' ||
      user.account_type === 'super_admin';

    let allowed = isAdmin || alert.created_by === user.email;
    if (!allowed && alert.patient_id) {
      const [patient] = await base44.asServiceRole.entities.Patient.filter({ id: alert.patient_id }, undefined, 5000);
      allowed = patient?.created_by === user.email
        || (Array.isArray(patient?.assigned_nurses) && patient.assigned_nurses.includes(user.email));
    }
    if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const now = new Date().toISOString();
    let data;
    if (action === 'acknowledge') {
      data = { status: 'acknowledged', acknowledged_by: user.email, acknowledged_at: now };
    } else if (action === 'resolve') {
      data = {
        status: 'resolved',
        resolved_at: now,
        resolution_notes: typeof resolution_notes === 'string' ? resolution_notes : (alert.resolution_notes || ''),
      };
    } else if (action === 'dismiss') {
      data = { status: 'dismissed' };
    } else {
      data = { flagged_urgent: !alert.flagged_urgent };
    }

    const updated = await base44.asServiceRole.entities.PatientAlert.update(alert_id, data);
    return Response.json({ alert: updated });
  } catch (error) {
    console.error('updateScopedPatientAlert error:', error?.message);
    return Response.json({ error: 'Failed to update alert' }, { status: 500 });
  }
});
