import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { visitId, duration, chatMessages } = await req.json();

    if (!visitId) {
      return Response.json({ error: 'Visit ID required' }, { status: 400 });
    }

    const visit = await base44.entities.Visit.get(visitId);
    const patient = await base44.entities.Patient.get(visit.patient_id);

    const prompt = `Generate a concise telehealth visit summary based on the following information:

Patient: ${patient.first_name} ${patient.last_name}
Visit Type: ${visit.visit_type}
Call Duration: ${Math.floor(duration / 60)} minutes
Date: ${new Date().toLocaleDateString()}

${chatMessages && chatMessages.length > 0 ? `Chat Messages During Call:\n${chatMessages.map(m => `${m.sender}: ${m.text}`).join('\n')}` : ''}

Provide a professional clinical summary including:
1. Key discussion points
2. Patient concerns addressed
3. Clinical observations
4. Follow-up actions needed
5. Patient education provided`;

    const summary = await base44.integrations.Core.InvokeLLM({
      prompt,
      add_context_from_internet: false
    });

    await base44.entities.Visit.update(visitId, {
      telehealth_summary: summary,
      telehealth_call_duration: duration
    });

    return Response.json({ success: true, summary });

  } catch (error) {
    console.error('Telehealth summary error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});