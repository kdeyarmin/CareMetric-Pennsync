import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { feature_title, feature_description, feature_link, target_audience } = await req.json();

    if (!feature_title || !feature_description) {
      return Response.json({ 
        error: 'feature_title and feature_description are required' 
      }, { status: 400 });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    // Get all users with feature announcement preferences enabled
    const allPrefs = await base44.asServiceRole.entities.NotificationPreferences.list();
    const enabledUsers = allPrefs.filter(p => p.feature_announcements);

    // If target_audience specified, filter further
    let targetUsers = enabledUsers;
    if (target_audience === 'active_subscribers') {
      const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
        status: 'active'
      });
      const activeEmails = new Set(subscriptions.map(s => s.user_email));
      targetUsers = enabledUsers.filter(p => activeEmails.has(p.user_email));
    }

    const emailHtml = `
      <h1>🎉 New Feature: ${feature_title}</h1>
      <p>${feature_description}</p>
      
      ${feature_link ? `<p><a href="${feature_link}" style="display: inline-block; padding: 12px 24px; background-color: #3b82f6; color: white; text-decoration: none; border-radius: 6px; margin: 16px 0;">Try It Now</a></p>` : ''}
      
      <p>We're constantly improving CareMetric AI to help you provide the best care possible.</p>
      
      <p>Have feedback? Hit reply and let us know what you think!</p>
      
      <p>Best regards,<br>The CareMetric AI Team</p>
      
      <hr style="margin: 24px 0; border: none; border-top: 1px solid #e5e7eb;">
      <p style="font-size: 12px; color: #6b7280;">
        You're receiving this because you opted in to feature announcements. 
        <a href="https://app.caremetricai.com/Settings">Update preferences</a>
      </p>
    `;

    let sentCount = 0;
    let errors = [];

    // Send emails in batches to avoid rate limits
    for (const pref of targetUsers) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            from: 'CareMetric AI <updates@caremetricai.com>',
            to: pref.user_email,
            subject: `🎉 New Feature: ${feature_title}`,
            html: emailHtml
          })
        });

        if (response.ok) {
          sentCount++;
        } else {
          const error = await response.json();
          errors.push({ email: pref.user_email, error: error.message });
        }

        // Rate limiting - wait 100ms between sends
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        errors.push({ email: pref.user_email, error: error.message });
      }
    }

    // Log the announcement
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      action: 'feature_announcement_sent',
      details: { 
        feature_title, 
        sent_count: sentCount, 
        target_count: targetUsers.length,
        errors: errors.length 
      },
      page: 'admin'
    });

    return Response.json({ 
      success: true, 
      sent_count: sentCount,
      target_count: targetUsers.length,
      errors: errors.length > 0 ? errors : undefined
    });
  } catch (error) {
    console.error('[sendFeatureAnnouncement] Error:', error);
    return Response.json({
      error: 'Failed to send feature announcement',
      details: error.message
    }, { status: 500 });
  }
});