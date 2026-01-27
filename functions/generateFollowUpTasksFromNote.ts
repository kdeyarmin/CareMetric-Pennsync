import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { note_content, diagnosis, patient_id } = await req.json();

    if (!note_content || !diagnosis) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const response = await base44.asServiceRole.integrations.Core.InvokeLLM({
      prompt: `You are a clinical task manager. Analyze the clinical note and identify follow-up tasks and action items for the clinician.

Primary Diagnosis: ${diagnosis}

Clinical Note:
${note_content}

Based on the clinical note, identify:
1. Follow-up appointments or assessments needed
2. Medication or treatment adjustments to monitor
3. Patient education or counseling needed
4. Coordination with other providers
5. Symptom monitoring or vital sign checks
6. Compliance/medication adherence checks

For each task, provide:
- title: Brief task title
- description: Detailed description of what needs to be done
- priority: 'high', 'medium', or 'low'
- due_date: Recommended due date (ISO format, e.g., 2025-02-10)
- reason: Why this task is needed based on the note
- category: Type of task (e.g., 'follow-up', 'monitoring', 'education', 'coordination')

Return as JSON array with these fields. Only suggest tasks that are clearly indicated by the clinical content.`,
      response_json_schema: {
        type: 'object',
        properties: {
          suggested_tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                due_date: { type: 'string' },
                reason: { type: 'string' },
                category: { type: 'string' }
              }
            }
          }
        }
      }
    });

    const tasks = response.suggested_tasks || [];

    return Response.json({
      suggested_tasks: tasks,
      count: tasks.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error in generateFollowUpTasksFromNote:', error);
    return Response.json({ 
      error: error.message,
      suggested_tasks: []
    }, { status: 500 });
  }
});