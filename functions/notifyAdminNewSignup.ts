import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, user_full_name, user_role } = await req.json();

    // Get admin email from environment or hardcoded
    const adminEmail = Deno.env.get('ADMIN_EMAIL') || 'admin@caremetricai.com';

    if (!user_email) {
       return Response.json({ error: 'Missing user_email' }, { status: 400 });
     }

    // Send email notification
    await base44.integrations.Core.SendEmail({
      to: adminEmail,
      subject: `🎉 New User Signup - ${user_full_name || user_email}`,
      body: `A new user has signed up for CareMetric AI!

User Details:
- Email: ${user_email}
- Name: ${user_full_name || 'Not provided'}
- Role: ${user_role || 'user'}
- Signup Date: ${new Date().toLocaleString()}

Log in to the admin dashboard to view more details.`
    });

    return Response.json({ success: true, message: 'Admin notified' });
    } catch (error) {
     console.error('Admin notification error:', error);
     return Response.json({ error: error.message }, { status: 500 });
    }
});