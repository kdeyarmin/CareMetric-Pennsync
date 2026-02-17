import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { patient_id, sender_name, sender_email, body, channel, patient_name, recipient_emails } = await req.json();

    if (!patient_id || !body || !recipient_emails?.length) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const channelLabel = channel === 'team' ? 'Care Team' : 'Patient';
    const subject = `New ${channelLabel} Message - ${patient_name || 'Patient'}`;

    const htmlBody = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <div style="background: #1e40af; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
          <h2 style="margin: 0; font-size: 18px;">🔒 Secure Message Notification</h2>
          <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.9;">HIPAA-Compliant Communication</p>
        </div>
        <div style="background: #f8fafc; padding: 24px; border: 1px solid #e2e8f0; border-radius: 0 0 8px 8px;">
          <p style="margin: 0 0 12px; color: #475569;">
            <strong>${sender_name || sender_email}</strong> sent a new <strong>${channelLabel}</strong> message regarding <strong>${patient_name || 'a patient'}</strong>.
          </p>
          <div style="background: white; padding: 16px; border-radius: 8px; border-left: 4px solid #2563eb; margin: 16px 0;">
            <p style="margin: 0; color: #334155; font-size: 14px;">${body.substring(0, 200)}${body.length > 200 ? '...' : ''}</p>
          </div>
          <p style="margin: 16px 0 0; font-size: 12px; color: #94a3b8;">
            Log in to CareMetric AI to view the full message and respond. Do not reply to this email.
          </p>
        </div>
      </div>
    `;

    // Send to each recipient
    const results = [];
    for (const email of recipient_emails) {
      if (email === sender_email) continue; // Don't notify sender
      try {
        await base44.integrations.Core.SendEmail({
          to: email,
          subject,
          body: htmlBody,
          from_name: 'CareMetric AI Messaging'
        });
        results.push({ email, status: 'sent' });
      } catch (emailErr) {
        console.error(`Failed to send to ${email}:`, emailErr.message);
        results.push({ email, status: 'failed', error: emailErr.message });
      }
    }

    return Response.json({ success: true, results });
  } catch (error) {
    console.error('Notification error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});