import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe';

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  try {
    const signature = req.headers.get('stripe-signature');
    if (!signature) {
      console.error('[stripeWebhook] Missing stripe-signature header');
      return Response.json({ received: true }, { status: 200 });
    }

    const body = await req.text();
    if (!body) {
      console.error('[stripeWebhook] Empty request body');
      return Response.json({ received: true }, { status: 200 });
    }

    const base44 = createClientFromRequest(req);

    let event;
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
    } catch (err) {
      console.error('[stripeWebhook] Signature verification failed:', err.message);
      return Response.json({ received: true }, { status: 200 });
    }

    const session = event.data.object;

    console.log('[stripeWebhook] Processing event:', event.type, session.id);

    // Helper to add webhook event to subscription log
    const logWebhookEvent = async (subscriptionId, eventType, details) => {
      try {
        const sub = await base44.asServiceRole.entities.Subscription.get(subscriptionId);
        const webhookEvents = sub.webhook_events || [];
        webhookEvents.push({
          event_type: eventType,
          timestamp: new Date().toISOString(),
          details
        });
        await base44.asServiceRole.entities.Subscription.update(subscriptionId, {
          webhook_events: webhookEvents.slice(-50) // Keep last 50 events
        });
      } catch (error) {
        console.error('[stripeWebhook] Failed to log event:', error);
      }
    };

    switch (event.type) {
      case 'checkout.session.completed': {
        const user_email = session.metadata?.user_email;

        if (!user_email) {
          console.error('[stripeWebhook] Missing user_email in metadata:', session.id);
          break;
        }
        const stripe_customer_id = session.customer;
        const stripe_subscription_id = session.subscription;

        if (!stripe_subscription_id) {
          console.error('[stripeWebhook] Missing subscription ID:', session.id);
          break;
        }

        const subscription = await stripe.subscriptions.retrieve(stripe_subscription_id);
        const plan = subscription.items.data[0].price;

        const subData = {
          user_email,
          stripe_customer_id,
          stripe_subscription_id,
          stripe_price_id: plan.id,
          status: subscription.status,
          plan_name: plan.nickname || 'Unknown Plan',
          monthly_amount: plan.unit_amount / 100,
          current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
          trial_start: subscription.trial_start ? new Date(subscription.trial_start * 1000).toISOString() : null,
          trial_end: subscription.trial_end ? new Date(subscription.trial_end * 1000).toISOString() : null,
        };

        const existing = await base44.asServiceRole.entities.Subscription.filter({ user_email });
        let subscriptionId;
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
          subscriptionId = existing[0].id;
          console.log('[stripeWebhook] Updated subscription:', existing[0].id);
        } else {
          const created = await base44.asServiceRole.entities.Subscription.create(subData);
          subscriptionId = created.id;
          console.log('[stripeWebhook] Created subscription for:', user_email);
        }

        await logWebhookEvent(subscriptionId, 'checkout.session.completed', {
          subscription_id: stripe_subscription_id,
          plan: plan.nickname,
          amount: plan.unit_amount / 100
        });

        // Send thank you email for new active subscription
        if (subscription.status === 'active') {
          try {
            await base44.asServiceRole.functions.invoke('sendSubscriptionThankYou', {
              user_email,
              plan_name: plan.nickname || 'CareMetric AI',
              amount: plan.unit_amount
            });
            console.log('[stripeWebhook] Thank you email sent to:', user_email);
          } catch (emailError) {
            console.error('[stripeWebhook] Failed to send thank you email:', emailError);
          }
        }
        break;
      }
      
      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const existing = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existing && existing.length > 0) {
          const plan = subscription.items.data[0].price;
          const subData = {
            status: subscription.status,
            stripe_price_id: plan.id,
            plan_name: plan.nickname || 'Unknown Plan',
            monthly_amount: plan.unit_amount / 100,
            current_period_start: new Date(subscription.current_period_start * 1000).toISOString(),
            current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
            cancel_at_period_end: subscription.cancel_at_period_end,
            canceled_at: subscription.canceled_at ? new Date(subscription.canceled_at * 1000).toISOString() : null,
          };
          
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
          await logWebhookEvent(existing[0].id, 'customer.subscription.updated', {
            status: subscription.status,
            cancel_at_period_end: subscription.cancel_at_period_end
          });
          
          console.log('[stripeWebhook] Subscription updated:', subscription.status);
          
          // Send notification if subscription is being canceled
          if (subscription.cancel_at_period_end && !existing[0].cancel_at_period_end) {
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: existing[0].user_email,
                subject: "Subscription Cancellation Confirmed",
                body: `Your subscription will be canceled at the end of the current billing period (${new Date(subscription.current_period_end * 1000).toLocaleDateString()}).`
              });
              console.log('[stripeWebhook] Cancellation email sent');
            } catch (emailError) {
              console.error('[stripeWebhook] Failed to send cancellation email:', emailError);
            }
          }
        } else {
          console.warn('[stripeWebhook] Subscription not found for update:', subscription.id);
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const existing = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, {
            status: 'canceled',
            canceled_at: new Date().toISOString()
          });
          
          await logWebhookEvent(existing[0].id, 'customer.subscription.deleted', {
            canceled_at: new Date().toISOString()
          });
          
          console.log('[stripeWebhook] Subscription deleted/canceled');
          
          // Send final cancellation email
          try {
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: existing[0].user_email,
              subject: "Subscription Canceled",
              body: "Your CareMetric AI subscription has been canceled. We're sorry to see you go! You can resubscribe anytime from your account settings."
            });
            console.log('[stripeWebhook] Final cancellation email sent');
          } catch (emailError) {
            console.error('[stripeWebhook] Failed to send final email:', emailError);
          }
        } else {
          console.warn('[stripeWebhook] Subscription not found for deletion:', subscription.id);
        }
        break;
      }
      
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        
        // Handle user subscription payments
        if (invoice.subscription) {
          const existing = await base44.asServiceRole.entities.Subscription.filter({ 
            stripe_subscription_id: invoice.subscription 
          });
          
          if (existing && existing.length > 0) {
            await base44.asServiceRole.entities.Subscription.update(existing[0].id, {
              status: 'active',
              last_payment_date: new Date(invoice.created * 1000).toISOString(),
              last_payment_amount: invoice.amount_paid / 100,
              failed_payment_count: 0 // Reset failed count on success
            });
            
            await logWebhookEvent(existing[0].id, 'invoice.payment_succeeded', {
              amount: invoice.amount_paid / 100,
              invoice_id: invoice.id
            });
            
            console.log('[stripeWebhook] Payment succeeded:', invoice.amount_paid / 100);
          }
        }
        
        // Handle agency subscription payments
        const agencies = await base44.asServiceRole.entities.Agency.filter({ 
          stripe_subscription_id: invoice.subscription 
        });
        
        if (agencies.length > 0) {
          const agency = agencies[0];
          await base44.asServiceRole.entities.Agency.update(agency.id, {
            status: 'active',
            total_billed_amount: (agency.total_billed_amount || 0) + (invoice.amount_paid / 100),
            last_billing_date: new Date(invoice.created * 1000).toISOString().split('T')[0],
            next_billing_date: new Date((invoice.period_end || invoice.created + 2592000) * 1000).toISOString().split('T')[0]
          });
          console.log('[stripeWebhook] Agency payment recorded:', agency.agency_name, invoice.amount_paid / 100);
        }
        break;
      }
      
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        
        // Handle user subscription payment failures
        if (invoice.subscription) {
          const existing = await base44.asServiceRole.entities.Subscription.filter({ 
            stripe_subscription_id: invoice.subscription 
          });
          
          if (existing && existing.length > 0) {
            const failedCount = (existing[0].failed_payment_count || 0) + 1;
            
            await base44.asServiceRole.entities.Subscription.update(existing[0].id, {
              status: 'past_due',
              failed_payment_count: failedCount,
              last_failed_payment_date: new Date().toISOString()
            });
            
            await logWebhookEvent(existing[0].id, 'invoice.payment_failed', {
              amount: invoice.amount_due / 100,
              attempt_count: failedCount,
              invoice_id: invoice.id
            });
            
            console.log('[stripeWebhook] Payment failed, attempt:', failedCount);
            
            // Send alert email on payment failure
            try {
              await base44.asServiceRole.integrations.Core.SendEmail({
                to: existing[0].user_email,
                subject: "Payment Failed - Action Required",
                body: `Your recent payment of $${(invoice.amount_due / 100).toFixed(2)} failed. Please update your payment method to avoid service interruption. Attempt ${failedCount}.`
              });
              console.log('[stripeWebhook] Payment failure email sent');
            } catch (emailError) {
              console.error('[stripeWebhook] Failed to send payment failure email:', emailError);
            }
          }
        }
        
        // Handle failed agency payments
        const agencies = await base44.asServiceRole.entities.Agency.filter({ 
          stripe_subscription_id: invoice.subscription 
        });
        
        if (agencies.length > 0) {
          const agency = agencies[0];
          await base44.asServiceRole.entities.Agency.update(agency.id, {
            status: 'suspended'
          });
          console.log('[stripeWebhook] Agency payment failed, suspended:', agency.agency_name);
        }
        break;
      }
      
      case 'customer.subscription.trial_will_end': {
        const subscription = event.data.object;
        const existing = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existing && existing.length > 0) {
          await logWebhookEvent(existing[0].id, 'customer.subscription.trial_will_end', {
            trial_end: new Date(subscription.trial_end * 1000).toISOString()
          });
          
          // Send trial ending reminder
          try {
            const trialEndDate = new Date(subscription.trial_end * 1000).toLocaleDateString();
            await base44.asServiceRole.integrations.Core.SendEmail({
              to: existing[0].user_email,
              subject: "Your Trial is Ending Soon",
              body: `Your CareMetric AI trial will end on ${trialEndDate}. Make sure your payment method is up to date to continue enjoying uninterrupted access!`
            });
            console.log('[stripeWebhook] Trial ending reminder sent');
          } catch (emailError) {
            console.error('[stripeWebhook] Failed to send trial reminder:', emailError);
          }
        }
        break;
      }
      
      case 'customer.subscription.paused': {
        const subscription = event.data.object;
        const existing = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, {
            status: 'paused'
          });
          
          await logWebhookEvent(existing[0].id, 'customer.subscription.paused', {
            paused_at: new Date().toISOString()
          });
          
          console.log('[stripeWebhook] Subscription paused');
        }
        break;
      }
      
      case 'customer.subscription.resumed': {
        const subscription = event.data.object;
        const existing = await base44.asServiceRole.entities.Subscription.filter({ 
          stripe_subscription_id: subscription.id 
        });
        
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, {
            status: subscription.status
          });
          
          await logWebhookEvent(existing[0].id, 'customer.subscription.resumed', {
            resumed_at: new Date().toISOString()
          });
          
          console.log('[stripeWebhook] Subscription resumed');
        }
        break;
      }
      case 'invoice.payment_succeeded': {
        // Handle agency subscription payments
        const invoice = event.data.object;
        const agencies = await base44.asServiceRole.entities.Agency.filter({ 
          stripe_subscription_id: invoice.subscription 
        });
        
        if (agencies.length > 0) {
          const agency = agencies[0];
          await base44.asServiceRole.entities.Agency.update(agency.id, {
            status: 'active',
            total_billed_amount: (agency.total_billed_amount || 0) + (invoice.amount_paid / 100),
            last_billing_date: new Date(invoice.created * 1000).toISOString().split('T')[0],
            next_billing_date: new Date((invoice.period_end || invoice.created + 2592000) * 1000).toISOString().split('T')[0]
          });
          console.log('[stripeWebhook] Agency payment recorded:', agency.agency_name, invoice.amount_paid / 100);
        }
        break;
      }
      case 'invoice.payment_failed': {
        // Handle failed agency payments
        const invoice = event.data.object;
        const agencies = await base44.asServiceRole.entities.Agency.filter({ 
          stripe_subscription_id: invoice.subscription 
        });
        
        if (agencies.length > 0) {
          const agency = agencies[0];
          await base44.asServiceRole.entities.Agency.update(agency.id, {
            status: 'suspended'
          });
          console.log('[stripeWebhook] Agency payment failed, suspended:', agency.agency_name);
        }
        break;
      }
      default:
        console.log('[stripeWebhook] Unhandled event type:', event.type);
    }

    return Response.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error('[stripeWebhook] Error:', {
      message: error.message,
      stack: error.stack
    });
    return Response.json({ received: true }, { status: 200 });
  }
});