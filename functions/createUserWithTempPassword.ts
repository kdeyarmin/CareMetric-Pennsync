import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
      
      console.log('Step 4: Sending invitation email...');
      const signupUrl = 'https://www.caremetricai.com';
      
      let emailSent = false;
      let emailError = null;
      
      try {
        console.log('Attempting to send email to:', email);
        const emailPayload = {
          to: email,
          subject: 'You\'re Invited to CareMetric AI! 🎉',
          from_name: 'CareMetric AI',
          body: `Hello ${full_name},

You've been invited to join CareMetric AI - the intelligent healthcare documentation platform that saves time and ensures compliance.

📧 Your Email: ${email}
🎭 Role: ${role || 'user'}
🏥 Care Scope: ${care_scope || 'home_health'}

Get started:
➡️ Visit ${signupUrl}
➡️ Sign up using this email address
➡️ Complete onboarding to customize your experience
➡️ Start with a 14-day free trial - no credit card required!

⏰ This invitation expires in 7 days (${expiresAt.toLocaleDateString()}).

What you'll get:
✨ AI-powered Smart Notes Assistant
🎤 Voice-to-text Visit Scribe
📋 Automated Care Plan Management
✅ OASIS & Medicare Compliance Tools
📊 Real-time Analytics Dashboard
🎓 Personalized Training Modules
🔒 HIPAA-compliant Security & Encryption

Questions? Reply to this email or visit our support page.

Welcome to the future of healthcare documentation!

Best regards,
The CareMetric AI Team`
        });
        console.log('✓ Email send result:', JSON.stringify(emailResult));
        console.log('✓ Invitation email sent to:', email);
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