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


// <<<BEGIN SHARED HELPER: isAdminLike — generated, edit base44/_shared/backendHelpers.mjs>>>
const isAdminLike = (u) => !!u && u.role === 'admin';
// <<<END SHARED HELPER: isAdminLike>>>


Deno.serve(async (req) => {
  // Reject unsupported transport before SDK, authentication, or account work.
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed', code: 'METHOD_NOT_ALLOWED' }, {
      status: 405,
      headers: { Allow: 'POST', 'Cache-Control': 'no-store' },
    });
  }
  try {
    // These administrator routes require a user Bearer token. Reject absent
    // or malformed credentials before SDK construction, which may throw before
    // auth.me(). This syntax check grants no authority; the SDK verifies it.
    if (!/^Bearer [^\s,]+$/.test(req.headers.get('Authorization') || '')) {
      return Response.json({
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    const base44 = createClientFromRequest(req);
    
    const user = await withTrustedClaims(base44, await base44.auth.me().catch((error) => {
      // The SDK throws for missing/expired sessions; these are authentication
      // denials, not invitation-send failures. Preserve real transport errors.
      const status = error?.status ?? error?.response?.status;
      if (status === 401 || status === 403) return null;
      throw error;
    }));
    if (!user) {
      return Response.json({
        error: 'Authentication required',
        code: 'AUTHENTICATION_REQUIRED',
      }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
    }
    if (!isAdminLike(user)) {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();

    {
      const _agencyAdminGate = agencyAdminMissingAgencyResponse(user);
      if (_agencyAdminGate) return _agencyAdminGate;
    }
    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return Response.json({ error: 'invitation_id is required' }, { status: 400 });
    }

    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id }, undefined, 5000);
    if (!invitations || invitations.length === 0) {
      return Response.json({ error: 'Invitation not found' }, { status: 404 });
    }

    const invitation = invitations[0];
    // Don't resurrect a closed invitation: flipping an already-accepted invite back
    // to 'pending' re-opens the onUserSignup / autoApproveInvitedUser approval path
    // for an account that has already completed signup.
    if (invitation.status === 'accepted') {
      return Response.json(
        { error: 'This invitation was already accepted and cannot be resent.' },
        { status: 409 }
      );
    }
    // 'cancelled' is a deliberate revocation — offboardUser sets it precisely to
    // pull an outstanding invite when deactivating someone. Resending flipped it
    // back to 'pending', undoing that revocation and re-arming the
    // onUserSignup / autoApproveInvitedUser auto-approval path for the role the
    // invite carries. Only 'pending' and 'expired' may be resent.
    if (invitation.status === 'cancelled') {
      return Response.json(
        { error: 'This invitation was cancelled and cannot be resent. Create a new invitation instead.' },
        { status: 409 }
      );
    }

    // Agency admins may only resend invites for their own agency.
    if (user.account_type !== 'super_admin' && user.agency_name && (user.account_type === 'agency_admin' || user.role === 'admin')) {
      if (!user.agency_name) {
        return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
      }
      let inviteAgency = invitation.agency_name || null;
      if (!inviteAgency && invitation.invited_by) {
        const inviters = await base44.asServiceRole.entities.User
          .filter({ email: invitation.invited_by }, undefined, 5)
          .catch(() => []);
        inviteAgency = inviters?.[0]?.agency_name || null;
      }
      if (inviteAgency !== user.agency_name) {
        return Response.json({ error: 'Forbidden: invitation is outside your agency.' }, { status: 403 });
      }
    }

    // Authorized manual invitations are independent of the general delivery pause.

    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Use platform invite (handles email natively)
    await base44.users.inviteUser(invitation.email, 'user');

    console.log('✓ Re-invite sent');

    // Update invitation record
    await base44.asServiceRole.entities.UserInvitation.update(invitation_id, {
      status: 'pending',
      expires_at: newExpiresAt.toISOString(),
      last_sent_at: now.toISOString(),
      resend_count: (invitation.resend_count || 0) + 1
    });

    // Log activity
    try {
      await base44.asServiceRole.entities.UserActivity.create({
        user_email: user.email,
        user_name: user.full_name,
        action: 'invitation_resent',
        details: {
          invited_email: invitation.email,
          invited_name: invitation.full_name,
          resend_count: (invitation.resend_count || 0) + 1,
          new_expires_at: newExpiresAt.toISOString()
        },
        page: 'UserManagement',
        entity_type: 'UserInvitation',
        entity_id: invitation_id
      });
    } catch (logError) {
      console.error('Failed to log activity:', logError.message);
    }

    return Response.json({ 
      success: true, 
      message: 'Invitation resent successfully',
      new_expires_at: newExpiresAt.toISOString()
    });

  } catch (error) {
    console.error('Error resending invitation:', error.message);
    return Response.json({ 
      error: 'Failed to resend invitation', 
      details: 'Internal server error' 
    }, { status: 500 });
  }
});
// Production replacement endpoint: resendInvitationV2 (registered 2026-09-09)
