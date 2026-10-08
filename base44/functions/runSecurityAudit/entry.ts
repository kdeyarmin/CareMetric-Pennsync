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
 * runSecurityAudit — administrator security audit (owner decision, 2026-10-08).
 *
 * The built-in administrator audits the whole deployment. An agency
 * administrator — proven by exactly one active, service-owned agency_admin
 * membership through withTrustedClaims, never by a self-editable profile
 * field — audits their own agency: the staff cohort is that agency's
 * memberships, the patient cohort is that agency's charts, and activity rows
 * are counted only for that staff. Every other caller is refused before any
 * cohort read.
 *
 * Body: { secure_context?: boolean }
 */

const COHORT_LIMIT = 2000;
const MEMBERSHIP_LIMIT = 2000;
const ID_CHUNK = 200;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** Parse YYYY-MM-DD (or datetime) as local calendar day start. */
function startOfLocalDay(value) {
  if (!value) return null;
  const s = String(value);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) throw new Error(`${label} read failed`);
  return value;
}

/** The audit authority: { scope: 'platform' } or { scope: 'agency', agencyId }, or null. */
async function auditAuthority(base44, user) {
  if (user.role === 'admin') return { scope: 'platform', agencyId: null };
  const claims = await withTrustedClaims(base44, user);
  if (claims && claims.account_type === 'agency_admin' && claimIdentifier(claims.agency_id)) {
    return { scope: 'agency', agencyId: claims.agency_id };
  }
  return null;
}

async function loadCohort(base44, authority) {
  const entities = base44.asServiceRole.entities;
  if (authority.scope === 'platform') {
    const users = requireArray(await entities.User.list('-created_date', COHORT_LIMIT), 'User');
    const patients = requireArray(await entities.Patient.list('-created_date', COHORT_LIMIT), 'Patient');
    const activities = requireArray(await entities.UserActivity.list('-created_date', COHORT_LIMIT), 'UserActivity');
    return { users, patients, activities };
  }
  const memberships = requireArray(
    await entities.AgencyMembership.filter({ agency_id: authority.agencyId }, undefined, MEMBERSHIP_LIMIT + 1),
    'AgencyMembership',
  ).filter((row) => row?.agency_id === authority.agencyId && row.status !== 'revoked');
  if (memberships.length > MEMBERSHIP_LIMIT) throw new Error('Agency membership cohort exceeds the audit limit');
  const userIds = [...new Set(memberships.map((row) => row.user_id).filter(claimIdentifier))];
  const users = [];
  for (let index = 0; index < userIds.length; index += ID_CHUNK) {
    const chunk = userIds.slice(index, index + ID_CHUNK);
    const rows = requireArray(await entities.User.filter({ id: { $in: chunk } }, undefined, chunk.length + 1), 'User');
    users.push(...rows.filter((row) => chunk.includes(row?.id)));
  }
  const patients = requireArray(
    await entities.Patient.filter({ agency_id: authority.agencyId }, '-created_date', COHORT_LIMIT),
    'Patient',
  ).filter((row) => row?.agency_id === authority.agencyId);
  const staffEmails = new Set(users.map((row) => normalizeClaimEmail(row.email)).filter(Boolean));
  const activities = requireArray(await entities.UserActivity.list('-created_date', COHORT_LIMIT), 'UserActivity')
    .filter((row) => staffEmails.has(normalizeClaimEmail(row?.user_email)));
  return { users, patients, activities };
}

