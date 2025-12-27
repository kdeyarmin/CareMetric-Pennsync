import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@14.11.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { plan } = await req.json();
    
    // Get price ID based on plan
    const priceIds = {
      basic: Deno.env.get('STRIPE_PRICE_ID_BASIC'),
      pro: Deno.env.get('STRIPE_PRICE_ID_PRO'),
      enterprise: Deno.env.get('STRIPE_PRICE_ID_ENTERPRISE')
    };
    
    const priceId = priceIds[plan];
    if (!priceId) {
      return Response.json({ error: 'Invalid plan' }, { status: 400 });
    }

    // Check if user already has a subscription
    const existingSubs = await base44.entities.Subscription.filter({ 
      user_email: user.email 
    });
    
    let customerId = existingSubs[0]?.stripe_customer_id;
    
    // Create or retrieve Stripe customer
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          user_email: user.email,
          user_id: user.id
        }
      });
      customerId = customer.id;
    }

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${req.headers.get('origin')}/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}/billing`,
      metadata: {
        user_email: user.email,
        plan: plan
      }
    });

    return Response.json({ url: session.url });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});