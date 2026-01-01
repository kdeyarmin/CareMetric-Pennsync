import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { receiptData, productId, transactionId, purchaseDate, expiryDate } = await req.json();

    if (!receiptData || !productId || !transactionId) {
      return Response.json({ 
        error: 'Missing required fields: receiptData, productId, transactionId' 
      }, { status: 400 });
    }

    // Verify receipt with Apple
    const appleResponse = await verifyWithApple(receiptData);

    if (!appleResponse.valid) {
      return Response.json({ 
        success: false,
        error: 'Invalid receipt' 
      }, { status: 400 });
    }

    // Map product ID to plan
    const planMap = {
      'com.caremetric.monthly': { name: 'monthly', amount: 39.99, interval: 1 },
      'com.caremetric.quarterly': { name: 'quarterly', amount: 114.99, interval: 3 },
      'com.caremetric.semiannual': { name: 'semiannual', amount: 209.99, interval: 6 },
      'com.caremetric.annual': { name: 'annual', amount: 349.99, interval: 12 }
    };

    const plan = planMap[productId];
    if (!plan) {
      return Response.json({ error: 'Invalid product ID' }, { status: 400 });
    }

    // Calculate period dates
    const startDate = new Date(purchaseDate);
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + plan.interval);

    // Check for existing subscription
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({
      user_email: user.email
    });

    if (existingSubs.length > 0) {
      // Update existing subscription
      await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, {
        status: 'active',
        plan: plan.name,
        monthly_amount: plan.amount,
        current_period_start: startDate.toISOString(),
        current_period_end: endDate.toISOString(),
        stripe_subscription_id: transactionId,
        cancel_at_period_end: false
      });
    } else {
      // Create new subscription
      await base44.asServiceRole.entities.Subscription.create({
        user_email: user.email,
        status: 'active',
        plan: plan.name,
        monthly_amount: plan.amount,
        current_period_start: startDate.toISOString(),
        current_period_end: endDate.toISOString(),
        stripe_subscription_id: transactionId,
        stripe_customer_id: user.email,
        cancel_at_period_end: false
      });
    }

    return Response.json({
      success: true,
      message: 'Subscription activated',
      plan: plan.name,
      expiresAt: endDate.toISOString()
    });
  } catch (error) {
    console.error('Apple receipt verification error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});

async function verifyWithApple(receiptData) {
  const isProduction = Deno.env.get('DENO_ENV') === 'production';
  const verifyURL = isProduction 
    ? 'https://buy.itunes.apple.com/verifyReceipt'
    : 'https://sandbox.itunes.apple.com/verifyReceipt';

  try {
    const response = await fetch(verifyURL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        'receipt-data': receiptData,
        'password': Deno.env.get('APPLE_SHARED_SECRET') || '',
        'exclude-old-transactions': true
      })
    });

    const data = await response.json();
    
    // Status 0 = valid, 21007 = sandbox receipt sent to production (retry with sandbox)
    if (data.status === 0) {
      return { valid: true, receipt: data.receipt };
    } else if (data.status === 21007 && isProduction) {
      // Retry with sandbox
      return verifyWithApple(receiptData);
    }
    
    return { valid: false, error: `Status ${data.status}` };
  } catch (error) {
    console.error('Apple verification failed:', error);
    return { valid: false, error: error.message };
  }
}