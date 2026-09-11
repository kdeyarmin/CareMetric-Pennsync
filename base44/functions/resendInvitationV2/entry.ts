import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: trustedCallerClaims — generated, edit base44/_shared/backendHelpers.mjs>>>
const PRIVILEGED_PROFILE_ACCOUNT_TYPES = new Set(['super_admin', 'agency_admin']);
const TRUSTED_CLAIM_AGENCY_STATUSES = new Set(['active', 'trial']);
const normalizeClaimEmail = (value) => String(value || '').trim().toLowerCase();
async function loadTrustedTenantClaim(base44, profileId, email) {
  if (!profileId || !email) return null;
  let membership = null;
  try {
    const rows = await base44.asServiceRole.entities.AgencyMembership.filter(
      { user_id: profileId, status: 'active' },
      undefined,
      2,
    );
    const row = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    if (row
      && String(row.user_id || '').trim() === profileId
      && String(row.status || '') === 'active'
      && normalizeClaimEmail(row.user_email_normalized) === email
      && typeof row.agency_id === 'string'
      && row.agency_id.trim()) {
      membership = row;
    }
  } catch {
    membership = null;
  }
  if (!membership) return null;
  try {
    const agencyId = membership.agency_id.trim();
    const rows = await base44.asServiceRole.entities.Agency.filter({ id: agencyId }, undefined, 2);
    const agency = Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    const agencyName = String(agency?.agency_name || '').trim();
    if (!agency || agency.id !== agencyId || !TRUSTED_CLAIM_AGENCY_STATUSES.has(String(agency.status || ''))
      || !agencyName) {
      return null;
    }
    return { tenantRole: String(membership.tenant_role || ''), agencyId, agencyName };
  } catch {
    return null;
  }
}
async function withTrustedClaims(base44, profile) {
  if (!profile || typeof profile !== 'object') return profile;
  // Protected built-in admins (the platform owner included) already hold
  // platform-level RLS authority, so their legacy self-scoping claims cannot
  // widen access; leave them exactly as the handler saw them before.
  if (profile.role === 'admin') return profile;
  const email = normalizeClaimEmail(profile.email);
  const profileId = typeof profile.id === 'string' ? profile.id.trim() : '';
  const tenant = await loadTrustedTenantClaim(base44, profileId, email);
  const claimedType = String(profile.account_type || '');
  const baseType = PRIVILEGED_PROFILE_ACCOUNT_TYPES.has(claimedType) ? 'user' : claimedType;
  if (tenant) {
    return {
      ...profile,
      account_type: tenant.tenantRole === 'agency_admin' ? 'agency_admin' : baseType,
      agency_name: tenant.agencyName,
      agency_id: tenant.agencyId,
      is_approved: true,
    };
  }
  return { ...profile, account_type: baseType, agency_name: '', agency_id: '', is_approved: false };
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
