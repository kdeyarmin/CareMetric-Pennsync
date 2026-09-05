import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * getScopedPatientAlerts — returns only PatientAlert rows tied to a patient the
 * caller created or is assigned to. The configured protected superadmin is the
 * sole cross-patient/platform exception.
 *
 * Optional status (string) and severity (string[]) parameters narrow results.
 * Service-role queries are only bounded fetch optimizations; every patient and
 * alert row is re-authorized in memory before it can be returned.
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

const DEFAULT_ALERT_LIMIT = 100;
const MAX_ALERT_LIMIT = 500;
const ALERT_SCAN_LIMIT = 1000;
const PATIENT_SCAN_LIMIT = 1000;
const MAX_PATIENT_ID_LENGTH = 200;
const MAX_FILTER_VALUE_LENGTH = 100;
const MAX_SEVERITY_FILTERS = 20;

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

function parseLimit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_ALERT_LIMIT;
  return Math.min(Math.floor(numeric), MAX_ALERT_LIMIT);
}

function parseRequestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'Request body must be an object' };
  }

  let patientId = null;
  if (body.patient_id !== undefined && body.patient_id !== null) {
    if (typeof body.patient_id !== 'string') {
      return { error: 'patient_id must be a string' };
    }
    patientId = body.patient_id.trim();
    if (!patientId || patientId.length > MAX_PATIENT_ID_LENGTH) {
      return { error: 'patient_id is invalid' };
    }
  }

  let status = null;
  if (body.status !== undefined && body.status !== null) {
    if (typeof body.status !== 'string') return { error: 'status must be a string' };
    status = body.status.trim();
    if (!status || status.length > MAX_FILTER_VALUE_LENGTH) {
      return { error: 'status is invalid' };
    }
  }

  let severities = [];
  if (body.severity !== undefined && body.severity !== null) {
    if (!Array.isArray(body.severity) || body.severity.length > MAX_SEVERITY_FILTERS) {
      return { error: 'severity must be a bounded string array' };
    }
    severities = [...new Set(body.severity.map((value) => {
      if (typeof value !== 'string') return null;
      const trimmed = value.trim();
      return trimmed && trimmed.length <= MAX_FILTER_VALUE_LENGTH ? trimmed : null;
    }))];
    if (severities.some((value) => value === null)) {
      return { error: 'severity must contain valid strings' };
    }
  }

  return {
    patientId,
    limit: parseLimit(body.limit),
    status,
    severities,
  };
}

function alertMatches(alert, { allowedIds, patientId, status, severitySet }) {
  if (!alert || typeof alert !== 'object') return false;
  if (patientId && alert.patient_id !== patientId) return false;
  if (allowedIds && !allowedIds.has(alert.patient_id)) return false;
  if (status && alert.status !== status) return false;
  if (severitySet.size > 0 && !severitySet.has(alert.severity)) return false;
  return true;
}

async function fetchCallerPatientIds(entities, callerEmail) {
  const [assignedPatients, createdPatients] = await Promise.all([
    entities.Patient.filter(
      { assigned_nurses: callerEmail },
      '-created_date',
      PATIENT_SCAN_LIMIT,
    ),
    entities.Patient.filter(
      { created_by: callerEmail },
      '-created_date',
      PATIENT_SCAN_LIMIT,
    ),
  ]);

  return new Set(
    [
      ...requireRows(assignedPatients, 'Patient.filter assigned'),
      ...requireRows(createdPatients, 'Patient.filter created'),
    ]
      .filter((patient) => patient?.id && patientBelongsToCaller(patient, callerEmail))
      .map((patient) => patient.id),
  );
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    const callerEmail = normalizeProtectedEmail(user.email);
    if (!callerEmail) return Response.json({ error: 'Forbidden' }, { status: 403 });

    let body;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
    const parsed = parseRequestBody(body);
    if (parsed.error) return Response.json({ error: parsed.error }, { status: 400 });

    const { patientId, limit, status, severities } = parsed;
    const entities = base44.asServiceRole.entities;
    const protectedSuperadmin = isProtectedSuperAdmin(user);
    const severitySet = new Set(severities);
    const extraFilter = {};
    if (status) extraFilter.status = status;
    if (severities.length > 0) extraFilter.severity = { $in: severities };

    if (patientId) {
      if (!protectedSuperadmin) {
        const rawPatients = await entities.Patient
          .filter({ id: patientId }, undefined, PATIENT_SCAN_LIMIT);
        const patient = requireRows(rawPatients, 'Patient.filter')
          .find((row) => row?.id === patientId);
        if (!patient || !patientBelongsToCaller(patient, callerEmail)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 });
        }
      }

      const rawAlerts = await entities.PatientAlert
        .filter({ patient_id: patientId, ...extraFilter }, '-created_date', ALERT_SCAN_LIMIT);
      const alerts = requireRows(rawAlerts, 'PatientAlert.filter')
        .slice(0, ALERT_SCAN_LIMIT)
        .filter((alert) => alertMatches(alert, {
          allowedIds: null,
          patientId,
          status,
          severitySet,
        }))
        .slice(0, limit);
      return Response.json({ alerts });
    }

    if (protectedSuperadmin) {
      const rawAlerts = Object.keys(extraFilter).length > 0
        ? await entities.PatientAlert.filter(extraFilter, '-created_date', ALERT_SCAN_LIMIT)
        : await entities.PatientAlert.list('-created_date', ALERT_SCAN_LIMIT);
      const alerts = requireRows(
        rawAlerts,
        Object.keys(extraFilter).length > 0 ? 'PatientAlert.filter' : 'PatientAlert.list',
      )
        .slice(0, ALERT_SCAN_LIMIT)
        .filter((alert) => alertMatches(alert, {
          allowedIds: null,
          patientId: null,
          status,
          severitySet,
        }))
        .slice(0, limit);
      return Response.json({ alerts });
    }

    const allowedIds = await fetchCallerPatientIds(entities, callerEmail);
    if (allowedIds.size === 0) return Response.json({ alerts: [] });

    const rawAlerts = await entities.PatientAlert
      .filter(
        { patient_id: { $in: [...allowedIds] }, ...extraFilter },
        '-created_date',
        ALERT_SCAN_LIMIT,
      );
    const alerts = requireRows(rawAlerts, 'PatientAlert.filter')
      .slice(0, ALERT_SCAN_LIMIT)
      .filter((alert) => alertMatches(alert, {
        allowedIds,
        patientId: null,
        status,
        severitySet,
      }))
      .slice(0, limit);
    return Response.json({ alerts });
  } catch (error) {
    console.error('getScopedPatientAlerts error:', error?.message);
    return Response.json({ error: 'Failed to load alerts' }, { status: 500 });
  }
});
