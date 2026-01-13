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

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Extract clinical data from these rough notes. Return a JSON object with:
- diagnoses: array of diagnosed conditions
- medications: array of current medications with dosages
- vitals: object with BP, HR, RR, O2, temp, weight
- symptoms: array of reported symptoms
- patient_history: brief patient history summary

Notes:
${roughNotes}

Return only valid JSON, no markdown.`,
      response_json_schema: {
        type: "object",
        properties: {
          diagnoses: { type: "array", items: { type: "string" } },
          medications: { type: "array", items: { type: "string" } },
          vitals: { type: "object" },
          symptoms: { type: "array", items: { type: "string" } },
          patient_history: { type: "string" }
        }
      }
    });

    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});