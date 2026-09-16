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

// ───────────────────────────────────────────────────────────────────────────
// Policy acknowledgment service. Acknowledgments are an audit/compliance trail,
// so the entity's write RLS is admin-only — learners can NOT write their own
// rows directly. They sign off through this function instead, which validates
// ownership and stamps the transition server-side (precedent: selfEnrollCourse,
// gradeTrainingAttempt). Admins read the org-wide status list through the `list`
// action so account_type-based admins (agency_admin/super_admin) are honored
// even though the entity read RLS follows the codebase `role: admin` convention.
//
//   acknowledge — any authenticated user, only their own un-acknowledged row.
//   list        — admin only; returns acks (optionally scoped to a policy_id).
// ───────────────────────────────────────────────────────────────────────────

// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>

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



const sameEmail = (a, b) =>
  String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await withTrustedClaims(base44, await base44.auth.me());
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'acknowledge';
    const svc = base44.asServiceRole.entities;

    // ── ACKNOWLEDGE: validated, server-stamped sign-off on the caller's row ──
    if (action === 'acknowledge') {
      const { acknowledgment_id, signed_name } = body;
      if (!acknowledgment_id || !signed_name || !String(signed_name).trim()) {
        return Response.json({ error: 'acknowledgment_id and signed_name are required' }, { status: 400 });
      }

      const [ack] = await svc.PolicyAcknowledgment.filter({ id: acknowledgment_id }, '-created_date', 1);
      if (!ack) {
        return Response.json({ error: 'Acknowledgment not found' }, { status: 404 });
      }
      // Ownership is enforced here because the write goes through service-role
      // (which bypasses RLS): a user may only sign their own assigned row.
      if (!sameEmail(ack.user_id, user.email)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 });
      }
      if (ack.acknowledged) {
        // Already signed — idempotent no-op, don't overwrite the original stamp.
        return Response.json({ success: true, already_acknowledged: true });
      }

      const ip = req.headers.get('x-forwarded-for') || req.headers.get('x-real-ip') || '';
      await svc.PolicyAcknowledgment.update(ack.id, {
        acknowledged: true,
        status: 'acknowledged',
        acknowledged_at: new Date().toISOString(),
        signed_name: String(signed_name).trim(),
        ip_address: ip.split(',')[0].trim(),
        device_metadata: { user_agent: req.headers.get('user-agent') || '' },
      });

      return Response.json({ success: true });
    }

    // ── LIST: admin-only org-wide status (honors account_type admins) ───────
    if (action === 'list') {
      if (!isAdminLike(user)) {
        return Response.json({ error: 'Forbidden: admin access required' }, { status: 403 });
      }
      const filter = body.policy_id ? { policy_id: body.policy_id } : {};
      let acks = await svc.PolicyAcknowledgment.filter(filter, '-created_date', 5000);
      // Agency admins are scoped to their own agency's staff.
      if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
        if (!user.agency_name) {
          return Response.json({ error: 'Forbidden: agency membership required' }, { status: 403 });
        }
        const agencyUsers = await svc.User.filter({ agency_name: user.agency_name }, '-created_date', 5000);
        const emails = new Set(agencyUsers.map((u) => u.email));
        acks = acks.filter((a) => emails.has(a.user_id));
      }
      return Response.json({ success: true, acknowledgments: acks });
    }

    return Response.json({ error: `Unknown action: ${action}` }, { status: 400 });
  } catch (error) {
    console.error('policyAcknowledgment failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});