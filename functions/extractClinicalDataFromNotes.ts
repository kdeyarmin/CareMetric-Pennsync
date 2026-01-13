import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { roughNotes } = await req.json();

    if (!roughNotes?.trim()) {
      return Response.json({ error: 'No notes provided' }, { status: 400 });
    }

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Extract clinical data from the following rough clinical notes. Return a JSON object with the following structure:
{
  "diagnoses": ["diagnosis1", "diagnosis2"],
  "medications": ["med1", "med2"],
  "vitals": {"temp": 98.6, "bp": "120/80", "hr": 72},
  "symptoms": ["symptom1", "symptom2"],
  "patient_history": "relevant history"
}

Clinical Notes:
${roughNotes}

Return ONLY the JSON object, no other text.`,
      add_context_from_internet: false,
      response_json_schema: {
        type: 'object',
        properties: {
          diagnoses: { type: 'array', items: { type: 'string' } },
          medications: { type: 'array', items: { type: 'string' } },
          vitals: { type: 'object' },
          symptoms: { type: 'array', items: { type: 'string' } },
          patient_history: { type: 'string' }
        }
      }
    });

    return Response.json(result);
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});