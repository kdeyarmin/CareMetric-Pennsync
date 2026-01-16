import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (user?.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 403 });
    }

    console.log('Processing AI feedback for model improvement...');

    // Get unprocessed feedback
    const unprocessedFeedback = await base44.asServiceRole.entities.AIFeedback.filter({
      is_processed: false
    });

    console.log(`Found ${unprocessedFeedback.length} unprocessed feedback items`);

    // Analyze patterns
    const feedbackAnalysis = {
      by_type: {},
      by_action: {},
      avg_ratings: {},
      improvement_areas: []
    };

    unprocessedFeedback.forEach(feedback => {
      // Track by suggestion type
      if (!feedbackAnalysis.by_type[feedback.ai_suggestion_type]) {
        feedbackAnalysis.by_type[feedback.ai_suggestion_type] = {
          count: 0,
          accepted: 0,
          edited: 0,
          rejected: 0
        };
      }
      feedbackAnalysis.by_type[feedback.ai_suggestion_type].count++;
      feedbackAnalysis.by_type[feedback.ai_suggestion_type][feedback.user_action]++;

      // Calculate average ratings
      if (!feedbackAnalysis.avg_ratings[feedback.ai_suggestion_type]) {
        feedbackAnalysis.avg_ratings[feedback.ai_suggestion_type] = {
          helpful: [],
          accuracy: []
        };
      }
      if (feedback.helpful_rating) {
        feedbackAnalysis.avg_ratings[feedback.ai_suggestion_type].helpful.push(feedback.helpful_rating);
      }
      if (feedback.accuracy_rating) {
        feedbackAnalysis.avg_ratings[feedback.ai_suggestion_type].accuracy.push(feedback.accuracy_rating);
      }
    });

    // Calculate averages
    Object.keys(feedbackAnalysis.avg_ratings).forEach(type => {
      const helpful = feedbackAnalysis.avg_ratings[type].helpful;
      const accuracy = feedbackAnalysis.avg_ratings[type].accuracy;

      feedbackAnalysis.avg_ratings[type] = {
        helpful_avg: helpful.length > 0 ? (helpful.reduce((a, b) => a + b) / helpful.length).toFixed(2) : null,
        accuracy_avg: accuracy.length > 0 ? (accuracy.reduce((a, b) => a + b) / accuracy.length).toFixed(2) : null
      };

      // Flag for improvement if rating is below 3
      if ((feedbackAnalysis.avg_ratings[type].helpful_avg && feedbackAnalysis.avg_ratings[type].helpful_avg < 3) ||
          (feedbackAnalysis.avg_ratings[type].accuracy_avg && feedbackAnalysis.avg_ratings[type].accuracy_avg < 3)) {
        feedbackAnalysis.improvement_areas.push({
          suggestion_type: type,
          issue: 'Low user satisfaction ratings',
          helpful_avg: feedbackAnalysis.avg_ratings[type].helpful_avg,
          accuracy_avg: feedbackAnalysis.avg_ratings[type].accuracy_avg,
          recommended_action: 'Review prompt engineering and model parameters'
        });
      }
    });

    // Mark feedback as processed
    for (const feedback of unprocessedFeedback) {
      try {
        await base44.asServiceRole.entities.AIFeedback.update(feedback.id, {
          is_processed: true
        });
      } catch (e) {
        console.error(`Error marking feedback ${feedback.id} as processed:`, e);
      }
    }

    // Create admin task if improvements needed
    if (feedbackAnalysis.improvement_areas.length > 0) {
      try {
        await base44.asServiceRole.entities.Task.create({
          title: 'AI Model Improvement Required',
          description: `Analysis of ${unprocessedFeedback.length} user feedback items indicates ${feedbackAnalysis.improvement_areas.length} areas for AI model improvement. Details: ${JSON.stringify(feedbackAnalysis.improvement_areas)}`,
          priority: 'medium',
          status: 'pending',
          assigned_to: user.email,
          type: 'document',
          source: 'ai_generated'
        });
      } catch (e) {
        console.error('Error creating improvement task:', e);
      }
    }

    console.log('✅ AI feedback processing complete');

    return Response.json({
      success: true,
      feedback_processed: unprocessedFeedback.length,
      analysis: feedbackAnalysis
    });

  } catch (error) {
    console.error('Error in processAIFeedback:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});