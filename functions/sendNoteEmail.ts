import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { noteContent, recipientEmail, recipientType, patientName, visitType } = await req.json();

    if (!noteContent || !recipientEmail) {
      return Response.json({ 
        error: 'Missing required fields: noteContent, recipientEmail' 
      }, { status: 400 });
    }

    // Format email based on recipient type
    let subject, body;

    if (recipientType === 'provider') {
      subject = `Clinical Note - ${visitType || 'Visit Documentation'}`;
      body = `
Hello ${user.full_name},

Here is your clinical note for ${patientName || 'the patient'}:

${noteContent}

---
This note was generated via CareMetric AI
Date: ${new Date().toLocaleDateString()}
Provider: ${user.full_name}
      `;
    } else {
      // Patient-friendly version
      subject = `Visit Summary from ${user.full_name}`;
      body = `
Dear ${patientName || 'Patient'},

Thank you for your visit. Below is a summary of today's appointment:

${noteContent}

If you have any questions or concerns, please don't hesitate to reach out.

Best regards,
${user.full_name}

---
This summary was sent via CareMetric AI
      `;
    }

    await base44.asServiceRole.integrations.Core.SendEmail({
      from_name: user.full_name,
      to: recipientEmail,
      subject: subject,
      body: body
    });

    return Response.json({
      success: true,
      message: `Note sent to ${recipientEmail}`
    });

  } catch (error) {
    console.error('Send note email error:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});