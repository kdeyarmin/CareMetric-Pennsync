import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch relevant data for analysis
    const [patients, alerts, tasks, complianceAudits, visits] = await Promise.all([
      base44.entities.Patient.filter({ status: 'active' }),
      base44.entities.PatientAlert.filter({ status: 'active' }),
      base44.entities.Task.filter({ 
        $or: [
          { assigned_to: user.email },
          { created_by: user.email }
        ]
      }),
      base44.entities.ComplianceAudit.filter({
        nurse_email: user.email,
        status: { $in: ['flagged', 'critical', 'pending_review'] }
      }),
      base44.entities.Visit.filter({ 
        created_by: user.email,
        status: { $in: ['scheduled', 'in_progress'] }
      })
    ]);

    // Prepare context for AI analysis
    const context = {
      activePatients: patients.length,
      criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
      highPriorityAlerts: alerts.filter(a => a.severity === 'high').length,
      overdueTasks: tasks.filter(t => 
        t.status === 'pending' && 
        t.due_date && 
        new Date(t.due_date) < new Date()
      ).length,
      criticalTasks: tasks.filter(t => 
        t.status === 'pending' && 
        t.priority === 'critical'
      ).length,
      flaggedCompliance: complianceAudits.length,
      scheduledVisitsToday: visits.filter(v => {
        const visitDate = new Date(v.visit_date);
        const today = new Date();
        return visitDate.toDateString() === today.toDateString();
      }).length,
      patientDetails: patients.slice(0, 10).map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        diagnoses: p.primary_diagnosis,
        status: p.status
      })),
      alertDetails: alerts.slice(0, 5).map(a => ({
        type: a.alert_type,
        severity: a.severity,
        title: a.title,
        patientId: a.patient_id
      })),
      taskDetails: tasks.slice(0, 5).map(t => ({
        title: t.title,
        priority: t.priority,
        dueDate: t.due_date,
        status: t.status
      }))
    };

    // Use AI to generate intelligent nudges
    const prompt = `You are an AI clinical assistant for home health nurses. Analyze the following data and generate 3-5 intelligent, actionable nudges/alerts prioritized by urgency and impact.

Current Situation:
- Active Patients: ${context.activePatients}
- Critical Patient Alerts: ${context.criticalAlerts}
- High Priority Alerts: ${context.highPriorityAlerts}
- Overdue Tasks: ${context.overdueTasks}
- Critical Tasks: ${context.criticalTasks}
- Flagged Compliance Issues: ${context.flaggedCompliance}
- Scheduled Visits Today: ${context.scheduledVisitsToday}

Recent Alerts:
${JSON.stringify(context.alertDetails, null, 2)}

Pending Tasks:
${JSON.stringify(context.taskDetails, null, 2)}

Generate nudges that are:
1. Specific and actionable
2. Prioritized by urgency (critical, high, medium, low)
3. Context-aware and personalized
4. Brief but informative (1-2 sentences)
5. Include recommended actions

Focus on:
- Patient safety issues
- Compliance deadlines
- Overdue or critical tasks
- Early warning signs requiring attention
- Workflow optimization suggestions

Return a JSON array of nudges.`;

    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt,
      response_json_schema: {
        type: 'object',
        properties: {
          nudges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                message: { type: 'string' },
                priority: { 
                  type: 'string',
                  enum: ['critical', 'high', 'medium', 'low']
                },
                category: {
                  type: 'string',
                  enum: ['patient_safety', 'compliance', 'task', 'clinical', 'workflow']
                },
                action: { type: 'string' },
                actionUrl: { type: 'string' },
                icon: { type: 'string' },
                relatedEntity: { type: 'string' },
                relatedEntityId: { type: 'string' }
              },
              required: ['title', 'message', 'priority', 'category', 'action']
            }
          }
        },
        required: ['nudges']
      }
    });

    // Add metadata and enrich nudges
    const enrichedNudges = aiResponse.nudges.map((nudge, index) => ({
      ...nudge,
      id: nudge.id || `nudge_${Date.now()}_${index}`,
      timestamp: new Date().toISOString(),
      viewed: false,
      dismissed: false
    }));

    return Response.json({
      success: true,
      nudges: enrichedNudges,
      summary: {
        total: enrichedNudges.length,
        critical: enrichedNudges.filter(n => n.priority === 'critical').length,
        high: enrichedNudges.filter(n => n.priority === 'high').length,
        medium: enrichedNudges.filter(n => n.priority === 'medium').length,
        low: enrichedNudges.filter(n => n.priority === 'low').length
      },
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error generating AI nudges:', error);
    return Response.json({ 
      error: error.message,
      success: false 
    }, { status: 500 });
  }
});