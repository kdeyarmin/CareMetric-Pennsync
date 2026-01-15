import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
});

Deno.serve(async (req) => {
    try {
        const base44 = createClientFromRequest(req);

        const { appointment_form_id, field_name, patient_question, current_value } = await req.json();

        // Get form and template
        const appointmentForm = await base44.asServiceRole.entities.AppointmentForm.filter({ 
            id: appointment_form_id 
        });
        if (!appointmentForm || appointmentForm.length === 0) {
            return Response.json({ error: 'Form not found' }, { status: 404 });
        }

        const form = appointmentForm[0];

        const template = await base44.asServiceRole.entities.FormTemplate.filter({ 
            id: form.form_template_id 
        });
        if (!template || template.length === 0) {
            return Response.json({ error: 'Template not found' }, { status: 404 });
        }

        const formTemplate = template[0];

        // Find field definition
        const fieldDef = formTemplate.fields.find(f => f.field_name === field_name);

        // Use AI to help with the field
        const prompt = `You are a helpful AI assistant for healthcare forms. A patient needs help filling out a form field.

Form: ${formTemplate.form_name}
Field: ${fieldDef?.field_label || field_name}
Help Text: ${fieldDef?.help_text || 'None'}
Current Value: ${current_value || 'Empty'}
Patient Question: ${patient_question}

Provide a helpful, clear response that:
1. Explains what information is needed
2. Gives examples if appropriate
3. Suggests how to answer if they're unsure
4. Is friendly and reassuring

Keep your response concise (2-3 sentences) and patient-friendly.`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a friendly healthcare form assistant. Help patients understand what information is needed without providing medical advice."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.7,
            max_tokens: 200
        });

        const aiResponse = response.choices[0].message.content;

        return Response.json({
            success: true,
            ai_assistance: aiResponse,
            field_info: {
                label: fieldDef?.field_label,
                help_text: fieldDef?.help_text,
                required: fieldDef?.required
            }
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});