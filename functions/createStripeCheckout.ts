import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe';

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY"));

Deno.serve(async (req) => {
  const { priceId } = await req.json();
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  const YOUR_DOMAIN = req.headers.get('origin');

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: `${YOUR_DOMAIN}/app/PaymentSuccess`,
      cancel_url: `${YOUR_DOMAIN}/app/SubscriptionPlans`,
      customer_email: user.email,
      metadata: {
        user_email: user.email
      }
    });

    return new Response(JSON.stringify({ sessionId: session.id, url: session.url }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});