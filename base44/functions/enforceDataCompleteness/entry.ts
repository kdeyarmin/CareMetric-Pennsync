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

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>
// <<<BEGIN SHARED HELPER: dataQualityScoring — generated, edit base44/_shared/backendHelpers.mjs>>>
const PATIENT_CRITICAL_FIELDS = [
  'first_name', 'last_name', 'date_of_birth', 'phone', 'address',
  'emergency_contact_name', 'emergency_contact_phone', 'physician_name', 'primary_diagnosis',
];
const USER_CRITICAL_FIELDS = ['phone', 'care_scope', 'credential_type', 'license_number'];
const VISIT_DOCUMENTATION_FIELDS = [
  'nurse_notes', 'homebound_justification', 'vital_signs', 'skilled_intervention_documented',
];
function qualityFieldMissing(row, field) {
  const value = row ? row[field] : undefined;
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return value === false;
}
function missingQualityFields(row, fields) {
  return fields.filter((field) => qualityFieldMissing(row, field));
}
function completenessScore(fields, missing) {
  return Math.round(((fields.length - missing.length) / fields.length) * 100);
}
function visitDocumentationGaps(visit) {
  const missing = VISIT_DOCUMENTATION_FIELDS.filter((field) => (field === 'nurse_notes'
    ? typeof visit?.nurse_notes !== 'string' || visit.nurse_notes.trim().length < 100
    : qualityFieldMissing(visit, field)));
  return { missing, score: completenessScore(VISIT_DOCUMENTATION_FIELDS, missing) };
}
function sameQualityList(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}
async function writePatientQuality(entities, patient, agencyId) {
  const missing = missingQualityFields(patient, PATIENT_CRITICAL_FIELDS);
  const score = completenessScore(PATIENT_CRITICAL_FIELDS, missing);
  if (patient.data_completeness_score === score && sameQualityList(patient.missing_critical_fields, missing)) {
    return { outcome: 'unchanged', score, missing };
  }
  if (patient.agency_id !== agencyId || typeof patient.updated_date !== 'string' || !patient.updated_date) {
    return { outcome: 'skipped', score, missing };
  }
  const result = await entities.Patient.updateMany(
    { id: patient.id, agency_id: agencyId, updated_date: patient.updated_date },
    { $set: { data_completeness_score: score, missing_critical_fields: missing } },
  );
  const updated = !!result && result.success === true && result.updated === 1;
  return { outcome: updated ? 'updated' : 'conflict', score, missing };
}
// <<<END SHARED HELPER: dataQualityScoring>>>

/**
 * enforceDataCompleteness — score ONE record's critical-field completeness.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). It was one of
 * the legacy Patient service-role writers: an editable agency_name decided
 * which tenant's rows an "admin" could rewrite. Now:
 *   - the caller is the built-in administrator or an agency_admin/manager
 *     whose exact active membership withTrustedClaims rebuilds from
 *     service-owned rows; it is decided before the body is read;
 *   - the record must belong to that agency by its OWN agency_id (a Patient or
 *     Visit) or by an active membership there (a User);
 *   - a Patient's quality fields are written with the shared compare-and-swap
 *     (agency_id + updated_date) and only when they changed; a User's
 *     profile_completeness_score is written; a Visit is scored and REPORTED,
 *     because its compliance_score is the clinician's own SmartNote result.
 *
 * Body: { entity_type: 'Patient' | 'User' | 'Visit', entity_id }
 */
const DATA_COMPLETENESS_ENABLED = true;
const MAX_BODY_BYTES = 1_000;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

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
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: json({ error: 'Request body must be an object' }, 400) };
  if (Object.keys(body).some((key) => !['entity_type', 'entity_id'].includes(key))) {
    return { error: json({ error: 'Request contains unsupported fields' }, 400) };
  }
  if (!['Patient', 'User', 'Visit'].includes(body.entity_type)) {
    return { error: json({ error: 'entity_type must be Patient, User or Visit' }, 400) };
  }
  if (!claimIdentifier(body.entity_id)) return { error: json({ error: 'entity_id is required' }, 400) };
  return { entityType: body.entity_type, entityId: body.entity_id };
}

async function exactRow(entity, id) {
  const found = await entity.filter({ id }, undefined, 2);
  return Array.isArray(found) && found.length === 1 && found[0]?.id === id ? found[0] : null;
}

Deno.serve(async (req) => {
  if (!DATA_COMPLETENESS_ENABLED) {
    return json({ error: 'Data completeness scoring is unavailable', code: 'data_completeness_paused' }, 503);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const profile = await base44.auth.me().catch(() => null);
    if (!profile) return json({ error: 'Unauthorized' }, 401);
    if (isDeactivatedUser(profile)) return DEACTIVATED_USER_RESPONSE();
    if (profile.disabled === true || profile.is_service === true) return json({ error: 'Forbidden' }, 403);
    const user = await withTrustedClaims(base44, profile);
    const builtInAdmin = isAdminLike(user);
    if (!builtInAdmin && !(claimIdentifier(user.agency_id) && user.is_manager === true)) {
      return json({ error: 'Agency administrator or manager access required' }, 403);
    }

    const input = await readBody(req);
    if (input.error) return input.error;
    const entities = base44.asServiceRole.entities;
    const inScope = (agencyId) => builtInAdmin ? claimIdentifier(agencyId) : agencyId === user.agency_id;

    if (input.entityType === 'Patient') {
      const patient = await exactRow(entities.Patient, input.entityId);
      if (!patient || !inScope(patient.agency_id)) return json({ error: 'Patient not found in your agency' }, 404);
      const result = await writePatientQuality(entities, patient, patient.agency_id);
      if (result.outcome === 'conflict') return json({ error: 'The chart changed while it was scored; retry' }, 409);
      return json({
        entity_type: 'Patient',
        entity_id: patient.id,
        completeness_score: result.score,
        missing_fields: result.missing,
        critical: result.missing.length >= 3,
        updated: result.outcome === 'updated',
      });
    }

    if (input.entityType === 'User') {
      const target = await exactRow(entities.User, input.entityId);
      if (!target) return json({ error: 'User not found in your agency' }, 404);
      if (!builtInAdmin) {
        const memberships = await entities.AgencyMembership.filter(
          { agency_id: user.agency_id, user_id: target.id, status: 'active' }, undefined, 2,
        );
        if (!Array.isArray(memberships) || memberships.length !== 1
          || memberships[0]?.agency_id !== user.agency_id || memberships[0]?.user_id !== target.id) {
          return json({ error: 'User not found in your agency' }, 404);
        }
      }
      const missing = missingQualityFields(target, USER_CRITICAL_FIELDS);
      const score = completenessScore(USER_CRITICAL_FIELDS, missing);
      if (target.profile_completeness_score !== score) {
        await entities.User.update(target.id, { profile_completeness_score: score });
      }
      return json({
        entity_type: 'User',
        entity_id: target.id,
        completeness_score: score,
        missing_fields: missing,
        critical: missing.length >= 3,
        updated: target.profile_completeness_score !== score,
      });
    }

    const visit = await exactRow(entities.Visit, input.entityId);
    if (!visit || !inScope(visit.agency_id)) return json({ error: 'Visit not found in your agency' }, 404);
    const gaps = visitDocumentationGaps(visit);
    return json({
      entity_type: 'Visit',
      entity_id: visit.id,
      completeness_score: gaps.score,
      missing_fields: gaps.missing,
      critical: gaps.missing.length >= 3,
      updated: false,
    });
  } catch {
    console.error('enforceDataCompleteness failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
