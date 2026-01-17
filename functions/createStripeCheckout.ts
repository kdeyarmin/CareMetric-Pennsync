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

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${YOUR_DOMAIN}/app/PaymentSuccess`,
      cancel_url: `${YOUR_DOMAIN}/app/SubscriptionPlans`,
      customer_email: user.email,
      metadata: {
        user_email: user.email,
        base44_app_id: appId || 'unknown'
      }
    });

    console.log('[createStripeCheckout] Session created:', {
      sessionId: session.id,
      userEmail: user.email,
      priceId
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