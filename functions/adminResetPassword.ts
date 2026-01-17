import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  let adminUser;
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    adminUser = await base44.auth.me();
    if (!adminUser || adminUser.role !== 'admin') {
      console.warn('[adminResetPassword] Unauthorized access attempt by user:', adminUser?.email);
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { user_email, new_password } = body;

    if (!user_email || !new_password) {
      console.error('[adminResetPassword] Missing required fields');
      return Response.json({ error: 'user_email and new_password are required' }, { status: 400 });
    }

    // Validate password strength
    if (new_password.length < 8) {
      console.error('[adminResetPassword] Password too short');
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Get user by email
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    if (users.length === 0) {
      console.warn('[adminResetPassword] Target user not found:', user_email);
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const targetUser = users[0];

    // Use Base44's auth API to reset password
    const serviceRoleKey = Deno.env.get('BASE44_SERVICE_ROLE_KEY');
    if (!serviceRoleKey) {
      console.error('[adminResetPassword] BASE44_SERVICE_ROLE_KEY not set');
      return Response.json({ error: 'Server configuration error' }, { status: 500 });
    }
    
    const response = await fetch(`https://api.base44.com/v1/auth/admin/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${serviceRoleKey}`
      },
      body: JSON.stringify({
        app_id: Deno.env.get('BASE44_APP_ID'),
        user_id: targetUser.id,
        new_password: new_password
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[adminResetPassword] Failed to reset password via API:', response.status, errorText);
      return Response.json({ error: 'Failed to reset password', details: errorText }, { status: 500 });
    }

    // Log the password reset action in both SecurityLog and AuditTrail
    await base44.asServiceRole.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: adminUser.email,
      user_role: 'admin',
      action: 'PASSWORD_RESET',
      details: {
        target_user: user_email,
        reset_by: adminUser.email
      }
    });

    // Detailed audit trail entry
    await base44.asServiceRole.entities.AuditTrail.create({
      timestamp: new Date().toISOString(),
      user_email: adminUser.email,
      user_role: 'admin',
      action_type: 'PASSWORD_RESET',
      action_description: `Admin ${adminUser.email} reset password for ${user_email}`,
      target_entity_type: 'User',
      target_entity_id: targetUser.id,
      target_identifier: user_email,
      change_details: {
        reset_by: adminUser.email,
        reset_method: 'admin_override'
      }
    });

    // Send email notification to user
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: user_email,
      subject: 'Your Password Has Been Reset',
      body: `Your password for CareMetric AI has been reset by an administrator.

New Password: ${new_password}

Please log in with this password and change it immediately in your Settings.

If you did not request this reset, please contact your administrator immediately.`,
      from_name: 'CareMetric AI Admin'
    });

    console.log('[adminResetPassword] Password reset successfully for:', user_email);

    return Response.json({ 
      success: true,
      message: 'Password reset successfully and user notified via email'
    });

  } catch (error) {
    console.error('[adminResetPassword] Error:', {
      message: error.message,
      stack: error.stack,
      adminUser: adminUser?.email
    });
    return Response.json({ 
      error: 'Failed to reset password',
      details: error.message 
    }, { status: 500 });
  }
});