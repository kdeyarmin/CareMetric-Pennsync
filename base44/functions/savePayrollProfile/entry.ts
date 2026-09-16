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

/**
 * savePayrollProfile — admin upsert of an employee's standing payroll profile
 * (currently the recurring phone reimbursement). One profile per employee: the
 * function finds an existing row by email and updates it, otherwise creates one.
 *
 * Admin-only. The reimbursement is an expense reimbursement figure — this system
 * tracks hours/points and standing reimbursements only; it holds NO pay rates or
 * wage/gross-pay math.
 */

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


function toNonNegativeNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : Math.round(n * 100) / 100;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    // Admin = role 'admin' or an admin account_type (agency/super), matching the
    // app's role model (src/lib/roles.js) and other backend admin gates.
    const isAdmin = user.role === 'admin';
    if (!isAdmin) {
      return Response.json({ error: 'Only administrators can manage payroll profiles.' }, { status: 403 });
    }

    const {
      employee_email,
      phone_reimbursement = 0,
      active = true,
      notes = '',
      service_type,
      earns_points,
    } = (await req.json()) || {};
    const email = String(employee_email || '').trim().toLowerCase();
    if (!email) {
      return Response.json({ error: 'employee_email is required.' }, { status: 400 });
    }
    // Company/service line and points-eligibility. Only home-health staff can be
    // flagged points-eligible; hospice (and home-health office) are hourly.
    const resolvedServiceType = service_type === 'hospice' ? 'hospice' : 'home_health';
    const resolvedEarnsPoints = resolvedServiceType === 'home_health' && earns_points === true;

    // Resolve the employee's display name from their user record (best-effort).
    let employee_name = email;
    let targetUser = null;
    try {
      const users = await base44.asServiceRole.entities.User.filter({ email }, undefined, 5000);
      if (users && users[0]) {
        targetUser = users[0];
        employee_name = users[0].full_name || email;
      }
    } catch (_e) {
      employee_name = email;
    }

    // Agency admins may only write payroll profiles for staff in their agency.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name || !targetUser || targetUser.agency_name !== user.agency_name) {
        return Response.json({ error: 'Forbidden: target user is outside your agency.' }, { status: 403 });
      }
    }

    const fields = {
      employee_email: email,
      employee_name,
      service_type: resolvedServiceType,
      earns_points: resolvedEarnsPoints,
      phone_reimbursement: toNonNegativeNumber(phone_reimbursement),
      active: active !== false,
      notes: String(notes || '').slice(0, 1000),
    };

    const existing = await base44.asServiceRole.entities.EmployeePayrollProfile
      .filter({ employee_email: email }, undefined, 5000)
      .catch(() => []);

    let saved;
    if (existing && existing[0]) {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.update(existing[0].id, fields);
    } else {
      saved = await base44.asServiceRole.entities.EmployeePayrollProfile.create(fields);
      // Concurrent creates can race past the empty filter above. Re-read and
      // collapse to a single row (keep earliest, delete extras, re-apply fields).
      const afterCreate = await base44.asServiceRole.entities.EmployeePayrollProfile
        .filter({ employee_email: email }, undefined, 20)
        .catch(() => []);
      if (afterCreate && afterCreate.length > 1) {
        const sorted = [...afterCreate].sort((a, b) => {
          const ac = String(a.created_date || '');
          const bc = String(b.created_date || '');
          if (ac !== bc) return ac.localeCompare(bc);
          return String(a.id).localeCompare(String(b.id));
        });
        const keep = sorted[0];
        for (const dup of sorted.slice(1)) {
          await base44.asServiceRole.entities.EmployeePayrollProfile.delete(dup.id).catch(() => {});
        }
        saved = await base44.asServiceRole.entities.EmployeePayrollProfile.update(keep.id, fields);
      }
    }

    return Response.json({ success: true, profile: saved });
  } catch (error) {
    console.error('savePayrollProfile failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});
