import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch all feedback data
    const allFeedback = await base44.asServiceRole.entities.AIInsightFeedback.list('-created_date', 1000);

    // Analyze by insight type
    const byType = {};
    const lowRatedInsights = [];
    const actionableInsights = [];

    allFeedback.forEach(feedback => {
      const type = feedback.insight_type;
      
      if (!byType[type]) {
        byType[type] = {
          count: 0,
          totalRating: 0,
          accurate: 0,
          inaccurate: 0,
          actionTaken: 0,
          feedbackTexts: []
        };
      }

      byType[type].count++;
      byType[type].totalRating += feedback.rating || 0;
      
      if (feedback.accuracy_rating === 'very_accurate' || feedback.accuracy_rating === 'accurate') {
        byType[type].accurate++;
      } else if (feedback.accuracy_rating === 'inaccurate' || feedback.accuracy_rating === 'very_inaccurate') {
        byType[type].inaccurate++;
      }

      if (feedback.action_taken) {
        byType[type].actionTaken++;
      }

      if (feedback.feedback_text) {
        byType[type].feedbackTexts.push(feedback.feedback_text);
      }

      // Identify low-rated insights for improvement
      if (feedback.rating <= 2) {
        lowRatedInsights.push({
          type: feedback.insight_type,
          rating: feedback.rating,
          accuracy: feedback.accuracy_rating,
          relevance: feedback.relevance_rating,
          usefulness: feedback.usefulness_rating,
          feedback: feedback.feedback_text,
          insight_content: feedback.insight_content,
          created_date: feedback.created_date
        });
      }
    });

    // Calculate metrics per type
    const typeMetrics = Object.keys(byType).map(type => {
      const data = byType[type];
      return {
        insight_type: type,
        total_feedback: data.count,
        avg_rating: (data.totalRating / data.count).toFixed(2),
        accuracy_rate: data.count > 0 ? ((data.accurate / data.count) * 100).toFixed(1) : 0,
        inaccuracy_rate: data.count > 0 ? ((data.inaccurate / data.count) * 100).toFixed(1) : 0,
        action_rate: data.count > 0 ? ((data.actionTaken / data.count) * 100).toFixed(1) : 0,
        common_feedback_themes: extractThemes(data.feedbackTexts)
      };
    });

    // Generate improvement recommendations
    const recommendations = [];
    typeMetrics.forEach(metric => {
      if (parseFloat(metric.avg_rating) < 3.5) {
        recommendations.push({
          insight_type: metric.insight_type,
          severity: 'high',
          issue: `Low average rating (${metric.avg_rating}/5)`,
          suggestion: 'Review and refine AI model prompts and logic',
          data: metric
        });
      }

      if (parseFloat(metric.accuracy_rate) < 60) {
        recommendations.push({
          insight_type: metric.insight_type,
          severity: 'critical',
          issue: `Low accuracy rate (${metric.accuracy_rate}%)`,
          suggestion: 'Retrain model with recent feedback data and clinical guidelines',
          data: metric
        });
      }

      if (parseFloat(metric.action_rate) < 40) {
        recommendations.push({
          insight_type: metric.insight_type,
          severity: 'medium',
          issue: `Low action rate (${metric.action_rate}%)`,
          suggestion: 'Insights may not be actionable or relevant enough',
          data: metric
        });
      }
    });

    // Overall statistics
    const overallStats = {
      total_feedback_count: allFeedback.length,
      avg_rating: allFeedback.length > 0 
        ? (allFeedback.reduce((sum, f) => sum + (f.rating || 0), 0) / allFeedback.length).toFixed(2)
        : 0,
      action_taken_rate: allFeedback.length > 0
        ? ((allFeedback.filter(f => f.action_taken).length / allFeedback.length) * 100).toFixed(1)
        : 0,
      unique_nurses: new Set(allFeedback.map(f => f.nurse_email)).size
    };

    return Response.json({
      success: true,
      overall_stats: overallStats,
      type_metrics: typeMetrics.sort((a, b) => parseFloat(a.avg_rating) - parseFloat(b.avg_rating)),
      low_rated_insights: lowRatedInsights.slice(0, 20),
      recommendations: recommendations.sort((a, b) => {
        const severity = { critical: 3, high: 2, medium: 1 };
        return severity[b.severity] - severity[a.severity];
      }),
      retraining_data: {
        positive_examples: allFeedback.filter(f => f.rating >= 4).map(f => ({
          type: f.insight_type,
          content: f.insight_content,
          feedback: f.feedback_text
        })),
        negative_examples: allFeedback.filter(f => f.rating <= 2).map(f => ({
          type: f.insight_type,
          content: f.insight_content,
          feedback: f.feedback_text,
          issues: {
            accuracy: f.accuracy_rating,
            relevance: f.relevance_rating,
            usefulness: f.usefulness_rating
          }
        }))
      }
    });

  } catch (error) {
    console.error('Error analyzing AI feedback:', error);
    return Response.json({ 
      error: error.message,
      stack: error.stack 
    }, { status: 500 });
  }
});

function extractThemes(feedbackTexts) {
  if (!feedbackTexts || feedbackTexts.length === 0) return [];
  
  const commonWords = ['not', 'too', 'very', 'really', 'more', 'less', 'need', 'should', 'would', 'could'];
  const wordFreq = {};
  
  feedbackTexts.forEach(text => {
    if (!text) return;
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 4 && !commonWords.includes(w));
    
    words.forEach(word => {
      wordFreq[word] = (wordFreq[word] || 0) + 1;
    });
  });
  
  return Object.entries(wordFreq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([word, count]) => ({ theme: word, frequency: count }));
}