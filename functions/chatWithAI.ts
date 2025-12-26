import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { message, conversationHistory = [] } = await req.json();

    // Gather contextual data based on user role
    const [
      myTasks,
      myAlerts,
      myRecommendations,
      trainingModules,
      recentActivity
    ] = await Promise.all([
      base44.entities.Task.filter({ assigned_to: user.email, status: 'pending' }, null, 10),
      base44.entities.PatientAlert.filter({ assigned_to: user.email, status: 'active' }, null, 5),
      base44.entities.TrainingRecommendation.filter({ nurse_email: user.email, addressed: false }, null, 5),
      base44.entities.TrainingModule.filter({ is_active: true }, null, 20),
      base44.entities.UserActivity.filter({ user_email: user.email }, '-created_date', 10)
    ]);

    // Analyze user intent and gather more specific data if needed
    const messageLower = message.toLowerCase();
    let additionalContext = {};

    if (messageLower.includes('patient') || messageLower.includes('alert')) {
      const patients = await base44.entities.Patient.filter({ created_by: user.email, status: 'active' }, null, 10);
      additionalContext.patients = patients.map(p => ({
        name: `${p.first_name} ${p.last_name}`,
        diagnosis: p.primary_diagnosis,
        status: p.status
      }));
    }

    if (messageLower.includes('training') || messageLower.includes('learn') || messageLower.includes('course')) {
      additionalContext.availableTraining = trainingModules.map(m => ({
        title: m.title,
        category: m.category,
        duration: m.duration_minutes,
        description: m.description
      }));
    }

    if (messageLower.includes('compliance') || messageLower.includes('audit')) {
      const audits = await base44.entities.ComplianceAudit.filter({ nurse_email: user.email }, '-audit_date', 5);
      additionalContext.recentAudits = audits.map(a => ({
        date: a.audit_date,
        score: a.compliance_score,
        status: a.status
      }));
    }

    // Build comprehensive context for AI
    const systemContext = `You are CareMetric AI Assistant, a helpful AI assistant for healthcare nurses. 
You have access to the user's real-time data and can provide personalized assistance.

USER PROFILE:
- Name: ${user.full_name}
- Email: ${user.email}
- Role: ${user.role}

CURRENT DATA SUMMARY:
- Pending Tasks: ${myTasks.length}
- Active Alerts: ${myAlerts.length}
- Training Recommendations: ${myRecommendations.length}

PENDING TASKS:
${myTasks.map(t => `- ${t.title} (Priority: ${t.priority})`).join('\n') || 'No pending tasks'}

ACTIVE ALERTS:
${myAlerts.map(a => `- ${a.title} (Severity: ${a.severity})`).join('\n') || 'No active alerts'}

TRAINING RECOMMENDATIONS:
${myRecommendations.map(r => `- ${r.recommendation_type}: ${r.recommendation_text}`).join('\n') || 'No training recommendations'}

${additionalContext.patients ? `\nYOUR PATIENTS:\n${additionalContext.patients.map(p => `- ${p.name}: ${p.diagnosis}`).join('\n')}` : ''}

${additionalContext.availableTraining ? `\nAVAILABLE TRAINING MODULES:\n${additionalContext.availableTraining.slice(0, 5).map(t => `- ${t.title} (${t.category}, ${t.duration}min)`).join('\n')}` : ''}

${additionalContext.recentAudits ? `\nRECENT COMPLIANCE AUDITS:\n${additionalContext.recentAudits.map(a => `- ${a.date}: ${a.score}% (${a.status})`).join('\n')}` : ''}

INSTRUCTIONS:
1. Be helpful, concise, and professional
2. Use the user's actual data to provide personalized responses
3. If asked about training, recommend specific modules from the available list
4. If asked about tasks or alerts, reference the actual items listed above
5. If the user wants to give feedback, guide them to rate AI insights
6. Keep responses under 200 words unless detailed explanation is needed
7. Use bullet points for clarity when listing multiple items`;

    // Build conversation context
    const messages = [
      { role: "system", content: systemContext },
      ...conversationHistory.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: "user", content: message }
    ];

    // Generate AI response
    const aiResponse = await base44.integrations.Core.InvokeLLM({
      prompt: JSON.stringify(messages),
      response_json_schema: {
        type: "object",
        properties: {
          response: { type: "string" },
          suggested_actions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                label: { type: "string" },
                action: { type: "string" },
                data: { type: "object" }
              }
            }
          },
          training_suggestions: {
            type: "array",
            items: { type: "string" }
          }
        }
      }
    });

    // Log the chat interaction
    await base44.entities.UserActivity.create({
      user_email: user.email,
      user_name: user.full_name,
      action: 'ai_chat_query',
      details: {
        query: message,
        response_length: aiResponse.response?.length || 0,
        suggested_actions_count: aiResponse.suggested_actions?.length || 0
      },
      page: 'ai_chat'
    });

    return Response.json({
      success: true,
      response: aiResponse.response || "I'm here to help! What would you like to know?",
      suggested_actions: aiResponse.suggested_actions || [],
      training_suggestions: aiResponse.training_suggestions || [],
      context_used: {
        tasks_count: myTasks.length,
        alerts_count: myAlerts.length,
        recommendations_count: myRecommendations.length
      }
    });

  } catch (error) {
    console.error('Error in AI chat:', error);
    return Response.json({ 
      error: 'Failed to process chat message',
      details: error.message 
    }, { status: 500 });
  }
});