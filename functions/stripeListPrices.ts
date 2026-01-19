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
    const { product_id } = body;

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    const params = { active: true, limit: 100 };
    if (product_id) {
      params.product = product_id;
    }

    const prices = await stripe.prices.list(params);

    return Response.json({
      success: true,
      prices: prices.data
    });
  } catch (error) {
    console.error('[stripeListPrices] Error:', error.message);
    return Response.json({
      error: 'Failed to list prices',
      details: error.message
    }, { status: 500 });
  }
});