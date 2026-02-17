import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { user_email, user_name, day } = await req.json();

    if (!user_email) {
      return Response.json({ error: 'user_email is required' }, { status: 400 });
    }

    // Check notification preferences
    const prefs = await base44.asServiceRole.entities.NotificationPreferences.filter({ 
      user_email 
    });
    
    if (prefs.length > 0 && !prefs[0].onboarding_emails) {
      return Response.json({ 
        success: true, 
        message: 'User has disabled onboarding emails' 
      });
    }

    const resendApiKey = Deno.env.get('RESEND_API_KEY');
    if (!resendApiKey) {
      throw new Error('RESEND_API_KEY not configured');
    }

    const wrapInBrandTemplate = (title, subtitle, innerContent) => `
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f4f4;">
  <div style="max-width: 600px; margin: 20px auto; background: white; border-radius: 10px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); overflow: hidden;">
    <div style="background: linear-gradient(135deg, #3b82f6 0%, #1e40af 100%); color: white; padding: 30px; text-align: center;">
      <h1 style="margin: 0; font-size: 24px; font-weight: 700;">${title}</h1>
      <p style="margin: 10px 0 0; opacity: 0.95; font-size: 14px;">${subtitle}</p>
    </div>
    <div style="padding: 30px;">
      ${innerContent}
    </div>
    <div style="background: #f8fafc; padding: 20px; text-align: center; color: #666; font-size: 12px; border-top: 1px solid #e5e7eb;">
      <p><strong>CareMetric AI</strong> — AI-Powered Clinical Documentation</p>
      <p style="margin-top: 5px; color: #999;">© ${new Date().getFullYear()} CareMetric AI. All rights reserved.</p>
    </div>
  </div>
</body></html>`;

    // Different email content based on day
    const emailContent = {
      1: {
        subject: '🎉 Welcome to CareMetric AI!',
        body: wrapInBrandTemplate('🎉 Welcome to CareMetric AI!', 'Your documentation revolution starts now', `
          <p style="font-size: 15px; color: #1f2937;">Hi ${user_name || 'there'},</p>
          <p style="color: #475569;">We're excited to have you on board. CareMetric AI is here to revolutionize your healthcare documentation.</p>
          
          <h3 style="color: #1e40af;">🚀 Getting Started</h3>
          <ul style="color: #475569; font-size: 14px;">
            <li style="margin-bottom: 8px;"><strong>Add Your First Patient:</strong> Navigate to the Patients page to start building your patient roster</li>
            <li style="margin-bottom: 8px;"><strong>Try Smart Notes:</strong> Experience AI-powered documentation that saves hours of work</li>
            <li><strong>Explore Features:</strong> Check out our comprehensive suite of tools designed for healthcare professionals</li>
          </ul>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="https://app.caremetricai.com" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Get Started →</a>
          </div>
          
          <p style="color: #64748b; font-size: 13px;">Need help? Email us at <a href="mailto:support@caremetricai.com" style="color: #3b82f6;">support@caremetricai.com</a></p>
          <p style="color: #475569;">Best regards,<br>The CareMetric AI Team</p>
        `)
      },
      3: {
        subject: '💡 Top 3 Features You Should Try',
        body: wrapInBrandTemplate('💡 Top Features to Try', 'Maximize your productivity with CareMetric AI', `
          <p style="font-size: 15px; color: #1f2937;">Hi ${user_name || 'there'},</p>
          <p style="color: #475569;">We hope you're enjoying CareMetric AI. Here are our top 3 features to maximize your productivity:</p>
          
          <h3 style="color: #1e40af;">🎯 Must-Try Features</h3>
          <ol style="color: #475569; font-size: 14px;">
            <li style="margin-bottom: 8px;"><strong>Smart Note Assistant:</strong> Turn rough notes into Medicare-compliant documentation in seconds</li>
            <li style="margin-bottom: 8px;"><strong>OASIS Analyzer:</strong> Ensure compliance and optimize your PDGM scores</li>
            <li><strong>Care Plan Management:</strong> Create comprehensive care plans with AI assistance</li>
          </ol>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="https://app.caremetricai.com/SmartNoteAssistant" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Try Smart Notes Now →</a>
          </div>
          
          <p style="color: #64748b; font-size: 13px;">Questions? Reply to this email - we'd love to hear from you!</p>
          <p style="color: #475569;">Best,<br>The CareMetric AI Team</p>
        `)
      },
      7: {
        subject: '📊 Your First Week Recap & Tips',
        body: wrapInBrandTemplate('📊 Your First Week Recap', 'Tips to get the most out of CareMetric AI', `
          <p style="font-size: 15px; color: #1f2937;">Hi ${user_name || 'there'},</p>
          <p style="color: #475569;">Congratulations on completing your first week! Here's what you might have missed:</p>
          
          <h3 style="color: #1e40af;">🔥 Pro Tips</h3>
          <ul style="color: #475569; font-size: 14px;">
            <li style="margin-bottom: 8px;"><strong>Voice Dictation:</strong> Use voice commands to speed up documentation</li>
            <li style="margin-bottom: 8px;"><strong>Custom Templates:</strong> Create reusable templates for common visit types</li>
            <li style="margin-bottom: 8px;"><strong>Mobile Access:</strong> Document on-the-go with our mobile-optimized interface</li>
            <li><strong>Compliance Monitoring:</strong> Stay audit-ready with real-time compliance checks</li>
          </ul>
          
          <div style="background: #eff6ff; border-left: 4px solid #3b82f6; padding: 15px; border-radius: 6px; margin: 20px 0;">
            <p style="margin: 0; color: #1e40af; font-size: 13px;">💡 <strong>Pro Tip:</strong> Check out the Training Hub for interactive tutorials and compliance quizzes.</p>
          </div>
          
          <div style="text-align: center; margin: 25px 0;">
            <a href="https://app.caremetricai.com" style="display: inline-block; background: #3b82f6; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 15px;">Continue Learning →</a>
          </div>
          
          <p style="color: #475569;">Keep up the great work!<br>The CareMetric AI Team</p>
        `)
      }
    };

    const content = emailContent[day] || emailContent[1];

    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'CareMetric AI <onboarding@caremetricai.com>',
        to: user_email,
        subject: content.subject,
        html: content.body
      })
    });

    const result = await response.json();

    if (!response.ok) {
      console.error('Resend API error:', result);
      throw new Error(result.message || 'Failed to send email');
    }

    // Log the email
    await base44.asServiceRole.entities.UserActivity.create({
      user_email,
      action: 'onboarding_email_sent',
      details: { day, email_id: result.id },
      page: 'onboarding'
    });

    return Response.json({ success: true, email_id: result.id });
  } catch (error) {
    console.error('[sendOnboardingEmail] Error:', error);
    return Response.json({
      error: 'Failed to send onboarding email',
      details: error.message
    }, { status: 500 });
  }
});