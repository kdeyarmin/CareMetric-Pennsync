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

        // Prepare review request email
        const googleReviewLink = 'https://g.page/r/YOUR_BUSINESS_ID/review';
        
        const subject = 'Share Your Experience';
        const body = `Dear ${patientData.first_name},

We hope you had a positive experience with your recent ${apt.appointment_type} appointment.

If you're satisfied with the care you received, we'd be grateful if you could share your experience with others by leaving a review:

${googleReviewLink}

Your feedback helps other patients find quality care and helps us continuously improve our services.

Thank you for trusting us with your healthcare!

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

        // Update appointment with review request flag
        await base44.asServiceRole.entities.Appointment.update(appointment_id, {
            review_requested: true,
            review_requested_date: new Date().toISOString()
        });

        return Response.json({
            success: true,
            message: 'Review request sent',
            sent_to: patientData.email
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});