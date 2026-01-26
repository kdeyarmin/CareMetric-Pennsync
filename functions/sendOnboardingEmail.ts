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

    // Different email content based on day
    const emailContent = {
      1: {
        subject: '🎉 Welcome to CareMetric AI!',
        body: `
          <h1>Welcome to CareMetric AI, ${user_name || 'there'}!</h1>
          <p>We're excited to have you on board. CareMetric AI is here to revolutionize your healthcare documentation.</p>
          
          <h2>🚀 Getting Started</h2>
          <ul>
            <li><strong>Add Your First Patient:</strong> Navigate to the Patients page to start building your patient roster</li>
            <li><strong>Try Smart Notes:</strong> Experience AI-powered documentation that saves hours of work</li>
            <li><strong>Explore Features:</strong> Check out our comprehensive suite of tools designed for healthcare professionals</li>
          </ul>
          
          <p>Need help? Our support team is here for you at <a href="mailto:support@caremetricai.com">support@caremetricai.com</a></p>
          
          <p>Best regards,<br>The CareMetric AI Team</p>
        `
      },
      3: {
        subject: '💡 Top 3 Features You Should Try',
        body: `
          <h1>Hi ${user_name || 'there'}!</h1>
          <p>We hope you're enjoying CareMetric AI. Here are our top 3 features to maximize your productivity:</p>
          
          <h2>🎯 Must-Try Features</h2>
          <ol>
            <li><strong>Smart Note Assistant:</strong> Turn rough notes into Medicare-compliant documentation in seconds</li>
            <li><strong>OASIS Analyzer:</strong> Ensure compliance and optimize your PDGM scores</li>
            <li><strong>Care Plan Management:</strong> Create comprehensive care plans with AI assistance</li>
          </ol>
          
          <p>Ready to explore? <a href="https://app.caremetricai.com/SmartNoteAssistant">Try Smart Notes Now</a></p>
          
          <p>Questions? Reply to this email - we'd love to hear from you!</p>
          
          <p>Best,<br>The CareMetric AI Team</p>
        `
      },
      7: {
        subject: '📊 Your First Week Recap & Tips',
        body: `
          <h1>Your First Week with CareMetric AI 🎉</h1>
          <p>Hi ${user_name || 'there'},</p>
          <p>Congratulations on completing your first week! Here's what you might have missed:</p>
          
          <h2>🔥 Pro Tips</h2>
          <ul>
            <li><strong>Voice Dictation:</strong> Use voice commands to speed up documentation</li>
            <li><strong>Custom Templates:</strong> Create reusable templates for common visit types</li>
            <li><strong>Mobile Access:</strong> Document on-the-go with our mobile-optimized interface</li>
            <li><strong>Compliance Monitoring:</strong> Stay audit-ready with real-time compliance checks</li>
          </ul>
          
          <h2>📚 Resources</h2>
          <p>Check out our <a href="https://caremetricai.com/resources">Resource Center</a> for video tutorials and best practices.</p>
          
          <p>Keep up the great work!<br>The CareMetric AI Team</p>
        `
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