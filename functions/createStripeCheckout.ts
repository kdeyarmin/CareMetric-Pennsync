import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe';

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));

Deno.serve(async (req) => {
  try {
    const body = await req.json();
    const { priceId } = body;

    if (!priceId) {
      console.error('[createStripeCheckout] Missing priceId');
      return Response.json({ error: 'priceId is required' }, { status: 400 });
    }

    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      console.error('[createStripeCheckout] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const YOUR_DOMAIN = req.headers.get('origin');
    const appId = Deno.env.get("BASE44_APP_ID");

    // Check if user already has an active or trialing subscription
    const existingSubscriptions = await base44.asServiceRole.entities.Subscription.filter({ user_email: user.email });
    const hasActiveSub = existingSubscriptions.some(sub => 
      sub.status === 'active' || sub.status === 'trialing' || sub.status === 'lifetime_free'
    );

    if (hasActiveSub && existingSubscriptions[0].status !== 'trialing') {
      console.log('[createStripeCheckout] User already has active subscription');
      return Response.json({ 
        error: 'You already have an active subscription. Please manage it from the billing portal.' 
      }, { status: 400 });
    }

    // Get or create Stripe customer
    let customerId = existingSubscriptions[0]?.stripe_customer_id;
    
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.full_name,
        metadata: {
          user_email: user.email,
          base44_app_id: appId || 'unknown'
        }
      });
      customerId = customer.id;
      console.log('[createStripeCheckout] Created new customer:', customerId);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      subscription_data: {
        trial_period_days: hasActiveSub ? 0 : 14, // 14-day trial for new users only
        metadata: {
          user_email: user.email,
          base44_app_id: appId || 'unknown'
        }
      },
      success_url: `${YOUR_DOMAIN}/app/PaymentSuccess?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${YOUR_DOMAIN}/app/SubscriptionPlans`,
      metadata: {
        user_email: user.email,
        base44_app_id: appId || 'unknown'
      },
      allow_promotion_codes: true,
      billing_address_collection: 'auto'
    });

    console.log('[createStripeCheckout] Session created:', {
      sessionId: session.id,
      userEmail: user.email,
      priceId,
      trialDays: hasActiveSub ? 0 : 14
    });

    return Response.json({ sessionId: session.id, url: session.url });
  } catch (error) {
    console.error('[createStripeCheckout] Error:', {
      message: error.message,
      stack: error.stack,
      type: error.type
    });
    return Response.json({ 
      error: 'Failed to create checkout session',
      details: error.message 
    }, { status: 500 });
  }
});