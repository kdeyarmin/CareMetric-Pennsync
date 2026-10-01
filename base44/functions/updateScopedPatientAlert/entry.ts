import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
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
