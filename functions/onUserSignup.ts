import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('onUserSignup triggered');
    const base44 = createClientFromRequest(req);
    const { user } = await req.json();
    console.log('User data received:', user?.email);

    if (!user || !user.email) {
      console.error('No user data provided');
      return Response.json({ error: 'No user data provided' }, { status: 400 });
    }

    // Generate unique referral code for new user
    const referralCode = crypto.randomUUID().slice(0, 8).toUpperCase();
    console.log('Generated referral code:', referralCode);
    
    try {
      await base44.asServiceRole.entities.User.update(user.id, {
        referral_code: referralCode
      });
      console.log('Referral code saved for user:', user.email);
    } catch (codeError) {
      console.error('Failed to save referral code:', codeError);
    }

    // Create 14-day free trial subscription for new user
    console.log('Creating trial subscription for:', user.email);
    try {
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);
      
      await base44.asServiceRole.entities.Subscription.create({
        user_email: user.email,
        status: 'trialing',
        trial_start: new Date().toISOString(),
        trial_end: trialEndDate.toISOString(),
        plan_name: '14-Day Free Trial - Full Access',
        monthly_amount: 0
      });
      console.log('✅ 14-day trial subscription created for:', user.email);
    } catch (trialError) {
      console.error('Failed to create trial subscription:', trialError);
      // Don't fail signup if trial creation fails
    }

    // Check if user was invited
    console.log('Checking for invitation...');
    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
      email: user.email,
      status: 'pending'
    });
    console.log('Found invitations:', invitations?.length || 0);

    // Auto-approve ALL users
    console.log('Auto-approving user...');
    try {
      if (invitations && invitations.length > 0) {
        const invitation = invitations[0];
        await base44.asServiceRole.entities.User.update(user.id, {
          role: invitation.role,
          care_scope: invitation.care_scope,
          phone: invitation.phone,
          credentials: invitation.credentials,
          is_approved: true,
          service_type: 'home_health'
        });
        await base44.asServiceRole.entities.UserInvitation.delete(invitation.id);
      } else {
        // No invitation - still auto-approve with default role
        await base44.asServiceRole.entities.User.update(user.id, {
          is_approved: true,
          role: 'user',
          onboarding_completed: false
        });
      }
      console.log('User auto-approved:', user.email);
    } catch (updateError) {
      console.error('Failed to auto-approve user:', updateError);
    }

    // Notify admins of new signup (informational only)
    console.log('Fetching admin users...');
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    console.log('Found admins:', admins.length);

    const emailBody = `
    Hello,

    A new user has signed up for CareMetric AI:

    👤 Name: ${user.full_name || 'Not provided'}
    📧 Email: ${user.email}
    📅 Signup Date: ${new Date().toLocaleString()}
    🎭 Role: ${user.role || 'user'}
    👨‍⚕️ Provider Type: ${user.credential_type || 'Not set'}
    🏥 Work Setting: ${user.service_type || 'Not set'}
    ✅ Status: Auto-approved

    The user has been automatically approved and now has access to the system with a 14-day free trial.

    You can view their activity in the Admin Dashboard.

    ➡️ https://www.caremetricai.com

    Best regards,
    CareMetric AI
    `.trim();

    // Send email to all admins using Resend
    try {
      const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
      
      const emailPromises = admins.map(admin => 
        resend.emails.send({
          from: 'CareMetric AI <notifications@caremetricai.com>',
          to: admin.email,
          subject: '✅ New User Signup - CareMetric AI',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hello ${admin.full_name || 'Admin'},</h2>
              
              <p>A new user has signed up for <strong>CareMetric AI</strong>:</p>
              
              <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                <p style="margin: 5px 0;"><strong>👤 Name:</strong> ${user.full_name || 'Not provided'}</p>
                <p style="margin: 5px 0;"><strong>📧 Email:</strong> ${user.email}</p>
                <p style="margin: 5px 0;"><strong>📅 Signup Date:</strong> ${new Date().toLocaleString()}</p>
                <p style="margin: 5px 0;"><strong>🎭 Role:</strong> ${user.role || 'user'}</p>
                <p style="margin: 5px 0;"><strong>👨‍⚕️ Provider Type:</strong> ${user.credential_type || 'Not set'}</p>
                <p style="margin: 5px 0;"><strong>🏥 Work Setting:</strong> ${user.service_type || 'Not set'}</p>
                <p style="margin: 5px 0;"><strong>✅ Status:</strong> Auto-approved</p>
              </div>
              
              <p>The user has been automatically approved and now has access to the system with a <strong>14-day free trial</strong>.</p>
              
              <p>You can view their activity in the Admin Dashboard:</p>
              <p><a href="https://www.caremetricai.com" style="color: #3b82f6;">➡️ Go to Admin Dashboard</a></p>
              
              <p>Best regards,<br>CareMetric AI</p>
            </div>
          `
        })
      );

      console.log('Sending emails to admins via Resend...');
      await Promise.all(emailPromises);
      console.log('Signup notification emails sent successfully');
    } catch (emailError) {
      console.error('Failed to send admin notification emails:', emailError);
      // Continue execution - don't fail signup if email fails
    }

    // Send welcome email sequence
    try {
      await base44.asServiceRole.functions.invoke('sendWelcomeEmailSequence', {
        user_email: user.email,
        user_name: user.full_name || 'there'
      });
      console.log('Welcome email sent to:', user.email);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    return Response.json({ 
      success: true, 
      message: `Notification sent to ${admins.length} admin(s)` 
    });

  } catch (error) {
    console.error('Error in onUserSignup:', error);
    console.error('Error stack:', error.stack);
    
    // Return success even if notification fails - don't block signup
    return Response.json({ 
      success: true,
      warning: 'User created but notification failed',
      error: error.message 
    });
  }
});