import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';

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
// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const TRUSTED_CLAIM_TENANT_ROLES = new Set(['agency_admin', 'manager', 'clinician', 'office_staff', 'social_worker', 'spiritual_care']);
const normalizeClaimEmail = (value) => typeof value === 'string' ? value.trim().toLowerCase() : '';
const claimIdentifier = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 200 && value.trim() === value && !value.startsWith('$');
const claimEmail = (value) => typeof value === 'string' && value.length <= 320
  && value.includes('@') && !/\s/.test(value) && value === normalizeClaimEmail(value);
const claimInstant = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value))
  && new Date(Date.parse(value)).toISOString() === value;
const claimReason = (value) => typeof value === 'string' && value.length > 0
  && value.length <= 500 && value.trim() === value;
function canonicalClaimMembership(row, userId, normalizedEmail) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const status = row.status;
  return claimIdentifier(row.id) && claimIdentifier(row.agency_id)
    && row.user_id === userId && claimIdentifier(row.membership_key)
    && row.membership_key === row.agency_id + ':' + userId
    && claimEmail(row.user_email_normalized) && row.user_email_normalized === normalizedEmail
    && TRUSTED_CLAIM_TENANT_ROLES.has(row.tenant_role)
    && ['pending', 'active', 'suspended', 'revoked'].includes(status)
    && Number.isSafeInteger(row.version) && row.version >= 1
    && (row.invitation_id == null || claimIdentifier(row.invitation_id))
    && claimIdentifier(row.created_by_user_id) && claimIdentifier(row.last_transition_by_user_id)
    && claimEmail(row.last_transition_by_email_normalized) && claimInstant(row.last_transition_at)
    && claimReason(row.last_transition_reason)
    && (row.activated_at == null || claimInstant(row.activated_at))
    && (!['active', 'suspended'].includes(status) || claimInstant(row.activated_at))
    && (status !== 'pending' || row.activated_at == null)
    && (status === 'revoked'
      ? claimInstant(row.revoked_at) && claimReason(row.revocation_reason)
      : row.revoked_at == null && row.revocation_reason == null);
}
async function loadTrustedTenantClaim(base44, profileId, normalizedEmail) {
  if (!claimIdentifier(profileId) || !claimEmail(normalizedEmail)) return null;
  try {
    // Inspect all lifecycle states before choosing an active membership. An
    // active row plus a revoked/suspended duplicate is never a trusted grant.
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId }, undefined, 101,
    );
    if (!Array.isArray(rows) || rows.length > 100
      || rows.some(row => !canonicalClaimMembership(row, profileId, normalizedEmail))) return null;
    for (const key of ['id', 'membership_key', 'agency_id']) {
      if (new Set(rows.map(row => row[key])).size !== rows.length) return null;
    }
    const active = rows.filter(row => row.status === 'active');
    // Legacy callers do not carry an explicit tenant selector. Multiple active
    // memberships cannot safely be resolved by choosing the first result.
    if (active.length !== 1) return null;
    const membership = active[0];
    const agencyId = membership.agency_id;
    const agencies = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(agencies) && agencies.length === 1 ? agencies[0] : null;
    const agencyName = typeof agency?.agency_name === 'string' ? agency.agency_name.trim() : '';
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(agency.status)
      || !agencyName || agencyName.length > 200) return null;
    return { tenantRole: membership.tenant_role, agencyId, agencyName };
  } catch {
    // No lookup failure may be interpreted as membership approval.
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Preserve the repository's existing protected built-in-admin boundary. This
  // compatibility helper does not grant or change built-in roles.
  if (profile.role === 'admin') return profile;
  const normalizedEmail = normalizeClaimEmail(profile.email);
  const profileId = profile.id;
  const eligible = profile.role === 'user' && profile.is_active !== false
    && profile.disabled !== true && profile.is_service !== true;
  const tenant = eligible ? await loadTrustedTenantClaim(base44, profileId, normalizedEmail) : null;
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
      is_manager: tenant.tenantRole === 'manager' || tenant.tenantRole === 'agency_admin',
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false, is_manager: false };
}
// <<<END SHARED HELPER: trustedCallerClaims>>>

/**
 * autoAssignNurseToPatient — put a visit's clinician on the patient's care team.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). The legacy
 * version was an entity trigger on Visit create that appended the visit
 * creator's address to Patient.assigned_nurses, so creating a visit granted
 * its author PHI access. That never comes back:
 *   - it is NOT a trigger. An agency_admin or manager (exact active membership
 *     rebuilt by withTrustedClaims, never a profile field) or the built-in
 *     administrator asks for one visit, decided before the body is read;
 *   - the visit is read only after that, and must belong to the named agency;
 *   - it writes nothing itself. The grant is forwarded, with the CALLER's own
 *     credential, to managePatientCareTeamAssignment, which re-derives the
 *     caller's manager authority, verifies the target's active membership in
 *     the chart's agency, writes the audited PatientCareTeamAssignment row and
 *     deduplicates on client_request_id. Patient.assigned_nurses is never
 *     read or written;
 *   - a nurse who already holds an assignment is reported, and a suspended or
 *     revoked assignment is never re-granted from here (the broker refuses a
 *     second grant; reactivation is a deliberate act on the care-team screen).
 *
 * Body: { agency_id, visit_id }
 */
