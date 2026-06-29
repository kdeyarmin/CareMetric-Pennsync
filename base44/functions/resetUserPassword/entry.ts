import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

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

    // Generate a cryptographically-secure temporary password. Math.random() is
    // NOT a CSPRNG and must never be used for credentials. Indices are
    // rejection-sampled to avoid the modulo bias of `byte % alphabetLength`
    // (the alphabet length does not divide 256).
    const PW_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const randomIndex = (max) => {
      const limit = Math.floor(256 / max) * max;
      const buf = new Uint8Array(1);
      let x;
      do { crypto.getRandomValues(buf); x = buf[0]; } while (x >= limit);
      return x % max;
    };
    const tempPassword = Array.from({ length: 14 }, () => PW_ALPHABET[randomIndex(PW_ALPHABET.length)]).join('');

    // Get user details
    const users = await base44.asServiceRole.entities.User.filter({ email: userEmail });
    if (!users || users.length === 0) {
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const targetUser = users[0];

    // Update user password using service role
    await base44.asServiceRole.auth.updateUserPassword(userEmail, tempPassword);

    const appUrl = `https://hub.base44.app/apps/68ee80d98929370f9e8f2932`;

    // Send email with temporary password
    await base44.asServiceRole.integrations.Core.SendEmail({
      to: userEmail,
      subject: 'Your Penn Sync Password Has Been Reset',
      body: `Hello ${targetUser.full_name || 'User'},

Your password has been reset by an administrator. Here are your login details:

🔗 Login URL: ${appUrl}
👤 Username: ${userEmail}
🔑 Temporary Password: ${tempPassword}

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

    // SECURITY: do NOT echo the temporary password in the HTTP response. Email is
    // the only delivery channel; returning it here would expose the credential to
    // browser/proxy/APM network logs.
    return Response.json({
      success: true,
      message: 'Password reset successfully. Temporary password sent via email.'
    });

  } catch (error) {
    console.error('Password reset error:', error);
    // Generic message — don't leak internals to the client.
    return Response.json({ error: 'Failed to reset password' }, { status: 500 });
  }
});