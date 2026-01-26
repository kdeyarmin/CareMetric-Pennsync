import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    const { days_inactive = 7, test_mode = false, specific_email = null } = await req.json();

    console.log(`Checking for inactive users (${days_inactive} days)...`);

    // Get all users
    const allUsers = await base44.asServiceRole.entities.User.list('-created_date', 1000);
    
    // Calculate cutoff date
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days_inactive);

    // Filter inactive users
    let inactiveUsers = [];
    
    for (const targetUser of allUsers) {
      // Skip if specific email provided and doesn't match
      if (specific_email && targetUser.email !== specific_email) {
        continue;
      }

      // Skip admin users
      if (targetUser.role === 'admin') {
        continue;
      }

      // Check if user created recently but has no activity
      const userCreatedDate = new Date(targetUser.created_date);
      if (userCreatedDate < cutoffDate) {
        continue; // User is too old for this campaign
      }

      // Check for any activity
      const userActivity = await base44.asServiceRole.entities.UserActivity.filter({
        user_email: targetUser.email
      });

      // Check for visits
      const userVisits = await base44.asServiceRole.entities.Visit.filter({
        created_by: targetUser.email
      });

      // Check for note conversions
      const userNotes = await base44.asServiceRole.entities.NoteConversion.filter({
        nurse_email: targetUser.email
      });

      // User is inactive if they have minimal or no activity
      if (userActivity.length <= 2 && userVisits.length === 0 && userNotes.length === 0) {
        inactiveUsers.push(targetUser);
      }
    }

    console.log(`Found ${inactiveUsers.length} inactive users`);

    if (test_mode) {
      return Response.json({
        success: true,
        test_mode: true,
        inactive_users: inactiveUsers.map(u => ({
          email: u.email,
          full_name: u.full_name,
          created_date: u.created_date
        })),
        count: inactiveUsers.length,
        message: 'Test mode - no emails sent'
      });
    }

    // Send emails to inactive users
    const emailResults = [];
    
    for (const targetUser of inactiveUsers) {
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
    .content h2 { color: #1e40af; margin-top: 0; font-size: 22px; }
    .content p { color: #555; margin: 16px 0; font-size: 15px; line-height: 1.7; }
    .features { background: #f8fafc; padding: 25px; border-radius: 8px; margin: 25px 0; }
    .features h3 { color: #1e40af; margin-top: 0; margin-bottom: 15px; font-size: 18px; }
    .feature-item { margin: 12px 0; padding-left: 24px; position: relative; color: #444; font-size: 14px; }
    .feature-item:before { content: "✓"; position: absolute; left: 0; color: #10b981; font-weight: bold; font-size: 16px; }
    .cta { text-align: center; margin: 35px 0; }
    .cta-button { display: inline-block; background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3); transition: transform 0.2s; }
    .cta-button:hover { transform: translateY(-2px); box-shadow: 0 6px 16px rgba(59, 130, 246, 0.4); }
    .footer { background: #f8fafc; padding: 25px 30px; text-align: center; color: #666; font-size: 13px; border-top: 1px solid #e5e7eb; }
    .footer a { color: #3b82f6; text-decoration: none; }
    .testimonial { background: #eff6ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 6px; font-style: italic; color: #555; }
    .stats { display: flex; justify-content: space-around; margin: 30px 0; }
    .stat { text-align: center; }
    .stat-number { font-size: 32px; font-weight: bold; color: #3b82f6; }
    .stat-label { font-size: 13px; color: #666; margin-top: 5px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🏥 Welcome Back to CareMetric AI</h1>
      <p>We noticed you haven't had a chance to explore yet</p>
    </div>
    
    <div class="content">
      <h2>Hi ${targetUser.full_name || 'there'},</h2>
      
      <p>We're excited to have you as part of the CareMetric AI community! We noticed you created your account but haven't had a chance to dive in yet.</p>
      
      <p>We understand—healthcare is demanding, and finding time to explore new tools can be challenging. That's exactly why we built CareMetric AI: <strong>to save you time, not take it.</strong></p>

      <div class="stats">
        <div class="stat">
          <div class="stat-number">70%</div>
          <div class="stat-label">Less Documentation Time</div>
        </div>
        <div class="stat">
          <div class="stat-number">95%</div>
          <div class="stat-label">Compliance Accuracy</div>
        </div>
        <div class="stat">
          <div class="stat-number">3hrs</div>
          <div class="stat-label">Saved Per Day</div>
        </div>
      </div>

      <div class="features">
        <h3>What You Can Do in Just 5 Minutes:</h3>
        <div class="feature-item"><strong>Smart Note Assistant</strong> - Turn rough notes into compliance-ready documentation instantly</div>
        <div class="feature-item"><strong>AI Visit Scribe</strong> - Record your visit, get a perfect note automatically</div>
        <div class="feature-item"><strong>Real-Time Compliance Checking</strong> - Never miss a required element again</div>
        <div class="feature-item"><strong>Care Coordination Tools</strong> - Auto-generate referrals, education materials, and follow-up tasks</div>
        <div class="feature-item"><strong>Risk Prediction</strong> - Identify high-risk patients before issues arise</div>
        <div class="feature-item"><strong>OASIS Automation</strong> - Streamline your assessments with AI-powered insights</div>
      </div>

      <div class="testimonial">
        "CareMetric AI has completely transformed how I document. What used to take 30 minutes now takes 5. I can focus on patient care instead of paperwork."
        <br><br>
        <strong>— Sarah M., RN, Home Health Nurse</strong>
      </div>

      <p><strong>Getting started is simple:</strong></p>
      <p>1. Log in to your account<br>
         2. Add your first patient (or use our sample data)<br>
         3. Try the Smart Note Assistant with any rough notes<br>
         4. See the magic happen ✨</p>

      <div class="cta">
        <a href="https://caremetricai.com" class="cta-button">
          Get Started Now →
        </a>
      </div>

      <p style="margin-top: 30px; color: #666; font-size: 14px;">
        <strong>Need help?</strong> We're here for you. Reply to this email with any questions, and our team will personally assist you in getting set up.
      </p>

      <p style="color: #666; font-size: 14px;">
        We're committed to making your documentation faster, more accurate, and compliant—so you can spend more time doing what you do best: caring for patients.
      </p>
    </div>
    
    <div class="footer">
      <p><strong>CareMetric AI</strong><br>
      AI-Powered Clinical Documentation & Compliance Platform</p>
      <p style="margin-top: 15px;">
        <a href="https://caremetricai.com">Visit Website</a> | 
        <a href="mailto:support@caremetricai.com">Contact Support</a> | 
        <a href="https://caremetricai.com/privacy">Privacy Policy</a>
      </p>
      <p style="margin-top: 15px; font-size: 12px; color: #999;">
        This email was sent to ${targetUser.email} because you created an account with CareMetric AI.
      </p>
    </div>
  </div>
</body>
</html>`;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: targetUser.email,
          from_name: 'CareMetric AI Team',
          subject: `${targetUser.full_name ? targetUser.full_name + ', ' : ''}Welcome to CareMetric AI - Let's Get Started! 🚀`,
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
      inactive_users_found: inactiveUsers.length,
      emails_sent: emailResults.filter(r => r.status === 'sent').length,
      emails_failed: emailResults.filter(r => r.status === 'failed').length,
      results: emailResults
    });

  } catch (error) {
    console.error('[sendInactiveUserEmail] Error:', error);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});