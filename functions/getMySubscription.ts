import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('[getMySubscription] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('[getMySubscription] Fetching subscription for:', user.email);

    // Use service role to bypass RLS and get user's subscription
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
      user_email: user.email
    });

    let subscription = subscriptions[0] || null;

    // If no subscription exists at all, auto-create a 14-day trial as safety net
    // This handles edge cases where onUserSignup trial creation failed
    if (!subscription) {
      console.log('[getMySubscription] No subscription found, auto-creating trial for:', user.email);
      const trialEndDate = new Date();
      trialEndDate.setDate(trialEndDate.getDate() + 14);

      subscription = await base44.asServiceRole.entities.Subscription.create({
        user_email: user.email,
        status: 'trialing',
        trial_start: new Date().toISOString(),
        trial_end: trialEndDate.toISOString(),
        plan_name: '14-Day Free Trial - Full Access',
        monthly_amount: 0
      });
      console.log('[getMySubscription] Trial auto-created for:', user.email);

      return Response.json({
        success: true,
        subscription: subscription
      });
    }

    // CRITICAL: Auto-expire trial if past trial_end date
    // This ensures users cannot access features after trial ends
    if (subscription.status === 'trialing' && subscription.trial_end) {
      const trialEnd = new Date(subscription.trial_end);
      const now = new Date();
      if (now > trialEnd) {
        console.log('[getMySubscription] ⚠️ Trial expired for:', user.email, 'Expired on:', trialEnd.toISOString());
        await base44.asServiceRole.entities.Subscription.update(subscription.id, {
          status: 'expired'
        });
        subscription = { ...subscription, status: 'expired' };
      } else {
        const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        console.log('[getMySubscription] ✅ Trial active for:', user.email, 'Days remaining:', daysRemaining);
      }
    }

    return Response.json({
      success: true,
      subscription: subscription
    });
  } catch (error) {
    console.error('getMySubscription error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});