import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    // Find users who viewed subscription page but didn't subscribe in last 24 hours
    const oneDayAgo = new Date();
    oneDayAgo.setHours(oneDayAgo.getHours() - 24);

    const recentActivity = await base44.asServiceRole.entities.UserActivity.filter({
      action: 'page_view',
      page: 'SubscriptionPlans'
    });

    const viewedButNotSubscribed = [];

    for (const activity of recentActivity) {
      const activityDate = new Date(activity.created_date);
      if (activityDate < oneDayAgo) continue;

      // Check if user has active subscription
      const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
        user_email: activity.user_email,
        status: 'active'
      });

      if (subscriptions.length === 0) {
        // Check notification preferences
        const prefs = await base44.asServiceRole.entities.NotificationPreferences.filter({ 
          user_email: activity.user_email 
        });
        
        if (prefs.length > 0 && !prefs[0].abandoned_cart_recovery) {
          continue;
        }

        // Check if we already sent abandoned cart email recently
        const recentEmails = await base44.asServiceRole.entities.UserActivity.filter({
          user_email: activity.user_email,
          action: 'abandoned_cart_email_sent'
        });

        const lastEmailDate = recentEmails.length > 0 
          ? new Date(recentEmails[0].created_date) 
          : null;

        if (!lastEmailDate || (new Date() - lastEmailDate) > 86400000) { // 24 hours
          viewedButNotSubscribed.push(activity.user_email);
        }
      }
    }

    // Remove duplicates
    const uniqueEmails = [...new Set(viewedButNotSubscribed)];
    let sentCount = 0;

    for (const email of uniqueEmails) {
      const emailHtml = `
        <h1>Still Thinking It Over?</h1>
        <p>Hi there,</p>
        <p>We noticed you were checking out CareMetric AI subscription plans recently. We'd love to help you get started!</p>
        
        <h2>✨ What You'll Get</h2>
        <ul>
          <li>AI-powered documentation that saves hours each week</li>
          <li>Medicare-compliant notes in seconds</li>
          <li>Real-time compliance monitoring</li>
          <li>OASIS optimization tools</li>
          <li>24/7 access to comprehensive care management tools</li>
        </ul>
        
        <h2>💰 Special Offer</h2>
        <p>Use code <strong>WELCOME10</strong> for 10% off your first month!</p>
        
        <p><a href="https://app.caremetricai.com/SubscriptionPlans" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">View Plans & Subscribe</a></p>
        
        <h2>❓ Have Questions?</h2>
        <p>Our team is here to help! Reply to this email or schedule a demo to see CareMetric AI in action.</p>
        
        <p>Best regards,<br>The CareMetric AI Team</p>
        
        <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
        <p style="font-size: 12px; color: #6b7280;">
          Not interested? <a href="https://app.caremetricai.com/Settings">Update your email preferences</a>
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
            from: 'CareMetric AI <sales@caremetricai.com>',
            to: email,
            subject: "Don't Miss Out on Your CareMetric AI Subscription",
            html: emailHtml
          })
        });

        if (response.ok) {
          sentCount++;
          
          // Log the email
          await base44.asServiceRole.entities.UserActivity.create({
            user_email: email,
            action: 'abandoned_cart_email_sent',
            details: { sent_date: new Date().toISOString() },
            page: 'subscription'
          });
        }

        // Rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Failed to send abandoned cart email to ${email}:`, error);
      }
    }

    return Response.json({ 
      success: true, 
      sent_count: sentCount,
      potential_count: uniqueEmails.length
    });
  } catch (error) {
    console.error('[sendAbandonedCartEmail] Error:', error);
    return Response.json({
      error: 'Failed to send abandoned cart emails',
      details: error.message
    }, { status: 500 });
  }
});