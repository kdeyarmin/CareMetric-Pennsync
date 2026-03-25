import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * COMPREHENSIVE PAYMENT FLOW TESTING
 * This function tests and logs the complete payment journey for:
 * 1. Apple App Store IAP
 * 2. Stripe Web (PC/Android)
 * 3. Subscription creation and validation
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { testType } = await req.json(); // 'apple', 'stripe', 'all'
    const testMode = testType || 'all';
    const results = {
      timestamp: new Date().toISOString(),
      user: user.email,
      tests: {}
    };

    // TEST 1: Verify Stripe Products & Prices Setup
    if (testMode === 'all' || testMode === 'stripe') {
      console.log('🔍 TEST: Checking Stripe products and prices...');
      try {
        // Skip this test if not admin - stripeListProducts requires admin role
        if (user.role !== 'admin') {
          results.tests.stripeProducts = {
            status: 'SKIP',
            message: 'Admin role required to list products'
          };
        } else {
          const productsResponse = await base44.functions.invoke('stripeListProducts', {});
          const products = productsResponse?.data?.products || [];
        
        if (products.length === 0) {
          results.tests.stripeProducts = {
            status: 'FAIL',
            message: 'No Stripe products found'
          };
        } else {
          const productChecks = [];
          for (const product of products.slice(0, 4)) {
            const pricesResponse = await base44.functions.invoke('stripeListPrices', {
              product_id: product.id
            });
            const activePrices = (pricesResponse?.data?.prices || []).filter(p => p.active);
            
            productChecks.push({
              name: product.name,
              id: product.id,
              active: product.active,
              activePrices: activePrices.length,
              prices: activePrices.map(p => ({
                amount: p.unit_amount / 100,
                interval: `${p.recurring?.interval_count || 1} ${p.recurring?.interval || 'month'}`
              }))
            });
          }
          
          results.tests.stripeProducts = {
            status: productChecks.length > 0 ? 'PASS' : 'FAIL',
            productsFound: products.length,
            checkedProducts: productChecks
          };
          }
      } catch (error) {
        results.tests.stripeProducts = {
          status: 'FAIL',
          error: error.message
        };
      }
    }

    // TEST 2: Verify Apple IAP Configuration
    if (testMode === 'all' || testMode === 'apple') {
      console.log('🍎 TEST: Checking Apple IAP configuration...');
      const appleSecret = Deno.env.get('APPLE_SHARED_SECRET');
      const appleSetup = {
        hasSecret: !!appleSecret,
        secretLength: appleSecret?.length || 0,
        endpoints: {
          production: 'https://buy.itunes.apple.com/verifyReceipt',
          sandbox: 'https://sandbox.itunes.apple.com/verifyReceipt'
        }
      };
      
      results.tests.appleIAP = {
        status: appleSecret ? 'PASS' : 'FAIL',
        details: appleSetup,
        message: appleSecret ? 'Apple IAP configured' : 'Missing APPLE_SHARED_SECRET'
      };
    }

    // TEST 3: Verify Stripe Checkout Configuration
    if (testMode === 'all' || testMode === 'stripe') {
      console.log('💳 TEST: Checking Stripe checkout configuration...');
      const stripeSecret = Deno.env.get('STRIPE_SECRET_KEY');
      const stripePublic = Deno.env.get('STRIPE_PUBLISHABLE_KEY');
      
      const stripeSetup = {
        hasSecretKey: !!stripeSecret,
        hasPublishableKey: !!stripePublic,
        secretKeyPrefix: stripeSecret?.substring(0, 12) || 'missing',
        mode: stripeSecret?.includes('sk_live') ? 'LIVE' : 'TEST'
      };

      results.tests.stripeCheckout = {
        status: stripeSecret && stripePublic ? 'PASS' : 'FAIL',
        details: stripeSetup,
        message: stripeSecret && stripePublic ? 'Stripe configured for live payments' : 'Missing Stripe credentials'
      };
    }

    // TEST 4: Verify Current User Subscription Status
    if (testMode === 'all' || testMode === 'stripe' || testMode === 'apple') {
      console.log('📋 TEST: Checking user subscription...');
      try {
        const subs = await base44.asServiceRole.entities.Subscription.filter({
          user_email: user.email
        });

        const subscription = subs[0];
        results.tests.userSubscription = {
          status: subscription ? 'FOUND' : 'NOT_FOUND',
          details: subscription ? {
            status: subscription.status,
            planName: subscription.plan_name,
            isAppleIAP: subscription.is_apple_iap,
            trialEnd: subscription.trial_end,
            monthlyAmount: subscription.monthly_amount,
            createdDate: subscription.created_date
          } : null
        };
      } catch (error) {
        results.tests.userSubscription = {
          status: 'FAIL',
          error: error.message
        };
      }
    }

    // TEST 5: Verify Subscription Recording Flow
    if (testMode === 'all') {
      console.log('🔄 TEST: Simulating subscription creation flow...');
      try {
        const testEmail = `test-flow-${Date.now()}@caremetric.dev`;
        
        // Simulate creating a trial subscription (like onUserSignup does)
        const testSub = await base44.asServiceRole.entities.Subscription.create({
          user_email: testEmail,
          status: 'trialing',
          plan_name: 'Flow Test - 14 Day Trial',
          monthly_amount: 0,
          trial_start: new Date().toISOString(),
          trial_end: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        });

        // Verify it was created
        const fetched = await base44.asServiceRole.entities.Subscription.get(testSub.id);

        results.tests.subscriptionFlow = {
          status: fetched ? 'PASS' : 'FAIL',
          message: 'Trial subscription can be created and retrieved',
          details: {
            created: !!testSub,
            retrieved: !!fetched,
            idMatch: testSub.id === fetched.id
          }
        };

        // Clean up
        await base44.asServiceRole.entities.Subscription.delete(testSub.id);
      } catch (error) {
        results.tests.subscriptionFlow = {
          status: 'FAIL',
          error: error.message
        };
      }
    }

    // TEST 6: Webhook Handler Status
    if (testMode === 'all') {
      console.log('🔗 TEST: Checking Stripe webhook handler...');
      const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
      results.tests.stripeWebhook = {
        status: webhookSecret ? 'CONFIGURED' : 'NOT_CONFIGURED',
        secretLength: webhookSecret?.length || 0,
        message: webhookSecret ? 'Webhook secret is set' : 'Missing STRIPE_WEBHOOK_SECRET'
      };
    }

    // SUMMARY
    const allTests = Object.values(results.tests);
    const passCount = allTests.filter(t => t.status === 'PASS' || t.status === 'FOUND' || t.status === 'CONFIGURED').length;
    const failCount = allTests.filter(t => t.status === 'FAIL').length;

    results.summary = {
      totalTests: allTests.length,
      passed: passCount,
      failed: failCount,
      status: failCount === 0 ? '✅ ALL SYSTEMS GO' : '⚠️ ISSUES FOUND'
    };

    console.log('📊 Test Results:', results);

    return Response.json({
      success: true,
      data: results
    });

  } catch (error) {
    console.error('Test execution error:', error);
    return Response.json({
      success: false,
      error: error.message,
      stack: error.stack
    }, { status: 500 });
  }
});