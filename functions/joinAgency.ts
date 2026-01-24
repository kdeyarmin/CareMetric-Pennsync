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
      return Response.json({ error: 'agency_code is required' }, { status: 400 });
    }

    // Find agency with this code
    const agencies = await base44.asServiceRole.entities.AgencySettings.filter({
      agency_code: agency_code.trim().toUpperCase(),
      is_enterprise: true
    });

    if (agencies.length === 0) {
      return Response.json({ error: 'Invalid agency code' }, { status: 404 });
    }

    const agency = agencies[0];

    // Update user's agency_id and agency_code
    await base44.auth.updateMe({
      agency_id: agency.id,
      agency_code: agency_code.trim().toUpperCase()
    });

    // Log the action
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'joined_agency',
      details: {
        agency_id: agency.id,
        agency_name: agency.office_name,
        agency_code: agency_code.trim().toUpperCase()
      },
      page: 'settings'
    });

    // Notify agency manager
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: agency.agency_manager_email,
        subject: `New Provider Joined Your Agency`,
        from_name: 'CareMetric AI',
        body: `
<h2>New Provider Added</h2>

<p><strong>${user.full_name}</strong> (${user.email}) has joined your agency using the agency code.</p>

<p><strong>Provider Type:</strong> ${user.credential_type || 'Not specified'}</p>

<p>You can now view their performance metrics and configure personalized settings in the Enterprise Dashboard.</p>

<p>Best regards,<br>
The CareMetric AI Team</p>
        `
      });
    } catch (emailError) {
      console.error('Error sending notification email:', emailError);
    }

    return Response.json({
      success: true,
      agency_name: agency.office_name,
      message: 'Successfully joined agency'
    });

  } catch (error) {
    console.error('Error joining agency:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});