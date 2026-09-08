import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// <<<BEGIN SHARED HELPER: protectedUserAuthz — generated, edit base44/_shared/backendHelpers.mjs>>>
const normalizeProtectedEmail = (value) => String(value || '').trim().toLowerCase();
const isProtectedAdmin = (user) => !!user && user.role === 'admin';
function isProtectedSuperAdmin(user) {
  const configuredEmail = normalizeProtectedEmail(Deno.env.get('SUPER_ADMIN_EMAIL'));
  return !!configuredEmail
    && isProtectedAdmin(user)
    && normalizeProtectedEmail(user.email) === configuredEmail;
}
// <<<END SHARED HELPER: protectedUserAuthz>>>

const ID_SCAN_LIMIT = 1000;
const MAX_ENTITY_ID_LENGTH = 200;

const requireRows = (value, label) => {
  if (!Array.isArray(value)) throw new Error(`${label} returned a non-array result`);
  return value;
};

function patientBelongsToCaller(patient, callerEmail) {
  if (!patient || !callerEmail) return false;
  if (normalizeProtectedEmail(patient.created_by) === callerEmail) return true;
  return Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.some(
      (email) => normalizeProtectedEmail(email) === callerEmail,
    );
}


/**
 * updateScopedPatientAlert — applies an Acknowledge/Resolve/Dismiss/flag-urgent
 * transition to a PatientAlert, authorized the same way getScopedPatientAlerts
 * authorizes reads: the patient creator, an assigned nurse, or the configured
 * protected superadmin. No custom profile field grants cross-patient access.
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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) return Response.json({ error: 'Forbidden' }, { status: 403 });

    const { alert_id, action, resolution_notes } = await req.json().catch(() => ({}));
    const alertId = typeof alert_id === 'string' ? alert_id.trim() : '';
    if (!alertId || alertId.length > MAX_ENTITY_ID_LENGTH) {
      return Response.json({ error: 'alert_id is invalid' }, { status: 400 });
    }
    if (!['acknowledge', 'resolve', 'dismiss', 'toggle_flagged_urgent'].includes(action)) {
      return Response.json({ error: 'action must be one of acknowledge, resolve, dismiss, toggle_flagged_urgent' }, { status: 400 });
    }

    const entities = base44.asServiceRole.entities;
    const rawAlerts = await entities.PatientAlert.filter(
      { id: alertId },
      undefined,
      ID_SCAN_LIMIT,
    );
    const alert = requireRows(rawAlerts, 'PatientAlert.filter')
      .find((row) => row?.id === alertId);
    if (!alert) return Response.json({ error: 'Alert not found' }, { status: 404 });

    if (!isProtectedSuperAdmin(user)) {
      const patientId = typeof alert.patient_id === 'string' ? alert.patient_id.trim() : '';
      if (!patientId || patientId.length > MAX_ENTITY_ID_LENGTH) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const rawPatients = await entities.Patient.filter(
        { id: patientId },
        undefined,
        ID_SCAN_LIMIT,
      );
      const patient = requireRows(rawPatients, 'Patient.filter')
        .find((row) => row?.id === patientId);
      if (!patient || !patientBelongsToCaller(patient, callerEmail)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
    }

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

    const updated = await entities.PatientAlert.update(alertId, data);
    if (!updated || updated.id !== alertId) {
      return Response.json({ error: 'Failed to verify updated alert' }, { status: 502 });
    }
    return Response.json({ alert: updated });
  } catch (error) {
    console.error('updateScopedPatientAlert error:', error?.message);
    return Response.json({ error: 'Failed to update alert' }, { status: 500 });
  }
});
