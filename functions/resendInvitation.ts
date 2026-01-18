import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { invitation_id } = await req.json();
    
    if (!invitation_id) {
      return Response.json({ error: 'invitation_id is required' }, { status: 400 });
    }

    // Get the invitation
    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ id: invitation_id });
    const invitation = invitations[0];
    
    if (!invitation) {
      return Response.json({ error: 'Invitation not found' }, { status: 404 });
    }

    // Check if invitation is still pending
    if (invitation.status !== 'pending') {
      return Response.json({ error: 'Can only resend pending invitations' }, { status: 400 });
    }

    // Update expiry date and resend count
    const now = new Date();
    const newExpiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    
    await base44.asServiceRole.entities.UserInvitation.update(invitation_id, {
      expires_at: newExpiresAt.toISOString(),
      last_sent_at: now.toISOString(),
      resend_count: (invitation.resend_count || 0) + 1
    });

    // Send invitation email via Resend
    let emailSent = false;
    let emailError = null;
    
    try {
      const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
      const signupUrl = 'https://www.caremetricai.com';
      
      await resend.emails.send({
        from: 'CareMetric AI <onboarding@caremetricai.com>',
        to: invitation.email,
        subject: 'Reminder: You\'re Invited to CareMetric AI! 🎉',
        html: `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h2>Hello ${invitation.full_name},</h2>
            
            <p>This is a reminder that you've been invited to join <strong>CareMetric AI</strong> - the intelligent healthcare documentation platform.</p>
            
            <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
              <p style="margin: 5px 0;"><strong>📧 Your Email:</strong> ${invitation.email}</p>
              <p style="margin: 5px 0;"><strong>🎭 Role:</strong> ${invitation.role || 'user'}</p>
              <p style="margin: 5px 0;"><strong>🏥 Care Scope:</strong> ${invitation.care_scope || 'home_health'}</p>
            </div>
            
            <div style="text-align: center; margin: 30px 0;">
              <a href="${signupUrl}" style="background-color: #4F46E5; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; font-weight: bold;">Sign Up Now</a>
            </div>
            
            <p><strong>⏰ This invitation expires in 7 days</strong> (${newExpiresAt.toLocaleDateString()}).</p>
            
            <h3>What you'll get:</h3>
            <ul>
              <li>✨ AI-powered Smart Notes Assistant</li>
              <li>🎤 Voice-to-text Visit Scribe</li>
              <li>📋 Automated Care Plan Management</li>
              <li>✅ OASIS & Medicare Compliance Tools</li>
              <li>📊 Real-time Analytics Dashboard</li>
              <li>🎓 Personalized Training Modules</li>
              <li>🔒 HIPAA-compliant Security & Encryption</li>
            </ul>
            
            <p>Questions? Reply to this email or visit our support page.</p>
            
            <p>Best regards,<br>The CareMetric AI Team</p>
          </div>
        `
      });
      
      emailSent = true;
    } catch (error) {
      console.error('Email send failed:', error);
      emailError = error.message;
    }

    return Response.json({ 
      success: true,
      email_sent: emailSent,
      email_error: emailError,
      message: emailSent ? 'Invitation resent successfully' : 'Invitation updated but email failed to send'
    });

  } catch (error) {
    console.error('Error resending invitation:', error);
    return Response.json({ 
      error: 'Internal server error', 
      details: error.message 
    }, { status: 500 });
  }
});