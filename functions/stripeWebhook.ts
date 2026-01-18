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
          status: subscription.status,
          plan_name: plan.nickname || 'Unknown Plan',
          monthly_amount: plan.unit_amount / 100,
          current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
          cancel_at_period_end: subscription.cancel_at_period_end,
        };

        const existing = await base44.asServiceRole.entities.Subscription.filter({ user_email });
        if (existing && existing.length > 0) {
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
          console.log('[stripeWebhook] Updated subscription:', existing[0].id);
        } else {
          await base44.asServiceRole.entities.Subscription.create(subData);
          console.log('[stripeWebhook] Created subscription for:', user_email);
        }

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
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const existing = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: session.id });
        if (existing && existing.length > 0) {
          const subData = {
            status: session.status,
            current_period_end: new Date(session.current_period_end * 1000).toISOString(),
            cancel_at_period_end: session.cancel_at_period_end,
          };
          await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
          console.log('[stripeWebhook] Updated subscription status:', session.status);
        } else {
          console.warn('[stripeWebhook] Subscription not found:', session.id);
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