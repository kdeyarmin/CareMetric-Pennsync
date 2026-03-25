import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch user's training completions
    const userCompletions = await base44.entities.TrainingCompletion.filter({
      nurse_email: user.email
    });

    // Fetch all training modules
    const allModules = await base44.entities.TrainingModule.list();

    // Fetch user's feedback on modules
    const userFeedback = await base44.entities.TrainingFeedback.filter({
      user_email: user.email
    });

    // Calculate performance metrics
    const completedModuleIds = userCompletions.filter(c => c.status === 'completed').map(c => c.training_module_id);
    const averageScore = userCompletions.filter(c => c.score).length > 0
      ? (userCompletions.filter(c => c.score).reduce((sum, c) => sum + c.score, 0) / userCompletions.filter(c => c.score).length).toFixed(0)
      : 'N/A';

    const performanceProfile = {
      user_email: user.email,
      user_name: user.full_name,
      completed_modules: completedModuleIds.length,
      total_modules: allModules.length,
      average_score: averageScore,
      low_performing_modules: userCompletions
        .filter(c => c.score && c.score < 80)
        .map(c => ({
          module_id: c.training_module_id,
          score: c.score,
          status: c.status
        }))
        .slice(0, 5),
      uncompleted_required_modules: allModules
        .filter(m => m.is_required && !completedModuleIds.includes(m.id))
        .slice(0, 5)
        .map(m => ({
          id: m.id,
          title: m.title,
          category: m.category,
          difficulty: m.difficulty_level
        })),
      feedback_summary: {
        total_feedback: userFeedback.length,
        average_module_rating: userFeedback.filter(f => f.rating).length > 0
          ? (userFeedback.filter(f => f.rating).reduce((sum, f) => sum + f.rating, 0) / userFeedback.filter(f => f.rating).length).toFixed(1)
          : 'N/A',
        reported_issues: userFeedback.filter(f => f.feedback_type === 'content_issue').length
      }
    };

    // Use AI to generate personalized recommendations
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Based on this learner's performance profile, generate personalized training recommendations:

${JSON.stringify(performanceProfile, null, 2)}

${allModules.length > 0 ? `Available modules for recommendation:
${JSON.stringify(allModules.slice(0, 10).map(m => ({
  id: m.id,
  title: m.title,
  category: m.category,
  difficulty: m.difficulty_level,
  duration: m.duration_minutes
})), null, 2)}` : ''}

Provide personalized recommendations considering:
1. Their current performance level and gaps
2. Modules they haven't completed yet (especially required ones)
3. Areas where they struggled (low scores)
4. Their feedback and learning patterns
5. Difficulty progression

Format as JSON with keys: priority_recommendations, skill_gap_training, compliance_required_modules, advanced_modules, learning_tips`,
      response_json_schema: {
        type: 'object',
        properties: {
          priority_recommendations: {
            type: 'array',
            items: { type: 'string' }
          },
          skill_gap_training: {
            type: 'array',
            items: { type: 'string' }
          },
          compliance_required_modules: {
            type: 'array',
            items: { type: 'string' }
          },
          advanced_modules: {
            type: 'array',
            items: { type: 'string' }
          },
          learning_tips: {
            type: 'array',
            items: { type: 'string' }
          }
        }
      }
    });

    return Response.json({
      user_profile: performanceProfile,
      recommendations: response,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error generating training recommendations:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});