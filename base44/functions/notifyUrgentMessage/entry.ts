import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);
        const payload = await req.json();
        
        const messageData = payload.data;
        
        if (!messageData || messageData.priority !== 'urgent') {
             return Response.json({ success: true, ignored: true });
        }
        
        let nursesToNotify = [];
        let patientName = "Unknown";
        
        if (messageData.patient_id) {
            try {
                const patient = await base44.asServiceRole.entities.Patient.get(messageData.patient_id);
                nursesToNotify = patient.assigned_nurses || [];
                patientName = `${patient.first_name} ${patient.last_name}`;
            } catch (e) {
                console.error("Error fetching patient", e);
            }
        }
        
        let notifiedCount = 0;
        
        // Coerce message_text — an attachment-only or malformed urgent message may
        // have no body, and an unguarded .substring()/.length would throw, 500 the
        // handler, and leave the nurse un-notified of an urgent message.
        const bodyText = String(messageData.message_text || '');
        const bodyPreview = `${bodyText.substring(0, 100)}${bodyText.length > 100 ? '...' : ''}`;

        for (const nurseEmail of nursesToNotify) {
            if (nurseEmail === messageData.sender_email) continue;

            await base44.asServiceRole.entities.Notification.create({
                user_email: nurseEmail,
                title: `URGENT Message: ${patientName}`,
                message: `From ${messageData.sender_name}: ${bodyPreview}`,
                type: "critical_alert",
                priority: "critical",
                is_read: false,
                action_url: `/PatientDetails?id=${messageData.patient_id}`,
                action_label: "View Message",
                metadata: {
                    patient_id: messageData.patient_id,
                    thread_id: messageData.thread_id
                }
            });
            notifiedCount++;
        }
        
        return Response.json({ success: true, notified: notifiedCount });
    } catch (error) {
        console.error("notifyUrgentMessage error:", error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});