import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { appointment_id, reminder_type } = await req.json();

        // Get appointment details
        const appointment = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
        if (!appointment || appointment.length === 0) {
            return Response.json({ error: 'Appointment not found' }, { status: 404 });
        }

        const apt = appointment[0];

        // Get patient details
        const patient = await base44.asServiceRole.entities.Patient.filter({ id: apt.patient_id });
        if (!patient || patient.length === 0) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        const patientData = patient[0];

        // Prepare reminder message
        let subject, body;
        if (reminder_type === '24_hours') {
            subject = 'Appointment Reminder - Tomorrow';
            body = `Dear ${patientData.first_name},\n\nThis is a friendly reminder about your ${apt.appointment_type} appointment tomorrow (${apt.appointment_date}) at ${apt.start_time}.\n\nPlease reply to confirm or call us if you need to reschedule.\n\nBest regards,\nYour Healthcare Team`;
        } else if (reminder_type === '1_hour') {
            subject = 'Appointment Starting Soon';
            body = `Dear ${patientData.first_name},\n\nYour ${apt.appointment_type} appointment is scheduled to start in 1 hour at ${apt.start_time}.\n\nPlease prepare any questions or documents you'd like to discuss.\n\nSee you soon!`;
        } else {
            subject = 'Appointment Confirmation';
            body = `Dear ${patientData.first_name},\n\nYour ${apt.appointment_type} appointment is confirmed for ${apt.appointment_date} at ${apt.start_time}.\n\nPlease arrive 10 minutes early and bring your insurance card.\n\nThank you!`;
        }

        // Send email reminder
        if (patientData.email) {
            await base44.asServiceRole.integrations.Core.SendEmail({
                to: patientData.email,
                subject,
                body
            });
        }

        // Update appointment with reminder sent flag
        await base44.asServiceRole.entities.Appointment.update(appointment_id, {
            last_reminder_sent: new Date().toISOString(),
            reminder_count: (apt.reminder_count || 0) + 1
        });

        return Response.json({
            success: true,
            message: 'Reminder sent successfully',
            sent_to: patientData.email,
            reminder_type
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});