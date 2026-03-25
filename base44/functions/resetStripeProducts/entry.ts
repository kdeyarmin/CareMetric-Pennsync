import Stripe from 'npm:stripe@15.0.0';
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    // Admin only
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    console.log('Starting Stripe products reset...');

    // Step 1: Archive all existing products (Stripe doesn't allow deletion if there are active prices)
    const existingProducts = await stripe.products.list({ limit: 100 });
    
    for (const product of existingProducts.data) {
      console.log(`Archiving product: ${product.name} (${product.id})`);
      try {
        await stripe.products.update(product.id, { active: false });
      } catch (error) {
        console.log(`Could not archive ${product.id}: ${error.message}`);
      }
    }

    console.log(`Archived ${existingProducts.data.length} products`);

    // Step 2: Create new products with correct prices
    const productsToCreate = [
      {
        name: "Monthly CareMetric AI",
        description: "Monthly subscription to CareMetric AI",
        price: 2999, // $29.99
        interval: "month"
      },
      {
        name: "3 Month Subscription - CareMetric AI",
        description: "3 month subscription to CareMetric AI",
        price: 8199, // $81.99
        interval: "month"
      },
      {
        name: "6 Month Subscription - CareMetric AI",
        description: "6 month subscription to CareMetric AI",
        price: 14999, // $149.99
        interval: "month"
      },
      {
        name: "1 Year Subscription - CareMetric AI",
        description: "1 year subscription to CareMetric AI",
        price: 26499, // $264.99
        interval: "year"
      }
    ];

    const createdProducts = [];

    for (const productData of productsToCreate) {
      // Create product
      console.log(`Creating product: ${productData.name}`);
      const product = await stripe.products.create({
        name: productData.name,
        description: productData.description
      });

      // Create price for product
      console.log(`Creating price: $${productData.price / 100}/${productData.interval}`);
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: productData.price,
        currency: 'usd',
        recurring: {
          interval: productData.interval
        }
      });

      createdProducts.push({
        product: product.name,
        productId: product.id,
        price: `$${productData.price / 100}`,
        priceId: price.id,
        interval: productData.interval
      });

      console.log(`✓ Created: ${productData.name} - $${productData.price / 100}/${productData.interval}`);
    }

    return Response.json({
      success: true,
      message: 'All products deleted and recreated successfully',
      deleted: existingProducts.data.length,
      created: createdProducts
    });

  } catch (error) {
    console.error('Error resetting products:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Failed to reset products'
      },
      { status: 500 }
    );
  }
});