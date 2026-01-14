import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

const TWILIO_ACCOUNT_SID = Deno.env.get('TWILIO_ACCOUNT_SID');
const TWILIO_AUTH_TOKEN = Deno.env.get('TWILIO_AUTH_TOKEN');
const TWILIO_PHONE = Deno.env.get('TWILIO_PHONE_NUMBER');

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const user = await base44.auth.me();

        if (!user || user.role !== 'admin') {
            return Response.json({ error: 'Admin access required' }, { status: 403 });
        }

        // Find upcoming appointments (next 24 hours)
        const visits = await base44.entities.Visit.list();
        const now = new Date();
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

        const upcomingVisits = visits.filter(v => {
            const visitDate = new Date(v.visit_date);
            return visitDate >= now && visitDate <= tomorrow && v.status === 'scheduled';
        });

        let reminders_sent = 0;

        for (const visit of upcomingVisits) {
            const [patients, templates] = await Promise.all([
                base44.entities.Patient.filter({ id: visit.patient_id }),
                base44.entities.MessageTemplate.filter({ 
                    trigger_event: 'appointment_24h_before',
                    is_active: true
                })
            ]);

            const patient = patients[0];
            const template = templates[0];

            if (!patient || !template) continue;

            // Render template
            const renderedBody = template.message_body
                .replace('{{patient_name}}', patient.first_name)
                .replace('{{appointment_date}}', visit.visit_date)
                .replace('{{appointment_time}}', visit.visit_time || 'TBD');

            // Send email
            if (template.delivery_method === 'email' || template.delivery_method === 'both') {
                if (patient.email) {
                    await base44.integrations.Core.SendEmail({
                        to: patient.email,
                        subject: template.subject_line,
                        body: renderedBody
                    });

                    await base44.entities.Message.create({
                        patient_id: visit.patient_id,
                        visit_id: visit.id,
                        template_id: template.id,
                        message_type: 'appointment_reminder',
                        recipient_email: patient.email,
                        subject: template.subject_line,
                        body: renderedBody,
                        delivery_method: 'email',
                        status: 'sent',
                        sent_at: new Date().toISOString()
                    });

                    reminders_sent++;
                }
            }

            // Send SMS
            if (template.delivery_method === 'sms' || template.delivery_method === 'both') {
                if (patient.phone && template.sms_body) {
                    const smsBody = template.sms_body
                        .replace('{{patient_name}}', patient.first_name)
                        .replace('{{appointment_date}}', visit.visit_date)
                        .replace('{{appointment_time}}', visit.visit_time || 'TBD');

                    try {
                        const auth = btoa(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`);
                        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Messages.json`, {
                            method: 'POST',
                            headers: {
                                'Authorization': `Basic ${auth}`,
                                'Content-Type': 'application/x-www-form-urlencoded'
                            },
                            body: new URLSearchParams({
                                From: TWILIO_PHONE,
                                To: patient.phone,
                                Body: smsBody
                            })
                        });

                        await base44.entities.Message.create({
                            patient_id: visit.patient_id,
                            visit_id: visit.id,
                            template_id: template.id,
                            message_type: 'appointment_reminder',
                            recipient_phone: patient.phone,
                            body: smsBody,
                            delivery_method: 'sms',
                            status: 'sent',
                            sent_at: new Date().toISOString()
                        });

                        reminders_sent++;
                    } catch (error) {
                        console.error('SMS send error:', error);
                    }
                }
            }
        }

        return Response.json({ success: true, reminders_sent, upcoming_visits: upcomingVisits.length });
    } catch (error) {
        return Response.json({ error: error.message }, { status: 500 });
    }
});