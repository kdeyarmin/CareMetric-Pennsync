import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { analysisResults, diagnoses, vitals } = await req.json();

    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Based on the following clinical analysis, generate 3-5 specific follow-up actions/tasks.

Analysis Results:
${analysisResults}

Diagnoses: ${diagnoses?.join(', ') || 'None identified'}
Vitals: ${vitals ? JSON.stringify(vitals) : 'Not provided'}

For each task, provide:
- Task name
- Priority (critical/high/medium/low)
- Due timeframe (e.g., today, 24 hours, this week)
- Specific action details
- Reason/clinical justification

Return as a structured list.`,
      add_context_from_internet: false,
    });

    return Response.json({ tasks: response });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});