const AUTO_ASSIGN_ENABLED = true;
const MAX_BODY_BYTES = 1_000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function readBody(req) {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return { error: json({ error: 'Request body is too large' }, 413) };
  let body;
  try {
    const raw = await req.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
      return { error: json({ error: 'Request body is too large' }, 413) };
    }
    body = JSON.parse(raw);
  } catch {
    return { error: json({ error: 'Invalid JSON body' }, 400) };
  }
  if (!plainObject(body)) return { error: json({ error: 'Request body must be an object' }, 400) };
  if (Object.keys(body).some((key) => !['agency_id', 'visit_id'].includes(key))) {
    return { error: json({ error: 'Request contains unsupported fields' }, 400) };
  }
  if (!claimIdentifier(body.agency_id) || !claimIdentifier(body.visit_id)) {
    return { error: json({ error: 'agency_id and visit_id are required' }, 400) };
  }
  return { agencyId: body.agency_id, visitId: body.visit_id };
}

function brokerPayload(value) {
  if (!plainObject(value)) return {};
  return plainObject(value.data) ? value.data : value;
}

async function invokeBroker(base44, payload) {
  try {
    return { ok: true, data: brokerPayload(await base44.functions.invoke('managePatientCareTeamAssignment', payload)) };
  } catch (error) {
    const record = plainObject(error) ? error : {};
    const response = plainObject(record.response) ? record.response : {};
    const status = Number(response.status || record.status || 0);
    const data = brokerPayload(response.data ?? record.data);
    return {
      ok: false,
      status: Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502,
      error: typeof data.error === 'string' && data.error ? data.error : 'Care-team assignment failed',
    };
  }
}

Deno.serve(async (req) => {
  if (!AUTO_ASSIGN_ENABLED) {
    return json({ error: 'Care-team auto-assignment is unavailable', code: 'auto_assign_paused' }, 503);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const profile = await base44.auth.me().catch(() => null);
    if (!profile) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(profile)) return DEACTIVATED_USER_RESPONSE();
    if (profile.disabled === true || profile.is_service === true) return json({ error: 'Forbidden' }, 403);
    const claims = await withTrustedClaims(base44, profile);
    const builtInAdmin = claims.role === 'admin';
    if (!builtInAdmin && !(claimIdentifier(claims.agency_id) && claims.is_manager === true)) {
      return json({ error: 'Agency administrator or manager access required' }, 403);
    }

    const input = await readBody(req);
    if (input.error) return input.error;
    if (!builtInAdmin && input.agencyId !== claims.agency_id) {
      return json({ error: 'Forbidden: that agency is not yours' }, 403);
    }

    const visits = await base44.asServiceRole.entities.Visit.filter({ id: input.visitId }, undefined, 2);
    const visit = Array.isArray(visits) && visits.length === 1 && visits[0]?.id === input.visitId ? visits[0] : null;
    if (!visit || visit.agency_id !== input.agencyId) return json({ error: 'Visit not found in this agency' }, 404);
    const patientId = claimIdentifier(visit.patient_id) ? visit.patient_id : null;
    const nurseId = claimIdentifier(visit.created_by_user_id) ? visit.created_by_user_id : null;
    if (!patientId || !nurseId) {
      return json({ error: 'The visit does not name both a patient and the clinician who created it' }, 409);
    }

    const scope = { agency_id: input.agencyId, patient_id: patientId, target_user_id: nurseId };
    // The broker answers 404 when no assignment exists yet; anything else it
    // refuses (not a manager, target not a member) is the caller's answer.
    const inspected = await invokeBroker(base44, { action: 'inspect', ...scope });
    if (!inspected.ok && inspected.status !== 404) return json({ error: inspected.error }, inspected.status);
    const current = inspected.ok && plainObject(inspected.data.assignment) ? inspected.data.assignment : null;
    if (current && current.status === 'active') {
      return json({ success: true, already_assigned: true, assignment: current });
    }
    if (current && current.status !== 'active') {
      return json({
        success: false,
        error: `The clinician's care-team assignment is ${current.status}; reactivate it deliberately on the care-team screen`,
        assignment: current,
      }, 409);
    }

    const granted = await invokeBroker(base44, {
      action: 'grant',
      ...scope,
      // Deterministic per visit, so a retry is the broker's idempotent replay.
      client_request_id: `auto-assign-visit:${input.visitId}`,
      reason: `Assigned to the care team from visit ${visit.visit_date || input.visitId}`,
    });
    if (!granted.ok) return json({ error: granted.error }, granted.status);
    return json({
      success: true,
      already_assigned: false,
      idempotent: granted.data.idempotent === true,
      assignment: plainObject(granted.data.assignment) ? granted.data.assignment : null,
    });
  } catch {
    console.error('autoAssignNurseToPatient failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
