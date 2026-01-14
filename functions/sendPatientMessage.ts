import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { patientId, subject, body, priority = 'normal', attachments = [] } = await req.json();

        if (!patientId || !subject || !body) {
            return Response.json({ error: 'Patient ID, subject, and body required' }, { status: 400 });
        }

        const patients = await base44.entities.Patient.filter({ id: patientId });
        const patient = patients[0];

        if (!patient) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        // Create secure message record
        const message = await base44.entities.PatientMessage.create({
            patient_id: patientId,
            provider_email: user.email,
            subject: subject,
            sender_type: 'provider',
            sender_email: user.email,
            sender_name: user.full_name,
            body: body,
            priority: priority,
            status: 'unread',
            is_encrypted: true,
            attachments: attachments,
            conversation_id: `conv-${Date.now()}`
        });

        // Send notification email to patient
        if (patient.email) {
            await base44.integrations.Core.SendEmail({
                to: patient.email,
                subject: `New Secure Message: ${subject}`,
                body: `You have received a new secure message from ${user.full_name}. Please log in to your portal to read it.`
            });
        }

        return Response.json({
            success: true,
            messageId: message.id,
            conversationId: message.conversation_id
        });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});