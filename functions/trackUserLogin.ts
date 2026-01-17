import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let user;
  try {
    const base44 = createClientFromRequest(req);
    
    user = await base44.auth.me();
    if (!user) {
      console.error('[trackUserLogin] Unauthorized access attempt');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Log login activity
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'login',
      details: {
        login_time: new Date().toISOString(),
        user_role: user.role
      },
      page: 'login',
      user_agent: req.headers.get('user-agent') || 'unknown'
    });

    console.log('[trackUserLogin] Login tracked for user:', user.email);

    return Response.json({ success: true });
  } catch (error) {
    console.error('[trackUserLogin] Error:', {
      message: error.message,
      stack: error.stack,
      userEmail: user?.email
    });
    return Response.json({ 
      error: 'Failed to track user login',
      details: error.message 
    }, { status: 500 });
  }
});