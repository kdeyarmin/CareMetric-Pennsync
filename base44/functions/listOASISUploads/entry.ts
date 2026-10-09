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
// <<<BEGIN SHARED HELPER: oasisRecordScope — generated, edit base44/_shared/backendHelpers.mjs>>>
function oasisCallerScope(user) {
  if (!user || typeof user !== 'object') return null;
  const userId = typeof user.id === 'string' ? user.id : '';
  const email = String(user.email || '').trim().toLowerCase();
  if (!userId || !email) return null;
  if (user.role === 'admin') return { platform: true, lead: true, agencyId: '', userId, email };
  const agencyId = typeof user.agency_id === 'string' ? user.agency_id : '';
  if (!agencyId) return null;
  const lead = user.account_type === 'agency_admin' || user.is_manager === true;
  return { platform: false, lead, agencyId, userId, email };
}
async function oasisOpenablePatientIds(base44, scope) {
  // null means "every chart in scope": the platform owner and an agency lead.
  if (!scope || scope.platform || scope.lead) return null;
  const entities = base44.asServiceRole.entities;
  const [created, seats] = await Promise.all([
    entities.Patient.filter(
      { agency_id: scope.agencyId, created_by_user_id: scope.userId }, '-updated_date', 2000,
    ).catch(() => []),
    entities.PatientCareTeamAssignment.filter(
      { agency_id: scope.agencyId, user_id: scope.userId, status: 'active' }, '-updated_date', 2000,
    ).catch(() => []),
  ]);
  const ids = new Set();
  for (const row of Array.isArray(created) ? created : []) {
    if (row?.agency_id === scope.agencyId && row.created_by_user_id === scope.userId
      && String(row.created_by_user_email_normalized || '') === scope.email) ids.add(row.id);
  }
  for (const row of Array.isArray(seats) ? seats : []) {
    if (row?.status === 'active' && row.agency_id === scope.agencyId && row.user_id === scope.userId) {
      ids.add(row.patient_id);
    }
  }
  return ids;
}
// <<<END SHARED HELPER: oasisRecordScope>>>

// Released by the owner on 2026-10-08 ("approve everything"). Who sees which
// upload is decided from TRUSTED claims (withTrustedClaims rebuilds agency_id,
// account_type and is_manager from the caller's one active AgencyMembership):
//   * the platform owner (built-in admin role) sees every upload;
//   * an agency lead (agency_admin or manager membership) sees their agency's;
//   * anyone else sees the uploads they authored — read as the caller, so
//     OASISUpload's own creator-or-admin read rule decides — plus uploads linked
//     to a chart they may open (recorded creator or active care-team seat).
// The service-role read is therefore always bounded by an agency id or by an
// exact set of openable patient ids, never by a field the caller can edit.
// Every money-shaped field is stripped below.
const OASIS_UPLOAD_LIST_ENABLED = true;

// Recursively drop any object key whose name implies money (revenue / payment /
// reimbursement / rescore) so an OASISUpload never carries a dollar figure or a
// payment-driven rescore, while every clinical field — scores, functional
// impairment level, clinical group, compliance, documentation, extracted_data —
// is preserved.
const FINANCIAL_KEY = /revenue|payment|reimburs|rescore/i;
function stripFinancial(value) {
  if (Array.isArray(value)) return value.map(stripFinancial);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (FINANCIAL_KEY.test(k)) continue;
      out[k] = stripFinancial(v);
    }
    return out;
  }
  return value;
}

const MAX_ID = 200;
const exactId = (value) => typeof value === 'string' && value.length > 0 && value.length <= MAX_ID
  && value.trim() === value && !value.startsWith('$') ? value : '';

function sortRows(rows, sort) {
  const descending = String(sort || '').startsWith('-');
  const field = String(sort || '-created_date').replace(/^-/, '') || 'created_date';
  return [...rows].sort((a, b) => {
    const left = String(a?.[field] ?? '');
    const right = String(b?.[field] ?? '');
    if (left === right) return String(a?.id || '').localeCompare(String(b?.id || ''));
    return descending ? (left < right ? 1 : -1) : (left < right ? -1 : 1);
  });
}

