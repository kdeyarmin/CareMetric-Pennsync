import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, user_name } = await req.json();

    if (!user_email) {
      return Response.json({ error: 'user_email required' }, { status: 400 });
    }

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

    // Send welcome email
    await resend.emails.send({
      from: 'CareMetric AI <welcome@caremetricai.com>',
      to: user_email,
      subject: '🎉 Welcome to CareMetric AI - Your 14-Day Trial Starts Now!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to CareMetric AI, ${user_name}! 🚀</h2>
          
          <p>We're thrilled to have you on board! Your 14-day free trial has officially started.</p>
          
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 10px; margin: 20px 0;">
            <h3 style="margin: 0 0 10px 0;">🎁 What You Get:</h3>
            <ul style="margin: 0; padding-left: 20px;">
              <li>✨ AI-powered Smart Notes Assistant</li>
              <li>🎤 Voice-to-text Visit Scribe</li>
              <li>📋 Automated Care Plan Management</li>
              <li>✅ OASIS & Medicare Compliance Tools</li>
              <li>📊 Real-time Analytics Dashboard</li>
              <li>🎓 Personalized Training Modules</li>
            </ul>
          </div>

          <h3>🚀 Get Started in 3 Easy Steps:</h3>
          <ol>
            <li><strong>Complete Your Profile</strong> - Add your credentials and care scope</li>
            <li><strong>Try Smart Notes</strong> - Document your first visit with AI assistance</li>
            <li><strong>Explore Features</strong> - Check out care plans, compliance tools, and analytics</li>
          </ol>

          <div style="text-align: center; margin: 30px 0;">
            <a href="https://www.caremetricai.com" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
              Start Exploring →
            </a>
          </div>

          <p style="color: #666; font-size: 14px; border-top: 1px solid #eee; padding-top: 20px; margin-top: 30px;">
            Need help getting started? Reply to this email - we're here to help! 💙
          </p>

          <p style="color: #999; font-size: 12px;">
            Your trial ends on ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>
      `
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Welcome email error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});