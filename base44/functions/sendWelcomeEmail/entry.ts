import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Only admins can send welcome emails
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const body = await req.json();
    const { email, full_name, temporary_password } = body;

    if (!email || !full_name || !temporary_password) {
      return Response.json(
        { error: 'Missing required fields: email, full_name, temporary_password' },
        { status: 400 }
      );
    }

    const welcomeEmail = await base44.integrations.Core.SendEmail({
      to: email,
      subject: 'Welcome to Penn Sync - Your Account is Ready',
      from_name: 'Penn Sync Admin',
      body: `Dear ${full_name},

Welcome to Penn Sync! Your user account has been set up by your administrator.

LOGIN CREDENTIALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Email: ${email}
Temporary Password: ${temporary_password}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

IMPORTANT: Please change your password immediately upon first login for security.

GETTING STARTED:
1. Visit the Penn Sync login page and sign in with the credentials above
2. You will be prompted to change your temporary password to a secure password of your choice
3. Once logged in, you'll have access to the Penn Sync platform
4. Explore the dashboard and available features for your role
5. Contact your administrator if you have any questions

PLATFORM FEATURES:
• Patient Management - View and manage patient records
• Smart Notes - AI-assisted clinical documentation
• Compliance Monitoring - Real-time Medicare compliance checks
• Care Planning - Automated care plan generation and tracking
• Training & Development - Access to training modules and resources

SECURITY REMINDER:
• Keep your password confidential
• Never share login credentials with others
• Log out when finished, especially on shared devices
• Report any suspicious activity to your administrator

If you did not request this account or have any questions, please contact your administrator immediately.

Best regards,
Penn Sync Administration Team

---
This is an automated message. Please do not reply to this email.`
    });

    return Response.json({ success: true, message: 'Welcome email sent successfully' });
  } catch (error) {
    console.error('Welcome email error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});