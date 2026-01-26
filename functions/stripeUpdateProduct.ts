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

    const { product_id, name, description, active } = await req.json();

    if (!product_id) {
      return Response.json({ error: 'Product ID required' }, { status: 400 });
    }

    // Only update fields that are provided
    const updateData = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (active !== undefined) updateData.active = active;

    const updatedProduct = await stripe.products.update(product_id, updateData);

    console.log('Product updated successfully:', updatedProduct.id);

    return Response.json({ 
      success: true, 
      product: updatedProduct 
    });

  } catch (error) {
    console.error('Error updating product:', error);
    return Response.json({ 
      error: 'Failed to update product', 
      details: error.message 
    }, { status: 500 });
  }
});