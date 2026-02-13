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
            from_name: 'CareMetric AI System',
            subject: `🎉 New User Signup - ${user.full_name || user.email}`,
            body: `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 20px auto; background: white; padding: 0; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #10b981 0%, #059669 100%); color: white; padding: 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 24px; font-weight: 600; }
    .content { padding: 30px; }
    .info-box { background: #f8fafc; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 6px; }
    .info-row { display: flex; margin: 10px 0; }
    .info-label { font-weight: 600; color: #555; min-width: 140px; }
    .info-value { color: #333; }
    .cta { text-align: center; margin: 30px 0; }
    .cta-button { display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; }
    .footer { background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 13px; border-top: 1px solid #e5e7eb; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🎉 New User Registration</h1>
      <p style="margin: 10px 0 0; opacity: 0.95;">CareMetric AI</p>
    </div>
    
    <div class="content">
      <p>Hello ${admin.full_name || 'Admin'},</p>
      
      <p>A new user has successfully registered for CareMetric AI and has been automatically approved with a 14-day free trial.</p>

      <div class="info-box">
        <h3 style="margin-top: 0; color: #1e40af;">User Information</h3>
        <div class="info-row">
          <span class="info-label">Name:</span>
          <span class="info-value">${user.full_name || 'Not provided'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Email:</span>
          <span class="info-value">${user.email}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Signup Date:</span>
          <span class="info-value">${new Date().toLocaleString('en-US', { dateStyle: 'full', timeStyle: 'short' })}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Role:</span>
          <span class="info-value">${user.role || 'user'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Provider Type:</span>
          <span class="info-value">${user.credential_type || 'Not set'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Work Setting:</span>
          <span class="info-value">${user.service_type || 'Not set'}</span>
        </div>
        <div class="info-row">
          <span class="info-label">Status:</span>
          <span class="info-value"><strong style="color: #10b981;">Auto-approved ✓</strong></span>
        </div>
        <div class="info-row">
          <span class="info-label">Trial Status:</span>
          <span class="info-value">14-day free trial active</span>
        </div>
      </div>

      <p style="color: #555; font-size: 14px;">
        <strong>Next Steps:</strong> The user has received a welcome email with onboarding instructions. You may want to monitor their initial activity or reach out to offer personalized assistance.
      </p>

      <div class="cta">
        <a href="https://app.caremetricai.com/UserManagement" class="cta-button">
          View in Admin Dashboard →
        </a>
      </div>
    </div>
    
    <div class="footer">
      <p><strong>CareMetric AI Admin Notification</strong></p>
      <p style="margin-top: 10px; font-size: 12px; color: #999;">
        This is an automated notification sent to all administrators.
      </p>
    </div>
  </div>
</body>
</html>`
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

    // Generate PDF guide URLs
    let userGuideUrl = '';
    let quickGuideUrl = '';
    try {
      const fullGuideRes = await base44.asServiceRole.functions.invoke('generateUserGuidePDF', { guide_type: 'full' });
      const fullGuideData = fullGuideRes.data || fullGuideRes;
      userGuideUrl = fullGuideData.file_url || '';
      
      const quickGuideRes = await base44.asServiceRole.functions.invoke('generateUserGuidePDF', { guide_type: 'quick' });
      const quickGuideData = quickGuideRes.data || quickGuideRes;
      quickGuideUrl = quickGuideData.file_url || '';
      
      console.log('Generated guide PDFs for welcome email');
    } catch (guideError) {
      console.error('Failed to generate guide PDFs:', guideError);
    }

    // Send welcome email with onboarding link and guides
    try {
      const appUrl = Deno.env.get('APP_URL') || 'https://app.caremetricai.com';
      const onboardingUrl = `${appUrl}/onboarding`;
      
      const guideSection = (userGuideUrl || quickGuideUrl) ? `
      <div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 20px; margin: 20px 0;">
        <h3 style="margin-top: 0; color: #0369a1; font-size: 16px;">📚 Your Getting Started Guides</h3>
        <p style="color: #475569; font-size: 14px; margin-bottom: 15px;">Download these guides for quick reference — they cover everything you need to know!</p>
        ${userGuideUrl ? `<a href="${userGuideUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; margin-right: 10px; margin-bottom: 8px;">📖 Complete User Guide (PDF)</a>` : ''}
        ${quickGuideUrl ? `<a href="${quickGuideUrl}" style="display: inline-block; background: #059669; color: white; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: 600; font-size: 13px; margin-bottom: 8px;">⚡ Quick Reference Guide (PDF)</a>` : ''}
      </div>` : '';

      await base44.asServiceRole.integrations.Core.SendEmail({
        to: user.email,
        from_name: 'CareMetric AI',
        subject: '🎉 Welcome to CareMetric AI - Your Free Trial Starts Now!',
        body: `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
    <div style="background: linear-gradient(135deg, #2563eb 0%, #4f46e5 100%); color: white; padding: 30px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px;">🎉 Welcome to CareMetric AI!</h1>
      <p style="margin: 10px 0 0; opacity: 0.95; font-size: 15px;">Your 14-day free trial is now active</p>
    </div>
    
    <div style="padding: 30px;">
      <p style="font-size: 15px;">Hello ${user.full_name || 'there'},</p>
      
      <p style="color: #475569;">Welcome aboard! You now have full access to all CareMetric AI features for the next 14 days — no credit card required.</p>

      <h3 style="color: #1e40af; margin-top: 25px;">🚀 Getting Started in 4 Easy Steps</h3>
      <ol style="color: #475569; font-size: 14px; padding-left: 20px;">
        <li style="margin-bottom: 8px;"><strong>Complete your profile</strong> — Set your provider type in Settings</li>
        <li style="margin-bottom: 8px;"><strong>Add your first patient</strong> — Go to Patients > Add Patient</li>
        <li style="margin-bottom: 8px;"><strong>Try the Smart Note Assistant</strong> — Create your first AI-enhanced note</li>
        <li style="margin-bottom: 8px;"><strong>Explore the Dashboard</strong> — See everything in one place</li>
      </ol>

      <div style="text-align: center; margin: 25px 0;">
        <a href="${appUrl}/Dashboard" style="display: inline-block; background: #2563eb; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Get Started Now →</a>
      </div>

      ${guideSection}

      <h3 style="color: #1e40af; margin-top: 25px;">✨ What You Can Do</h3>
      <div style="color: #475569; font-size: 14px;">
        <p>✅ <strong>Smart Note Assistant</strong> — AI-powered clinical documentation</p>
        <p>✅ <strong>Medical Scribe</strong> — Voice-to-note with speaker identification</p>
        <p>✅ <strong>Care Plans</strong> — Automated care plan generation</p>
        <p>✅ <strong>Compliance Tools</strong> — Real-time compliance monitoring</p>
        <p>✅ <strong>Patient Alerts</strong> — AI-powered risk detection</p>
        <p>✅ <strong>Analytics</strong> — Track your time savings and performance</p>
      </div>

      <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; border-radius: 6px; margin: 20px 0;">
        <p style="margin: 0; color: #92400e; font-size: 13px;">💡 <strong>Pro Tip:</strong> Most nurses save 20-30 minutes on their very first AI-enhanced note. Start with the Smart Note Assistant to see the difference immediately!</p>
      </div>

      <p style="color: #64748b; font-size: 13px;">Questions? Visit our <a href="${appUrl}/Documentation" style="color: #2563eb;">Documentation</a> page, check the <a href="${appUrl}/FAQ" style="color: #2563eb;">FAQ</a>, or email us at <a href="mailto:support@caremetricai.com" style="color: #2563eb;">support@caremetricai.com</a>.</p>
    </div>
    
    <div style="background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb;">
      <p><strong>CareMetric AI</strong> — AI-Powered Clinical Documentation</p>
      <p style="margin-top: 5px; color: #999;">© ${new Date().getFullYear()} CareMetric AI. All rights reserved.</p>
    </div>
  </div>
</body>
</html>`
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