import Stripe from 'npm:stripe@15.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const payload = await req.json();
    const { price_id, set_active } = payload;

    if (!price_id) {
      console.error('Missing price_id in request');
      return Response.json(
        { success: false, error: 'price_id is required' },
        { status: 400 }
      );
    }

    // Get current status if not specified
    let targetStatus = set_active;
    if (targetStatus === undefined) {
      const currentPrice = await stripe.prices.retrieve(price_id);
      targetStatus = !currentPrice.active; // Toggle
    }

    console.log(`Setting price ${price_id} to active=${targetStatus}`);

    const updatedPrice = await stripe.prices.update(price_id, {
      active: targetStatus,
    });

    console.log(`Price ${price_id} updated successfully to active=${targetStatus}`);

    return Response.json({
      success: true,
      message: `Price ${targetStatus ? 'activated' : 'deactivated'} successfully`,
      price: updatedPrice,
    });
  } catch (error) {
    console.error('Error archiving price:', error.message);
    console.error('Full error:', error);

    return Response.json(
      {
        success: false,
        error: error.message || 'Failed to archive price',
        details: error.message,
      },
      { status: 500 }
    );
  }
});