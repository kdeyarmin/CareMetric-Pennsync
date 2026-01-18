import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== createUserWithTempPassword started ===');
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    console.log('Step 1: Verifying admin user...');
    let user;
    try {
      user = await base44.auth.me();
      console.log('Current user:', user?.email, 'Role:', user?.role);
    } catch (authError) {
      console.error('Auth error:', authError.message);
      return Response.json({ error: 'Authentication failed', details: authError.message }, { status: 401 });
    }
    
    if (!user || user.role !== 'admin') {
      console.error('Unauthorized: User is not admin');
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    console.log('Step 2: Parsing request payload...');
    let payload;
    try {
      payload = await req.json();
      console.log('Request payload:', { email: payload.email, full_name: payload.full_name, role: payload.role });
    } catch (parseError) {
      console.error('JSON parse error:', parseError.message);
      return Response.json({ error: 'Invalid JSON payload', details: parseError.message }, { status: 400 });
    }
    
    const { email, full_name, role, care_scope, phone, credentials } = payload;

    if (!email || !full_name) {
      console.error('Missing required fields');
      return Response.json({ error: 'Email and full name are required' }, { status: 400 });
    }

    console.log('Step 3: Creating invitation record...');
    try {
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days from now
      
      const invitation = await base44.asServiceRole.entities.UserInvitation.create({
        email,
        full_name,
        role: role || 'user',
        care_scope: care_scope || 'home_health',
        phone: phone || null,
        credentials: credentials || null,
        invited_by: user.email,
        status: 'pending',
        expires_at: expiresAt.toISOString(),
        last_sent_at: now.toISOString(),
        resend_count: 0
      });
      console.log('✓ Invitation record created:', invitation.id, 'Expires:', expiresAt.toISOString());
      
      console.log('Step 5: Sending invitation email via Resend...');
      const signupUrl = 'https://www.caremetricai.com';
      
      let emailSent = false;
      let emailError = null;
      
      try {
        const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
        
        const emailResult = await resend.emails.send({
          from: 'CareMetric AI <onboarding@caremetricai.com>',
          to: email,
          subject: 'You\'re Invited to CareMetric AI! 🎉',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hello ${full_name},</h2>
              
              <p>You've been invited to join <strong>CareMetric AI</strong> - the intelligent healthcare documentation platform that saves time and ensures compliance.</p>
              
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>📧 Your Email:</strong> ${email}</p>
                <p style="margin: 5px 0;"><strong>🎭 Role:</strong> ${role || 'user'}</p>
                <p style="margin: 5px 0;"><strong>🏥 Care Scope:</strong> ${care_scope || 'home_health'}</p>
              </div>
              
              <h3>Get started:</h3>
              <ol>
                <li>Visit <a href="${signupUrl}">${signupUrl}</a></li>
                <li>Sign up using this email address</li>
                <li>Complete onboarding to customize your experience</li>
                <li>Start with a 14-day free trial - no credit card required!</li>
              </ol>
              
              <p><strong>⏰ This invitation expires in 7 days</strong> (${expiresAt.toLocaleDateString()}).</p>
              
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
              
              <p><strong>Welcome to the future of healthcare documentation!</strong></p>
              
              <p>Best regards,<br>The CareMetric AI Team</p>
            </div>
          `
        });
        
        console.log('✓ Email sent via Resend:', JSON.stringify(emailResult));
        emailSent = true;
      } catch (error) {
        console.error('⚠️ Email send failed:', error);
        console.error('Email error details:', error.message, error.stack);
        emailError = error.message;
      }
      
      console.log('=== User invitation completed ===');
      return Response.json({ 
        success: true, 
        message: emailSent ? 'Invitation sent successfully' : 'Invitation created but email failed to send',
        user_email: email,
        email_sent: emailSent,
        email_error: emailError,
        invitation_id: invitation.id
      });
      
    } catch (dbError) {
      console.error('Database error:', dbError);
      console.error('Error name:', dbError.name);
      console.error('Error message:', dbError.message);
      console.error('Error stack:', dbError.stack);
      return Response.json({ 
        error: 'Failed to create invitation', 
        details: dbError.message,
        errorName: dbError.name
      }, { status: 500 });
    }

  } catch (error) {
    console.error('=== FATAL ERROR ===');
    console.error('Error:', error);
    console.error('Error name:', error.name);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    return Response.json({ 
      error: 'Internal server error', 
      details: error.message,
      errorName: error.name,
      stack: error.stack 
    }, { status: 500 });
  }
});