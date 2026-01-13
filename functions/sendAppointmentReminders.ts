import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    // This function is called by scheduled task, use service role
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDate = tomorrow.toISOString().split('T')[0];

    // Get all appointments for tomorrow that haven't had reminders sent
    const allAppointments = await base44.asServiceRole.entities.Appointment.list('-created_date', 2000);
    
    const upcomingAppointments = allAppointments.filter(apt => 
      apt.appointment_date === tomorrowDate &&
      ['scheduled', 'confirmed'].includes(apt.status) &&
      !apt.reminder_sent
    );

    console.log(`Found ${upcomingAppointments.length} appointments for tomorrow requiring reminders`);

    const results = [];

    for (const appointment of upcomingAppointments) {
      try {
        // Get patient info
        const patients = await base44.asServiceRole.entities.Patient.filter({ id: appointment.patient_id });
        const patient = patients[0];

        if (!patient || !patient.email) {
          console.log(`Skipping appointment ${appointment.id} - no patient email`);
          continue;
        }

        // Get provider info
        const users = await base44.asServiceRole.entities.User.filter({ email: appointment.provider_email });
        const provider = users[0];

        const appointmentDate = new Date(appointment.appointment_date).toLocaleDateString('en-US', { 
          weekday: 'long', 
          year: 'numeric', 
          month: 'long', 
          day: 'numeric' 
        });

        // Send reminder email
        const emailSubject = `Appointment Reminder - ${appointmentDate}`;
        const emailBody = `
Dear ${patient.first_name} ${patient.last_name},

This is a friendly reminder about your upcoming appointment:

Date: ${appointmentDate}
Time: ${appointment.start_time}${appointment.end_time ? ` - ${appointment.end_time}` : ''}
Provider: ${provider?.full_name || 'Your Provider'}
Type: ${appointment.appointment_type === 'telehealth' ? 'Telehealth (Virtual)' : 'In-Person Visit'}

${appointment.appointment_type === 'telehealth' ? `
Your telehealth visit will be conducted via secure video call. Please ensure you have:
- A stable internet connection
- A device with a camera and microphone
- A quiet, private location for your visit

You will receive a link to join the video call shortly before your appointment time.
` : `
Please arrive 10 minutes early for check-in.
`}

${appointment.notes ? `\nNotes: ${appointment.notes}\n` : ''}

If you need to reschedule or cancel, please contact us as soon as possible.

We look forward to seeing you!

Best regards,
${provider?.full_name || 'Your Healthcare Team'}
        `;

        await base44.asServiceRole.integrations.Core.SendEmail({
          to: patient.email,
          subject: emailSubject,
          body: emailBody
        });

        // Update appointment to mark reminder as sent
        await base44.asServiceRole.entities.Appointment.update(appointment.id, {
          reminder_sent: true,
          reminder_sent_date: new Date().toISOString()
        });

        results.push({
          appointment_id: appointment.id,
          patient: `${patient.first_name} ${patient.last_name}`,
          email: patient.email,
          appointment_date: appointment.appointment_date,
          sent: true
        });

        console.log(`Sent reminder for appointment ${appointment.id} to ${patient.email}`);

      } catch (error) {
        console.error(`Error processing appointment ${appointment.id}:`, error);
        results.push({
          appointment_id: appointment.id,
          error: error.message,
          sent: false
        });
      }
    }

    return Response.json({
      success: true,
      total_appointments: upcomingAppointments.length,
      reminders_sent: results.filter(r => r.sent).length,
      results
    });

  } catch (error) {
    console.error('Error sending appointment reminders:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});