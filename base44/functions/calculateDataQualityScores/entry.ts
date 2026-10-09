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
// <<<BEGIN SHARED HELPER: schedulerAuth — generated, edit base44/_shared/backendHelpers.mjs>>>
const SCHEDULER_SECRET_HEADER = 'x-internal-secret';
function isSchedulerAdmin(user) {
  return !!user && user.role === 'admin';
}
// Constant-time string compare for the shared-secret check (mirrors
// createTelehealthToken's timingSafeEqual). A plain === short-circuits on the
// first differing character, so response timing could leak how much of the
// secret matched. Dependency-free char-code XOR so the identical source runs
// under Deno (consumers) and Node (tests).
function timingSafeEqualStr(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return mismatch === 0;
}
function getSchedulerAuthError(req, user) {
  if (isSchedulerAdmin(user)) return null;
  const expectedSecret = String(Deno.env.get('INTERNAL_FN_SECRET') || '').trim();
  if (!expectedSecret) {
    return Response.json(
      { error: 'Server misconfigured: INTERNAL_FN_SECRET is required for scheduled/internal functions' },
      { status: 500 },
    );
  }
  const providedSecret = String(req.headers.get(SCHEDULER_SECRET_HEADER) || '').trim();
  if (timingSafeEqualStr(providedSecret, expectedSecret)) return null;
  return Response.json(
    { error: user ? 'Forbidden: admin or scheduler secret required' : 'Unauthorized: scheduler secret required' },
    { status: user ? 403 : 401 },
  );
}
// <<<END SHARED HELPER: schedulerAuth>>>
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
 * calculateDataQualityScores — recompute data-completeness scores, ONE agency
 * at a time.
 *
 * Released by the owner on 2026-10-08 ("turn everything on"). It was one of
 * the legacy Patient service-role writers: it scanned every tenant's charts,
 * scoped them from editable agency_name / created_by / assigned_nurses
 * fields, and wrote each row unconditionally. Now:
 *   - an agency_admin or manager (exact active membership rebuilt by
 *     withTrustedClaims, never a profile field) recomputes THEIR agency only;
 *   - the scheduled run ("Daily Data Quality Scores") and the built-in
 *     administrator authenticate with getSchedulerAuthError (built-in admin or
 *     the shared INTERNAL_FN_SECRET header) and run each active agency
 *     separately from service-owned Agency rows: every read is filtered by
 *     that agency_id and every row is re-checked against it, so no request
 *     ever mixes tenants (D49's per-agency rule);
 *   - a Patient's data_completeness_score / missing_critical_fields are
 *     written with a compare-and-swap on the row's own agency_id and
 *     updated_date and only when they changed; a Visit's compliance_score is
 *     the clinician's SmartNote result and is reported, never overwritten; a
 *     member's profile_completeness_score is written only for users holding
 *     an active membership in that agency.
 *
 * Body: {} or { agency_id } (agency_id only for the scheduler/built-in admin)
 */
const DATA_QUALITY_SCORES_ENABLED = true;
const MAX_BODY_BYTES = 1_000;
const PATIENT_LIMIT = 2_000;
const VISIT_LIMIT = 2_000;
const MEMBER_LIMIT = 500;
const AGENCY_LIMIT = 200;
const NO_STORE_HEADERS = { 'Cache-Control': 'no-store', Pragma: 'no-cache' };

const json = (body, status = 200, headers = {}) => Response.json(body, {
  status,
  headers: { ...NO_STORE_HEADERS, ...headers },
});

function rows(value) {
  return Array.isArray(value) ? value : [];
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
    body = raw.trim() ? JSON.parse(raw) : {};
  } catch {
    return { error: json({ error: 'Invalid JSON body' }, 400) };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: json({ error: 'Request body must be an object' }, 400) };
  if (Object.keys(body).some((key) => key !== 'agency_id')) return { error: json({ error: 'Request contains unsupported fields' }, 400) };
  if (body.agency_id != null && !claimIdentifier(body.agency_id)) return { error: json({ error: 'agency_id is invalid' }, 400) };
  return { agencyId: body.agency_id ?? null };
}

