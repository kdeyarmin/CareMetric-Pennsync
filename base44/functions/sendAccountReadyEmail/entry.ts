import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Require an admin: previously unauthenticated, so anyone could send a
    // "Penn Sync Administration" branded email to any address with
    // attacker-controlled name content (open relay / phishing).
    const user = await base44.auth.me();
    if (!user || (user.role !== 'admin' && user.account_type !== 'super_admin' && user.account_type !== 'agency_admin')) {
      return Response.json({ error: 'Unauthorized. Admin access required.' }, { status: 403 });
    }

    const { email, full_name } = await req.json();

    await base44.asServiceRole.integrations.Core.SendEmail({
      to: email,
      from_name: 'Penn Sync Administration',
      subject: 'Your Penn Sync Account is Ready – You Can Now Log In',
      body: `Dear ${full_name},

Great news! Your Penn Sync account has been fully verified and activated. You can now log in at any time.

Your login email: ${email}

If you set a password when you first signed up, use that to log in. If you've forgotten your password, use the "Forgot Password" link on the login page to reset it.

GETTING STARTED:
• Visit the Penn Sync login page and sign in with your email and password
• Once logged in, you'll have access to all features assigned to your role
• Contact your administrator if you have any questions or issues

If you did not create this account or have concerns, please contact your administrator immediately.

Best regards,
Penn Sync Administration Team

---
This is an automated message. Please do not reply to this email.`
    });

    return Response.json({ success: true, message: `Account-ready email sent to ${email}` });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});