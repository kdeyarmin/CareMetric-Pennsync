import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { subscription_id, new_price_id } = await req.json();

    if (!subscription_id || !new_price_id) {
      return Response.json({ 
        error: 'subscription_id and new_price_id are required' 
      }, { status: 400 });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    // Get the subscription
    const subscription = await stripe.subscriptions.retrieve(subscription_id);
    
    if (!subscription) {
      return Response.json({ error: 'Subscription not found' }, { status: 404 });
    }

    // Update the subscription with the new price
    const updatedSubscription = await stripe.subscriptions.update(subscription_id, {
      items: [{
        id: subscription.items.data[0].id,
        price: new_price_id,
      }],
      proration_behavior: 'create_prorations', // Prorate charges
    });

    // Update subscription entity in database
    const subscriptions = await base44.entities.Subscription.filter({ 
      user_email: user.email 
    });

    if (subscriptions.length > 0) {
      await base44.entities.Subscription.update(subscriptions[0].id, {
        stripe_price_id: new_price_id,
        updated_date: new Date().toISOString()
      });
    }

    return Response.json({
      success: true,
      subscription: updatedSubscription
    });
  } catch (error) {
    console.error('[updateSubscriptionPrice] Error:', error);
    return Response.json({
      error: 'Failed to update subscription',
      details: error.message
    }, { status: 500 });
  }
});