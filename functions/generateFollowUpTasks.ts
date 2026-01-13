import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { analysisResults, diagnoses, vitals } = await req.json();

    const result = await base44.integrations.Core.InvokeLLM({
      prompt: `Generate actionable follow-up tasks based on the clinical analysis.

Analysis Results:
${analysisResults || 'Not provided'}

Patient Diagnoses:
${diagnoses?.join(', ') || 'Not provided'}

Vital Signs:
${vitals ? JSON.stringify(vitals) : 'Not provided'}

Create a list of specific follow-up tasks including:
1. Task description
2. Priority (high/medium/low)
3. Timeline for completion
4. Responsible party

Format as a numbered list.`,
      add_context_from_internet: false
    });

    return Response.json({ tasks: result });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});