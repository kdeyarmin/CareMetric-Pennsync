import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

/**
 * Resolve Telnyx credentials: prefer env vars, then the in-app IntegrationSecret
 * row with provider 'telnyx'. Mirrors the SMS/voice handlers so fax functions work
 * for agencies that store credentials in-app rather than in the dashboard env.
 */
async function resolveTelnyxCreds(base44) {
  const pick = (v) => (v && String(v).trim() ? String(v).trim() : null);
  let apiKey = pick(Deno.env.get('TELNYX_API_KEY'));
  let publicKey = pick(Deno.env.get('TELNYX_PUBLIC_KEY'));
  let messagingProfileId = pick(Deno.env.get('TELNYX_MESSAGING_PROFILE_ID'));
  let voiceConnectionId = pick(Deno.env.get('TELNYX_VOICE_CONNECTION_ID')) || pick(Deno.env.get('TELNYX_CONNECTION_ID'));
  let faxConnectionId = pick(Deno.env.get('TELNYX_FAX_CONNECTION_ID'));
  try {
    const rows = await base44.asServiceRole.entities.IntegrationSecret.filter({ provider: 'telnyx' });
    const rec = rows?.[0] || {};
    if (!apiKey) apiKey = pick(rec.api_key);
    if (!publicKey) publicKey = pick(rec.public_key);
    if (!messagingProfileId) messagingProfileId = pick(rec.messaging_profile_id);
    if (!voiceConnectionId) voiceConnectionId = pick(rec.voice_connection_id);
    if (!faxConnectionId) faxConnectionId = pick(rec.fax_connection_id);
  } catch { /* ignore */ }
  return { apiKey, publicKey, messagingProfileId, voiceConnectionId, faxConnectionId };
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { event, data } = await req.json();

    // Only process delivered or failed status changes
    const status = data?.status?.toLowerCase();
    if (!['delivered', 'failed'].includes(status)) {
      return Response.json({ skipped: true, reason: 'Status not delivered or failed' });
    }

    // Check if this is an update event with a previous status
    const oldStatus = event?.old_data?.status?.toLowerCase();
    if (oldStatus === status) {
      return Response.json({ skipped: true, reason: 'Status unchanged' });
    }

    const recipientFax = data?.recipient_fax_number || 'Unknown';
    const documentName = data?.document_name || 'Untitled Document';
    const timestamp = new Date().toLocaleString();

    // Prepare notification content
    const subject = `Fax ${status === 'delivered' ? 'Delivered' : 'Failed'}: ${documentName}`;
    const emailBody = `
Your fax has been ${status}.

Document: ${documentName}
Recipient: ${recipientFax}
Time: ${timestamp}
Status: ${status.charAt(0).toUpperCase() + status.slice(1)}
${data?.error_message ? `\nError: ${data.error_message}` : ''}
${data?.twilio_sid ? `\nTracking ID: ${data.twilio_sid}` : ''}

Please log in to your dashboard to view more details.
    `.trim();

    const smsMessage = `Fax ${status === 'delivered' ? 'delivered' : 'failed'}: ${documentName} to ${recipientFax}`;

    // Fetch user preferences (if stored)
    const userPrefs = await base44.auth.me();
    const notifyEmail = userPrefs?.email;
    const notifyPhone = userPrefs?.phone; // Assuming phone is stored on user

    const notifications = [];

    // Send Email notification
    if (notifyEmail) {
      try {
        await base44.integrations.Core.SendEmail({
          to: notifyEmail,
          subject: subject,
          body: emailBody,
          from_name: 'Fax System',
        });
        notifications.push({ type: 'email', status: 'sent' });
      } catch (emailError) {
        console.error('Email notification failed:', emailError);
        notifications.push({ type: 'email', status: 'failed', error: emailError.message });
      }
    }

    // Send SMS notification via Telnyx
    if (notifyPhone) {
      try {
        const { apiKey, messagingProfileId } = await resolveTelnyxCreds(base44);
        const fromNumber = Deno.env.get('TELNYX_FAX_NUMBER'); // Reuse fax number or dedicated SMS number

        if (apiKey && fromNumber) {
          const payload = { from: fromNumber, to: notifyPhone, text: smsMessage };
          if (messagingProfileId) payload.messaging_profile_id = messagingProfileId;
          const response = await fetch('https://api.telnyx.com/v2/messages', {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
          });

          if (response.ok) {
            notifications.push({ type: 'sms', status: 'sent' });
          } else {
            const error = await response.text();
            notifications.push({ type: 'sms', status: 'failed', error });
          }
        }
      } catch (smsError) {
        console.error('SMS notification failed:', smsError);
        notifications.push({ type: 'sms', status: 'failed', error: smsError.message });
      }
    }

    // Log notification attempt
    try {
      // Notification requires user_email (RLS reads on it); user_id is not a
      // field, so the previous create silently failed and the recipient never
      // saw it. Shape mirrors the working pollFaxStatuses notification.
      await base44.asServiceRole.entities.Notification.create({
        user_email: user.email,
        type: status === 'failed' ? 'fax_failed' : 'fax_delivered',
        title: subject,
        message: `Fax to ${recipientFax} has been ${status}`,
        metadata: { related_entity: 'FaxLog', related_entity_id: data?.id },
        is_read: false,
      });
    } catch (logError) {
      console.error('Failed to log notification:', logError);
    }

    return Response.json({
      success: true,
      notifications: notifications,
      faxId: data?.id,
      recipientFax: recipientFax,
      faxStatus: status,
    });
  } catch (error) {
    console.error('Notification service error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});