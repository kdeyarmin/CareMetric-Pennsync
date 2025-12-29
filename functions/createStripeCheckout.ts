import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@14.11.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

function createPageUrl(pageName) {
  return `/${pageName.toLowerCase().replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase()}`;
}

Deno.serve(async (req) => {
  try {
    console.log('Checkout request received');
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      console.error('User not authenticated');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    console.log('User authenticated:', user.email);

    // Get priceId from request body
    const { priceId } = await req.json();
    console.log('Price ID selected:', priceId);
    
    if (!priceId) {
      console.error('No price ID provided');
      return Response.json({ error: 'Price ID is required' }, { status: 400 });
    }
    
    console.log('Price ID:', priceId);

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

    // Check if user already had a subscription (no trial for renewals)
    const trialDays = existingSubs.length > 0 ? null : 14;

    // Create checkout session
    const origin = 'https://www.caremetricai.com';
    
    console.log('Creating checkout session for customer:', customerId);
    console.log('Origin:', origin);
    console.log('Trial days:', trialDays);
    
    const sessionConfig = {
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: `${origin}/?page=PaymentSuccess&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/?page=SubscriptionPlans`,
      metadata: {
        user_email: user.email,
        user_id: user.id
      }
    };
    
    if (trialDays) {
      sessionConfig.subscription_data = {
        trial_period_days: trialDays,
        metadata: {
          user_email: user.email,
          user_id: user.id
        }
      };
    }
    
    const session = await stripe.checkout.sessions.create(sessionConfig);
    
    console.log('Checkout session created:', session.id);
    console.log('Checkout URL:', session.url);

    return Response.json({ url: session.url });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    console.error('Error stack:', error.stack);
    return Response.json({ 
      error: error.message,
      details: error.toString()
    }, { status: 500 });
  }
});