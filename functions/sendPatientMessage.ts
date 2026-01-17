import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
    let user;
    try {
        const base44 = createClientFromRequest(req);
        user = await base44.auth.me();

        if (!user) {
            console.error('[sendPatientMessage] Unauthorized access attempt');
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const requestBody = await req.json();
        const { patientId, subject, body, priority = 'normal', attachments = [] } = requestBody;

        if (!patientId || !subject || !body) {
            console.error('[sendPatientMessage] Missing required fields', { patientId: !!patientId, subject: !!subject, body: !!body });
            return Response.json({ error: 'Patient ID, subject, and body required' }, { status: 400 });
        }

        const patients = await base44.entities.Patient.filter({ id: patientId });
        const patient = patients[0];

        if (!patient) {
            console.error('[sendPatientMessage] Patient not found:', patientId);
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

        // Send notification email to patient if email exists
        if (patient.email) {
            try {
                await base44.integrations.Core.SendEmail({
                    to: patient.email,
                    subject: `New Secure Message from CareMetric AI: ${subject}`,
                    body: `
                        <div style="font-family: Arial, sans-serif; line-height: 1.6;">
                            <p>Dear ${patient.first_name || 'Patient'},</p>
                            <p>You have received a new secure message from your care team at CareMetric AI. Please log in to your patient portal to view the full message securely:</p>
                            <p><strong>Message subject:</strong> ${subject}</p>
                            <p>If you have any questions, please contact your care provider.</p>
                            <p>Sincerely,<br/>The CareMetric AI Team</p>
                            <p style="font-size: 0.8em; color: #888;">This is an automated notification. Please do not reply directly to this email.</p>
                        </div>
                    `,
                    from_name: 'CareMetric AI'
                });
                console.log('[sendPatientMessage] Notification email sent to:', patient.email);
            } catch (emailError) {
                console.error('[sendPatientMessage] Failed to send notification email to:', patient.email, emailError);
                // Continue function execution even if email fails, as the message is already saved
            }
        } else {
            console.warn('[sendPatientMessage] Patient has no email for notification:', patientId);
        }

        return Response.json({
            success: true,
            messageId: message.id,
            conversationId: message.conversation_id
        });
    } catch (error) {
        console.error('[sendPatientMessage] Error:', {
            message: error.message,
            stack: error.stack,
            userEmail: user?.email
        });
        return Response.json({ 
            error: 'Failed to send patient message',
            details: error.message 
        }, { status: 500 });
    }
});