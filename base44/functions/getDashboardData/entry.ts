import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getDashboardData — returns the Dashboard's core datasets (active patients,
 * today's visits, active care plans, recent incidents) scoped to the caller so
 * a non-admin's browser never receives agency-wide PHI it isn't authorized for.
 *   - admins: agency-wide (unchanged from the previous client queries)
 *   - everyone else: only their assigned patients' data (Patient.assigned_nurses)
 *
 * Defense-in-depth; Base44 row-level security remains the primary control. This
 * is fetched under its own ['dashboardData', email] query key so the app-wide
 * shared keys (['patients'], ['todayVisits'], ...) and their cross-component
 * invalidations are left untouched.
 */

// Today's date in America/New_York (matches the client's todayEastern()).
function todayEastern() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const sr = base44.asServiceRole.entities;
    const today = todayEastern();

    // Agency-wide view for any administrator tier: the agency `admin` role, an
    // agency_admin/super_admin account_type, or the designated platform owner.
    // (Mirrors lib/roles.js getRoleView — kept inline since Deno functions can't
    // import frontend modules.) Without the account_type/owner checks a super
    // admin who isn't yet role:'admin' would incorrectly get the nurse view.
    const SUPER_ADMIN_EMAIL = ((typeof Deno !== 'undefined' && Deno.env.get('SUPER_ADMIN_EMAIL')) || '').trim().toLowerCase() || null;
    const isAdmin =
      user.role === 'admin' ||
      user.account_type === 'agency_admin' ||
      user.account_type === 'super_admin' ||
      String(user.email || '').trim().toLowerCase() === SUPER_ADMIN_EMAIL;

    if (isAdmin) {
      const [patients, visits, carePlans, incidents] = await Promise.all([
        sr.Patient.filter({ status: 'active' }, '-updated_date', 100),
        sr.Visit.filter({ visit_date: today }, '-visit_time'),
        sr.CarePlan.filter({ status: 'active' }, '-updated_date', 50),
        sr.Incident.list('-incident_date', 20),
      ]);
      return Response.json({ patients, visits, carePlans, incidents });
    }

    // Non-admin: restrict everything to the caller's assigned patients.
    const patients = await sr.Patient.filter({ assigned_nurses: user.email, status: 'active' }, '-updated_date', 100);
    const ids = (patients || []).map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      return Response.json({ patients: [], visits: [], carePlans: [], incidents: [] });
    }
    const [visits, carePlans, incidents] = await Promise.all([
      sr.Visit.filter({ patient_id: { $in: ids }, visit_date: today }, '-visit_time'),
      sr.CarePlan.filter({ patient_id: { $in: ids }, status: 'active' }, '-updated_date', 50),
      sr.Incident.filter({ patient_id: { $in: ids } }, '-incident_date', 20),
    ]);
    return Response.json({ patients, visits, carePlans, incidents });
  } catch (error) {
    console.error('getDashboardData error:', error?.message);
    return Response.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
});