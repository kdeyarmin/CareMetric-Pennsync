import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

// <<<BEGIN SHARED HELPER: requireAgencyAdminAgency — generated, edit base44/_shared/backendHelpers.mjs>>>
function agencyAdminMissingAgencyResponse(user) {
  if (user && user.account_type === 'agency_admin' && !String(user.agency_name || '').trim()) {
    return Response.json({ error: 'Forbidden: agency_name is required.' }, { status: 403 });
  }
  return null;
}
// <<<END SHARED HELPER: requireAgencyAdminAgency>>>


// Returns org-wide required-training readiness for educators and admins. Runs
// with the service role and computes the rollups server-side so that non-admin
// educators (whose TrainingAssignment RLS would otherwise limit reads to their
// own rows) get accurate team data. Agency admins are scoped to their agency.

const isAuthorized = (user) =>
  user?.role === 'admin' ||
  user?.account_type === 'agency_admin' ||
  user?.account_type === 'super_admin' ||
  user?.is_manager === true; // Rebuilt from server-owned membership, never the editable training_role.

const isCompleted = (a) => a.status === 'completed' || a.pass_fail_result === 'passed';
const requiredStatusLabel = (a) =>
  isCompleted(a) ? 'Complete' : a.status === 'overdue' ? 'Overdue' : 'Outstanding';

const BUSINESS_LINES = [
  { key: 'home_health', label: 'Home Health' },
  { key: 'hospice', label: 'Hospice' },
];

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user?.email) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!isAuthorized(user)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }

    const svc = base44.asServiceRole.entities;
    const [assignments, courses, users] = await Promise.all([
      svc.TrainingAssignment.list('-created_date', 5000),
      svc.TrainingCourse.list('-updated_date', 1000),
      svc.User.list('-created_date', 2000),
    ]);

    if (!Array.isArray(assignments) || !Array.isArray(courses) || !Array.isArray(users)
      || assignments.length >= 5000 || courses.length >= 1000 || users.length >= 2000) {
      return Response.json({ error: 'Training readiness source is incomplete. Narrow or paginate the source before reporting totals.' }, { status: 409 });
    }
    const courseById = Object.fromEntries(courses.map((c) => [c.id, c]));

    // Only protected platform admins (super_admin, or bare role:admin with no agency_name
    // — platform-wide by design) see every tenant's staff. Everyone else,
    // including membership-backed managers, is scoped
    // to their own agency. The old condition only scoped admin account types, so
    // a plain educator/supervisor passed authorization and received the unscoped
    // list — a cross-tenant staff roster + training-compliance dump. Fail closed
    // when an agency-scoped caller lacks an agency_name.
    const isSuperAdmin = user.account_type === 'super_admin';
    // A user who is BOTH account_type agency_admin AND role admin with no
    // agency_name must NOT be promoted to platform-wide via the bare-role:admin
    // path — an agency_admin without an agency_name fails closed by design.
    const isPlatformAdmin = isSuperAdmin
      || (user.role === 'admin' && user.account_type !== 'agency_admin' && !String(user.agency_name || '').trim());
    let scopedAssignments = assignments;
    if (!isPlatformAdmin) {
      const agency = String(user.agency_name || '').trim();
      if (!agency) {
        return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
      }
      if (!claimIdentifier(user.agency_id)) {
        return Response.json({ error: 'A verified agency identifier is required for team readiness.' }, { status: 403 });
      }
      const memberships = await svc.AgencyMembership.filter({ agency_id: user.agency_id }, undefined, 5001);
      if (!Array.isArray(memberships) || memberships.length > 5000
        || memberships.some(row => row?.agency_id !== user.agency_id
          || !canonicalClaimMembership(row, row?.user_id, row?.user_email_normalized))
        || new Set(memberships.map(row => row.user_id)).size !== memberships.length) {
        return Response.json({ error: 'Agency roster is incomplete or ambiguous. Readiness was not calculated.' }, { status: 409 });
      }
      const agencyEmails = new Set();
      for (const member of memberships.filter(row => row.status === 'active')) {
        const matches = users.filter(row => row.id === member.user_id);
        if (matches.length !== 1 || normalizeClaimEmail(matches[0].email) !== member.user_email_normalized) {
          return Response.json({ error: 'Agency roster identity could not be verified. Readiness was not calculated.' }, { status: 409 });
        }
        if (matches[0].is_active !== false && matches[0].disabled !== true && matches[0].is_service !== true) agencyEmails.add(member.user_email_normalized);
      }
      scopedAssignments = assignments.filter((a) => agencyEmails.has(normalizeClaimEmail(a.assigned_to_user_id)));
    }

    const required = scopedAssignments.filter(
      (a) =>
        a.required === true ||
        ['annual_mandatory', 'in_service'].includes(courseById[a.course_id]?.training_type)
    );

    const doneCount = required.filter(isCompleted).length;
    const overall = {
      total: required.length,
      done: doneCount,
      overdue: required.filter((a) => a.status === 'overdue').length,
      pct: required.length ? Math.round((doneCount / required.length) * 100) : null,
      staff: new Set(required.map((a) => a.assigned_to_user_id)).size,
    };

    const byBusinessLine = BUSINESS_LINES.map(({ key, label }) => {
      const subset = required.filter((a) => a.assigned_to_business_line === key);
      const done = subset.filter(isCompleted).length;
      return {
        key,
        label,
        total: subset.length,
        done,
        overdue: subset.filter((a) => a.status === 'overdue').length,
        pct: subset.length ? Math.round((done / subset.length) * 100) : 100,
      };
    }).filter((row) => row.total > 0);

    const roleMap = {};
    required.forEach((a) => {
      const role = a.assigned_to_role || 'Unspecified role';
      if (!roleMap[role]) roleMap[role] = { role, total: 0, done: 0, overdue: 0 };
      roleMap[role].total += 1;
      if (isCompleted(a)) roleMap[role].done += 1;
      if (a.status === 'overdue') roleMap[role].overdue += 1;
    });
    const rolesNeedingAttention = Object.values(roleMap)
      .map((r) => ({ ...r, pct: r.total ? Math.round((r.done / r.total) * 100) : 100 }))
      .sort((a, b) => a.pct - b.pct)
      .slice(0, 6);

    const rows = required.map((a) => ({
      employee: a.assigned_to_user_id || '',
      role: a.assigned_to_role || '',
      business_line: a.assigned_to_business_line || '',
      course: a.course_title || courseById[a.course_id]?.title || '',
      category: courseById[a.course_id]?.category || '',
      status: requiredStatusLabel(a),
      due_date: a.due_date || '',
      completion_date: a.completion_date || '',
      score: a.score_percentage ?? '',
    }));

    return Response.json({ overall, byBusinessLine, rolesNeedingAttention, rows });
  } catch (error) {
    console.error('getTeamTrainingReadiness failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});