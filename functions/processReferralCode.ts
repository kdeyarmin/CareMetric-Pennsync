import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Authenticate user
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { referral_code } = await req.json();
    
    if (!referral_code) {
      return Response.json({ error: 'Referral code is required' }, { status: 400 });
    }

    // Check if user already has a referrer
    if (user.referred_by) {
      return Response.json({ 
        error: 'You have already used a referral code' 
      }, { status: 400 });
    }

    // Find the referrer by code
    const referrers = await base44.asServiceRole.entities.User.filter({ 
      referral_code: referral_code.toUpperCase() 
    });
    
    if (referrers.length === 0) {
      return Response.json({ 
        error: 'Invalid referral code' 
      }, { status: 404 });
    }
    
    const referrer = referrers[0];
    
    // Can't refer yourself
    if (referrer.id === user.id) {
      return Response.json({ 
        error: 'You cannot use your own referral code' 
      }, { status: 400 });
    }
    
    // Update user with referrer info
    await base44.asServiceRole.entities.User.update(user.id, {
      referred_by: referrer.id
    });
    
    // Create referral record
    await base44.asServiceRole.entities.Referral.create({
      referrer_id: referrer.id,
      referrer_email: referrer.email,
      referred_user_id: user.id,
      referred_user_email: user.email,
      referral_code_used: referral_code.toUpperCase(),
      status: 'trial_started'
    });
    
    return Response.json({ 
      success: true,
      message: 'Referral code applied successfully',
      referrer_name: referrer.full_name
    });
    
  } catch (error) {
    console.error('Referral processing error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});