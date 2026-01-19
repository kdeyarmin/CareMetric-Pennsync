import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { product_id } = await req.json();

    if (!product_id) {
      return Response.json({ error: 'Product ID required' }, { status: 400 });
    }

    const deletedProduct = await stripe.products.del(product_id);

    console.log('Product deleted:', product_id);

    return Response.json({ 
      success: true, 
      deleted: deletedProduct 
    });

  } catch (error) {
    console.error('Error deleting product:', error);
    return Response.json({ 
      error: 'Failed to delete product', 
      details: error.message 
    }, { status: 500 });
  }
});