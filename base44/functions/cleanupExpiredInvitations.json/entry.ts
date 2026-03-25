import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== Cleaning up expired invitations ===');
    const base44 = createClientFromRequest(req);
    
    // Verify admin (this is a scheduled task)
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get settings
    const settings = await base44.asServiceRole.entities.InvitationSettings.list();
    const config = settings[0] || { cleanup_after_days: 30, notify_before_cleanup: true };

    const now = new Date();
    const cleanupThreshold = new Date(now.getTime() - config.cleanup_after_days * 24 * 60 * 60 * 1000);

    // Get all invitations
    const allInvitations = await base44.asServiceRole.entities.UserInvitation.list();

    // Find invitations to clean up (expired or revoked, and old enough)
    const toCleanup = allInvitations.filter(inv => {
      const expiresAt = new Date(inv.expires_at);
      const isExpired = now > expiresAt;
      const isRevoked = inv.status === 'revoked';
      
      // Must be expired or revoked AND past cleanup threshold
      if ((isExpired || isRevoked) && expiresAt < cleanupThreshold) {
        return true;
      }
      return false;
    });

    console.log(`Found ${toCleanup.length} invitations to clean up`);

    if (toCleanup.length === 0) {
      return Response.json({ 
        success: true, 
        message: 'No invitations to clean up',
        cleaned: 0
      });
    }

    // Notify admins if enabled
    if (config.notify_before_cleanup) {
      const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
      const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

      try {
        await resend.emails.send({
          from: 'CareMetric AI <notifications@caremetricai.com>',
          to: admins.map(a => a.email),
          subject: `🗑️ ${toCleanup.length} expired invitation${toCleanup.length !== 1 ? 's' : ''} cleaned up`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Invitation Cleanup Report</h2>
              
              <p>The following expired/revoked invitations have been automatically removed from the system:</p>
              
              <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                <thead>
                  <tr style="background-color: #f3f4f6;">
                    <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Email</th>
                    <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Name</th>
                    <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Status</th>
                    <th style="padding: 10px; text-align: left; border: 1px solid #e5e7eb;">Expired</th>
                  </tr>
                </thead>
                <tbody>
                  ${toCleanup.map(inv => `
                    <tr>
                      <td style="padding: 10px; border: 1px solid #e5e7eb;">${inv.email}</td>
                      <td style="padding: 10px; border: 1px solid #e5e7eb;">${inv.full_name}</td>
                      <td style="padding: 10px; border: 1px solid #e5e7eb;">${inv.status}</td>
                      <td style="padding: 10px; border: 1px solid #e5e7eb;">${new Date(inv.expires_at).toLocaleDateString()}</td>
                    </tr>
                  `).join('')}
                </tbody>
              </table>
              
              <p style="color: #6b7280; font-size: 14px;">
                These invitations were automatically cleaned up after ${config.cleanup_after_days} days past expiration.
              </p>
              
              <p style="color: #6b7280; font-size: 14px;">
                You can adjust cleanup settings in the User Management dashboard.
              </p>
            </div>
          `
        });
      } catch (emailError) {
        console.error('Failed to send cleanup notification:', emailError);
      }
    }

    // Delete the invitations
    await Promise.all(toCleanup.map(inv => 
      base44.asServiceRole.entities.UserInvitation.delete(inv.id)
    ));

    console.log(`Successfully cleaned up ${toCleanup.length} invitations`);

    return Response.json({ 
      success: true, 
      cleaned: toCleanup.length 
    });

  } catch (error) {
    console.error('Error in cleanupExpiredInvitations:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});