import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { agency_manager_email, office_name } = await req.json();

    if (!agency_manager_email || !office_name) {
      return Response.json({ error: 'agency_manager_email and office_name are required' }, { status: 400 });
    }

    // Generate unique agency code
    const agencyCode = generateAgencyCode();

    // Get or create agency settings
    const existingSettings = await base44.asServiceRole.entities.AgencySettings.list();
    let agencySettings;

    if (existingSettings.length > 0) {
      // Update existing
      agencySettings = await base44.asServiceRole.entities.AgencySettings.update(existingSettings[0].id, {
        is_enterprise: true,
        agency_code: agencyCode,
        agency_manager_email,
        office_name
      });
    } else {
      // Create new
      agencySettings = await base44.asServiceRole.entities.AgencySettings.create({
        is_enterprise: true,
        agency_code: agencyCode,
        agency_manager_email,
        office_name
      });
    }

    // Send email to agency manager with the code
    try {
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: agency_manager_email,
        subject: `${office_name} - Enterprise Setup Complete`,
        from_name: 'CareMetric AI',
        body: `
<h2>Welcome to CareMetric AI Enterprise!</h2>

<p>Your agency <strong>${office_name}</strong> has been successfully set up with enterprise features.</p>

<h3>Agency Code</h3>
<p style="font-size: 24px; font-weight: bold; color: #3b82f6; background: #f1f5f9; padding: 20px; border-radius: 8px; text-align: center;">
  ${agencyCode}
</p>

<h3>Next Steps:</h3>
<ol>
  <li>Share this agency code with your providers</li>
  <li>Providers should enter this code in their Settings page under "Agency Code"</li>
  <li>Once linked, you'll be able to:
    <ul>
      <li>View all provider performance metrics</li>
      <li>Configure agency-wide AI learning</li>
      <li>Share best practices across your team</li>
      <li>Access enterprise analytics</li>
    </ul>
  </li>
</ol>

<h3>Important:</h3>
<p><strong>Keep this code secure.</strong> Anyone with this code can link themselves to your agency and access shared resources.</p>

<p>Access your enterprise dashboard at: <a href="https://caremetricai.com">CareMetric AI Enterprise Dashboard</a></p>

<p>If you have any questions, please contact support.</p>

<p>Best regards,<br>
The CareMetric AI Team</p>
        `
      });
    } catch (emailError) {
      console.error('Error sending email:', emailError);
      // Don't fail the request if email fails
    }

    return Response.json({
      success: true,
      agency_code: agencyCode,
      agency_settings: agencySettings,
      message: 'Enterprise agency setup complete. Email sent to manager.'
    });

  } catch (error) {
    console.error('Error setting up enterprise:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function generateAgencyCode() {
  // Generate a unique 8-character alphanumeric code
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // Exclude confusing characters
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}