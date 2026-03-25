import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // Get all subscriptions
    const subscriptions = await base44.asServiceRole.entities.Subscription.list();
    const now = new Date();
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

    let emailsSent = { day7: 0, day3: 0, lastDay: 0, feedback: 0 };

    for (const sub of subscriptions) {
      if (sub.status !== 'trialing') continue;

      const endDate = new Date(sub.current_period_end);
      const daysLeft = Math.ceil((endDate - now) / (1000 * 60 * 60 * 24));
      
      const user = await base44.asServiceRole.entities.User.filter({ email: sub.user_email });
      if (!user[0]) continue;
      const userName = user[0].full_name;

      // Day 7 - Halfway check-in
      if (daysLeft === 7) {
        await resend.emails.send({
          from: 'CareMetric AI <support@caremetricai.com>',
          to: sub.user_email,
          subject: '💙 How\'s Your CareMetric AI Experience Going?',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hi ${userName}! 👋</h2>
              
              <p>You're halfway through your free trial, and we wanted to check in!</p>
              
              <div style="background: #f0f9ff; border-left: 4px solid #3b82f6; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #1e40af;"><strong>⏰ 7 days left in your trial</strong></p>
              </div>

              <h3>Quick Question:</h3>
              <p>What feature has been most helpful for you so far?</p>
              <p style="color: #666;">Just hit reply and let us know - we read every response! 💬</p>

              <h3>Haven't explored everything yet?</h3>
              <p>Here are some features you might have missed:</p>
              <ul>
                <li>🎤 <strong>Voice Scribe</strong> - Dictate notes hands-free</li>
                <li>📋 <strong>Care Plans</strong> - AI-suggested interventions</li>
                <li>✅ <strong>OASIS Analyzer</strong> - Compliance scoring</li>
                <li>📊 <strong>Analytics</strong> - Track your productivity</li>
              </ul>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.caremetricai.com" style="background: #3b82f6; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; display: inline-block;">
                  Explore Features
                </a>
              </div>

              <p style="color: #999; font-size: 14px; margin-top: 30px;">
                Questions? We're here to help! Reply anytime.
              </p>
            </div>
          `
        });
        emailsSent.day7++;
      }

      // Day 3 - Trial ending soon
      if (daysLeft === 3) {
        await resend.emails.send({
          from: 'CareMetric AI <support@caremetricai.com>',
          to: sub.user_email,
          subject: '⏰ 3 Days Left - Don\'t Lose Your CareMetric AI Benefits!',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hi ${userName},</h2>
              
              <div style="background: #fef3c7; border-left: 4px solid #f59e0b; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #92400e;"><strong>⏰ Only 3 days left in your trial!</strong></p>
              </div>

              <p>Your trial ends on <strong>${endDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}</strong>.</p>

              <h3>Why Continue with CareMetric AI?</h3>
              <ul style="line-height: 1.8;">
                <li>⏱️ Save 2+ hours daily on documentation</li>
                <li>✅ Never miss compliance requirements</li>
                <li>📈 Improve patient outcomes with AI insights</li>
                <li>🔒 HIPAA-compliant and secure</li>
              </ul>

              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 25px; border-radius: 10px; margin: 30px 0; text-align: center;">
                <h3 style="margin: 0 0 15px 0;">💰 Our Plans</h3>
                <p style="margin: 0 0 20px 0;">Starting at just $39.99/month<br/>
                <span style="font-size: 14px; opacity: 0.9;">Save even more with annual billing!</span></p>
                <a href="https://www.caremetricai.com" style="background: white; color: #667eea; padding: 12px 30px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold;">
                  View Plans & Subscribe
                </a>
              </div>

              <p style="color: #666; font-size: 14px;">
                <strong>Need more time to decide?</strong> Reply to this email and we'll see what we can do!
              </p>
            </div>
          `
        });
        emailsSent.day3++;
      }

      // Last day
      if (daysLeft === 1) {
        await resend.emails.send({
          from: 'CareMetric AI <support@caremetricai.com>',
          to: sub.user_email,
          subject: '🚨 Last Day of Your Trial - Subscribe to Keep Your Access',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hi ${userName},</h2>
              
              <div style="background: #fee2e2; border-left: 4px solid #ef4444; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; color: #991b1b;"><strong>🚨 Your trial ends tomorrow!</strong></p>
              </div>

              <p>This is your last day to enjoy all the features of CareMetric AI.</p>

              <h3>Don't lose access to:</h3>
              <ul>
                <li>✨ Your saved notes and patient data</li>
                <li>📋 Your care plans and workflows</li>
                <li>📊 Your analytics and insights</li>
                <li>🎓 Your training progress</li>
              </ul>

              <div style="text-align: center; margin: 30px 0;">
                <a href="https://www.caremetricai.com" style="background: #ef4444; color: white; padding: 15px 40px; text-decoration: none; border-radius: 5px; display: inline-block; font-weight: bold; font-size: 16px;">
                  Subscribe Now - Keep Your Access
                </a>
              </div>

              <p style="background: #f0f9ff; padding: 15px; border-radius: 5px; font-size: 14px;">
                💡 <strong>Special Offer:</strong> Use code <code style="background: white; padding: 2px 6px; border-radius: 3px;">TRIAL2026</code> for 10% off your first month!
              </p>

              <p style="color: #666; margin-top: 30px;">
                Questions about pricing? Reply to this email anytime!
              </p>
            </div>
          `
        });
        emailsSent.lastDay++;
      }

      // Day 10 - Feedback request
      if (daysLeft === 10) {
        await resend.emails.send({
          from: 'CareMetric AI <feedback@caremetricai.com>',
          to: sub.user_email,
          subject: '💭 Quick Question About Your Experience',
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>Hi ${userName}! 👋</h2>
              
              <p>Hope you're enjoying CareMetric AI so far!</p>

              <div style="background: #f0fdf4; border-left: 4px solid #10b981; padding: 20px; margin: 30px 0;">
                <h3 style="margin: 0 0 15px 0; color: #065f46;">We'd love your feedback:</h3>
                <ul style="margin: 10px 0; color: #065f46;">
                  <li>What features are you loving?</li>
                  <li>What could we improve?</li>
                  <li>Any features you'd like to see in future updates?</li>
                </ul>
              </div>

              <p>Your input directly shapes our roadmap. Just hit reply and share your thoughts!</p>

              <p style="color: #999; font-size: 14px; margin-top: 30px;">
                Thanks for being part of our community! 💙
              </p>
            </div>
          `
        });
        emailsSent.feedback++;
      }
    }

    return Response.json({ 
      success: true, 
      emailsSent 
    });
  } catch (error) {
    console.error('Trial notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});