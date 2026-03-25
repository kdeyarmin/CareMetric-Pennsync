import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== Checking for expiring invitations ===');
    const base44 = createClientFromRequest(req);
    
    // Verify admin (this is a scheduled task)
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const now = new Date();
    const twoDaysFromNow = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000);

    // Get all pending invitations
    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
      status: 'pending' 
    });

    const expiringInvitations = invitations.filter(inv => {
      const expiresAt = new Date(inv.expires_at);
      return expiresAt > now && expiresAt <= twoDaysFromNow;
    });

    console.log(`Found ${expiringInvitations.length} expiring invitations`);

    if (expiringInvitations.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No expiring invitations found' 
      });
    }

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });

    // Notify each invitee
    const inviteeEmails = expiringInvitations.map(inv => {
      const daysLeft = Math.ceil((new Date(inv.expires_at) - now) / (1000 * 60 * 60 * 24));
      
      return resend.emails.send({
        from: 'CareMetric AI <onboarding@caremetricai.com>',
        to: inv.email,
        subject: `⏰ Your CareMetric AI invitation expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}!`,
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Hello ${inv.full_name},</h2>
            
            <p>Your invitation to join <strong>CareMetric AI</strong> is expiring soon!</p>
            
            <div style="background-color: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-weight: bold;">⏰ Expires in ${daysLeft} day${daysLeft !== 1 ? 's' : ''}</p>
              <p style="margin: 5px 0 0 0;">Expiration date: ${new Date(inv.expires_at).toLocaleDateString()}</p>
            </div>
            
            <p>Don't miss out on your chance to join CareMetric AI - the intelligent healthcare documentation platform!</p>
            
            <h3>Get started now:</h3>
            <ol>
              <li>Visit <a href="https://www.caremetricai.com">www.caremetricai.com</a></li>
              <li>Sign up using <strong>${inv.email}</strong></li>
              <li>Start your 14-day free trial!</li>
            </ol>
            
            <p>Questions? Reply to this email for assistance.</p>
            
            <p>Best regards,<br>The CareMetric AI Team</p>
          </div>
        `
      });
    });

    // Notify admins
    const adminEmail = resend.emails.send({
      from: 'CareMetric AI <notifications@caremetricai.com>',
      to: admins.map(a => a.email),
      subject: `⏰ ${expiringInvitations.length} invitation${expiringInvitations.length !== 1 ? 's' : ''} expiring soon`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Expiring Invitations Report</h2>
          
          <p>The following invitations are expiring within 2 days:</p>
          
          <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
              <tr style="background-color: #f3f4f6;">
                <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Email</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Name</th>
                <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Expires</th>
              </tr>
            </thead>
            <tbody>
              ${expiringInvitations.map(inv => `
                <tr>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${inv.email}</td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${inv.full_name}</td>
                  <td style="padding: 10px; border: 1px solid #e5e7eb;">${new Date(inv.expires_at).toLocaleDateString()}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>
          
          <p>You can resend these invitations from the User Management dashboard.</p>
          
          <p><a href="https://www.caremetricai.com">Go to Dashboard</a></p>
        </div>
      `
    });

    await Promise.all([...inviteeEmails, adminEmail]);

    console.log('Expiry notifications sent successfully');
    return Response.json({ 
      success: true, 
      notified: expiringInvitations.length 
    });

  } catch (error) {
    console.error('Error in notifyExpiringInvitations:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});