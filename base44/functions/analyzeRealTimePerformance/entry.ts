import { createClientFromRequest } from 'npm:@base44/sdk@0.8.31';

// Tolerant JSON extractor: we ask for strict JSON in-prompt instead of passing
// response_json_schema, because the provider rejects deeply-nested object
// schemas that lack an explicit `required` array at every level.
function parseLLMJson(raw) {
  if (!raw) return null;
  if (typeof raw === 'object') return raw;
  const text = String(raw).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
  }
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { nurse_email, training_module_id, session_id } = await req.json();
    // Only admins may analyze another nurse's real-time performance metrics.
    // Mirrors analyzeNurseDeficits; without it any user reads another nurse's
    // RealTimePerformanceMetric + an AI critique of them.
    if (nurse_email && nurse_email !== user.email && user.role !== 'admin') {
      return Response.json({ error: 'Forbidden' }, { status: 403 });
    }
    const targetEmail = nurse_email || user.email;

    // Fetch real-time metrics for this session
    const metrics = await base44.asServiceRole.entities.RealTimePerformanceMetric.filter({
      nurse_email: targetEmail,
      training_module_id,
      session_id
    });

    if (metrics.length === 0) {
      return Response.json({
        recommendation: 'continue',
        suggested_difficulty: 'medium',
        insights: []
      });
    }

    // Analyze performance patterns
    const correctCount = metrics.filter(m => m.is_correct).length;
    const totalCount = metrics.filter(m => m.is_correct !== undefined).length;
    const accuracyRate = totalCount > 0 ? (correctCount / totalCount) * 100 : 0;

    const avgTime = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.time_spent_seconds || 0), 0) / metrics.length
      : 0;

    const difficultyPerformance = {
      easy: { correct: 0, total: 0 },
      medium: { correct: 0, total: 0 },
      hard: { correct: 0, total: 0 }
    };

    metrics.forEach(m => {
      // Guard on bucket membership, not just truthiness: an out-of-enum
      // difficulty (e.g. "expert") would index to undefined and throw on .total++.
      const bucket = difficultyPerformance[m.question_difficulty];
      if (bucket && m.is_correct !== undefined) {
        bucket.total++;
        if (m.is_correct) {
          bucket.correct++;
        }
      }
    });

    // Calculate accuracy by difficulty
    const easyAccuracy = difficultyPerformance.easy.total > 0
      ? (difficultyPerformance.easy.correct / difficultyPerformance.easy.total) * 100
      : 0;
    const mediumAccuracy = difficultyPerformance.medium.total > 0
      ? (difficultyPerformance.medium.correct / difficultyPerformance.medium.total) * 100
      : 0;
    const hardAccuracy = difficultyPerformance.hard.total > 0
      ? (difficultyPerformance.hard.correct / difficultyPerformance.hard.total) * 100
      : 0;

    // AI-driven recommendation
    let suggestedDifficulty = 'medium';
    let recommendation = 'continue';
    const insights = [];

    if (accuracyRate >= 90 && easyAccuracy >= 90) {
      suggestedDifficulty = 'hard';
      recommendation = 'increase_difficulty';
      insights.push('Excellent performance! Ready for more challenging content.');
    } else if (accuracyRate >= 80 && mediumAccuracy >= 80) {
      suggestedDifficulty = 'medium';
      recommendation = 'continue';
      insights.push('Great progress! Continue at this level.');
    } else if (accuracyRate < 60) {
      suggestedDifficulty = 'easy';
      recommendation = 'decrease_difficulty';
      insights.push('Struggling with current difficulty. Switching to easier content.');
    }

    if (avgTime > 60) {
      insights.push('Taking more time to answer - consider providing additional hints.');
    }

    const hintsUsed = metrics.filter(m => m.metric_type === 'hint_usage').length;
    if (hintsUsed > 3) {
      insights.push('Frequent hint usage detected - may need foundational review.');
    }

    // Use AI to generate personalized insights
    const prompt = `
Analyze this nurse's real-time training performance and provide adaptive recommendations:

Performance Data:
- Overall Accuracy: ${accuracyRate.toFixed(1)}%
- Easy Questions: ${easyAccuracy.toFixed(1)}% (${difficultyPerformance.easy.total} questions)
- Medium Questions: ${mediumAccuracy.toFixed(1)}% (${difficultyPerformance.medium.total} questions)
- Hard Questions: ${hardAccuracy.toFixed(1)}% (${difficultyPerformance.hard.total} questions)
- Average Time per Question: ${avgTime.toFixed(1)}s
- Hints Used: ${hintsUsed}

Provide:
1. Specific areas of strength
2. Areas needing improvement
3. Recommended next steps
4. Suggested difficulty level
5. Motivational message

Return ONLY valid JSON, no prose or code fences, with this shape:
{"strengths":[""],"improvement_areas":[""],"next_steps":[""],"recommended_difficulty":"","motivation":""}
`;

    const aiResponse = parseLLMJson(await base44.asServiceRole.integrations.Core.InvokeLLM({
      model: "claude_opus_4_8",
      prompt
    })) || {};

    return Response.json({
      recommendation,
      suggested_difficulty: aiResponse.recommended_difficulty || suggestedDifficulty,
      accuracy_rate: accuracyRate,
      performance_by_difficulty: {
        easy: easyAccuracy,
        medium: mediumAccuracy,
        hard: hardAccuracy
      },
      avg_time_seconds: avgTime,
      hints_used: hintsUsed,
      insights: [...insights, ...(aiResponse.strengths || [])],
      improvement_areas: aiResponse.improvement_areas || [],
      next_steps: aiResponse.next_steps || [],
      motivation_message: aiResponse.motivation || ''
    });

  } catch (error) {
    console.error('Error analyzing performance:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});