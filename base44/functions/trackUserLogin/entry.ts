import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// <<<BEGIN SHARED HELPER: requireActiveUser — generated, edit base44/_shared/backendHelpers.mjs>>>
const isDeactivatedUser = (u) => !!u && u.is_active === false;
const DEACTIVATED_USER_RESPONSE = () => Response.json(
  { error: 'Unauthorized - account is deactivated' },
  { status: 403 },
);
// <<<END SHARED HELPER: requireActiveUser>>>


Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (isDeactivatedUser(user)) return DEACTIVATED_USER_RESPONSE();
    if (!user) {
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

    return Response.json({ success: true });
  } catch (error) {
    console.error('trackUserLogin failed:', error);
    return Response.json({ error: 'Internal server error' }, { status: 500 });
  }
});