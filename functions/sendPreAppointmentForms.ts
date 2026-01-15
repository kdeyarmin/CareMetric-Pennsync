import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_id } = await req.json();

        // Get appointment
        const appointment = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
        if (!appointment || appointment.length === 0) {
            return Response.json({ error: 'Appointment not found' }, { status: 404 });
        }

        const apt = appointment[0];

        // Get patient
        const patient = await base44.asServiceRole.entities.Patient.filter({ id: apt.patient_id });
        if (!patient || patient.length === 0) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        const patientData = patient[0];

        // Get applicable form templates for this appointment type
        const formTemplates = await base44.asServiceRole.entities.FormTemplate.filter({
            is_active: true
        });

        const applicableForms = formTemplates.filter(template => 
            template.appointment_types?.includes(apt.appointment_type) || 
            template.appointment_types?.includes('all')
        );

        if (applicableForms.length === 0) {
            return Response.json({ message: 'No forms required for this appointment type' });
        }

        const formsSent = [];

        // Create AppointmentForm records and send emails
        for (const template of applicableForms) {
            // Check if form already sent
            const existing = await base44.asServiceRole.entities.AppointmentForm.filter({
                appointment_id,
                form_template_id: template.id
            });

            if (existing.length > 0) {
                continue; // Skip if already sent
            }

            // Create form record
            const appointmentForm = await base44.asServiceRole.entities.AppointmentForm.create({
                appointment_id,
                patient_id: apt.patient_id,
                form_template_id: template.id,
                form_name: template.form_name,
                status: 'sent',
                sent_date: new Date().toISOString(),
                form_data: {},
                reminder_count: 0
            });

            // Generate form link
            const formLink = `${Deno.env.get('BASE_URL') || 'https://app.base44.com'}/patient-form?id=${appointmentForm.id}`;

            // Send email with form
            const subject = `Complete Your ${template.form_name} - Appointment on ${apt.appointment_date}`;
            const body = `Dear ${patientData.first_name},

To help us prepare for your upcoming ${apt.appointment_type} appointment on ${apt.appointment_date}, please complete the following form:

${template.form_name}

Complete the form here: ${formLink}

This will only take a few minutes and helps us provide you with the best care possible.

If you have any questions or need assistance completing the form, our AI assistant is available to help.

Thank you!
Your Healthcare Team`;

            if (patientData.email) {
                await base44.asServiceRole.integrations.Core.SendEmail({
                    to: patientData.email,
                    subject,
                    body
                });
            }

            formsSent.push({
                form_name: template.form_name,
                form_id: appointmentForm.id
            });
        }

        return Response.json({
            success: true,
            message: `${formsSent.length} form(s) sent`,
            forms_sent: formsSent
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});