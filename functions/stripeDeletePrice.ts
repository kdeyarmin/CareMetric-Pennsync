import Stripe from 'npm:stripe@15.0.0';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY'));

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const payload = await req.json();
    const { price_id } = payload;

    if (!price_id) {
      console.error('Missing price_id in request');
      return Response.json(
        { success: false, error: 'price_id is required' },
        { status: 400 }
      );
    }

    console.log(`Attempting to delete price: ${price_id}`);

    // Archive the price instead of deleting (Stripe best practice)
    const updatedPrice = await stripe.prices.update(price_id, {
      active: false,
    });

    console.log(`Price ${price_id} archived successfully`);

    return Response.json({
      success: true,
      message: 'Price archived successfully (marked as inactive)',
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