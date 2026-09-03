import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

/**
 * getDashboardData — returns the Dashboard's core datasets (active patients,
 * today's visits, recent incidents) scoped before patient PHI reaches the
 * browser.
 *   - configured protected superadmin: platform-wide dashboard
 *   - everyone else: only patients they created or are assigned to
 *
 * Also returns recentCompletedVisits + active carePlans so RealTimePatientAlerts
 * can compute overdue / high-risk / goal-deadline alerts. Today's visits alone
 * cannot drive "No visit in N days" logic.
 *
 * Service-role filters reduce the amount of data fetched, but every returned
 * row is checked in memory because those filters are not an authorization
 * boundary.
 */

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

const DASHBOARD_PATIENT_LIMIT = 100;
const PATIENT_SCAN_LIMIT = 1000;
const VISIT_LIMIT = 500;
const VISIT_SCAN_LIMIT = 1000;
const INCIDENT_LIMIT = 20;
const INCIDENT_SCAN_LIMIT = 200;
const COMPLETED_VISIT_LIMIT = 500;
const COMPLETED_VISIT_SCAN_LIMIT = 1000;
const CARE_PLAN_LIMIT = 200;
const CARE_PLAN_SCAN_LIMIT = 500;

const asRows = (value) => Array.isArray(value) ? value : [];
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

function newestFirst(left, right) {
  return String(right?.updated_date || '').localeCompare(String(left?.updated_date || ''));
}

function uniqueRowsById(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    if (!row?.id || seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

// Today's date in America/New_York (matches the client's todayEastern()). Returns YYYY-MM-DD.
function todayEastern() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

/** Slim alert context: recent completed visits + active care plans for patient ids. */
async function fetchAlertContext(sr, patientIds) {
  const ids = asRows(patientIds).filter(Boolean);
  if (ids.length === 0) {
    return { recentCompletedVisits: [], carePlans: [] };
  }

  const allowedIds = new Set(ids);
  const [rawCompletedVisits, rawCarePlans] = await Promise.all([
    sr.Visit.filter(
      { patient_id: { $in: ids }, status: 'completed' },
      '-visit_date',
      COMPLETED_VISIT_SCAN_LIMIT,
    ),
    sr.CarePlan.filter(
      { patient_id: { $in: ids }, status: 'active' },
      '-updated_date',
      CARE_PLAN_SCAN_LIMIT,
    ),
  ]);

  return {
    recentCompletedVisits: requireRows(rawCompletedVisits, 'Visit.filter')
      .filter((visit) => allowedIds.has(visit?.patient_id) && visit?.status === 'completed')
      .slice(0, COMPLETED_VISIT_LIMIT),
    carePlans: requireRows(rawCarePlans, 'CarePlan.filter')
      .filter((plan) => allowedIds.has(plan?.patient_id) && plan?.status === 'active')
      .slice(0, CARE_PLAN_LIMIT),
  };
}

async function fetchCallerPatients(sr, callerEmail) {
  const [assignedPatients, createdPatients] = await Promise.all([
    sr.Patient.filter(
      { assigned_nurses: callerEmail, status: 'active' },
      '-updated_date',
      PATIENT_SCAN_LIMIT,
    ),
    sr.Patient.filter(
      { created_by: callerEmail, status: 'active' },
      '-updated_date',
      PATIENT_SCAN_LIMIT,
    ),
  ]);

  return uniqueRowsById([
    ...requireRows(assignedPatients, 'Patient.filter assigned'),
    ...requireRows(createdPatients, 'Patient.filter created'),
  ])
    .filter((patient) => patient.status === 'active' && patientBelongsToCaller(patient, callerEmail))
    .sort(newestFirst)
    .slice(0, DASHBOARD_PATIENT_LIMIT);
}

async function fetchScopedDashboardRows(sr, patientIds, today) {
  const allowedIds = new Set(patientIds);
  if (allowedIds.size === 0) {
    return { visits: [], incidents: [], recentCompletedVisits: [], carePlans: [] };
  }

  const [rawVisits, rawIncidents, alertCtx] = await Promise.all([
    sr.Visit.filter(
      { patient_id: { $in: patientIds }, visit_date: today },
      '-visit_time',
      VISIT_SCAN_LIMIT,
    ),
    sr.Incident.filter(
      { patient_id: { $in: patientIds } },
      '-incident_date',
      INCIDENT_SCAN_LIMIT,
    ),
    fetchAlertContext(sr, patientIds),
  ]);

  return {
    visits: requireRows(rawVisits, 'Visit.filter')
      .filter((visit) => allowedIds.has(visit?.patient_id) && visit?.visit_date === today)
      .slice(0, VISIT_LIMIT),
    incidents: requireRows(rawIncidents, 'Incident.filter')
      .filter((incident) => allowedIds.has(incident?.patient_id))
      .slice(0, INCIDENT_LIMIT),
    recentCompletedVisits: alertCtx.recentCompletedVisits,
    carePlans: alertCtx.carePlans,
  };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const sr = base44.asServiceRole.entities;
    const today = todayEastern();

    // Cross-patient scope is restricted to the protected platform identity.
    // Built-in role plus the backend-only configured email are the only trusted
    // privilege signals; custom profile fields cannot widen this result.
    if (isProtectedSuperAdmin(user)) {
      const [rawPatients, rawVisits, rawIncidents] = await Promise.all([
        sr.Patient.filter({ status: 'active' }, '-updated_date', DASHBOARD_PATIENT_LIMIT),
        sr.Visit.filter({ visit_date: today }, '-visit_time', VISIT_LIMIT),
        sr.Incident.list('-incident_date', INCIDENT_LIMIT),
      ]);
      const patients = requireRows(rawPatients, 'Patient.filter')
        .filter((patient) => patient?.id && patient.status === 'active')
        .slice(0, DASHBOARD_PATIENT_LIMIT);
      const visits = requireRows(rawVisits, 'Visit.filter')
        .filter((visit) => visit?.visit_date === today)
        .slice(0, VISIT_LIMIT);
      const incidents = requireRows(rawIncidents, 'Incident.list')
        .filter((incident) => !!incident?.id)
        .slice(0, INCIDENT_LIMIT);
      const { recentCompletedVisits, carePlans } = await fetchAlertContext(
        sr,
        patients.map((patient) => patient.id),
      );
      return Response.json({ patients, visits, incidents, recentCompletedVisits, carePlans });
    }

    const patients = await fetchCallerPatients(sr, callerEmail);
    const scopedRows = await fetchScopedDashboardRows(
      sr,
      patients.map((patient) => patient.id),
      today,
    );
    return Response.json({ patients, ...scopedRows });
  } catch (error) {
    console.error('getDashboardData error:', error?.message);
    return Response.json({ error: 'Failed to load dashboard data' }, { status: 500 });
  }
});
