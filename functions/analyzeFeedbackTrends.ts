import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
    }

    // Fetch all feedback
    const allFeedback = await base44.entities.TrainingFeedback.list('-created_date', 500);

    if (!allFeedback || allFeedback.length === 0) {
      return Response.json({
        trends: [],
        summary: 'No feedback data available',
        recommendations: []
      });
    }

    // Prepare feedback data for analysis
    const feedbackSummary = {
      total_feedback: allFeedback.length,
      module_ratings: allFeedback.filter(f => f.feedback_type === 'module_rating').length,
      content_issues: allFeedback.filter(f => f.feedback_type === 'content_issue').length,
      general_feedback: allFeedback.filter(f => f.feedback_type === 'general_feedback').length,
      average_rating: allFeedback.filter(f => f.rating).length > 0
        ? (allFeedback.filter(f => f.rating).reduce((sum, f) => sum + f.rating, 0) / allFeedback.filter(f => f.rating).length).toFixed(1)
        : 'N/A',
      average_effectiveness: allFeedback.filter(f => f.effectiveness_rating).length > 0
        ? (allFeedback.filter(f => f.effectiveness_rating).reduce((sum, f) => sum + f.effectiveness_rating, 0) / allFeedback.filter(f => f.effectiveness_rating).length).toFixed(1)
        : 'N/A',
      average_relevance: allFeedback.filter(f => f.relevance_rating).length > 0
        ? (allFeedback.filter(f => f.relevance_rating).reduce((sum, f) => sum + f.relevance_rating, 0) / allFeedback.filter(f => f.relevance_rating).length).toFixed(1)
        : 'N/A',
      would_recommend_percentage: allFeedback.filter(f => f.would_recommend).length > 0
        ? ((allFeedback.filter(f => f.would_recommend).length / allFeedback.filter(f => f.would_recommend !== undefined).length) * 100).toFixed(0)
        : 'N/A',
      top_issues: Object.entries(
        allFeedback.filter(f => f.issue_category).reduce((acc, f) => {
          acc[f.issue_category] = (acc[f.issue_category] || 0) + 1;
          return acc;
        }, {})
      ).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([category, count]) => ({ category, count })),
      difficulty_breakdown: Object.entries(
        allFeedback.filter(f => f.difficulty_rating).reduce((acc, f) => {
          acc[f.difficulty_rating] = (acc[f.difficulty_rating] || 0) + 1;
          return acc;
        }, {})
      ).map(([level, count]) => ({ level, count })),
      recent_feedback_samples: allFeedback.slice(0, 3).map(f => ({
        type: f.feedback_type,
        module: f.module_title,
        rating: f.rating,
        content: f.feedback_text || f.issue_description || 'N/A',
        date: f.created_date
      }))
    };

    // Use AI to analyze trends and generate insights
    const response = await base44.integrations.Core.InvokeLLM({
      prompt: `Analyze the following training feedback data and provide actionable insights for administrators:

${JSON.stringify(feedbackSummary, null, 2)}

Please provide:
1. Key trends observed in the feedback
2. Modules or topics that need improvement
3. User satisfaction patterns
4. Specific actionable recommendations for the admin to address issues
5. Modules performing well that should be promoted

Format as JSON with keys: trends, improvement_areas, satisfaction_patterns, actionable_recommendations, high_performing_modules`,
      response_json_schema: {
        type: 'object',
        properties: {
          trends: { type: 'array', items: { type: 'string' } },
          improvement_areas: { type: 'array', items: { type: 'string' } },
          satisfaction_patterns: { type: 'array', items: { type: 'string' } },
          actionable_recommendations: { type: 'array', items: { type: 'string' } },
          high_performing_modules: { type: 'array', items: { type: 'string' } }
        }
      }
    });

    return Response.json({
      summary: feedbackSummary,
      analysis: response,
      generated_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error analyzing feedback trends:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});