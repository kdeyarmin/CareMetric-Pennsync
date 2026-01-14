import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
        const tomorrowStr = tomorrow.toISOString().split('T')[0];

        // Get appointments for tomorrow
        const appointments = await base44.entities.Appointment.filter({
            appointment_date: tomorrowStr,
            status: { $ne: 'cancelled' },
            reminder_sent: false
        });

        let reminders_sent = 0;

        for (const appointment of appointments) {
            const [patients] = await Promise.all([
                base44.entities.Patient.filter({ id: appointment.patient_id })
            ]);

            const patient = patients[0];
            if (!patient || !patient.email) continue;

            // Send reminder email
            const reminderBody = `
Dear ${patient.first_name},

This is a reminder about your upcoming appointment.

Date: ${appointment.appointment_date}
Time: ${appointment.start_time}
Type: ${appointment.visit_type}
${appointment.title ? `Title: ${appointment.title}` : ''}
${appointment.notes ? `Notes: ${appointment.notes}` : ''}

Please arrive 5 minutes early. If you need to reschedule, please contact us as soon as possible.

Thank you,
Healthcare Team
            `.trim();

            await base44.integrations.Core.SendEmail({
                to: patient.email,
                subject: `Appointment Reminder - ${appointment.appointment_date}`,
                body: reminderBody
            });

            // Update appointment reminder status
            await base44.entities.Appointment.update(appointment.id, {
                reminder_sent: true,
                reminder_sent_at: new Date().toISOString()
            });

            reminders_sent++;
        }

        return Response.json({
            success: true,
            reminders_sent,
            appointments_checked: appointments.length
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});