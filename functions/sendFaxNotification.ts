import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json();
    const { user_email, fax_history_id, status, recipient_name, recipient_fax_number } = body;

    if (!user_email || !fax_history_id || !status) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Get user to check notification preferences
    const users = await base44.asServiceRole.entities.User.filter({ email: user_email });
    const user = users?.[0];
    if (!user) {
      console.log('[sendFaxNotification] User not found:', user_email);
      return Response.json({ error: 'User not found' }, { status: 404 });
    }

    const prefs = user.fax_notification_preferences || {
      notify_on_sent: true,
      notify_on_delivered: true,
      notify_on_failed: true,
      channels: { in_app: true, email: true, sms: false }
    };

    // Check if user wants this notification type
    const shouldNotify = 
      (status === 'sent' && prefs.notify_on_sent !== false) ||
      (status === 'delivered' && prefs.notify_on_delivered !== false) ||
      (status === 'failed' && prefs.notify_on_failed !== false);

    if (!shouldNotify) {
      console.log('[sendFaxNotification] User opted out of', status, 'notifications');
      return Response.json({ success: true, skipped: true });
    }

    const channels = prefs.channels || { in_app: true, email: true, sms: false };
    const channelsSent = [];

    const displayRecipient = recipient_name || recipient_fax_number || 'Unknown';
    const statusMessages = {
      sent: `Your fax to ${displayRecipient} has been sent successfully.`,
      delivered: `Your fax to ${displayRecipient} has been delivered.`,
      failed: `Your fax to ${displayRecipient} has failed. Please retry from the Fax Queue.`
    };
    const message = statusMessages[status] || `Fax status update: ${status}`;

    // 1. In-app notification (always create the record)
    if (channels.in_app !== false) {
      await base44.asServiceRole.entities.FaxNotification.create({
        user_email,
        fax_history_id,
        recipient_name: recipient_name || '',
        recipient_fax_number: recipient_fax_number || '',
        status,
        message,
        is_read: false,
        channels_sent: ['in_app']
      });
      channelsSent.push('in_app');
      console.log('[sendFaxNotification] In-app notification created');
    }

    // 2. Email notification
    if (channels.email !== false) {
      const statusEmoji = status === 'sent' ? '✅' : status === 'delivered' ? '📬' : '❌';
      const statusLabel = status.charAt(0).toUpperCase() + status.slice(1);

      const emailBody = `
        <div style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto;">
          <div style="background: #1e40af; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 18px;">${statusEmoji} Fax ${statusLabel}</h2>
          </div>
          <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 8px 8px;">
            <p style="margin: 0 0 12px 0; color: #334155;">${message}</p>
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 6px 0; color: #64748b; font-size: 13px;">Recipient:</td><td style="padding: 6px 0; color: #1e293b; font-size: 13px; font-weight: 600;">${displayRecipient}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b; font-size: 13px;">Fax Number:</td><td style="padding: 6px 0; color: #1e293b; font-size: 13px;">${recipient_fax_number || 'N/A'}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b; font-size: 13px;">Status:</td><td style="padding: 6px 0; color: ${status === 'failed' ? '#dc2626' : '#16a34a'}; font-size: 13px; font-weight: 600;">${statusLabel}</td></tr>
              <tr><td style="padding: 6px 0; color: #64748b; font-size: 13px;">Time:</td><td style="padding: 6px 0; color: #1e293b; font-size: 13px;">${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}</td></tr>
            </table>
            ${status === 'failed' ? '<p style="margin: 16px 0 0 0; padding: 12px; background: #fef2f2; border-radius: 6px; color: #991b1b; font-size: 13px;">You can retry this fax from the Fax Queue page.</p>' : ''}
          </div>
        </div>
      `;

      try {
        await base44.asServiceRole.integrations.Core.SendEmail({
          to: user_email,
          subject: `${statusEmoji} Fax ${statusLabel} - ${displayRecipient}`,
          body: emailBody,
          from_name: 'CareMetric AI Fax'
        });
        channelsSent.push('email');
        console.log('[sendFaxNotification] Email sent to', user_email);
      } catch (emailErr) {
        console.error('[sendFaxNotification] Email failed:', emailErr.message);
      }
    }

    // 3. SMS notification (if user has phone and opted in)
    if (channels.sms === true && user.phone_number) {
      try {
        const smsText = `CareMetric Fax: ${message}`;
        // Use Twilio for SMS
        const twilioSid = Deno.env.get("TWILIO_ACCOUNT_SID");
        const twilioAuth = Deno.env.get("TWILIO_AUTH_TOKEN");
        const twilioFrom = Deno.env.get("TWILIO_PHONE_NUMBER");

        if (twilioSid && twilioAuth && twilioFrom) {
          const smsRes = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
            {
              method: 'POST',
              headers: {
                'Authorization': 'Basic ' + btoa(`${twilioSid}:${twilioAuth}`),
                'Content-Type': 'application/x-www-form-urlencoded'
              },
              body: new URLSearchParams({
                To: user.phone_number,
                From: twilioFrom,
                Body: smsText
              })
            }
          );
          if (smsRes.ok) {
            channelsSent.push('sms');
            console.log('[sendFaxNotification] SMS sent to', user.phone_number);
          } else {
            const smsErr = await smsRes.text();
            console.error('[sendFaxNotification] SMS failed:', smsErr);
          }
        } else {
          console.log('[sendFaxNotification] Twilio not configured, skipping SMS');
        }
      } catch (smsErr) {
        console.error('[sendFaxNotification] SMS error:', smsErr.message);
      }
    }

    // Update the notification record with all channels sent
    if (channelsSent.length > 1 && channels.in_app !== false) {
      const notifs = await base44.asServiceRole.entities.FaxNotification.filter({
        user_email, fax_history_id
      });
      if (notifs.length > 0) {
        await base44.asServiceRole.entities.FaxNotification.update(notifs[0].id, {
          channels_sent: channelsSent
        });
      }
    }

    return Response.json({ success: true, channels_sent: channelsSent });
  } catch (error) {
    console.error('[sendFaxNotification] Error:', error.message, error.stack);
    return Response.json({ error: error.message }, { status: 500 });
  }
});