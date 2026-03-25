import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function is called by automation, use service role
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    // Find subscriptions ending in 7 days
    const today = new Date();
    const sevenDaysFromNow = new Date(today);
    sevenDaysFromNow.setDate(today.getDate() + 7);

    const allSubscriptions = await base44.asServiceRole.entities.Subscription.list();
    const upcomingRenewals = allSubscriptions.filter(sub => {
      if (sub.status !== 'active' || !sub.current_period_end) return false;
      
      const endDate = new Date(sub.current_period_end);
      const daysUntil = Math.ceil((endDate - today) / (1000 * 60 * 60 * 24));
      
      return daysUntil === 7;
    });

    let sentCount = 0;

    for (const subscription of upcomingRenewals) {
      // Check notification preferences
      const prefs = await base44.asServiceRole.entities.NotificationPreferences.filter({ 
        user_email: subscription.user_email 
      });
      
      if (prefs.length > 0 && !prefs[0].subscription_reminders) {
        continue;
      }

      const renewalDate = new Date(subscription.current_period_end).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });

      const emailHtml = `
        <h1>Your Subscription Renews Soon</h1>
        <p>Hi there,</p>
        <p>This is a friendly reminder that your CareMetric AI subscription will renew on <strong>${renewalDate}</strong>.</p>
        
        <h2>📋 Subscription Details</h2>
        <ul>
          <li><strong>Plan:</strong> ${subscription.plan_name || 'CareMetric AI Subscription'}</li>
          <li><strong>Renewal Date:</strong> ${renewalDate}</li>
          <li><strong>Status:</strong> Active</li>
        </ul>
        
        <p>No action is needed - your subscription will automatically renew using your payment method on file.</p>
        
        <h2>🔧 Need to Make Changes?</h2>
        <p>You can update your payment method, change plans, or manage your subscription anytime:</p>
        <p><a href="https://app.caremetricai.com/SubscriptionPlans" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">Manage Subscription</a></p>
        
        <p>Thank you for being a valued member of CareMetric AI!</p>
        
        <p>Best regards,<br>The CareMetric AI Team</p>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 12px; color: #6b7280;">
          Questions? Contact us at <a href="mailto:support@caremetricai.com">support@caremetricai.com</a>
        </p>
      `;

      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'CareMetric AI <billing@caremetricai.com>',
            to: subscription.user_email,
            subject: '📅 Your Subscription Renews in 7 Days',
            html: emailHtml
          })
        });

        if (response.ok) {
          sentCount++;
          
          // Log the reminder
          await base44.asServiceRole.entities.UserActivity.create({
            user_email: subscription.user_email,
            action: 'subscription_reminder_sent',
            details: { renewal_date: subscription.current_period_end },
            page: 'subscription'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send reminder to ${subscription.user_email}:`, error);
      }
    }

    return Response.json({ 
      success: true, 
      sent_count: sentCount,
      checked_count: upcomingRenewals.length
    });
  } catch (error) {
    console.error('[sendSubscriptionReminder] Error:', error);
    return Response.json({
      error: 'Failed to send subscription reminders',
      details: error.message
    }, { status: 500 });
  }
});