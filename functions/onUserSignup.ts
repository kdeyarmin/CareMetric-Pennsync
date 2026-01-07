import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

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
        plan_name: '14-Day Free Trial',
        payment_method: 'trial'
      });
      console.log('Trial subscription created for:', user.email);
    } catch (trialError) {
      console.error('Failed to create trial subscription:', trialError);
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
    ✅ Status: Auto-approved

    The user has been automatically approved and now has access to the system with a 14-day free trial.

    You can view their activity in the Admin Dashboard.

    ➡️ https://www.caremetricai.com

    Best regards,
    CareMetric AI
    `.trim();

    // Send email to all admins
    const emailPromises = admins.map(admin => 
      base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `✅ New User Signup - CareMetric AI`,
        from_name: 'CareMetric AI',
        body: `Hello ${admin.full_name || 'Admin'},\n\n${emailBody}`
      })
    );

    console.log('Sending emails to admins...');
    await Promise.all(emailPromises);
    console.log('Signup notification complete');

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