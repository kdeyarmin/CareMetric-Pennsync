import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user) {
            return Response.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const { visitId, patientId } = await req.json();

        if (!visitId || !patientId) {
            return Response.json({ error: 'Visit ID and patient ID required' }, { status: 400 });
        }

        const [visits, patients, templates] = await Promise.all([
            base44.entities.Visit.filter({ id: visitId }),
            base44.entities.Patient.filter({ id: patientId }),
            base44.entities.MessageTemplate.filter({ 
                trigger_event: 'visit_completed',
                is_active: true
            })
        ]);

        const visit = visits[0];
        const patient = patients[0];
        const template = templates[0];

        if (!visit || !patient || !template) {
            return Response.json({ error: 'Visit, patient, or template not found' }, { status: 404 });
        }

        let messageBody = template.message_body;

        // Personalize with AI if enabled
        if (template.personalize_with_ai && OPENAI_API_KEY) {
            const response = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    model: 'gpt-4o-mini',
                    messages: [{
                        role: 'user',
                        content: `Personalize this follow-up message for the patient based on their visit:\n\nPatient: ${patient.first_name} ${patient.last_name}\nDiagnosis: ${patient.primary_diagnosis}\nVisit Type: ${visit.visit_type}\n\nTemplate: ${template.message_body}\n\nMake it warm, personal, and empathetic while maintaining professionalism.`
                    }],
                    max_tokens: 500
                })
            });

            const aiResponse = await response.json();
            if (aiResponse.choices?.[0]) {
                messageBody = aiResponse.choices[0].message.content;
            }
        }

        // Standard placeholders
        messageBody = messageBody
            .replace('{{patient_name}}', patient.first_name)
            .replace('{{diagnosis}}', patient.primary_diagnosis || 'your condition')
            .replace('{{provider_name}}', user.full_name);

        // Send email
        if (template.delivery_method === 'email' || template.delivery_method === 'both') {
            if (patient.email) {
                await base44.integrations.Core.SendEmail({
                    to: patient.email,
                    subject: template.subject_line.replace('{{patient_name}}', patient.first_name),
                    body: messageBody
                });
            }
        }

        // Create message record
        await base44.entities.Message.create({
            patient_id: patientId,
            visit_id: visitId,
            template_id: template.id,
            message_type: 'follow_up',
            recipient_email: patient.email,
            subject: template.subject_line,
            body: messageBody,
            delivery_method: template.delivery_method,
            status: 'sent',
            sent_at: new Date().toISOString(),
            personalization_data: { ai_personalized: template.personalize_with_ai }
        });

        return Response.json({ success: true, message: 'Follow-up message sent' });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});