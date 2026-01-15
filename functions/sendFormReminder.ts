import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_form_id } = await req.json();

        // Get appointment form
        const appointmentForm = await base44.asServiceRole.entities.AppointmentForm.filter({ 
            id: appointment_form_id 
        });
        if (!appointmentForm || appointmentForm.length === 0) {
            return Response.json({ error: 'Form not found' }, { status: 404 });
        }

        const form = appointmentForm[0];

        // Get appointment and patient
        const appointment = await base44.asServiceRole.entities.Appointment.filter({ 
            id: form.appointment_id 
        });
        const patient = await base44.asServiceRole.entities.Patient.filter({ 
            id: form.patient_id 
        });

        if (!appointment.length || !patient.length) {
            return Response.json({ error: 'Related data not found' }, { status: 404 });
        }

        const apt = appointment[0];
        const patientData = patient[0];

        // Generate form link
        const formLink = `${Deno.env.get('BASE_URL') || 'https://app.base44.com'}/patient-form?id=${form.id}`;

        // Customize message based on form status
        let subject, body;
        
        if (form.status === 'incomplete' && form.ai_analysis) {
            subject = `Action Required: Complete Your ${form.form_name}`;
            body = `Dear ${patientData.first_name},

We noticed your ${form.form_name} is incomplete. Your appointment is on ${apt.appointment_date}, and we need this information to provide the best care.

Missing Information:
${form.missing_fields?.map(f => `- ${f}`).join('\n') || 'Some fields need more detail'}

Complete your form here: ${formLink}

Need help? Our AI assistant can guide you through any confusing sections.

Thank you!
Your Healthcare Team`;
        } else {
            subject = `Reminder: Complete Your ${form.form_name}`;
            body = `Dear ${patientData.first_name},

This is a friendly reminder to complete your ${form.form_name} before your appointment on ${apt.appointment_date}.

Complete the form here: ${formLink}

This will only take a few minutes. If you need assistance, our AI helper is available.

Thank you!
Your Healthcare Team`;
        }

        // Send reminder
        if (patientData.email) {
            await base44.asServiceRole.integrations.Core.SendEmail({
                to: patientData.email,
                subject,
                body
            });
        }

        // Update reminder count
        await base44.asServiceRole.entities.AppointmentForm.update(appointment_form_id, {
            reminder_count: (form.reminder_count || 0) + 1,
            last_reminder_sent: new Date().toISOString()
        });

        return Response.json({
            success: true,
            message: 'Reminder sent',
            reminder_number: (form.reminder_count || 0) + 1
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});