Deno.serve(async (req) => {
  if (!OASIS_UPLOAD_LIST_ENABLED) {
    return Response.json({
      success: false,
      available: false,
      reason: 'oasis_upload_listing_paused',
      message: 'OASIS upload listing is unavailable pending tenant-scoped server authorization and a safe response projection.',
      uploads: [],
      financialsRestricted: true,
    }, { status: 409 });
  }

  try {
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    const scope = oasisCallerScope(user);

    const body = await req.json().catch(() => ({}));
    const { patientId, sort = '-created_date', limit = 50, assessmentDateFrom, assessmentDateTo } = body || {};
    // Bounded like the other service reads — an unbounded list would silently
    // truncate at the SDK page default; a runaway limit would time out.
    const boundedLimit = Math.min(Math.max(Number(limit) || 50, 1), 1000);
    const safeSort = /^-?[a-z_]{1,40}$/.test(String(sort)) ? String(sort) : '-created_date';

    // Optional assessment-date range so report callers can scope server-side
    // instead of date-filtering a newest-N page (which undercounts any period
    // holding more than N uploads). Bounds compare lexicographically, which is
    // correct for both "YYYY-MM-DD" and ISO datetime storage: the lower bound
    // stays date-only (a date-only stored value sorts BEFORE "…T00:00:00"),
    // the upper bound gets the end-of-day suffix so datetime values match.
    const query = {};
    if (patientId !== undefined && patientId !== null && patientId !== '') {
      const id = exactId(patientId);
      if (!id) return Response.json({ error: 'patientId is invalid' }, { status: 400 });
      query.patient_id = id;
    }
    if (assessmentDateFrom || assessmentDateTo) {
      query.assessment_date = {};
      if (assessmentDateFrom) query.assessment_date.$gte = String(assessmentDateFrom).slice(0, 10);
      if (assessmentDateTo) query.assessment_date.$lte = `${String(assessmentDateTo).slice(0, 10)}T23:59:59.999`;
    }

    let records;
    if (scope && (scope.platform || scope.lead)) {
      const scoped = scope.platform ? query : { ...query, agency_id: scope.agencyId };
      records = Object.keys(scoped).length
        ? await base44.asServiceRole.entities.OASISUpload.filter(scoped, safeSort, boundedLimit)
        : await base44.asServiceRole.entities.OASISUpload.list(safeSort, boundedLimit);
      records = (records || []).filter((row) => scope.platform || row?.agency_id === scope.agencyId);
    } else {
      // The caller's own uploads, read as the caller: the entity's creator rule decides.
      const own = Object.keys(query).length
        ? await base44.entities.OASISUpload.filter(query, safeSort, boundedLimit)
        : await base44.entities.OASISUpload.list(safeSort, boundedLimit);
      const merged = new Map((own || []).filter((row) => row?.id).map((row) => [row.id, row]));
      // Plus uploads on the charts this caller may open, in their own agency.
      const openable = scope ? await oasisOpenablePatientIds(base44, scope) : null;
      const wanted = openable
        ? [...openable].filter((id) => !query.patient_id || id === query.patient_id)
        : [];
      if (scope && wanted.length) {
        const charted = await base44.asServiceRole.entities.OASISUpload.filter(
          { ...query, agency_id: scope.agencyId, patient_id: { $in: wanted } }, safeSort, boundedLimit,
        );
        for (const row of charted || []) {
          if (row?.id && row.agency_id === scope.agencyId && wanted.includes(row.patient_id)) merged.set(row.id, row);
        }
      }
      records = sortRows([...merged.values()], safeSort).slice(0, boundedLimit);
    }

    // PDGM reimbursement is globally fail-closed, so legacy estimator/revenue
    // fields are stripped for every role, including built-in admins.
    const uploads = (records || []).map(stripFinancial);
    return Response.json({ uploads, financialsRestricted: true });
  } catch (error) {
    console.error('listOASISUploads failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});

