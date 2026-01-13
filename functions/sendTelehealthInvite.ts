import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { appointmentId, patientEmail, patientName, providerName, appointmentDate, startTime, endTime } = await req.json();

    if (!appointmentId || !patientEmail || !patientName) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    // Format the appointment details for the email
    const appointmentDateTime = new Date(appointmentDate);
    const formattedDate = appointmentDateTime.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });

    const emailBody = `
Hello ${patientName},

You have been scheduled for a telehealth appointment with ${providerName}.

Appointment Details:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Date: ${formattedDate}
Time: ${startTime}${endTime ? ` - ${endTime}` : ''}
Type: Virtual Visit (Telehealth)

What to expect:
• You will receive a secure link to join the visit shortly before the appointment
• Ensure you have a quiet, private space with good internet connection
• Have any insurance cards or medical documents readily available
• Arrive 5-10 minutes early

If you need to reschedule or cancel, please contact us at least 24 hours in advance.

Questions? Reply to this email or contact us directly.

Best regards,
${providerName}
CareMetric AI Telehealth
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    `.trim();

    // Send the email
    const emailResult = await base44.integrations.Core.SendEmail({
      to: patientEmail,
      subject: `Telehealth Appointment Scheduled - ${formattedDate} at ${startTime}`,
      body: emailBody,
      from_name: providerName || 'CareMetric AI'
    });

    // Update appointment to mark reminder as sent
    if (appointmentId) {
      await base44.entities.Appointment.update(appointmentId, {
        reminder_sent: true,
        reminder_sent_date: new Date().toISOString()
      });
    }

    return Response.json({
      success: true,
      message: 'Telehealth invitation email sent successfully',
      email: patientEmail
    });
  } catch (error) {
    console.error('Error sending telehealth invite:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});