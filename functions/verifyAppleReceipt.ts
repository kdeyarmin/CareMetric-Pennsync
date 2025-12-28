import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Verify Apple IAP receipt and update subscription status
 * This endpoint is called by the iOS/macOS app after a successful purchase
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { receiptData, productId, transactionId, purchaseDate, expiryDate } = await req.json();

    if (!receiptData || !productId) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // In production, verify receipt with Apple's server
    // For now, we'll trust the data from the native app
    // The native app should already have verified it with StoreKit

    // Map product ID to interval
    const productIntervals = {
      'com.monthly.premium': { months: 1, label: 'Monthly' },
      'com.quarterly.premium': { months: 3, label: 'Quarterly' },
      'com.semiannual.premium': { months: 6, label: 'Semi-Annual' },
      'com.annual.premium': { months: 12, label: 'Annual' }
    };

    const interval = productIntervals[productId];
    if (!interval) {
      return Response.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    // Create or update subscription record
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ 
      user_email: user.email 
    });

    const subscriptionData = {
      user_email: user.email,
      stripe_customer_id: `apple_${user.email}`, // Use apple prefix for IAP
      stripe_subscription_id: transactionId || `apple_${Date.now()}`,
      status: 'active',
      current_period_start: purchaseDate || new Date().toISOString(),
      current_period_end: expiryDate || new Date(Date.now() + interval.months * 30 * 24 * 60 * 60 * 1000).toISOString(),
      cancel_at_period_end: false,
      monthly_amount: 0 // IAP amount handled by Apple
    };

    if (existingSubs.length > 0) {
      await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, subscriptionData);
    } else {
      await base44.asServiceRole.entities.Subscription.create(subscriptionData);
    }

    // Log the purchase
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'apple_iap_purchase',
      details: {
        product_id: productId,
        transaction_id: transactionId,
        interval: interval.label
      },
      page: 'subscription'
    });

    return Response.json({ 
      success: true,
      subscription: subscriptionData
    });

  } catch (error) {
    console.error('Apple receipt verification error:', error);
    return Response.json({ 
      error: 'Failed to verify receipt', 
      details: error.message 
    }, { status: 500 });
  }
});