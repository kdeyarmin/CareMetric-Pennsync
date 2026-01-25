import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invitation_token } = await req.json();

    if (!invitation_token) {
      return Response.json({ 
        success: false, 
        message: 'Invitation token is required' 
      }, { status: 400 });
    }

    // Find invitation
    const invitations = await base44.asServiceRole.entities.AgencyInvitation.filter({ 
      invitation_token 
    });

    if (invitations.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'Invalid invitation token' 
      });
    }

    const invitation = invitations[0];

    // Check if expired
    if (new Date(invitation.expires_at) < new Date()) {
      await base44.asServiceRole.entities.AgencyInvitation.update(invitation.id, {
        status: 'expired'
      });
      return Response.json({ 
        success: false, 
        message: 'This invitation has expired' 
      });
    }

    // Check if already accepted
    if (invitation.status === 'accepted') {
      return Response.json({ 
        success: false, 
        message: 'This invitation has already been used' 
      });
    }

    // Check if email matches (optional - allow anyone with token to accept)
    if (invitation.invited_email.toLowerCase() !== user.email.toLowerCase()) {
      return Response.json({ 
        success: false, 
        message: 'This invitation was sent to a different email address' 
      });
    }

    // Get agency
    const agencies = await base44.asServiceRole.entities.Agency.filter({ 
      agency_code: invitation.agency_code 
    });

    if (agencies.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'Agency not found' 
      });
    }

    const agency = agencies[0];

    // Join the agency
    await base44.auth.updateMe({
      agency_code: agency.agency_code,
      agency_name: agency.agency_name,
      joined_agency_date: new Date().toISOString().split('T')[0]
    });

    // Update invitation status
    await base44.asServiceRole.entities.AgencyInvitation.update(invitation.id, {
      status: 'accepted',
      accepted_at: new Date().toISOString()
    });

    // Update agency user count
    const agencyUsers = await base44.asServiceRole.entities.User.filter({ 
      agency_code: agency.agency_code 
    });
    await base44.asServiceRole.entities.Agency.update(agency.id, {
      current_user_count: agencyUsers.length + 1
    });

    console.log('Invitation accepted:', user.email, agency.agency_name);

    return Response.json({ 
      success: true, 
      agency_name: agency.agency_name,
      message: `Successfully joined ${agency.agency_name}` 
    });

  } catch (error) {
    console.error('Accept invitation error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});