function auditFindings({ users, patients, activities }, secureContext) {
  const findings = [];
  let score = 100;

  const inactiveUsers = users.filter((u) => {
    const lastActivity = activities.find((a) => a.user_email === u.email);
    if (!lastActivity) return true;
    const daysSinceActivity = (Date.now() - new Date(lastActivity.created_date).getTime()) / (1000 * 60 * 60 * 24);
    return daysSinceActivity > 90;
  });
  if (inactiveUsers.length > 0) {
    findings.push({
      severity: 'medium',
      category: 'Access Control',
      issue: `${inactiveUsers.length} inactive user(s) detected (no activity in 90+ days)`,
      recommendation: 'Review and disable accounts that are no longer active',
      affected_count: inactiveUsers.length,
    });
    score -= 5;
  }

  const failedLogins = activities.filter((a) => a.action?.includes('login_failed') || a.action?.includes('access_denied'));
  if (failedLogins.length > 10) {
    findings.push({
      severity: 'high',
      category: 'Authentication',
      issue: `${failedLogins.length} failed authentication attempts detected`,
      recommendation: 'Monitor for potential brute force attacks. Consider implementing rate limiting.',
      affected_count: failedLogins.length,
    });
    score -= 10;
  }

  const phiAccess = activities.filter((a) => a.entity_type === 'Patient' || a.entity_type === 'Visit');
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayByUser = new Map();
  for (const access of phiAccess) {
    if (new Date(access.created_date) >= today) {
      todayByUser.set(access.user_email, (todayByUser.get(access.user_email) || 0) + 1);
    }
  }
  const heavyUsers = [...todayByUser.entries()].filter(([, count]) => count > 50);
  if (heavyUsers.length > 0) {
    findings.push({
      severity: 'critical',
      category: 'Data Access',
      issue: 'Unusual PHI access patterns detected',
      recommendation: 'Review access patterns for potential data breach or misuse',
      affected_count: heavyUsers.length,
    });
    score -= 15;
  }

  if (!secureContext) {
    findings.push({
      severity: 'critical',
      category: 'Encryption',
      issue: 'Application not running in secure context (HTTPS)',
      recommendation: 'Ensure all access is through HTTPS with valid SSL certificate',
      affected_count: 1,
    });
    score -= 20;
  }

  const usersWithoutStrongAuth = users.filter((u) => !u.mfa_enabled);
  if (usersWithoutStrongAuth.length > 0) {
    findings.push({
      severity: 'medium',
      category: 'Authentication',
      issue: `${usersWithoutStrongAuth.length} user(s) without multi-factor authentication`,
      recommendation: 'Encourage or require MFA for all users, especially admins',
      affected_count: usersWithoutStrongAuth.length,
    });
    score -= 5;
  }

  const oldPatients = patients.filter((p) => {
    const discharged = startOfLocalDay(p.discharge_date);
    if (!discharged) return false;
    return (Date.now() - discharged.getTime()) / (1000 * 60 * 60 * 24) > 2555;
  });
  if (oldPatients.length > 0) {
    findings.push({
      severity: 'low',
      category: 'Data Retention',
      issue: `${oldPatients.length} patient record(s) older than 7 years`,
      recommendation: 'Review data retention policy and archive/purge old records',
      affected_count: oldPatients.length,
    });
    score -= 2;
  }

  return { findings, securityScore: Math.max(0, score) };
}

Deno.serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405, headers: { Allow: 'POST', ...NO_STORE } });
    }
    const base44 = createClientFromRequest(userScopedClientRequest(req, PENNSYNC_PRODUCTION_APP_ID));
    const user = await base44.auth.me().catch(() => null);
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (user.disabled === true || user.is_service === true || user.is_verified === false) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
    }
    const authority = await auditAuthority(base44, user);
    if (!authority) {
      return Response.json({
        error: 'Security audits are limited to administrators and agency administrators',
      }, { status: 403, headers: NO_STORE });
    }

    const body = await req.json().catch(() => ({}));
    const secureContext = body?.secure_context !== false;

    let cohort;
    try {
      cohort = await loadCohort(base44, authority);
    } catch (readErr) {
      console.error('runSecurityAudit cohort read failed:', readErr?.message || readErr);
      return Response.json({
        error: 'Security audit could not load the inspected cohort. Retry later.',
      }, { status: 503, headers: NO_STORE });
    }

    if (cohort.users.length === 0 && cohort.patients.length === 0) {
      return Response.json({
        error: 'Security audit found an empty cohort — refusing to record a misleading score.',
      }, { status: 422, headers: NO_STORE });
    }

    const { findings, securityScore } = auditFindings(cohort, secureContext);

    // Re-read the caller before recording, so an authority revoked during the
    // audit does not leave a log entry attributed to it.
    const freshUser = await base44.auth.me().catch(() => null);
    const freshAuthority = freshUser && !isDeactivatedUser(freshUser)
      && freshUser.id === user.id
      ? await auditAuthority(base44, freshUser)
      : null;
    if (!freshAuthority || freshAuthority.scope !== authority.scope || freshAuthority.agencyId !== authority.agencyId) {
      return Response.json({ error: 'Forbidden' }, { status: 403, headers: NO_STORE });
    }
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: freshUser.email,
      user_role: freshUser.role || 'user',
      action: 'security_audit',
      details: {
        audit_type: 'comprehensive',
        security_score: securityScore,
        findings_count: findings.length,
        findings,
        checked_users: cohort.users.length,
        checked_patients: cohort.patients.length,
        checked_activities: cohort.activities.length,
        agency_scoped: authority.scope === 'agency',
        agency_id: authority.agencyId,
      },
    });

    return Response.json({
      success: true,
      scope: authority.scope,
      security_score: securityScore,
      findings_count: findings.length,
      findings,
    }, { headers: NO_STORE });
  } catch (error) {
    console.error('runSecurityAudit failed:', error?.message || error);
    return Response.json({ error: 'Audit failed' }, { status: 500, headers: NO_STORE });
  }
});
