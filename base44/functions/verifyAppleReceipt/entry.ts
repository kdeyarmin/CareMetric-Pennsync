import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { receiptData, password } = await req.json();

    if (!receiptData) {
      return Response.json(
        { error: 'Missing receipt data' },
        { status: 400 }
      );
    }

    const appleSecret = Deno.env.get('APPLE_SHARED_SECRET');
    if (!appleSecret) {
      return Response.json(
        { error: 'Apple configuration not found' },
        { status: 500 }
      );
    }

    // Apple's production endpoint
    const appleEndpoint = 'https://buy.itunes.apple.com/verifyReceipt';
    const sandboxEndpoint = 'https://sandbox.itunes.apple.com/verifyReceipt';

    let verifyResponse;
    try {
      // Try production first
      verifyResponse = await fetch(appleEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          'receipt-data': receiptData,
          password: appleSecret,
        }),
      });
    } catch (error) {
      console.error('Apple verification error:', error);
      return Response.json(
        { error: 'Failed to verify receipt with Apple' },
        { status: 500 }
      );
    }

    const result = await verifyResponse.json();

    // Status 0 = valid, 21007 = sandbox receipt, try again with sandbox
    if (result.status === 21007) {
      const sandboxResponse = await fetch(sandboxEndpoint, {
        method: 'POST',
        body: JSON.stringify({
          'receipt-data': receiptData,
          password: appleSecret,
        }),
      });
      const sandboxResult = await sandboxResponse.json();
      
      if (sandboxResult.status === 0) {
        return handleValidReceipt(base44, user, sandboxResult.receipt, true);
      }
    }

    if (result.status === 0) {
      return handleValidReceipt(base44, user, result.receipt, false);
    }

    return Response.json(
      { error: `Invalid receipt: status ${result.status}` },
      { status: 400 }
    );
  } catch (error) {
    console.error('Apple receipt verification error:', error);
    return Response.json(
      { error: error.message },
      { status: 500 }
    );
  }
});

async function handleValidReceipt(base44, user, receipt, isSandbox) {
  try {
    const now = new Date();
    const trialEndDate = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

    // Create subscription record
    const subscription = await base44.asServiceRole.entities.Subscription.create({
      user_email: user.email,
      status: 'trialing',
      plan_name: 'CareMetric AI - Apple IAP Trial',
      monthly_amount: 0, // Free trial
      trial_start: now.toISOString(),
      trial_end: trialEndDate.toISOString(),
      is_apple_iap: true,
      apple_receipt: isSandbox ? 'sandbox' : 'production',
      apple_bundle_id: receipt.bundle_id,
      current_period_start: now.toISOString(),
      current_period_end: trialEndDate.toISOString(),
    });

    return Response.json({
      success: true,
      subscription,
      message: '14-day free trial activated',
      trial_ends: trialEndDate.toISOString(),
    });
  } catch (error) {
    console.error('Failed to create subscription:', error);
    return Response.json(
      { error: 'Failed to activate trial' },
      { status: 500 }
    );
  }
}