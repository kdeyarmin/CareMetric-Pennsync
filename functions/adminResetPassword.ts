import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    const adminUser = await base44.auth.me();
    if (!adminUser || adminUser.role !== 'admin') {
      return Response.json({ error: 'Unauthorized - Admin access required' }, { status: 403 });
    }

    const { user_email, new_password } = await req.json();

    if (!user_email || !new_password) {
      return Response.json({ error: 'user_email and new_password are required' }, { status: 400 });
    }

    // Validate password strength
    if (new_password.length < 8) {
      return Response.json({ error: 'Password must be at least 8 characters' }, { status: 400 });
    }

    // Get user by email
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    if (users.length === 0) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const targetUser = users[0];

    // Use Base44's auth API to reset password
    // Note: This uses service role to update the password
    const response = await fetch(`https://api.base44.com/v1/auth/admin/reset-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${Deno.env.get('BASE44_SERVICE_ROLE_KEY')}`
      },
      body: JSON.stringify({
        app_id: Deno.env.get('BASE44_APP_ID'),
        user_id: targetUser.id,
        new_password: new_password
      })
    });

    if (!response.ok) {
      return Response.json({ error: 'Failed to reset password' }, { status: 500 });
    }

    // Log the password reset action
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

    return Response.json({ 
      success: true,
      message: 'Password reset successfully and user notified via email'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});