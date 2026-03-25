import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    // Admin-only function
    if (user?.role !== 'admin') {
      return Response.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const anthropicApiKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!anthropicApiKey) {
      throw new Error('ANTHROPIC_API_KEY not configured');
    }

    console.log('[trainAIFromFeedback] Starting AI training from feedback');

    // Fetch unreviewed feedback
    const allFeedback = await base44.asServiceRole.entities.AIFeedback.list();
    const unreviewedFeedback = allFeedback.filter(f => !f.is_reviewed);

    if (unreviewedFeedback.length === 0) {
      return Response.json({
        success: true,
        message: 'No new feedback to process',
        feedback_processed: 0
      });
    }

    // Group feedback by type and category
    const feedbackByType = {};
    for (const feedback of unreviewedFeedback) {
      const key = `${feedback.output_type}_${feedback.improvement_category}`;
      if (!feedbackByType[key]) {
        feedbackByType[key] = [];
      }
      feedbackByType[key].push(feedback);
    }

    // Generate improvement patterns
    const improvementPrompt = `Analyze the following user corrections to AI outputs to identify patterns and improvement opportunities:

${Object.entries(feedbackByType)
  .map(([category, items]) => {
    return `\n${category}:\n${items
      .slice(0, 5) // Limit to first 5 of each type
      .map(
        (item, i) =>
          `${i + 1}. ORIGINAL: ${item.original_ai_output.substring(0, 200)}...
   CORRECTED: ${item.user_correction.substring(0, 200)}...
   CATEGORY: ${item.feedback_type}`
      )
      .join('\n')}`;
  })
  .join('\n')}

Based on these patterns, provide:
1. Common mistakes the AI is making
2. Specific improvement recommendations
3. Prompt modifications that would help
4. Training data gaps identified
5. Priority areas for improvement

Format as actionable guidance for AI model improvement.`;

    const claudeResponse = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicApiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2048,
        messages: [{ role: 'user', content: improvementPrompt }]
      })
    });

    if (!claudeResponse.ok) {
      throw new Error(`Claude API failed: ${claudeResponse.status}`);
    }

    const claudeResult = await claudeResponse.json();
    const improvements = claudeResult.content?.[0]?.text || '';

    // Mark feedback as reviewed
    for (const feedback of unreviewedFeedback) {
      await base44.asServiceRole.entities.AIFeedback.update(feedback.id, {
        is_reviewed: true,
        review_date: new Date().toISOString()
      });
    }

    // Create training session record
    const trainingSession = await base44.asServiceRole.entities.AILearningPattern.create({
      admin_email: user.email,
      feedback_count: unreviewedFeedback.length,
      improvement_areas: improvements,
      improvement_summary: Object.keys(feedbackByType).join(', '),
      patterns_identified: Object.keys(feedbackByType),
      session_date: new Date().toISOString(),
      status: 'completed'
    });

    console.log('[trainAIFromFeedback] Training complete:', {
      session_id: trainingSession.id,
      feedback_processed: unreviewedFeedback.length,
      categories: Object.keys(feedbackByType).length
    });

    return Response.json({
      success: true,
      session_id: trainingSession.id,
      feedback_processed: unreviewedFeedback.length,
      improvement_areas: Object.keys(feedbackByType),
      improvements_identified: improvements
    });

  } catch (error) {
    console.error('[trainAIFromFeedback] Error:', error.message);
    return Response.json({
      success: false,
      error: error.message
    }, { status: 500 });
  }
});