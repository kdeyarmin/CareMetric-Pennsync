import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getDashboardData — returns the Dashboard's core datasets (active patients,
 * today's visits, recent incidents) scoped to the caller so a non-admin's
 * browser never receives agency-wide PHI it isn't authorized for.
 *   - admins: agency-wide (unchanged from the previous client queries)
 *   - everyone else: only their assigned patients' data (Patient.assigned_nurses)
 *
 * Defense-in-depth; Base44 row-level security remains the primary control. This
 * is fetched under its own ['dashboardData', email] query key so the app-wide
 * shared keys (['patients'], ['todayVisits'], ...) and their cross-component
 * invalidations are left untouched.
 */

// Today's date in America/New_York (matches the client's todayEastern()). Returns YYYY-MM-DD.
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

    // Agency-wide view for any administrator tier: the agency `admin` role, or an
    // agency_admin/super_admin account_type. (Mirrors lib/roles.js getRoleView —
    // kept inline since Deno functions can't import frontend modules.) Without
    // the account_type checks a super admin who isn't yet role:'admin' would
    // incorrectly get the nurse view.
    const isPlatformAdmin =
      user.role === 'admin' ||
      user.account_type === 'super_admin';
    const isAgencyAdmin = user.account_type === 'agency_admin';

    // Platform/facility admins: unchanged agency-wide lists.
    if (isPlatformAdmin) {
      const [patients, visits, incidents] = await Promise.all([
        sr.Patient.filter({ status: 'active' }, '-updated_date', 100),
        sr.Visit.filter({ visit_date: today }, '-visit_time'),
        sr.Incident.list('-incident_date', 20),
      ]);
      return Response.json({ patients, visits, incidents });
    }

    // Agency admins: only patients tied to staff in their agency_name
    // (parity with bulkCreateDocumentPackages) — not every tenant's PHI.
    if (isAgencyAdmin) {
      if (!user.agency_name) {
        return Response.json({ patients: [], visits: [], incidents: [] });
      }
      const agencyUsers = await sr.User.list('-created_date', 5000).catch(() => []);
      const agencyEmails = new Set(
        (agencyUsers || [])
          .filter((u) => u.agency_name === user.agency_name && u.email)
          .map((u) => u.email),
      );
      const allActive = await sr.Patient.filter({ status: 'active' }, '-updated_date', 500);
      const patients = (allActive || []).filter((p) => {
        if (p.created_by && agencyEmails.has(p.created_by)) return true;
        return Array.isArray(p.assigned_nurses) && p.assigned_nurses.some((e) => agencyEmails.has(e));
      }).slice(0, 100);
      const ids = patients.map((p) => p.id).filter(Boolean);
      if (ids.length === 0) {
        return Response.json({ patients, visits: [], incidents: [] });
      }
      const [visits, incidents] = await Promise.all([
        sr.Visit.filter({ patient_id: { $in: ids }, visit_date: today }, '-visit_time'),
        sr.Incident.filter({ patient_id: { $in: ids } }, '-incident_date', 20),
      ]);
      return Response.json({ patients, visits, incidents });
    }

    // Non-admin: restrict everything to the caller's assigned patients.
    const patients = await sr.Patient.filter({ assigned_nurses: user.email, status: 'active' }, '-updated_date', 100);
    const ids = (patients || []).map((p) => p.id).filter(Boolean);
    if (ids.length === 0) {
      return Response.json({ patients: [], visits: [], incidents: [] });
    }
    const [visits, incidents] = await Promise.all([
      sr.Visit.filter({ patient_id: { $in: ids }, visit_date: today }, '-visit_time'),
      sr.Incident.filter({ patient_id: { $in: ids } }, '-incident_date', 20),
    ]);
    return Response.json({ patients, visits, incidents });
  } catch (error) {
    console.error('getDashboardData error:', error?.message);
    return Response.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
});