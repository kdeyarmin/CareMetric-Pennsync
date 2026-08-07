import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';


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
const isAdminLike = (u) => !!u && (
  u.role === 'admin' || u.account_type === 'agency_admin' ||
  u.account_type === 'super_admin'
);
// <<<END SHARED HELPER: isAdminLike>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
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

    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Use platform invite (handles email natively)
    await base44.users.inviteUser(invitation.email, invitation.role || 'user');

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