import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { test_mode = false, specific_email = null } = await req.json();

    console.log('Fetching users to send benefits email...');

    // Get all users
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 1000);
    
    // Filter users (exclude admins, or only specific email in test mode)
    let targetUsers = allUsers.filter(u => {
      if (specific_email) return u.email === specific_email;
      return u.role !== 'admin'; // Send to all non-admin users
    });

    console.log(`Found ${targetUsers.length} users to email`);

    if (test_mode) {
      return Response.json({
        success: true,
        test_mode: true,
        target_users: targetUsers.map(u => ({
          email: u.email,
          full_name: u.full_name,
          created_date: u.created_date
        })),
        count: targetUsers.length,
        message: 'Test mode - no emails sent'
      });
    }

    // Send emails
    const emailResults = [];
    
    for (const targetUser of targetUsers) {
      try {
        const emailBody = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4; }
    .container { max-width: 600px; margin: 40px auto; background: white; padding: 0; border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); overflow: hidden; }
    .header { background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 40px 30px; text-align: center; }
    .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
    .header p { margin: 10px 0 0; font-size: 16px; opacity: 0.95; }
    .content { padding: 40px 30px; }
    .hero-stat { text-align: center; background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%); padding: 30px; border-radius: 10px; margin: 25px 0; }
    .hero-number { font-size: 48px; font-weight: bold; color: #1e40af; margin: 0; }
    .hero-text { font-size: 18px; color: #555; margin: 10px 0 0; }
    .benefit-section { margin: 30px 0; }
    .benefit-item { display: flex; align-items: start; margin: 20px 0; }
    .benefit-icon { width: 50px; height: 50px; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); border-radius: 10px; display: flex; align-items: center; justify-content: center; margin-right: 20px; flex-shrink: 0; }
    .benefit-icon span { font-size: 24px; }
    .benefit-content h3 { margin: 0 0 8px 0; color: #1e40af; font-size: 18px; }
    .benefit-content p { margin: 0; color: #555; font-size: 14px; line-height: 1.6; }
    .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin: 30px 0; }
    .stat-card { background: #f8fafc; padding: 20px; border-radius: 8px; text-align: center; }
    .stat-number { font-size: 32px; font-weight: bold; color: #3b82f6; }
    .stat-label { font-size: 13px; color: #666; margin-top: 5px; }
    .cta { text-align: center; margin: 35px 0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); }
    .testimonial { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 6px; font-style: italic; color: #555; }
    .footer { background: #f8fafc; padding: 25px 30px; text-align: center; color: #666; font-size: 13px; border-top: 1px solid #e5e7eb; }
    .footer a { color: #3b82f6; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚀 Your Healthcare Documentation Revolution</h1>
      <p>Discover What CareMetric AI Can Do For You</p>
    </div>
    
    <div class="content">
      <p>Hi ${targetUser.full_name || 'there'},</p>
      
      <p>We wanted to take a moment to share what makes CareMetric AI special—and how we're helping healthcare professionals like you transform their daily workflow.</p>

      <div class="hero-stat">
        <div class="hero-number">70%</div>
        <div class="hero-text">Average time saved on clinical documentation</div>
      </div>

      <h2 style="color: #1e40af; font-size: 22px; margin-top: 35px;">💡 What You Can Accomplish with CareMetric AI</h2>

      <div class="benefit-section">
        <div class="benefit-item">
          <div class="benefit-icon"><span>📝</span></div>
          <div class="benefit-content">
            <h3>AI-Powered Smart Notes</h3>
            <p>Transform rough notes into Medicare-compliant documentation in seconds. Our AI understands clinical context and ensures every required element is included.</p>
          </div>
        </div>

        <div class="benefit-item">
          <div class="benefit-icon"><span>🎤</span></div>
          <div class="benefit-content">
            <h3>Voice-to-Documentation</h3>
            <p>Simply speak during or after your visit. CareMetric AI transcribes and converts your verbal notes into professional, structured documentation automatically.</p>
          </div>
        </div>

        <div class="benefit-item">
          <div class="benefit-icon"><span>✅</span></div>
          <div class="benefit-content">
            <h3>Real-Time Compliance Checking</h3>
            <p>Never worry about missing required elements again. Our system flags gaps instantly and suggests corrections before you submit.</p>
          </div>
        </div>

        <div class="benefit-item">
          <div class="benefit-icon"><span>🎯</span></div>
          <div class="benefit-content">
            <h3>Intelligent Care Plans</h3>
            <p>Generate evidence-based care plans tailored to each patient's diagnosis, medications, and clinical history—in just a few clicks.</p>
          </div>
        </div>

        <div class="benefit-item">
          <div class="benefit-icon"><span>⚠️</span></div>
          <div class="benefit-content">
            <h3>Predictive Risk Alerts</h3>
            <p>AI identifies high-risk patients before issues escalate. Get proactive alerts for deterioration, readmission risk, and care gaps.</p>
          </div>
        </div>

        <div class="benefit-item">
          <div class="benefit-icon"><span>📊</span></div>
          <div class="benefit-content">
            <h3>OASIS Automation</h3>
            <p>Streamline your OASIS assessments with AI-powered analysis, PDGM optimization, and automated quality assurance.</p>
          </div>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-card">
          <div class="stat-number">95%</div>
          <div class="stat-label">Compliance Accuracy</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">3hrs</div>
          <div class="stat-label">Saved Daily</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">10min</div>
          <div class="stat-label">Per Note</div>
        </div>
        <div class="stat-card">
          <div class="stat-number">100%</div>
          <div class="stat-label">HIPAA Secure</div>
        </div>
      </div>

      <div class="testimonial">
        "CareMetric AI has been a game-changer. What used to take me 45 minutes now takes 10. I can finally focus on my patients instead of drowning in paperwork."
        <br><br>
        <strong>— Jennifer R., RN, BSN</strong>
      </div>

      <h3 style="color: #1e40af; margin-top: 35px;">🎁 Ready to Transform Your Workflow?</h3>
      
      <p>Whether you're documenting visits, managing compliance, or coordinating care—CareMetric AI is designed to save you time and reduce stress.</p>

      <p><strong>Start using CareMetric AI today:</strong></p>
      <p style="color: #555; font-size: 14px; line-height: 1.8;">
        ✓ Create your first AI-powered note<br>
        ✓ Try the voice dictation feature<br>
        ✓ Generate a care plan automatically<br>
        ✓ Run a compliance check on existing documentation
      </p>

      <div class="cta">
        <a href="https://app.caremetricai.com" class="cta-button">
          Log In & Get Started →
        </a>
      </div>

      <p style="margin-top: 30px; color: #666; font-size: 14px;">
        <strong>Questions?</strong> Our support team is here to help. Reply to this email anytime, and we'll personally assist you in making the most of CareMetric AI.
      </p>
    </div>
    
    <div class="footer">
      <p><strong>CareMetric AI</strong><br>
      Transforming Healthcare Documentation with AI</p>
      <p style="margin-top: 15px;">
        <a href="https://app.caremetricai.com">Dashboard</a> | 
        <a href="mailto:support@caremetricai.com">Support</a> | 
        <a href="https://caremetricai.com/privacy">Privacy</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        You're receiving this because you have an account with CareMetric AI.
      </p>
    </div>
  </div>
</body>
</html>`;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: targetUser.email,
          from_name: 'CareMetric AI Team',
          subject: `${targetUser.full_name ? targetUser.full_name + ', d' : 'D'}iscover the Full Power of CareMetric AI 🚀`,
          body: emailBody
        });

        emailResults.push({
          email: targetUser.email,
          status: 'sent',
          sent_at: new Date().toISOString()
        });

        console.log(`✓ Email sent to ${targetUser.email}`);

        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`✗ Failed to send email to ${targetUser.email}:`, error);
        emailResults.push({
          email: targetUser.email,
          status: 'failed',
          error: error.message
        });
      }
    }

    return Response.json({
      success: true,
      users_found: targetUsers.length,
      emails_sent: emailResults.filter(r => r.status === 'sent').length,
      emails_failed: emailResults.filter(r => r.status === 'failed').length,
      results: emailResults
    });

  } catch (error) {
    console.error('[sendBenefitsEmail] Error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});