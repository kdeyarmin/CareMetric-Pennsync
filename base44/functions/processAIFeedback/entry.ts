import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { output_type, period_days = 30 } = await req.json();

    // Aggregate feedback for specific output type
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - period_days);

    const allFeedback = await base44.asServiceRole.entities.AIFeedback.filter(
      {
        user_email: user.email,
        output_type: output_type || undefined
      },
      '-created_date',
      200
    );

    const recentFeedback = allFeedback.filter(
      f => new Date(f.created_date) >= cutoffDate
    );

    // Calculate metrics
    const totalFeedback = recentFeedback.length;
    const helpfulCount = recentFeedback.filter(f => f.rating === 'helpful').length;
    const notHelpfulCount = recentFeedback.filter(f => f.rating === 'not_helpful').length;
    const flaggedCount = recentFeedback.filter(f => f.rating === 'flagged').length;

    const helpfulRate = totalFeedback > 0 ? (helpfulCount / totalFeedback) * 100 : 0;

    // Analyze common issues from flagged/not helpful feedback
    const negativeWithText = recentFeedback.filter(
      f => (f.rating === 'flagged' || f.rating === 'not_helpful') && f.feedback_text
    );

    let commonIssues = [];
    if (negativeWithText.length > 0) {
      // Use AI to extract patterns from negative feedback
      const feedbackTexts = negativeWithText.map(f => f.feedback_text).join('\n---\n');
      
      try {
        const analysis = await base44.integrations.Core.InvokeLLM({
          prompt: `Analyze these provider feedback comments about AI suggestions and identify the top 3-5 common issues or patterns:

${feedbackTexts}

Extract recurring themes, complaints, or improvement areas.`,
          response_json_schema: {
            type: "object",
            properties: {
              common_issues: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    issue: { type: "string" },
                    frequency: { type: "string" },
                    suggested_fix: { type: "string" }
                  }
                }
              }
            }
          }
        });

        commonIssues = analysis.common_issues;
      } catch (error) {
        console.error('Error analyzing feedback:', error);
      }
    }

    // Track improvement over time
    const oldFeedback = allFeedback.filter(
      f => new Date(f.created_date) < cutoffDate
    );
    const oldHelpfulRate = oldFeedback.length > 0 
      ? (oldFeedback.filter(f => f.rating === 'helpful').length / oldFeedback.length) * 100 
      : 0;

    const improvementTrend = helpfulRate - oldHelpfulRate;

    return Response.json({
      summary: {
        total_feedback: totalFeedback,
        helpful_count: helpfulCount,
        not_helpful_count: notHelpfulCount,
        flagged_count: flaggedCount,
        helpful_rate: Math.round(helpfulRate),
        improvement_trend: Math.round(improvementTrend)
      },
      common_issues: commonIssues,
      recommendations: commonIssues.map(issue => issue.suggested_fix),
      period_days
    });

  } catch (error) {
    console.error('Error processing AI feedback:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});