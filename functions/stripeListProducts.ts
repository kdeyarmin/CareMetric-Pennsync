import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

    // Fetch ALL products (active and inactive) for admin view
    const products = await stripe.products.list({ limit: 100 });

    return Response.json({
      success: true,
      products: products.data
    });
  } catch (error) {
    console.error('[stripeListProducts] Error:', error.message);
    return Response.json({
      error: 'Failed to list products',
      details: error.message
    }, { status: 500 });
  }
});