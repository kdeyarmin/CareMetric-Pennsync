import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai';

const openai = new OpenAI({
    apiKey: Deno.env.get("OPENAI_API_KEY"),
});

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

        // Get form template
        const template = await base44.asServiceRole.entities.FormTemplate.filter({ 
            id: form.form_template_id 
        });
        if (!template || template.length === 0) {
            return Response.json({ error: 'Template not found' }, { status: 404 });
        }

        const formTemplate = template[0];

        // Use AI to analyze completeness
        const prompt = `You are a healthcare form analysis AI. Analyze the following patient form submission for completeness and quality:

Form Template: ${formTemplate.form_name}
Required Fields: ${formTemplate.fields.filter(f => f.required).map(f => f.field_label).join(', ')}

Patient Submitted Data:
${JSON.stringify(form.form_data, null, 2)}

Analyze and return ONLY a JSON object:
{
  "completeness_score": 85,
  "is_complete": true/false,
  "missing_fields": ["field1", "field2"],
  "incomplete_fields": [
    {
      "field": "field_name",
      "issue": "Too vague, needs more detail",
      "suggestion": "Please provide specific dates or details"
    }
  ],
  "critical_concerns": ["Any red flags or urgent information"],
  "summary": "Brief assessment of the submission quality"
}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o-mini",
            messages: [
                {
                    role: "system",
                    content: "You are a healthcare form analysis AI. Always return valid JSON only."
                },
                {
                    role: "user",
                    content: prompt
                }
            ],
            temperature: 0.3
        });

        const analysis = JSON.parse(response.choices[0].message.content);

        // Update form with analysis
        await base44.asServiceRole.entities.AppointmentForm.update(appointment_form_id, {
            ai_completeness_score: analysis.completeness_score,
            missing_fields: analysis.missing_fields,
            ai_analysis: analysis,
            status: analysis.is_complete ? 'completed' : 'incomplete'
        });

        return Response.json({
            success: true,
            analysis
        });

    } catch (error) {
        console.error('Error:', error);
        return Response.json({ error: error.message }, { status: 500 });
    }
});