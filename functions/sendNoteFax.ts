import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { recipientFaxNumber, noteContent, patientName, subject } = await req.json();

    if (!recipientFaxNumber || !noteContent) {
      return Response.json({ error: 'Recipient fax number and note content are required' }, { status: 400 });
    }

    const apiKey = Deno.env.get('NOTIFYRE_API_KEY');
    const apiSecret = Deno.env.get('NOTIFYRE_API_SECRET');

    if (!apiKey || !apiSecret) {
      return Response.json({ error: 'Notifyre API credentials not configured' }, { status: 500 });
    }

    // Get provider practice info for header
    const practiceInfo = await base44.entities.ProviderPracticeInfo.filter({
      provider_email: user.email
    });

    let headerText = '';
    if (practiceInfo.length > 0) {
      const info = practiceInfo[0];
      headerText = `
From: ${info.provider_name}
${info.practice_name || ''}
${info.practice_address || ''}
Phone: ${info.practice_phone || ''}
Fax: ${info.practice_fax || ''}
      `;
    }

    // Create HTML content for fax
    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; font-size: 12pt; }
          .header { border-bottom: 2px solid #000; padding-bottom: 10px; margin-bottom: 20px; }
          .content { white-space: pre-wrap; }
          .footer { margin-top: 30px; padding-top: 10px; border-top: 1px solid #ccc; font-size: 10pt; color: #666; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>${subject || 'Clinical Note'}</h2>
          ${patientName ? `<p><strong>Patient:</strong> ${patientName}</p>` : ''}
          <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
          ${headerText ? `<pre>${headerText}</pre>` : ''}
        </div>
        <div class="content">${noteContent.replace(/\n/g, '<br>')}</div>
        <div class="footer">
          <p>This fax transmission contains confidential information intended only for the person(s) named above. 
          If you are not the intended recipient, you are hereby notified that any disclosure, copying, or distribution 
          of this information is strictly prohibited. If you have received this fax in error, please notify the sender 
          immediately.</p>
          <p>Sent via CareMetric AI - HIPAA Compliant Fax Service</p>
        </div>
      </body>
      </html>
    `;

    // Convert HTML to base64 for Notifyre API
    const encoder = new TextEncoder();
    const data = encoder.encode(htmlContent);
    const base64Content = btoa(String.fromCharCode(...data));

    // Send fax via Notifyre API
    const response = await fetch('https://api.notifyre.com/v3/fax/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + btoa(`${apiKey}:${apiSecret}`)
      },
      body: JSON.stringify({
        to: recipientFaxNumber.replace(/[^0-9+]/g, ''), // Clean phone number
        document: {
          content: base64Content,
          contentType: 'text/html',
          fileName: `clinical_note_${Date.now()}.html`
        },
        from: user.phone_number || undefined,
        headerText: `To: ${recipientFaxNumber} | From: ${user.full_name}`,
        subject: subject || 'Clinical Note'
      })
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.message || 'Failed to send fax');
    }

    // Log the fax activity
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'fax_sent',
      details: {
        recipient: recipientFaxNumber,
        patient: patientName,
        fax_id: result.id || result.faxId,
        timestamp: new Date().toISOString()
      },
      page: 'fax'
    });

    return Response.json({
      success: true,
      faxId: result.id || result.faxId,
      status: result.status,
      message: 'Fax sent successfully'
    });

  } catch (error) {
    console.error('Error sending fax:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});