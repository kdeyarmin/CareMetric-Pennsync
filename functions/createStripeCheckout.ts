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
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get plan type from request body
    const { plan } = await req.json();
    
    // Get subscription settings
    const settings = await base44.entities.SubscriptionSettings.list();
    const planMapping = {
      'monthly': settings[0]?.stripe_monthly_price_id,
      'quarterly': settings[0]?.stripe_quarterly_price_id,
      'biannual': settings[0]?.stripe_biannual_price_id,
      'yearly': settings[0]?.stripe_yearly_price_id
    };
    const priceId = planMapping[plan || 'monthly'];
    
    if (!priceId) {
      return Response.json({ error: 'Subscription not configured' }, { status: 400 });
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
      success_url: `${req.headers.get('origin')}${createPageUrl('PaymentSuccess')}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${req.headers.get('origin')}${createPageUrl('Billing')}`,
      metadata: {
        user_email: user.email
      },
      subscription_data: {
        trial_period_days: settings[0]?.trial_days || 14
      }
    });

    return Response.json({ url: session.url });
    
  } catch (error) {
    console.error('Stripe checkout error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});