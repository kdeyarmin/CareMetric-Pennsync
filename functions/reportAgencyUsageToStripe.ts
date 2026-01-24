import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import Stripe from 'npm:stripe@17.5.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'), {
  apiVersion: '2024-12-18.acacia'
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin only' }, { status: 403 });
    }

    const { agency_id } = await req.json();

    // Get agency
    const agency = await base44.asServiceRole.entities.Agency.get(agency_id);

    if (!agency) {
      return Response.json({ error: 'Agency not found' }, { status: 404 });
    }

    if (!agency.auto_billing_enabled || !agency.stripe_subscription_id) {
      return Response.json({ 
        success: false,
        message: 'Auto billing not enabled for this agency' 
      });
    }

    // Get all users in agency
    const allUsers = await base44.asServiceRole.entities.User.list();
    const agencyUsers = allUsers.filter(u => u.agency_code === agency.agency_code);
    const userCount = agencyUsers.length;

    // Update agency user count
    await base44.asServiceRole.entities.Agency.update(agency.id, {
      current_user_count: userCount
    });

    // Get subscription
    const subscription = await stripe.subscriptions.retrieve(agency.stripe_subscription_id);
    const subscriptionItemId = subscription.items.data[0].id;

    // Report usage to Stripe (idempotent with timestamp)
    const timestamp = Math.floor(Date.now() / 1000);
    const usageRecord = await stripe.subscriptionItems.createUsageRecord(
      subscriptionItemId,
      {
        quantity: userCount,
        timestamp: timestamp,
        action: 'set' // 'set' replaces the current usage
      }
    );

    console.log('Reported usage to Stripe:', {
      agency: agency.agency_name,
      users: userCount,
      usage_record: usageRecord.id
    });

    return Response.json({
      success: true,
      agency_name: agency.agency_name,
      user_count: userCount,
      stripe_usage_record_id: usageRecord.id,
      estimated_monthly_cost: userCount * agency.price_per_user
    });

  } catch (error) {
    console.error('Report usage error:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});