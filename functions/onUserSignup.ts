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

    // Check if user was invited
    console.log('Checking for invitation...');
    const invitations = await base44.asServiceRole.entities.UserInvitation.filter({ 
      email: user.email,
      status: 'pending'
    });
    console.log('Found invitations:', invitations?.length || 0);

    if (invitations && invitations.length > 0) {
      const invitation = invitations[0];
      
      // Auto-approve ALL invited users (admin-added users should be automatically approved)
      console.log('Auto-approving invited user...');
      
      try {
        await base44.asServiceRole.entities.User.update(user.id, {
          role: invitation.role,
          care_scope: invitation.care_scope,
          phone: invitation.phone,
          credentials: invitation.credentials,
          is_approved: true,
          service_type: 'home_health'
        });

        // Delete the invitation instead of updating it
        await base44.asServiceRole.entities.UserInvitation.delete(invitation.id);

        // Log auto-approval
        try {
          await base44.asServiceRole.entities.UserActivity.create({
            user_email: user.email,
            user_name: user.full_name,
            action: 'user_signup_auto_approved',
            details: {
              invitation_id: invitation.id,
              role: invitation.role,
              care_scope: invitation.care_scope,
              invited_by: invitation.invited_by
            },
            page: 'Signup',
            entity_type: 'User',
            entity_id: user.id
          });
        } catch (logError) {
          console.error('Failed to log activity:', logError);
        }

        console.log('Auto-approved invited user:', user.email);
        return Response.json({ success: true, auto_approved: true });
      } catch (updateError) {
        console.error('Failed to auto-approve user:', updateError);
      }
    }

    // Not invited - notify admins for manual approval
    console.log('Fetching admin users...');
    const admins = await base44.asServiceRole.entities.User.filter({ role: 'admin' });
    console.log('Found admins:', admins.length);

    const emailBody = `
    Hello,

    A new user has signed up for Penn Sync and is awaiting approval:

    👤 Name: ${user.full_name || 'Not provided'}
    📧 Email: ${user.email}
    📅 Signup Date: ${new Date().toLocaleString()}
    🎭 Role: ${user.role || 'user'}

    Action Required:
    Please log in to Penn Sync and navigate to the User Management page to approve or review this user's access.

    ➡️ Go to Admin Dashboard > User Management

    The user will not be able to access the system until approved by an administrator.

    Best regards,
    Penn Sync System
    `.trim();

    // Send email to all admins
    const emailPromises = admins.map(admin => 
      base44.asServiceRole.integrations.Core.SendEmail({
        to: admin.email,
        subject: `🔔 New User Awaiting Approval - Penn Sync`,
        from_name: 'Penn Sync Notifications',
        body: `Hello ${admin.full_name || 'Admin'},\n\n${emailBody}`
      })
    );

    // Also send notification to kdeyarmin@pennhospice.com
    emailPromises.push(
      base44.asServiceRole.integrations.Core.SendEmail({
        to: 'kdeyarmin@pennhospice.com',
        subject: `🔔 New User Awaiting Approval - Penn Sync`,
        from_name: 'Penn Sync Notifications',
        body: `Hello,\n\n${emailBody}`
      })
    );

    console.log('Sending emails to admins and kdeyarmin@pennhospice.com...');
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