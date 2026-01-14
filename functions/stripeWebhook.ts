import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@14.11.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});
const webhookSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');

Deno.serve(async (req) => {
  try {
    // Log webhook received
    console.log('Stripe webhook received:', new Date().toISOString());
    
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      console.error('No stripe-signature header found');
      return Response.json({ error: 'No signature header' }, { status: 400 });
    }

    if (!webhookSecret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured');
      return Response.json({ error: 'Webhook secret not configured' }, { status: 500 });
    }
    
    const body = await req.text();
    
    // Initialize base44 client BEFORE signature verification
    const base44 = createClientFromRequest(req);
    
    // Verify webhook signature using async method
    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
      console.log('Webhook signature verified, event type:', event.type);
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      return Response.json({ error: 'Invalid signature' }, { status: 400 });
    }

    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        
        // Skip if no subscription (payment mode instead of subscription mode)
        if (!session.subscription) {
          console.log('No subscription in session, skipping');
          break;
        }
        
        const subscription = await stripe.subscriptions.retrieve(session.subscription);
        
        // Create or update subscription record
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ 
          user_email: session.metadata.user_email 
        });
        
        const subscriptionData = {
          user_email: session.metadata.user_email,
          stripe_customer_id: session.customer,
          stripe_subscription_id: subscription.id,
          status: subscription.status,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          monthly_amount: subscription.items.data[0].price.unit_amount / 100
        };
        
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, subscriptionData);
        } else {
          await base44.asServiceRole.entities.Subscription.create(subscriptionData);
        }

        // Process referral rewards for paid subscriptions
        try {
          const users = await base44.asServiceRole.entities.User.filter({ 
            email: session.metadata.user_email 
          });
          
          if (users.length > 0 && users[0].referred_by) {
            const referredUser = users[0];
            
            // Find the referral record
            const referrals = await base44.asServiceRole.entities.Referral.filter({
              referred_user_id: referredUser.id,
              status: 'trial_started'
            });
            
            if (referrals.length > 0) {
              const referral = referrals[0];
              
              // Update referral status
              await base44.asServiceRole.entities.Referral.update(referral.id, {
                status: 'converted_to_paid',
                converted_to_paid_date: new Date().toISOString()
              });
              
              // Get referrer
              const referrers = await base44.asServiceRole.entities.User.filter({ 
                id: referral.referrer_id 
              });
              
              if (referrers.length > 0) {
                const referrer = referrers[0];
                
                // Apply $5 credit to referrer's Stripe customer
                const referrerSubs = await base44.asServiceRole.entities.Subscription.filter({
                  user_email: referrer.email
                });
                
                if (referrerSubs.length > 0) {
                  const referrerStripeCustomerId = referrerSubs[0].stripe_customer_id;
                  
                  // Add $5 credit to customer balance (negative balance = credit)
                  await stripe.customers.update(referrerStripeCustomerId, {
                    balance: (await stripe.customers.retrieve(referrerStripeCustomerId)).balance - 500 // $5 in cents
                  });
                  
                  // Update referral with reward info
                  await base44.asServiceRole.entities.Referral.update(referral.id, {
                    status: 'reward_issued',
                    reward_amount: 5,
                    reward_issued_date: new Date().toISOString()
                  });
                  
                  // Update referrer's total credits
                  await base44.asServiceRole.entities.User.update(referrer.id, {
                    total_referral_credits: (referrer.total_referral_credits || 0) + 5
                  });
                  
                  console.log(`Issued $5 credit to referrer ${referrer.email}`);
                }
              }
            }
          }
        } catch (referralError) {
          console.error('Referral processing error:', referralError);
          // Don't fail the webhook if referral processing fails
        }
        
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, {
            status: subscription.status,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end
          });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, {
            status: 'canceled'
          });
        }
        break;
      }

      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        
        // Record payment
        await base44.asServiceRole.entities.Payment.create({
          user_email: invoice.customer_email,
          stripe_payment_intent_id: invoice.payment_intent,
          stripe_invoice_id: invoice.id,
          amount: invoice.amount_paid / 100,
          currency: invoice.currency,
          status: 'succeeded',
          payment_date: new Date(invoice.created * 1000).toISOString(),
          period_start: new Date(invoice.period_start * 1000).toISOString(),
          period_end: new Date(invoice.period_end * 1000).toISOString()
        });
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const existingSubs = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: invoice.subscription 
        });
        
        if (existingSubs.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existingSubs[0].id, {
            status: 'past_due'
          });
        }
        break;
      }
    }

    console.log('Webhook processed successfully:', event.type);
    return Response.json({ received: true }, { status: 200 });
    
  } catch (error) {
    console.error('Webhook processing error:', error);
    // Still return 200 to acknowledge receipt even if processing fails
    return Response.json({ received: true, error: error.message }, { status: 200 });
  }
});