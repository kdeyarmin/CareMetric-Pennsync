import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { invited_email, custom_message } = await req.json();

    // Get user's agency
    const agencies = await base44.entities.Agency.filter({ admin_email: user.email });
    
    if (agencies.length === 0) {
      return Response.json({ 
        success: false, 
        message: 'You are not an agency admin' 
      }, { status: 403 });
    }

    const agency = agencies[0];

    // Check if agency has room for more users
    const agencyUsers = await base44.asServiceRole.entities.User.filter({ 
      agency_code: agency.agency_code 
    });

    if (agencyUsers.length >= agency.max_users) {
      return Response.json({ 
        success: false, 
        message: `Agency has reached max users (${agency.max_users}). Please upgrade your plan.` 
      });
    }

    // Check if invitation already exists
    const existingInvites = await base44.entities.AgencyInvitation.filter({
      agency_code: agency.agency_code,
      invited_email,
      status: 'pending'
    });

    if (existingInvites.length > 0) {
      return Response.json({ 
        success: false, 
        message: 'An invitation is already pending for this email' 
      });
    }

    // Generate unique token
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    // Create invitation record
    await base44.entities.AgencyInvitation.create({
      agency_code: agency.agency_code,
      agency_name: agency.agency_name,
      invited_email,
      invited_by: user.email,
      status: 'pending',
      invitation_token: token,
      expires_at: expiresAt.toISOString(),
      custom_message: custom_message || ""
    });

    // Send invitation email
    const appUrl = Deno.env.get('BASE44_APP_URL') || 'https://app.base44.com';
    const inviteLink = `${appUrl}?invite_token=${token}`;

    const emailBody = `
Hello!

You've been invited to join ${agency.agency_name} on CareMetric AI.

${custom_message ? `\nMessage from ${user.full_name || user.email}:\n${custom_message}\n` : ''}

Your agency code: ${agency.agency_code}

Click here to accept your invitation and create your account:
${inviteLink}

Or, if you already have an account, simply enter the agency code "${agency.agency_code}" in your Settings.

This invitation expires in 7 days.

---
${agency.agency_name}
Powered by CareMetric AI
    `.trim();

    await base44.integrations.Core.SendEmail({
      from_name: agency.agency_name,
      to: invited_email,
      subject: `Join ${agency.agency_name} on CareMetric AI`,
      body: emailBody
    });

    console.log('Invitation sent:', invited_email, agency.agency_name);

    return Response.json({ 
      success: true, 
      message: 'Invitation sent successfully',
      invite_token: token
    });

  } catch (error) {
    console.error('Send invitation error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});