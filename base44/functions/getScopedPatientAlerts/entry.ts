import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getScopedPatientAlerts — returns PatientAlert rows the caller is authorized to
 * see, filtered SERVER-SIDE so a browser never receives other patients' PHI
 * alerts. Authorization model (matches the rest of the app):
 *   - admins: all alerts
 *   - everyone else: only alerts for patients they are assigned to
 *     (Patient.assigned_nurses includes their email)
 *
 * This is defense-in-depth; entity-level row security in the Base44 dashboard
 * remains the primary control. The client may still apply a favorites filter
 * on top for UX, but it is no longer an access boundary.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const { patient_id, limit } = await req.json().catch(() => ({}));
    const cap = Math.min(Number(limit) || 100, 500);
    const isAdmin = user.role === 'admin';

    // Single-patient view: authorize against assignment (or admin).
    if (patient_id) {
      if (!isAdmin) {
        const [patient] = await base44.asServiceRole.entities.Patient.filter({ id: patient_id });
        // Mirror the Patient RLS: assigned nurse OR creator OR admin.
        const allowed = patient?.created_by === user.email
          || (Array.isArray(patient?.assigned_nurses) && patient.assigned_nurses.includes(user.email));
        if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id }, '-created_date', cap);
      return Response.json({ alerts });
    }

    // All-alerts view.
    if (isAdmin) {
      const alerts = await base44.asServiceRole.entities.PatientAlert.list('-created_date', cap);
      return Response.json({ alerts });
    }

    // Non-admin: restrict to the caller's accessible patients — those assigned to
    // them OR created by them (the Patient RLS grants both). Query the alerts BY
    // those patient ids (not a global window then filter) so a busy tenant's
    // other-patient alerts can't truncate an authorized patient's older alert.
    const [assignedPatients, createdPatients] = await Promise.all([
      base44.asServiceRole.entities.Patient.filter({ assigned_nurses: user.email }, '-created_date', 1000).catch(() => []),
      base44.asServiceRole.entities.Patient.filter({ created_by: user.email }, '-created_date', 1000).catch(() => []),
    ]);
    const allowedIds = [...new Set(
      [...(assignedPatients || []), ...(createdPatients || [])].map((p) => p.id).filter(Boolean)
    )];
    if (allowedIds.length === 0) return Response.json({ alerts: [] });

    const alerts = await base44.asServiceRole.entities.PatientAlert
      .filter({ patient_id: { $in: allowedIds } }, '-created_date', cap).catch(() => []);
    return Response.json({ alerts });
  } catch (error) {
    console.error('getScopedPatientAlerts error:', error?.message);
    return Response.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
});