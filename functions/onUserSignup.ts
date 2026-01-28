import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

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
      // Check if subscription already exists
      const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ user_email: user.email });
      
      if (!existingSubs || existingSubs.length === 0) {
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
      } else {
        console.log('ℹ️ Subscription already exists for:', user.email);
      }
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

    // Notify admins of new signup using Core.SendEmail (more reliable)
    console.log('Fetching admin users...');
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    console.log('Found admins:', admins.length);

    // Send email to all admins
    if (admins && admins.length > 0) {
      try {
        for (const admin of admins) {
          console.log('Sending admin notification to:', admin.email);
          
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: admin.email,
            subject: `✅ New User Signup - ${user.full_name || user.email}`,
            body: `Hello ${admin.full_name || 'Admin'},

A new user has signed up for CareMetric AI!

User Details:
- Name: ${user.full_name || 'Not provided'}
- Email: ${user.email}
- Signup Date: ${new Date().toLocaleString()}
- Role: ${user.role || 'user'}
- Provider Type: ${user.credential_type || 'Not set'}
- Work Setting: ${user.service_type || 'Not set'}
- Status: Auto-approved

The user has been automatically approved and now has access to the system with a 14-day free trial.

Log in to the admin dashboard to view more details.

Best regards,
CareMetric AI`
          });
          
          console.log('✅ Admin notification sent to:', admin.email);
        }
      } catch (emailError) {
        console.error('Failed to send admin notification emails:', emailError);
        console.error('Error details:', emailError.message);
        // Continue execution - don't fail signup if email fails
      }
    } else {
      console.warn('⚠️ No admin users found to notify');
    }

    // Send welcome email with onboarding link
    try {
      const appUrl = Deno.env.get('APP_URL') || 'https://app.caremetricai.com';
      const onboardingUrl = `${appUrl}/onboarding`;
      
      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        from_name: 'CareMetric AI',
        subject: '🎉 Welcome to CareMetric AI - Your Free Trial Starts Now!',
        body: `Hello ${user.full_name || 'there'},

Welcome to CareMetric AI! Your 14-day free trial is now active, giving you full access to all features.

🚀 Next Steps:
1. Complete your profile with your professional details
2. Explore the dashboard and available tools
3. Try creating your first AI-powered note
4. Add a patient to see the full workflow

📍 Get Started: ${onboardingUrl}

What You Can Do Right Now:
✓ Smart Note Assistant - AI-powered clinical documentation
✓ Patient Management - Centralized patient records
✓ Care Plans - Automated care plan generation
✓ Document Center - Professional templates and E-signatures
✓ Compliance Tools - Real-time compliance monitoring
✓ Analytics - Track your performance

Your 14-Day Free Trial Includes:
• Full access to all features
• Unlimited patient records
• AI-powered note generation
• Care plan automation
• Compliance monitoring

Questions? Check our help section or reach out to support@caremetricai.com

Best regards,
CareMetric AI Team`
      });
      console.log('Welcome email sent to:', user.email);
    } catch (emailError) {
      console.error('Failed to send welcome email:', emailError);
    }

    return Response.json({ 
      success: true, 
      message: `User account created. Notification sent to ${admins?.length || 0} admin(s)` 
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