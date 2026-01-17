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

    console.log('getMySubscription: Fetching subscription for user:', user.email);

    // Use service role to bypass RLS and get user's subscription
    const subscriptions = await base44.asServiceRole.entities.Subscription.filter({
      user_email: user.email
    });

    console.log('getMySubscription: Found subscriptions:', subscriptions);

    const subscription = subscriptions[0] || null;

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