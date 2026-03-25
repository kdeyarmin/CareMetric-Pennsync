import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@14.11.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});

function createPageUrl(pageName) {
  return `/${pageName.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      console.error('[createStripePortal] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { return_url } = await req.json().catch(() => ({}));

    // Get user's subscription
    const subscriptions = await base44.entities.Subscription.filter({ 
      user_email: user.email 
    });
    
    if (subscriptions.length === 0 || !subscriptions[0].stripe_customer_id) {
      console.error('[createStripePortal] No subscription found for:', user.email);
      return Response.json({ error: 'No active subscription found' }, { status: 404 });
    }

    // Create portal session with custom return URL if provided
    const portalReturnUrl = return_url || `${req.headers.get('origin')}${createPageUrl('MySubscription')}`;
    
    const session = await stripe.billingPortal.sessions.create({
      customer: subscriptions[0].stripe_customer_id,
      return_url: portalReturnUrl,
    });

    console.log('[createStripePortal] Portal session created:', {
      customerId: subscriptions[0].stripe_customer_id,
      userEmail: user.email,
      returnUrl: portalReturnUrl
    });

    return Response.json({ url: session.url });
    
  } catch (error) {
    console.error('[createStripePortal] Error:', {
      message: error.message,
      stack: error.stack,
      type: error.type
    });
    return Response.json({ 
      error: 'Failed to create portal session',
      details: error.message 
    }, { status: 500 });
  }
});