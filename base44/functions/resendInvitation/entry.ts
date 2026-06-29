import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { invitation_id } = await req.json();
    if (!invitation_id) {
      return Response.json({ error: 'invitation_id is required' }, { status: 400 });
    }

    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id });
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
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    // Use platform invite (handles email natively)
    await base44.users.inviteUser(invitation.email, invitation.role || 'user');
    console.log('✓ Re-invite sent to:', invitation.email);

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
      details: error.message 
    }, { status: 500 });
  }
});