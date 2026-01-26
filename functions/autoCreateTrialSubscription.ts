import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { user_email } = await req.json();

    if (!user_email) {
      return Response.json({ error: 'user_email is required' }, { status: 400 });
    }

    // Check if user already has a subscription
    const existingSubs = await base44.asServiceRole.entities.Subscription.filter({
      user_email
    });

    if (existingSubs.length > 0) {
      return Response.json({
        success: false,
        message: 'User already has a subscription'
      });
    }

    // Create 14-day trial subscription
    const trialEndDate = new Date();
    trialEndDate.setDate(trialEndDate.getDate() + 14);

    const subscription = await base44.asServiceRole.entities.Subscription.create({
      user_email,
      status: 'trialing',
      plan_name: '14-Day Free Trial',
      trial_start: new Date().toISOString(),
      trial_end: trialEndDate.toISOString(),
      monthly_amount: 0
    });

    console.log('Trial subscription created:', user_email);

    return Response.json({
      success: true,
      subscription,
      message: `14-day trial created for ${user_email}`
    });

  } catch (error) {
    console.error('Error creating trial:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});