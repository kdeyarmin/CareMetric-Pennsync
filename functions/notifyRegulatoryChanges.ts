import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import { Resend } from 'npm:resend@4.0.0';

Deno.serve(async (req) => {
  try {
    console.log('=== Notifying users of regulatory changes ===');
    const base44 = createClientFromRequest(req);
    
    // Verify admin (this is a scheduled task)
    const user = await base44.auth.me();
    if (user?.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Get recently approved regulatory updates that haven't been notified yet
    const updates = await base44.asServiceRole.entities.RegulatoryUpdate.filter({ 
      status: 'approved',
      notification_sent: { $ne: true }
    });

    if (updates.length === 0) {
      console.log('No new regulatory updates to notify');
      return Response.json({ 
        success: true, 
        message: 'No new updates to notify' 
      });
    }

    // Get all users
    const allUsers = await base44.asServiceRole.entities.User.list();
    const resend = new Resend(Deno.env.get('RESEND_API_KEY'));

    // Send targeted notifications to relevant users
    const notificationPromises = [];

    for (const update of updates) {
      // Filter users who should receive this update
      const relevantUsers = allUsers.filter(u => {
        // Filter by provider type
        const affectedAreas = update.affected_areas || [];
        const isRelevantToProvider = affectedAreas.length === 0 || 
          affectedAreas.includes(u.credential_type) ||
          affectedAreas.includes('all');
        
        // Filter by care setting
        const careType = update.care_type || 'both';
        const isRelevantToCareType = careType === 'both' || 
          careType === u.service_type;
        
        return isRelevantToProvider && isRelevantToCareType;
      });

      console.log(`Update "${update.title}" relevant to ${relevantUsers.length} users`);

      // Send email to each relevant user
      for (const relevantUser of relevantUsers) {
        const emailPromise = resend.emails.send({
          from: 'CareMetric AI <notifications@caremetricai.com>',
          to: relevantUser.email,
          subject: `🚨 New Regulatory Update: ${update.title}`,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h2>New Regulatory Update</h2>
              
              <div style="background-color: ${
                update.impact_level === 'critical' ? '#fee2e2' : 
                update.impact_level === 'high' ? '#fed7aa' : 
                '#dbeafe'
              }; border-left: 4px solid ${
                update.impact_level === 'critical' ? '#dc2626' : 
                update.impact_level === 'high' ? '#ea580c' : 
                '#2563eb'
              }; padding: 15px; margin: 20px 0;">
                <p style="margin: 0; font-weight: bold; text-transform: uppercase;">
                  ${update.impact_level || 'Medium'} Impact
                </p>
                <h3 style="margin: 10px 0 5px 0;">${update.title}</h3>
                <p style="margin: 5px 0 0 0;">Source: ${update.source}</p>
              </div>
              
              <p><strong>Summary:</strong></p>
              <p>${update.summary}</p>
              
              ${update.effective_date ? `
                <p><strong>Effective Date:</strong> ${new Date(update.effective_date).toLocaleDateString()}</p>
              ` : ''}
              
              ${update.required_actions?.length > 0 ? `
                <p><strong>Required Actions:</strong></p>
                <ul>
                  ${update.required_actions.map(action => `<li>${action}</li>`).join('')}
                </ul>
              ` : ''}
              
              ${update.suggested_training?.length > 0 ? `
                <p><strong>Recommended Training:</strong></p>
                <ul>
                  ${update.suggested_training.map(training => `<li>${training}</li>`).join('')}
                </ul>
              ` : ''}
              
              <div style="margin-top: 30px; padding: 20px; background-color: #f3f4f6; border-radius: 8px;">
                <p style="margin: 0 0 10px 0;">Review the full details in your dashboard:</p>
                <a href="https://www.caremetricai.com" 
                   style="display: inline-block; padding: 12px 24px; background-color: #2563eb; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
                  View in Dashboard
                </a>
              </div>
              
              ${update.reference_url ? `
                <p style="margin-top: 20px; font-size: 12px; color: #6b7280;">
                  <a href="${update.reference_url}" style="color: #2563eb;">Official Reference</a>
                </p>
              ` : ''}
              
              <p style="margin-top: 30px; font-size: 12px; color: #6b7280;">
                This notification was sent because this update is relevant to your provider type (${relevantUser.credential_type}) 
                ${relevantUser.service_type ? `and care setting (${relevantUser.service_type})` : ''}.
              </p>
            </div>
          `
        });
        
        notificationPromises.push(emailPromise);
      }

      // Mark this update as notified
      await base44.asServiceRole.entities.RegulatoryUpdate.update(update.id, {
        notification_sent: true,
        notification_sent_at: new Date().toISOString()
      });
    }

    // Send all emails
    await Promise.all(notificationPromises);

    console.log(`Sent ${notificationPromises.length} notifications for ${updates.length} updates`);
    return Response.json({ 
      success: true, 
      updatesNotified: updates.length,
      emailsSent: notificationPromises.length
    });

  } catch (error) {
    console.error('Error in notifyRegulatoryChanges:', error);
    return Response.json({ 
      error: error.message 
    }, { status: 500 });
  }
});