import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe';

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const signature = req.headers.get('stripe-signature');
  const body = await req.text();

  let event;

  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.log(`Webhook signature verification failed.`);
    return new Response(err.message, { status: 400 });
  }

  const session = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const user_email = session.metadata.user_email;
      const stripe_customer_id = session.customer;
      const stripe_subscription_id = session.subscription;

      const { data: subscription } = await stripe.subscriptions.retrieve(stripe_subscription_id);
      const plan = subscription.items.data[0].price;

      const subData = {
        user_email,
        stripe_customer_id,
        stripe_subscription_id,
        status: subscription.status,
        plan_name: plan.nickname,
        monthly_amount: plan.unit_amount / 100,
        current_period_end: new Date(subscription.current_period_end * 1000).toISOString(),
        cancel_at_period_end: subscription.cancel_at_period_end,
      };

      const { data: existing } = await base44.asServiceRole.entities.Subscription.filter({ user_email });
      if (existing && existing.length > 0) {
        await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
      } else {
        await base44.asServiceRole.entities.Subscription.create(subData);
      }
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
        const { data: existing } = await base44.asServiceRole.entities.Subscription.filter({ stripe_subscription_id: session.id });
        if(existing && existing.length > 0) {
            const subData = {
                status: session.status,
                current_period_end: new Date(session.current_period_end * 1000).toISOString(),
                cancel_at_period_end: session.cancel_at_period_end,
            };
            await base44.asServiceRole.entities.Subscription.update(existing[0].id, subData);
        }
        break;
    }
  }

  return new Response(JSON.stringify({ received: true }), { status: 200 });
});