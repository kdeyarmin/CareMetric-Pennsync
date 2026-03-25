import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== Trial Ending Email Campaign Started ===');
    const base44 = createClientFromRequest(req);
    
    // Get all subscriptions that are trialing and ending soon
    const allSubscriptions = await base44.asServiceRole.entities.Subscription.filter({
      status: 'trialing'
    });
    
    console.log(`Found ${allSubscriptions.length} active trials`);
    
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    
    // Filter subscriptions ending in the next 3 days
    const endingSoon = allSubscriptions.filter(sub => {
      if (!sub.trial_end) return false;
      const trialEnd = new Date(sub.trial_end);
      return trialEnd <= threeDaysFromNow && trialEnd > now;
    });
    
    console.log(`${endingSoon.length} trials ending in the next 3 days`);
    
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));
    let emailsSent = 0;
    const errors = [];
    
    for (const subscription of endingSoon) {
      try {
        const trialEnd = new Date(subscription.trial_end);
        const daysRemaining = Math.ceil((trialEnd - now) / (1000 * 60 * 60 * 24));
        
        // Get user details
        const users = await base44.asServiceRole.entities.User.filter({ email: subscription.user_email });
        const user = users[0];
        
        if (!user) {
          console.log(`User not found for email: ${subscription.user_email}`);
          continue;
        }
        
        await resend.emails.send({
          from: 'CareMetric AI <team@caremetricai.com>',
          to: subscription.user_email,
          subject: `Your CareMetric AI Trial Ends in ${daysRemaining} Day${daysRemaining > 1 ? 's' : ''}`,
          html: `
            <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 600px; margin: 0 auto; background-color: #ffffff;">
              <!-- Header -->
              <div style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); padding: 40px 30px; text-align: center; border-radius: 8px 8px 0 0;">
                <h1 style="color: #ffffff; margin: 0; font-size: 28px; font-weight: 700;">CareMetric AI</h1>
                <p style="color: #e0f2fe; margin: 10px 0 0 0; font-size: 14px;">Professional Healthcare Documentation Platform</p>
              </div>
              
              <!-- Main Content -->
              <div style="padding: 40px 30px; background-color: #ffffff;">
                <p style="font-size: 16px; color: #1f2937; margin: 0 0 20px 0;">Dear ${user.full_name || 'Healthcare Professional'},</p>
                
                <p style="font-size: 16px; color: #374151; line-height: 1.6; margin: 0 0 20px 0;">
                  We hope you've been enjoying your CareMetric AI trial. This is a friendly reminder that your <strong>14-day free trial will expire in ${daysRemaining} day${daysRemaining > 1 ? 's' : ''}</strong> on <strong>${trialEnd.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</strong>.
                </p>
                
                <!-- Value Proposition -->
                <div style="background-color: #f0f9ff; border-left: 4px solid #3b82f6; padding: 20px; margin: 25px 0; border-radius: 4px;">
                  <h3 style="color: #1e40af; margin: 0 0 15px 0; font-size: 18px;">Continue Your Journey with CareMetric AI</h3>
                  <p style="color: #1f2937; margin: 0; font-size: 15px; line-height: 1.6;">
                    Don't lose access to the tools that are transforming your clinical documentation workflow. Our platform continues to help healthcare professionals save hours each week while maintaining the highest standards of compliance.
                  </p>
                </div>
                
                <!-- What You'll Keep -->
                <h3 style="color: #1f2937; font-size: 18px; margin: 30px 0 15px 0;">What You'll Keep with a Subscription:</h3>
                <table style="width: 100%; margin-bottom: 25px;">
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>AI-Powered Smart Notes</strong> - Generate compliant documentation in seconds
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>Medical Scribe</strong> - Voice-to-text transcription with clinical accuracy
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>Automated Care Plans</strong> - Evidence-based care planning assistance
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>OASIS & Compliance Tools</strong> - Real-time compliance monitoring
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>Analytics Dashboard</strong> - Track performance and outcomes
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 8px 0; color: #374151; font-size: 15px;">
                      <span style="color: #3b82f6; font-size: 18px; margin-right: 10px;">✓</span>
                      <strong>Unlimited Patient Records</strong> - No caps or limitations
                    </td>
                  </tr>
                </table>
                
                <!-- Pricing -->
                <div style="background-color: #fafafa; padding: 25px; border-radius: 8px; margin: 25px 0; border: 1px solid #e5e7eb;">
                  <h3 style="color: #1f2937; margin: 0 0 20px 0; font-size: 18px; text-align: center;">Choose Your Plan</h3>
                  
                  <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <span style="color: #374151; font-size: 16px;"><strong>Monthly Plan</strong></span>
                      <span style="color: #3b82f6; font-size: 20px; font-weight: 700;">$29.99<span style="font-size: 14px; color: #6b7280;">/month</span></span>
                    </div>
                  </div>
                  
                  <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <span style="color: #374151; font-size: 16px;"><strong>3-Month Plan</strong></span>
                        <span style="background-color: #dbeafe; color: #1e40af; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; font-weight: 600;">SAVE 9%</span>
                      </div>
                      <span style="color: #3b82f6; font-size: 20px; font-weight: 700;">$81.99<span style="font-size: 14px; color: #6b7280;">/month</span></span>
                    </div>
                  </div>
                  
                  <div style="margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #e5e7eb;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <span style="color: #374151; font-size: 16px;"><strong>6-Month Plan</strong></span>
                        <span style="background-color: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; font-weight: 600;">SAVE 17%</span>
                      </div>
                      <span style="color: #3b82f6; font-size: 20px; font-weight: 700;">$149.99<span style="font-size: 14px; color: #6b7280;">/month</span></span>
                    </div>
                  </div>
                  
                  <div style="margin-bottom: 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                      <div>
                        <span style="color: #374151; font-size: 16px;"><strong>Yearly Plan</strong></span>
                        <span style="background-color: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 12px; font-size: 11px; margin-left: 8px; font-weight: 600;">BEST VALUE</span>
                      </div>
                      <span style="color: #3b82f6; font-size: 20px; font-weight: 700;">$264.99<span style="font-size: 14px; color: #6b7280;">/month</span></span>
                    </div>
                  </div>
                </div>
                
                <!-- CTA Button -->
                <div style="text-align: center; margin: 30px 0;">
                  <a href="https://www.caremetricai.com/pricing" 
                     style="display: inline-block; background-color: #3b82f6; color: #ffffff; padding: 16px 40px; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(59, 130, 246, 0.2);">
                    Choose Your Plan & Continue
                  </a>
                </div>
                
                <!-- What Happens Next -->
                <div style="background-color: #fef9f3; border: 1px solid #fed7aa; padding: 20px; border-radius: 6px; margin: 25px 0;">
                  <h4 style="color: #92400e; margin: 0 0 10px 0; font-size: 16px;">📌 What Happens After Your Trial?</h4>
                  <p style="color: #78350f; margin: 0; font-size: 14px; line-height: 1.6;">
                    If you don't select a plan before your trial expires, your access will be paused. Your data will remain secure and available when you return - simply choose a plan to reactivate your account instantly.
                  </p>
                </div>
                
                <!-- Support -->
                <p style="font-size: 15px; color: #374151; line-height: 1.6; margin: 25px 0 15px 0;">
                  Have questions about pricing or features? Our team is here to help:
                </p>
                <p style="font-size: 15px; color: #374151; margin: 0;">
                  📧 <a href="mailto:support@caremetricai.com" style="color: #3b82f6; text-decoration: none;">support@caremetricai.com</a>
                </p>
                
                <!-- Closing -->
                <div style="margin-top: 40px; padding-top: 30px; border-top: 1px solid #e5e7eb;">
                  <p style="font-size: 15px; color: #374151; margin: 0 0 10px 0;">Thank you for choosing CareMetric AI,</p>
                  <p style="font-size: 15px; color: #1f2937; font-weight: 600; margin: 0;">The CareMetric AI Team</p>
                </div>
              </div>
              
              <!-- Footer -->
              <div style="background-color: #f9fafb; padding: 25px 30px; text-align: center; border-radius: 0 0 8px 8px; border-top: 1px solid #e5e7eb;">
                <p style="font-size: 12px; color: #6b7280; margin: 0 0 8px 0;">
                  CareMetric AI - Professional Healthcare Documentation Platform
                </p>
                <p style="font-size: 11px; color: #9ca3af; margin: 0;">
                  © ${new Date().getFullYear()} CareMetric AI. All rights reserved.
                </p>
              </div>
            </div>
          `
        });
        
        console.log(`✅ Email sent to: ${subscription.user_email} (${daysRemaining} days remaining)`);
        emailsSent++;
        
      } catch (emailError) {
        console.error(`❌ Failed to send email to ${subscription.user_email}:`, emailError.message);
        errors.push({ email: subscription.user_email, error: emailError.message });
      }
    }
    
    console.log(`=== Campaign Complete: ${emailsSent}/${endingSoon.length} emails sent ===`);
    
    return Response.json({ 
      success: true,
      emails_sent: emailsSent,
      trials_ending_soon: endingSoon.length,
      errors: errors.length > 0 ? errors : null
    });
    
  } catch (error) {
    console.error('Campaign error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});