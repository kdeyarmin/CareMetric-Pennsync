import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, user_full_name, user_role } = await req.json();

    // Get admin email from environment or hardcoded
    const adminEmail = Deno.env.get('ADMIN_EMAIL') || 'admin@caremetricai.com';

    if (!user_email) {
      return new Response(
        JSON.stringify({ error: 'Missing user_email' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      );
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

    return new Response(
      JSON.stringify({ success: true, message: 'Admin notified' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Admin notification error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'Content-Type': 'application/json' } }
    );
  }
});