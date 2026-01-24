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

    const agencyData = await req.json();

    // Generate unique agency code
    const code = `AG${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    // Create Stripe customer for the agency
    const customer = await stripe.customers.create({
      name: agencyData.agency_name,
      email: agencyData.contact_email || agencyData.admin_email,
      phone: agencyData.contact_phone,
      metadata: {
        agency_code: code,
        base44_app_id: Deno.env.get('BASE44_APP_ID')
      }
    });

    console.log('Created Stripe customer:', customer.id);

    let stripeSubscriptionId = null;
    let stripePriceId = null;

    // Create usage-based subscription if auto billing is enabled
    if (agencyData.auto_billing_enabled !== false) {
      // First, create a metered price for this agency
      const price = await stripe.prices.create({
        currency: 'usd',
        unit_amount: Math.round((agencyData.price_per_user || 29.99) * 100),
        recurring: {
          interval: 'month',
          usage_type: 'metered'
        },
        product_data: {
          name: `${agencyData.agency_name} - User Seats`,
          metadata: {
            agency_code: code
          }
        },
        metadata: {
          agency_code: code,
          base44_app_id: Deno.env.get('BASE44_APP_ID')
        }
      });

      stripePriceId = price.id;
      console.log('Created Stripe price:', price.id);

      // Create subscription with metered billing
      const subscription = await stripe.subscriptions.create({
        customer: customer.id,
        items: [{
          price: price.id
        }],
        metadata: {
          agency_code: code,
          base44_app_id: Deno.env.get('BASE44_APP_ID')
        }
      });

      stripeSubscriptionId = subscription.id;
      console.log('Created Stripe subscription:', subscription.id);
    }

    // Calculate next billing date (30 days from now)
    const nextBillingDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0];

    // Create agency in database
    const agency = await base44.asServiceRole.entities.Agency.create({
      ...agencyData,
      agency_code: code,
      current_user_count: 0,
      stripe_customer_id: customer.id,
      stripe_subscription_id: stripeSubscriptionId,
      stripe_price_id: stripePriceId,
      next_billing_date: nextBillingDate,
      auto_billing_enabled: agencyData.auto_billing_enabled !== false
    });

    console.log('Created agency:', agency.id);

    // Create initial AgencySettings if compliance/style preferences were provided
    if (agencyData.custom_compliance_rules || agencyData.custom_documentation_style) {
      await base44.asServiceRole.entities.AgencySettings.create({
        agency_code: code,
        office_name: agencyData.agency_name,
        custom_compliance_rules: agencyData.custom_compliance_rules || "",
        custom_documentation_style: agencyData.custom_documentation_style || "",
        agency_manager_email: agencyData.admin_email
      });
    }

    // Send invitations to initial users if provided
    if (agencyData.initial_users && agencyData.initial_users.length > 0) {
      for (const email of agencyData.initial_users) {
        try {
          await base44.asServiceRole.users.inviteUser(email, 'user');
          await base44.asServiceRole.integrations.Core.SendEmail({
            to: email,
            subject: `Join ${agencyData.agency_name} on CareMetric AI`,
            body: `You've been invited to join ${agencyData.agency_name} on CareMetric AI.\n\nYour agency code is: ${code}\n\nAfter you sign up, go to Settings and enter this code to join the agency.\n\nGet started: ${Deno.env.get('BASE44_APP_URL') || 'https://app.base44.com'}`
          });
        } catch (inviteError) {
          console.error('Failed to invite user:', email, inviteError);
        }
      }
    }

    return Response.json({
      success: true,
      agency,
      stripe_customer_id: customer.id,
      stripe_subscription_id: stripeSubscriptionId
    });

  } catch (error) {
    console.error('Create agency with Stripe error:', error);
    return Response.json({ 
      success: false,
      error: error.message 
    }, { status: 500 });
  }
});