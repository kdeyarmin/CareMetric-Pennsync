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

    console.log('Starting subscription price cleanup...');

    // List all prices
    const allPrices = await stripe.prices.list({ limit: 100 });
    
    // Prices to keep (in cents)
    const keepPrices = {
      2999: 'month',    // $29.99/month (Monthly)
      8199: 'month',    // $81.99/month (3 month)
      14999: 'month',   // $149.99/month (6 month)
      26499: 'year'     // $264.99/year (1 year)
    };

    // Prices to deactivate (in cents)
    const deactivatePrices = {
      3999: 'month',    // $39.99/month
      11500: 'month',   // $115.00/month
      21000: 'month',   // $210.00/month
      35000: 'year'     // $350.00/year
    };

    const results = {
      kept: [],
      deactivated: [],
      errors: []
    };

    for (const price of allPrices.data) {
      const amount = price.unit_amount;
      const interval = price.recurring?.interval;

      // Check if this should be deactivated
      if (deactivatePrices[amount] === interval && price.active) {
        try {
          await stripe.prices.update(price.id, { active: false });
          results.deactivated.push({
            id: price.id,
            amount: amount / 100,
            interval: interval
          });
          console.log(`Deactivated: $${amount / 100}/${interval} (${price.id})`);
        } catch (error) {
          results.errors.push({
            id: price.id,
            error: error.message
          });
          console.error(`Error deactivating ${price.id}:`, error.message);
        }
      } 
      // Check if this should be kept
      else if (keepPrices[amount] === interval) {
        results.kept.push({
          id: price.id,
          amount: amount / 100,
          interval: interval,
          active: price.active
        });
        console.log(`Kept: $${amount / 100}/${interval} (${price.id})`);
      }
    }

    return Response.json({
      success: true,
      message: 'Subscription prices cleaned up successfully',
      results: results
    });

  } catch (error) {
    console.error('Error cleaning up prices:', error);
    return Response.json(
      {
        success: false,
        error: error.message || 'Failed to cleanup prices'
      },
      { status: 500 }
    );
  }
});