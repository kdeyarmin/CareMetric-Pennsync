import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2023-10-16',
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    // Product IDs from existing catalog
    const products = {
      threeMonth: 'prod_TgAokIrg1VTtAG',
      sixMonth: 'prod_TgAki8OgUtfufi',
      annual: 'prod_TgAlxQ8koQoH3p'
    };

    // New prices in cents
    const newPrices = {
      threeMonth: 11499, // $114.99
      sixMonth: 20999,   // $209.99
      annual: 34999      // $349.99
    };

    const results = [];

    // Create new price for 3-month subscription
    const threeMonthPrice = await stripe.prices.create({
      product: products.threeMonth,
      unit_amount: newPrices.threeMonth,
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 3
      }
    });

    // Update product default price
    await stripe.products.update(products.threeMonth, {
      default_price: threeMonthPrice.id
    });

    results.push({
      product: '3 Month',
      oldPrice: '$115.00',
      newPrice: '$114.99',
      priceId: threeMonthPrice.id
    });

    // Create new price for 6-month subscription
    const sixMonthPrice = await stripe.prices.create({
      product: products.sixMonth,
      unit_amount: newPrices.sixMonth,
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 6
      }
    });

    await stripe.products.update(products.sixMonth, {
      default_price: sixMonthPrice.id
    });

    results.push({
      product: '6 Month',
      oldPrice: '$210.00',
      newPrice: '$209.99',
      priceId: sixMonthPrice.id
    });

    // Create new price for annual subscription
    const annualPrice = await stripe.prices.create({
      product: products.annual,
      unit_amount: newPrices.annual,
      currency: 'usd',
      recurring: {
        interval: 'year',
        interval_count: 1
      }
    });

    await stripe.products.update(products.annual, {
      default_price: annualPrice.id
    });

    results.push({
      product: 'Annual',
      oldPrice: '$350.00',
      newPrice: '$349.99',
      priceId: annualPrice.id
    });

    return Response.json({
      success: true,
      message: 'Stripe prices updated successfully',
      results
    });

  } catch (error) {
    console.error('Error updating Stripe prices:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});