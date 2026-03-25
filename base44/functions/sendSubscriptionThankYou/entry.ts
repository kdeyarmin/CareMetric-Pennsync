import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, plan_name, amount } = await req.json();

    if (!user_email) {
      return Response.json({ error: 'user_email required' }, { status: 400 });
    }

    const user = await base44.asServiceRole.entities.User.filter({ email: user_email });
    const userName = user[0]?.full_name || 'there';

    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

    await resend.emails.send({
      from: 'CareMetric AI <welcome@caremetricai.com>',
      to: user_email,
      subject: '🎉 Welcome to CareMetric AI Premium!',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 40px; border-radius: 10px; text-align: center;">
            <h1 style="margin: 0 0 10px 0; font-size: 32px;">🎉 Thank You!</h1>
            <p style="margin: 0; font-size: 18px; opacity: 0.9;">You're now a CareMetric AI member</p>
          </div>

          <div style="padding: 30px 0;">
            <h2>Hi ${userName}! 👋</h2>
            
            <p>Thank you for subscribing to CareMetric AI! We're excited to have you as a valued member.</p>

            <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
              <p style="margin: 0;"><strong>Your Plan:</strong> ${plan_name || 'CareMetric AI'}</p>
              <p style="margin: 5px 0 0 0;"><strong>Amount:</strong> $${(amount / 100).toFixed(2)}</p>
            </div>

            <h3>🚀 You Now Have Full Access To:</h3>
            <ul style="line-height: 1.8;">
              <li>✨ Unlimited AI-powered Smart Notes</li>
              <li>🎤 Unlimited Voice Scribe dictation</li>
              <li>📋 Advanced Care Plan Management</li>
              <li>✅ Full OASIS & Compliance Suite</li>
              <li>📊 Real-time Analytics & Reports</li>
              <li>🎓 Complete Training Library</li>
              <li>🔒 Enterprise-grade Security</li>
              <li>💬 Priority Support</li>
            </ul>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://www.caremetricai.com" style="background: #667eea; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                Go to Dashboard
              </a>
            </div>

            <h3>📚 Getting the Most Out of CareMetric AI:</h3>
            <ol>
              <li><strong>Customize Your Workflow</strong> - Set up your preferred note templates</li>
              <li><strong>Configure AI Settings</strong> - Adjust verbosity and compliance priorities</li>
              <li><strong>Explore Training</strong> - Complete modules tailored to your role</li>
              <li><strong>Review Analytics</strong> - Track your productivity improvements</li>
            </ol>

            <div style="background: #f0fdf4; padding: 20px; border-radius: 10px; margin: 30px 0;">
              <h4 style="margin: 0 0 10px 0; color: #065f46;">💡 Pro Tips:</h4>
              <ul style="margin: 0; color: #065f46;">
                <li>Use voice commands for faster documentation</li>
                <li>Check the compliance dashboard weekly</li>
                <li>Enable offline mode for rural visits</li>
              </ul>
            </div>

            <p style="border-top: 2px solid #eee; padding-top: 20px; margin-top: 30px;">
              <strong>Need Help?</strong><br/>
              • Reply to this email for support<br/>
              • Visit our Help Center<br/>
              • Join our community forum
            </p>

            <p style="color: #666; font-size: 14px;">
              We're committed to making your healthcare documentation easier, faster, and more compliant. 
              Thank you for trusting CareMetric AI! 💙
            </p>

            <p style="color: #999; font-size: 12px; margin-top: 30px;">
              You can manage your subscription anytime from your account settings.
            </p>
          </div>
        </div>
      `
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Thank you email error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});