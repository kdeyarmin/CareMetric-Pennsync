import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      documentContent,
      patientId,
      patientName,
      visitType,
      carePlanId,
    } = await req.json();

    if (!documentContent || !patientId) {
      return Response.json(
        { error: 'Missing required fields: documentContent, patientId' },
        { status: 400 }
      );
    }

    // Use AI to extract action items and follow-ups from document
    const extractionPrompt = `Analyze this clinical document and extract all action items, follow-ups, and tasks that need to be created.

Document:
${documentContent}

Return a JSON array of tasks with this structure:
[
  {
    "title": "Task title",
    "description": "Detailed description",
    "priority": "high|medium|low",
    "due_date_offset_days": number (days from now),
    "type": "follow_up|medication|education|referral|assessment|other"
  }
]

Extract ALL mentioned follow-ups, medication changes, referrals, education needs, and recheck dates.`;

    const tasksResponse = await base44.integrations.Core.InvokeLLM({
      prompt: extractionPrompt,
      response_json_schema: {
        type: 'object',
        properties: {
          tasks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                title: { type: 'string' },
                description: { type: 'string' },
                priority: { type: 'string' },
                due_date_offset_days: { type: 'number' },
                type: { type: 'string' },
              },
            },
          },
        },
      },
    });

    // Create tasks in database
    const createdTasks = [];
    const now = new Date();

    if (tasksResponse.tasks && Array.isArray(tasksResponse.tasks)) {
      for (const taskData of tasksResponse.tasks) {
        const dueDate = new Date(
          now.getTime() + taskData.due_date_offset_days * 24 * 60 * 60 * 1000
        );

        const task = await base44.asServiceRole.entities.Task.create({
          title: taskData.title,
          description: taskData.description,
          patient_id: patientId,
          patient_name: patientName,
          assigned_to: user.email,
          status: 'pending',
          priority: taskData.priority || 'medium',
          due_date: dueDate.toISOString().split('T')[0],
          task_type: taskData.type || 'follow_up',
          related_care_plan_id: carePlanId,
          created_from_document: true,
          created_date: new Date().toISOString(),
        });

        createdTasks.push(task);
      }
    }

    return Response.json({
      success: true,
      tasks_created: createdTasks.length,
      tasks: createdTasks,
      message: `Created ${createdTasks.length} follow-up tasks from the document`,
    });
  } catch (error) {
    console.error('Task generation error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});