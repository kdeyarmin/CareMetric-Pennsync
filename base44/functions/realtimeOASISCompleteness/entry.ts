import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';
import OpenAI from 'npm:openai@4.28.0';

const openai = new OpenAI({
  apiKey: Deno.env.get('OPENAI_API_KEY'),
});

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { note_content, visit_type, patient_diagnoses } = await req.json();

    if (!note_content) {
      return Response.json({ 
        success: false, 
        error: 'Note content is required.' 
      }, { status: 400 });
    }

    const prompt = `You are an OASIS documentation assistant. Analyze the clinical note and identify missing OASIS data points that should be documented based on the visit type and patient condition.

Visit Type: ${visit_type || 'Not specified'}
Patient Diagnoses: ${patient_diagnoses || 'Not specified'}

Clinical Note:
${note_content}

Identify missing OASIS items and provide real-time prompts. Return JSON with:

{
  "missing_items": [
    {
      "oasis_item": "M1021 (Primary Diagnosis)",
      "category": "Clinical",
      "severity": "critical|high|medium|low",
      "prompt": "User-friendly reminder text to add this data",
      "why_needed": "Explanation of why this is needed",
      "location_in_note": "Where in the note this should be documented"
    }
  ],
  "completeness_score": number (0-100),
  "next_best_action": "Specific suggestion for what to document next",
  "documentation_quality": "brief assessment of current documentation quality"
}

Focus on:
- M items (Clinical/functional status)
- Vital signs and pain assessment
- ADL/IADL functional scores
- Wound documentation (if applicable)
- Medication reconciliation
- Safety assessments

Return valid JSON only.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: "You are a helpful OASIS documentation assistant providing real-time guidance."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      max_tokens: 1500
    });

    const result = JSON.parse(completion.choices[0].message.content);

    return Response.json({ success: true, ...result });

  } catch (error) {
    console.error('Real-time OASIS completeness error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});