import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
});

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_id } = await req.json();

        // Get appointment with notes
        const appointment = await base44.asServiceRole.entities.Appointment.filter({ id: appointment_id });
        if (!appointment || appointment.length === 0) {
            return Response.json({ error: 'Appointment not found' }, { status: 404 });
        }

        const apt = appointment[0];

        // Get patient info
        const patient = await base44.asServiceRole.entities.Patient.filter({ id: apt.patient_id });
        if (!patient || patient.length === 0) {
            return Response.json({ error: 'Patient not found' }, { status: 404 });
        }

        const patientData = patient[0];

        // Get related visit notes if available
        const visits = await base44.asServiceRole.entities.Visit.filter({ 
            patient_id: apt.patient_id 
        }, '-visit_date', 3);

        // Use AI to analyze if follow-up is needed
        const prompt = `You are a healthcare follow-up AI assistant. Analyze the following appointment and determine if a follow-up appointment is needed:

Patient Info:
- Name: ${patientData.first_name} ${patientData.last_name}
- Primary Diagnosis: ${patientData.primary_diagnosis || 'N/A'}
- Current Medications: ${patientData.current_medications?.length || 0} medications

Appointment Details:
- Type: ${apt.appointment_type}
- Date: ${apt.appointment_date}
- Summary: ${apt.notes || 'No notes available'}

Recent Visit Notes:
${visits.slice(0, 2).map(v => `- ${v.visit_date}: ${v.nurse_notes?.substring(0, 200) || 'No notes'}`).join('\n')}

Analyze and return ONLY a JSON object:
{
  "needs_followup": true/false,
  "urgency": "routine/soon/urgent",
  "recommended_timeframe": "2 weeks/1 month/3 months",
  "reason": "Brief clinical reason for follow-up",
  "suggested_appointment_type": "telehealth/in-person",
  "key_concerns": ["concern1", "concern2"]
}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a healthcare AI assistant specialized in follow-up care planning. Always return valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.5
        });

        const analysis = JSON.parse(response.choices[0].message.content);

        // If follow-up is needed, create a task
        if (analysis.needs_followup) {
            const dueDate = new Date();
            if (analysis.recommended_timeframe.includes('week')) {
                dueDate.setDate(dueDate.getDate() + 14);
            } else if (analysis.recommended_timeframe.includes('month')) {
                const months = parseInt(analysis.recommended_timeframe) || 1;
                dueDate.setMonth(dueDate.getMonth() + months);
            }

            await base44.asServiceRole.entities.Task.create({
                title: `Schedule follow-up for ${patientData.first_name} ${patientData.last_name}`,
                description: `${analysis.reason}\n\nKey concerns: ${analysis.key_concerns.join(', ')}`,
                type: 'schedule',
                priority: analysis.urgency === 'urgent' ? 'critical' : analysis.urgency === 'soon' ? 'high' : 'medium',
                status: 'pending',
                patient_id: apt.patient_id,
                due_date: dueDate.toISOString().split('T')[0],
                source: 'ai_generated',
                ai_reason: analysis.reason,
                related_visit_id: appointment_id
            });
        }

        return Response.json({
            success: true,
            analysis,
            task_created: analysis.needs_followup
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});