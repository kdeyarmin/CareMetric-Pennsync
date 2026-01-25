import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    // Get user's subscription to find customer ID
    const subscriptions = await base44.entities.Subscription.filter({ 
      user_email: user.email 
    });

    if (subscriptions.length === 0) {
      return Response.json({ 
        invoices: [],
        paymentMethods: []
      });
    }

    const subscription = subscriptions[0];
    const customerId = subscription.stripe_customer_id;

    if (!customerId) {
      return Response.json({ 
        invoices: [],
        paymentMethods: []
      });
    }

    // Fetch invoices
    const invoices = await stripe.invoices.list({
      customer: customerId,
      limit: 50
    });

    // Fetch payment methods
    const paymentMethods = await stripe.paymentMethods.list({
      customer: customerId,
      type: 'card'
    });

    return Response.json({
      success: true,
      invoices: invoices.data,
      paymentMethods: paymentMethods.data
    });
  } catch (error) {
    console.error('[getCustomerBillingHistory] Error:', error);
    return Response.json({
      error: 'Failed to fetch billing history',
      details: error.message
    }, { status: 500 });
  }
});