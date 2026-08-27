import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

/** Explicit patient access — Patient RLS treats role:admin as platform-wide. */
async function assertPatientAccess(base44, user, patient) {
  if (!patient) return Response.json({ error: 'Patient not found' }, { status: 404 });
  const isSuperAdmin = user.account_type === 'super_admin';
  const isAgencyScopedAdmin =
    user.account_type === 'agency_admin'
    || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
  const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);
  const isAssigned = Array.isArray(patient.assigned_nurses)
    && patient.assigned_nurses.includes(user.email);
  if (!isPlatformAdmin && !isAgencyScopedAdmin && patient.created_by !== user.email && !isAssigned) {
    return Response.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (isAgencyScopedAdmin) {
    if (!user.agency_name) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const agencyUsers = await base44.asServiceRole.entities.User
      .list('-created_date', 5000).catch(() => []);
    const agencyEmails = new Set(
      (agencyUsers || [])
        .filter((u) => u.agency_name === user.agency_name && u.email)
        .map((u) => u.email),
    );
    const inAgency = (patient.created_by && agencyEmails.has(patient.created_by))
      || (Array.isArray(patient.assigned_nurses)
        && patient.assigned_nurses.some((e) => agencyEmails.has(e)));
    if (!inAgency) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  return null;
}

/**
 * getPatientContext — returns the core datasets the PatientDetails page needs for
 * a single patient (the patient record, visits, incidents, tasks, and active
 * alerts) in ONE round-trip instead of the page firing several independent
 * entity queries from the browser.
 *
 * Access: caller-scoped entity reads plus assertPatientAccess so facility
 * admins (bare role:admin RLS is platform-wide) cannot pull another agency's
 * chart into the PatientDetails seed payload. Explicit limits avoid the server
 * default page (~50) silently truncating visit/incident history.
 *
 * The client seeds the per-entity React Query caches (['patient',id],
 * ['patientVisits',id], …) from this payload so the page's child components get
 * cache hits. OASIS uploads are intentionally NOT included — that cache key is
 * shape-inconsistent across components (financial-stripped function result vs.
 * raw entity), so it's left to each component's own query.
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const patientId = body?.patientId;
    if (!patientId) return Response.json({ error: 'patientId is required' }, { status: 400 });

    // Caller-scoped: RLS decides what this user may read; assertPatientAccess
    // closes the bare-admin platform-wide residual.
    const e = base44.entities;

    const patientArr = await e.Patient.filter({ id: patientId }, undefined, 5);
    const patient = patientArr?.[0] || null;
    if (!patient) {
      return Response.json({ patient: null, visits: [], incidents: [], tasks: [], activeAlerts: [] });
    }
    const denied = await assertPatientAccess(base44, user, patient);
    if (denied) return denied;

    const HISTORY = 1000;
    const [visits, incidents, tasks, activeAlerts] = await Promise.all([
      e.Visit.filter({ patient_id: patientId }, '-visit_date', HISTORY),
      e.Incident.filter({ patient_id: patientId }, '-incident_date', HISTORY),
      e.Task.filter({ patient_id: patientId }, undefined, HISTORY),
      e.PatientAlert.filter({ patient_id: patientId, status: 'active' }, '-created_date', 500),
    ]);

    return Response.json({ patient, visits, incidents, tasks, activeAlerts });
  } catch (error) {
    console.error('getPatientContext error:', error?.message);
    return Response.json({ error: 'Failed to load patient context' }, { status: 500 });
  }
});
