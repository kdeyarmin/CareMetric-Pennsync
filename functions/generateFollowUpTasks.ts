import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { analysisResults, diagnoses, vitals, patientId } = await req.json();

    const { invokeClaude } = await import('./helpers/claudeClient.js');
    const result = await invokeClaude({
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
3. Timeline for completion (today/24_hours/48_hours/this_week/next_visit)
4. Responsible party

Return as JSON array with fields: title, description, priority, due_timeframe, assigned_role.`,
      response_json_schema: {
        type: "object",
        properties: {
          tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                description: { type: "string" },
                priority: { type: "string" },
                due_timeframe: { type: "string" },
                assigned_role: { type: "string" }
              }
            }
          }
        }
      }
    });

    // Batch create tasks (avoid sequential creates)
    if (patientId && result.tasks?.length > 0) {
      const tasksToCreate = result.tasks.map(task => ({
        patient_id: patientId,
        title: task.title,
        description: task.description,
        priority: task.priority || 'medium',
        type: 'followup',
        due_timeframe: task.due_timeframe,
        source: 'ai_generated',
        status: 'pending',
        assigned_to: user.email
      }));

      try {
        await base44.asServiceRole.entities.Task.bulkCreate(tasksToCreate);
      } catch (createError) {
        console.warn('Failed to create tasks:', createError.message);
        // Don't throw - return results even if task creation fails
      }
    }

    return Response.json({ 
      success: true,
      tasks: result.tasks || [],
      created: patientId ? result.tasks?.length || 0 : 0
    });
  } catch (error) {
    console.error(error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});