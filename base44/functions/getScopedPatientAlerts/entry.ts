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
 *
 * Optional `status` (string) and `severity` (string[]) params narrow the
 * result server-side, BEFORE `limit`/500 cap is applied, so narrowing a large
 * result set to (e.g.) active+high/critical can't have those rows pushed out
 * of the capped page by rows the caller was going to discard anyway.
 */
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
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const { patient_id, limit, status, severity } = await req.json().catch(() => ({}));
    const cap = Math.min(Number(limit) || 100, 500);
    // Optional narrowing applied server-side, BEFORE the row cap above — so a
    // caller filtering to (e.g.) active+high/critical can't have those rows
    // pushed out of the capped page by older/lower-severity alerts that would
    // just be discarded client-side anyway.
    const extraFilter = {};
    if (status) extraFilter.status = status;
    if (Array.isArray(severity) && severity.length > 0) extraFilter.severity = { $in: severity };
    const hasExtraFilter = Object.keys(extraFilter).length > 0;
    // Platform-wide only for super_admin (or legacy facility admin with no
    // agency). role:'admin' + agency_name must be agency-scoped — otherwise a
    // facility admin sees every tenant's PatientAlert PHI.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
    const isAdmin = isPlatformAdmin || isAgencyScopedAdmin;

    // Agency-scoped admins: patients tied to staff sharing their agency_name.
    let agencyEmails = null;
    if (isAgencyScopedAdmin) {
      if (!user.agency_name) return Response.json({ alerts: [] });
      const agencyUsers = await base44.asServiceRole.entities.User.list('-created_date', 5000).catch(() => []);
      agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
    }
    const patientInAgency = (patient) => {
      if (!agencyEmails) return true;
      if (patient?.created_by && agencyEmails.has(patient.created_by)) return true;
      return Array.isArray(patient?.assigned_nurses) && patient.assigned_nurses.some((e) => agencyEmails.has(e));
    };

    // Single-patient view: authorize against assignment (or admin).
    if (patient_id) {
      if (!isAdmin) {
        const [patient] = await base44.asServiceRole.entities.Patient.filter({ id: patient_id }, undefined, 5000);
        // Mirror the Patient RLS: assigned nurse OR creator OR admin.
        const allowed = patient?.created_by === user.email
          || (Array.isArray(patient?.assigned_nurses) && patient.assigned_nurses.includes(user.email));
        if (!allowed) return Response.json({ error: 'Forbidden' }, { status: 403 });
      } else if (isAgencyScopedAdmin) {
        const [patient] = await base44.asServiceRole.entities.Patient.filter({ id: patient_id }, undefined, 5000);
        if (!patientInAgency(patient)) return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      const alerts = await base44.asServiceRole.entities.PatientAlert.filter({ patient_id, ...extraFilter }, '-created_date', cap);
      return Response.json({ alerts });
    }

    // All-alerts view — platform admins see everything; agency-scoped admins are
    // filtered to their agency's patient set (same as getDashboardData).
    if (isPlatformAdmin) {
      const alerts = hasExtraFilter
        ? await base44.asServiceRole.entities.PatientAlert.filter(extraFilter, '-created_date', cap)
        : await base44.asServiceRole.entities.PatientAlert.list('-created_date', cap);
      return Response.json({ alerts });
    }
    if (isAgencyScopedAdmin) {
      const agencyPatients = await base44.asServiceRole.entities.Patient
        .list('-created_date', 2000)
        .catch(() => []);
      const allowedIds = [...new Set(
        (agencyPatients || [])
          .filter(patientInAgency)
          .map((p) => p.id)
          .filter(Boolean),
      )];
      if (allowedIds.length === 0) return Response.json({ alerts: [] });
      const alerts = await base44.asServiceRole.entities.PatientAlert
        .filter({ patient_id: { $in: allowedIds }, ...extraFilter }, '-created_date', cap)
        .catch(() => []);
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
      .filter({ patient_id: { $in: allowedIds }, ...extraFilter }, '-created_date', cap).catch(() => []);
    return Response.json({ alerts });
  } catch (error) {
    console.error('getScopedPatientAlerts error:', error?.message);
    return Response.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
});