async function enabledAgencyIds(entities, requested) {
  if (requested) {
    const found = rows(await entities.Agency.filter({ id: requested }, undefined, 2));
    return found.length === 1 && found[0]?.id === requested && ['active', 'trial'].includes(found[0].status)
      ? [requested]
      : [];
  }
  const ids = [];
  for (const status of ['active', 'trial']) {
    for (const agency of rows(await entities.Agency.filter({ status }, undefined, AGENCY_LIMIT))) {
      if (claimIdentifier(agency?.id) && agency.status === status && !ids.includes(agency.id)) ids.push(agency.id);
    }
  }
  return ids;
}

async function scoreAgency(entities, agencyId) {
  const summary = {
    agency_id: agencyId,
    patients_scored: 0,
    patients_updated: 0,
    patient_conflicts: 0,
    members_scored: 0,
    members_updated: 0,
    visits_reviewed: 0,
    visits_with_documentation_gaps: 0,
  };

  const patients = rows(await entities.Patient.filter(
    { agency_id: agencyId, status: 'active' }, '-updated_date', PATIENT_LIMIT,
  )).filter((patient) => patient?.agency_id === agencyId && claimIdentifier(patient.id));
  for (const patient of patients) {
    const result = await writePatientQuality(entities, patient, agencyId);
    summary.patients_scored += 1;
    if (result.outcome === 'updated') summary.patients_updated += 1;
    if (result.outcome === 'conflict') summary.patient_conflicts += 1;
  }

  const members = rows(await entities.AgencyMembership.filter(
    { agency_id: agencyId, status: 'active' }, undefined, MEMBER_LIMIT,
  )).filter((row) => row?.agency_id === agencyId && row.status === 'active' && claimIdentifier(row.user_id));
  const memberIds = [...new Set(members.map((row) => row.user_id))];
  const users = memberIds.length === 0 ? [] : rows(await entities.User.filter(
    { id: { $in: memberIds } }, undefined, MEMBER_LIMIT,
  )).filter((user) => memberIds.includes(user?.id));
  for (const user of users) {
    const missing = missingQualityFields(user, USER_CRITICAL_FIELDS);
    const score = completenessScore(USER_CRITICAL_FIELDS, missing);
    summary.members_scored += 1;
    if (user.profile_completeness_score !== score) {
      await entities.User.update(user.id, { profile_completeness_score: score });
      summary.members_updated += 1;
    }
  }

  const visits = rows(await entities.Visit.filter(
    { agency_id: agencyId, status: 'completed' }, '-visit_date', VISIT_LIMIT,
  )).filter((visit) => visit?.agency_id === agencyId);
  for (const visit of visits) {
    summary.visits_reviewed += 1;
    if (visitDocumentationGaps(visit).missing.length > 0) summary.visits_with_documentation_gaps += 1;
  }
  return summary;
}

Deno.serve(async (req) => {
  if (!DATA_QUALITY_SCORES_ENABLED) {
    return json({ error: 'Data quality scoring is unavailable', code: 'data_quality_scores_paused' }, 503);
  }
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405, { Allow: 'POST' });
  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const profile = await base44.auth.me().catch(() => null);
    if (isDeactivatedUser(profile)) return DEACTIVATED_USER_RESPONSE();
    const claims = profile && profile.role !== 'admin' ? await withTrustedClaims(base44, profile) : profile;
    const agencyLead = !!claims && claims.role !== 'admin'
      && claimIdentifier(claims.agency_id) && claims.is_manager === true;
    if (!agencyLead) {
      // The scheduled run and the built-in administrator.
      const authError = getSchedulerAuthError(req, profile);
      if (authError) return authError;
    }

    const input = await readBody(req);
    if (input.error) return input.error;
    if (agencyLead && input.agencyId && input.agencyId !== claims.agency_id) {
      return json({ error: 'Forbidden: that agency is not yours' }, 403);
    }

    const entities = base44.asServiceRole.entities;
    const agencyIds = agencyLead
      ? await enabledAgencyIds(entities, claims.agency_id)
      : await enabledAgencyIds(entities, input.agencyId);
    if (agencyLead && agencyIds.length !== 1) return json({ error: 'Agency is unavailable' }, 403);

    const agencies = [];
    let failed = 0;
    for (const agencyId of agencyIds) {
      try {
        agencies.push(await scoreAgency(entities, agencyId));
      } catch {
        failed += 1;
      }
    }
    return json({
      success: failed === 0,
      agencies_processed: agencies.length,
      agencies_failed: failed,
      agencies,
      timestamp: new Date().toISOString(),
    });
  } catch {
    console.error('calculateDataQualityScores failed');
    return json({ error: 'Internal server error' }, 500);
  }
});
