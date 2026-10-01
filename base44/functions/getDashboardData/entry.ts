import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// <<<BEGIN SHARED HELPER: pennsyncProductionAppId — generated, edit base44/_shared/backendHelpers.mjs>>>
const PENNSYNC_PRODUCTION_APP_ID = '694ec16e72e01b60d22f7cbf';
// <<<END SHARED HELPER: pennsyncProductionAppId>>>
// <<<BEGIN SHARED HELPER: base44ClientRequest — generated, edit base44/_shared/backendHelpers.mjs>>>
function pinnedBase44Request(req, expectedAppId, forwardUserCredential) {
  if (typeof expectedAppId !== 'string' || expectedAppId === '') {
    throw new Error('pinned Base44 request requires an expected Base44-App-Id');
  }
  // Read the inbound headers without ever throwing on the SHAPE of req. A production
  // request is always a real Request with a Headers bag; a bare object with no usable
  // headers (a test fixture, a malformed direct call) carries no inbound header, which
  // is the absent case handled below. Only a PRESENT, different app id throws, and that
  // requires a real header an attacker would have to set — so a real Request always
  // reaches this read and the refusal is never skipped by the tolerance.
  const inbound =
    req && req.headers && typeof req.headers.get === 'function' ? req.headers : null;
  const read = (name) => (inbound ? inbound.get(name) : null);
  const received = read('Base44-App-Id');
  // Refuse only an ACTIVE mismatch: a caller presenting a DIFFERENT app id is the
  // tenant-redirect attack, and that is the case the refusal exists for. An ABSENT
  // header is not a mismatch and selects no other tenant — it only means the request
  // did not arrive through the platform, which always injects this header. We SET the
  // pinned constant below either way, so absent falls back to the correct app exactly
  // as the dropped Base44-Api-Url falls back to the default serverUrl. Throwing on
  // absent would turn every anonymous denial into a 500 instead of a clean 403.
  if (received !== null && received !== expectedAppId) {
    throw new Error(
      'Base44-App-Id mismatch: expected ' + expectedAppId + ', received ' + received
    );
  }
  const headers = new Headers();
  // Load-bearing: SET the constant (never forward the inbound value). The SDK reads
  // appId from this header and throws of its own accord when it is absent, so pinning
  // requires setting it here — dropping the inbound header alone would not suffice.
  headers.set('Base44-App-Id', expectedAppId);
  const serviceAuth = read('Base44-Service-Authorization');
  if (serviceAuth !== null) headers.set('Base44-Service-Authorization', serviceAuth);
  if (forwardUserCredential) {
    const authorization = read('Authorization');
    if (authorization !== null) headers.set('Authorization', authorization);
    const dataEnv = read('X-Data-Env');
    if (dataEnv === 'dev' || dataEnv === 'prod') headers.set('X-Data-Env', dataEnv);
  }
  // Cosmetic URL: serverUrl comes from the dropped Base44-Api-Url, not from here.
  // No method: the SDK request factory reads only headers.get(...), never the
  // method, so the request defaults to GET. An explicit POST would be inert for the
  // SDK and would read as an outbound delivery primitive to the inventory scanner
  // once this block is inlined into the fax status pollers.
  return new Request('https://base44.app', { headers });
}
function userScopedClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, true);
}
function serviceRoleClientRequest(req, expectedAppId) {
  return pinnedBase44Request(req, expectedAppId, false);
}
// <<<END SHARED HELPER: base44ClientRequest>>>
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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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
