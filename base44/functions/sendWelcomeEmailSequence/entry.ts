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
        <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
          <div style="background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 30px; text-align: center;">
            <h1 style="margin: 0; font-size: 24px; font-weight: 700;">🎉 Welcome to CareMetric AI!</h1>
            <p style="margin: 10px 0 0; opacity: 0.95; font-size: 15px;">Your 14-day free trial starts now</p>
          </div>
          
          <div style="padding: 30px;">
            <p style="font-size: 15px; color: #1f2937;">Hi ${user_name},</p>
            <p style="color: #475569;">We're thrilled to have you on board! Your 14-day free trial has officially started.</p>
            
            <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; border-radius: 6px; margin: 20px 0;">
              <h3 style="margin: 0 0 10px 0; color: #1e40af;">🎁 What You Get:</h3>
              <ul style="margin: 0; padding-left: 20px; color: #475569;">
                <li style="margin-bottom: 6px;">✨ AI-powered Smart Notes Assistant</li>
                <li style="margin-bottom: 6px;">🎤 Voice-to-text Visit Scribe</li>
                <li style="margin-bottom: 6px;">📋 Automated Care Plan Management</li>
                <li style="margin-bottom: 6px;">✅ OASIS & Medicare Compliance Tools</li>
                <li style="margin-bottom: 6px;">📊 Real-time Analytics Dashboard</li>
                <li>🎓 Personalized Training Modules</li>
              </ul>
            </div>

            <h3 style="color: #1e40af;">🚀 Get Started in 3 Easy Steps:</h3>
            <ol style="color: #475569; font-size: 14px; padding-left: 20px;">
              <li style="margin-bottom: 8px;"><strong>Complete Your Profile</strong> - Add your credentials and care scope</li>
              <li style="margin-bottom: 8px;"><strong>Try Smart Notes</strong> - Document your first visit with AI assistance</li>
              <li><strong>Explore Features</strong> - Check out care plans, compliance tools, and analytics</li>
            </ol>

            <div style="text-align: center; margin: 30px 0;">
              <a href="https://www.caremetricai.com" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);">
                Start Exploring →
              </a>
            </div>

            <p style="color: #64748b; font-size: 13px; border-top: 1px solid #e5e7eb; padding-top: 20px; margin-top: 30px;">
              Need help getting started? Reply to this email - we're here to help! 💙
            </p>
            <p style="color: #94a3b8; font-size: 12px;">
              Your trial ends on ${new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
            </p>
          </div>
          
          <div style="background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb;">
            <p><strong>CareMetric AI</strong> — AI-Powered Clinical Documentation</p>
            <p style="margin-top: 5px; color: #999;">© ${new Date().getFullYear()} CareMetric AI. All rights reserved.</p>
          </div>
        </div>
      `
    });

    return Response.json({ success: true });
  } catch (error) {
    console.error('Welcome email error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});