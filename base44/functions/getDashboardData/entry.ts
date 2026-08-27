import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getDashboardData — returns the Dashboard's core datasets (active patients,
 * today's visits, recent incidents) scoped to the caller so a non-admin's
 * browser never receives agency-wide PHI it isn't authorized for.
 *   - admins: agency-wide (unchanged from the previous client queries)
 *   - everyone else: only their assigned patients' data (Patient.assigned_nurses)
 *
 * Also returns recentCompletedVisits + active carePlans so RealTimePatientAlerts
 * can compute overdue / high-risk / goal-deadline alerts. Today's visits alone
 * cannot drive "No visit in N days" logic.
 *
 * Defense-in-depth; Base44 row-level security remains the primary control. This
 * is fetched under its own ['dashboardData', email] query key so the app-wide
 * shared keys (['patients'], ['todayVisits'], ...) and their cross-component
 * invalidations are left untouched.
 */

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>

// Today's date in America/New_York (matches the client's todayEastern()). Returns YYYY-MM-DD.
function todayEastern() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Slim alert context: recent completed visits + active care plans for patient ids. */
async function fetchAlertContext(sr, patientIds) {
  const ids = (patientIds || []).filter(Boolean);
  if (ids.length === 0) {
    return { recentCompletedVisits: [], carePlans: [] };
  }
  const [recentCompletedVisits, carePlans] = await Promise.all([
    // Cap high enough that sparse patients still appear; sorted newest-first so
    // RealTimePatientAlerts can pick lastVisit per patient from this set.
    sr.Visit.filter(
      { patient_id: { $in: ids }, status: 'completed' },
      '-visit_date',
      500,
    ).catch(() => []),
    sr.CarePlan.filter(
      { patient_id: { $in: ids }, status: 'active' },
      '-updated_date',
      200,
    ).catch(() => []),
  ]);
  return {
    recentCompletedVisits: recentCompletedVisits || [],
    carePlans: carePlans || [],
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const sr = base44.asServiceRole.entities;
    const today = todayEastern();

    // Platform-wide view only for super_admin (or legacy facility admin with no
    // agency_name). A role:'admin' who belongs to an agency must NOT see every
    // tenant's PHI — treat them like agency_admin.
    const isSuperAdmin = user.account_type === 'super_admin';
    const isAgencyScopedAdmin =
      user.account_type === 'agency_admin'
      || (user.role === 'admin' && !!user.agency_name && !isSuperAdmin);
    const isPlatformAdmin = isSuperAdmin || (user.role === 'admin' && !user.agency_name);

    // Platform/facility admins with no agency: unchanged tenant-wide lists.
    if (isPlatformAdmin) {
      const [patients, visits, incidents] = await Promise.all([
        sr.Patient.filter({ status: 'active' }, '-updated_date', 100),
        // Explicit limit — omitting it silently truncates to the server default (~50).
        sr.Visit.filter({ visit_date: today }, '-visit_time', 500),
        sr.Incident.list('-incident_date', 20),
      ]);
      const { recentCompletedVisits, carePlans } = await fetchAlertContext(
        sr,
        (patients || []).map((p) => p.id),
      );
      return Response.json({ patients, visits, incidents, recentCompletedVisits, carePlans });
    }

    // Agency-scoped admins: only patients tied to staff in their agency_name
    // (parity with bulkCreateDocumentPackages) — not every tenant's PHI.
    if (isAgencyScopedAdmin) {
      if (!user.agency_name) {
        return Response.json({
          patients: [], visits: [], incidents: [], recentCompletedVisits: [], carePlans: [],
        });
      }
      const agencyUsers = await sr.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      // Load a wide active roster before agency post-filter so other tenants'
      // newest patients cannot crowd this agency out of a small global top-N.
      const allActive = await sr.Patient.filter({ status: 'active' }, '-updated_date', 5000);
      const patients = (allActive || []).filter((p) => {
        if (p.created_by && agencyEmails.has(p.created_by)) return true;
        return Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e));
      }).slice(0, 100);
      const ids = patients.map((p) => p.id).filter(Boolean);
      if (ids.length === 0) {
        return Response.json({
          patients, visits: [], incidents: [], recentCompletedVisits: [], carePlans: [],
        });
      }
      const [visits, incidents, alertCtx] = await Promise.all([
        sr.Visit.filter({ patient_id: { $in: ids }, visit_date: today }, '-visit_time', 500),
        sr.Incident.filter({ patient_id: { $in: ids } }, '-incident_date', 20),
        fetchAlertContext(sr, ids),
      ]);
      return Response.json({
        patients,
        visits,
        incidents,
        recentCompletedVisits: alertCtx.recentCompletedVisits,
        carePlans: alertCtx.carePlans,
      });
    }

    // Non-admin: restrict everything to the caller's assigned patients.
    const patients = await sr.Patient.filter({ assigned_nurses: user.email, status: 'active' }, '-updated_date', 100);
    const ids = (patients || []).map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      return Response.json({
        patients: [], visits: [], incidents: [], recentCompletedVisits: [], carePlans: [],
      });
    }
    const [visits, incidents, alertCtx] = await Promise.all([
      sr.Visit.filter({ patient_id: { $in: ids }, visit_date: today }, '-visit_time', 500),
      sr.Incident.filter({ patient_id: { $in: ids } }, '-incident_date', 20),
      fetchAlertContext(sr, ids),
    ]);
    return Response.json({
      patients,
      visits,
      incidents,
      recentCompletedVisits: alertCtx.recentCompletedVisits,
      carePlans: alertCtx.carePlans,
    });
  } catch (error) {
    console.error('getDashboardData error:', error?.message);
    return Response.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
});
