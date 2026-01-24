import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { agency_code } = await req.json();

    if (!agency_code) {
      return Response.json({ 
        success: false, 
        message: 'Agency code is required' 
      }, { status: 400 });
    }

    // Find agency with this code
    const agencies = await base44.asServiceRole.entities.Agency.filter({ 
      agency_code: agency_code.toUpperCase() 
    });

    if (agencies.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'Invalid agency code. Please check and try again.' 
      });
    }

    const agency = agencies[0];

    // Check if agency is active
    if (agency.status !== 'active' && agency.status !== 'trial') {
      return Response.json({ 
        success: false, 
        message: 'This agency is not currently active' 
      });
    }

    // Check if agency has reached max users
    const agencyUsers = await base44.asServiceRole.entities.User.filter({ 
      agency_code: agency.agency_code 
    });

    if (agencyUsers.length >= agency.max_users) {
      return Response.json({ 
        success: false, 
        message: `This agency has reached its maximum user limit (${agency.max_users})` 
      });
    }

    // Join the agency
    await base44.auth.updateMe({
      agency_code: agency.agency_code,
      agency_name: agency.agency_name,
      joined_agency_date: new Date().toISOString().split('T')[0]
    });

    // Update agency user count
    await base44.asServiceRole.entities.Agency.update(agency.id, {
      current_user_count: agencyUsers.length + 1
    });

    // Log the activity
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'joined_agency',
      details: {
        agency_code: agency.agency_code,
        agency_name: agency.agency_name
      },
      page: 'settings'
    });

    return Response.json({ 
      success: true, 
      agency_name: agency.agency_name,
      message: `Successfully joined ${agency.agency_name}` 
    });

  } catch (error) {
    console.error('Join agency error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});