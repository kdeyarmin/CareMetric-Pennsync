import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Only an admin / super-admin may force a password reset for another account.
    // Previously unauthenticated — anyone could trigger reset invites for any user.
    const currentUser = await base44.auth.me();
    if (!currentUser || (currentUser.role !== 'admin' && currentUser.account_type !== 'super_admin')) {
      return Response.json({ error: 'Unauthorized. Admin access required.' }, { status: 403 });
    }

    const { userEmail } = await req.json();

    if (!userEmail) {
      return Response.json({ error: 'userEmail is required' }, { status: 400 });
    }

    const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
    if (!users || users.length === 0) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }
    const targetUser = users[0];

    // Re-invite the user — this sends them a fresh link to set/reset their password
    await base44.users.inviteUser(userEmail, targetUser.role || 'user');

    const appUrl = `https://hub.base44.app/apps/68ee80d98929370f9e8f2932`;

    // Also send a clear email with login details
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: userEmail,
      from_name: 'Penn Sync',
      subject: 'Penn Sync — Your Account Access',
      body: `Hello ${targetUser.full_name || userEmail},

An administrator has reset your account access for Penn Sync.

You should receive a separate email shortly with a link to set your password. Once set, use the details below to log in:

🔗 Login URL: ${appUrl}
👤 Username / Email: ${userEmail}

If you do not receive the password setup email within a few minutes, please check your spam folder or contact your administrator.

Best regards,
Penn Sync Team`
    });

    return Response.json({
      success: true,
      message: `Password reset invite and login instructions sent to ${userEmail}`
    });

  } catch (error) {
    console.error('adminResetPassword error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});