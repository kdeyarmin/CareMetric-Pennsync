import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_id } = await req.json();

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

        // Prepare satisfaction survey email
        const surveyLink = `${Deno.env.get('BASE_URL') || 'https://app.base44.com'}/survey?apt=${appointment_id}`;
        
        const subject = 'How was your appointment?';
        const body = `Dear ${patientData.first_name},

Thank you for your recent ${apt.appointment_type} appointment on ${apt.appointment_date}.

We value your feedback! Please take a moment to complete our brief satisfaction survey:
${surveyLink}

Your responses help us improve our care and services.

Best regards,
Your Healthcare Team`;

        // Send email
        if (patientData.email) {
            await base44.asServiceRole.integrations.Core.SendEmail({
                to: patientData.email,
                subject,
                body
            });
        }

        // Update appointment with survey sent flag
        await base44.asServiceRole.entities.Appointment.update(appointment_id, {
            satisfaction_survey_sent: true,
            satisfaction_survey_sent_date: new Date().toISOString()
        });

        return Response.json({
            success: true,
            message: 'Satisfaction survey sent',
            sent_to: patientData.email
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});