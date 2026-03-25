import { createClientFromRequest } from 'npm:@base44/sdk@0.8.4';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Verify admin user
    const currentUser = await base44.auth.me();
    if (!currentUser || currentUser.role !== 'admin') {
      return Response.json({ error: 'Unauthorized. Admin access required.' }, { status: 403 });
    }

    const { userEmail } = await req.json();

    if (!userEmail) {
      return Response.json({ error: 'User email is required' }, { status: 400 });
    }

    // Generate a temporary password (8 characters, alphanumeric)
    const tempPassword = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-4).toUpperCase();

    // Get user details
    const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
    if (!users || users.length === 0) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const targetUser = users[0];

    // Update user password using service role
    await base44.asServiceRole.auth.updateUserPassword(userEmail, tempPassword);

    // Send email with temporary password
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: userEmail,
      subject: 'Your Password Has Been Reset',
      body: `Hello ${targetUser.full_name || 'User'},

Your password has been reset by an administrator.

Your temporary password is: ${tempPassword}

Please log in and change your password immediately for security purposes.

If you did not request this password reset, please contact your administrator immediately.

Best regards,
Penn Sync Team`
    });

    // Log the action
    await base44.asServiceRole.entities.UserActivity.create({
      user_email: currentUser.email,
      user_name: currentUser.full_name,
      action: 'password_reset',
      details: {
        target_user: userEmail,
        reset_by: currentUser.email,
        timestamp: new Date().toISOString()
      },
      page: 'user_management',
      entity_type: 'User',
      entity_id: targetUser.id
    });

    return Response.json({
      success: true,
      message: 'Password reset successfully. Temporary password sent via email.',
      tempPassword // Return for admin to see (optional, can be removed for security)
    });

  } catch (error) {
    console.error('Password reset error:', error);
    return Response.json({ 
      error: 'Failed to reset password',
      details: error.message 
    }, { status: 500 });
  }
});