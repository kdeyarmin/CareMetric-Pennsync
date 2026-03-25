import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all active subscriptions
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
      status: 'trialing'
    });

    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    let notificationsSent = 0;

    for (const subscription of subscriptions) {
      if (!subscription.trial_end) continue;
      
      const trialEndDate = new Date(subscription.trial_end * 1000);
      const userEmail = subscription.user_email;

      // Send notification 3 days before trial ends
      if (trialEndDate <= threeDaysFromNow && trialEndDate > oneDayFromNow) {
        const daysRemaining = Math.ceil((trialEndDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: userEmail,
          from_name: 'CareMetric AI',
          subject: `Your free trial ends in ${daysRemaining} days`,
          body: `
Hi there,

Your CareMetric AI free trial will end in ${daysRemaining} days on ${trialEndDate.toLocaleDateString()}.

After your trial ends, you'll be automatically charged based on your selected plan. If you'd like to cancel or change your subscription, you can do so anytime from your billing settings.

Manage your subscription: ${req.headers.get('origin') || 'https://caremetricai.base44.app'}/?page=Billing

Thank you for trying CareMetric AI!

Best regards,
The CareMetric AI Team
          `
        });

        notificationsSent++;
      }

      // Send notification 1 day before trial ends
      if (trialEndDate <= oneDayFromNow && trialEndDate > now) {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: userEmail,
          from_name: 'CareMetric AI',
          subject: '⚠️ Your free trial ends tomorrow',
          body: `
Hi there,

This is a friendly reminder that your CareMetric AI free trial ends tomorrow (${trialEndDate.toLocaleDateString()}).

You'll be automatically charged for your subscription starting tomorrow. If you want to cancel, please do so before the trial period ends.

Manage your subscription: ${req.headers.get('origin') || 'https://caremetricai.base44.app'}/?page=Billing

Thank you!

Best regards,
The CareMetric AI Team
          `
        });

        notificationsSent++;
      }
    }

    return Response.json({ 
      success: true,
      subscriptionsChecked: subscriptions.length,
      notificationsSent 
    });
  } catch (error) {
    console.error('Trial notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});