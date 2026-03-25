import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { product_id, unit_amount, currency = 'usd', recurring_interval, recurring_interval_count = 1 } = body;

    if (!product_id || !unit_amount) {
      return Response.json({ error: 'Product ID and amount are required' }, { status: 400 });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    const priceData = {
      product: product_id,
      unit_amount: unit_amount,
      currency: currency,
      recurring: {
        interval: recurring_interval,
        interval_count: recurring_interval_count
      }
    };

    const price = await stripe.prices.create(priceData);

    console.log('[stripeCreatePrice] Created price:', price.id);

    return Response.json({
      success: true,
      price
    });
  } catch (error) {
    console.error('[stripeCreatePrice] Error:', error.message);
    return Response.json({
      error: 'Failed to create price',
      details: error.message
    }, { status: 500 });
  }
});