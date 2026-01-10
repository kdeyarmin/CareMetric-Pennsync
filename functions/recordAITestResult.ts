import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

/**
 * Records results from AI model usage for A/B testing analysis
 */
Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const {
      configuration_id,
      provider_type,
      task_type,
      ab_test_group,
      quality_score,
      compliance_score,
      processing_time_ms,
      tokens_used,
      success,
      error_message
    } = await req.json();

    // Create test result record
    const result = await base44.entities.AIModelTestResult.create({
      configuration_id,
      provider_type,
      task_type,
      user_email: user.email,
      ab_test_group,
      quality_score,
      compliance_score,
      processing_time_ms,
      tokens_used,
      success,
      error_message
    });

    // Update configuration performance metrics
    const config = await base44.entities.AIModelConfiguration.filter({ id: configuration_id });
    if (config[0]) {
      const metrics = config[0].performance_metrics || {};
      const totalUses = (metrics.total_uses || 0);
      
      await base44.asServiceRole.entities.AIModelConfiguration.update(configuration_id, {
        performance_metrics: {
          total_uses: totalUses + 1,
          avg_quality_score: calculateNewAverage(metrics.avg_quality_score, quality_score, totalUses),
          avg_compliance_score: calculateNewAverage(metrics.avg_compliance_score, compliance_score, totalUses),
          avg_processing_time_ms: calculateNewAverage(metrics.avg_processing_time_ms, processing_time_ms, totalUses),
          success_rate: calculateSuccessRate(metrics, success, totalUses)
        }
      });
    }

    return Response.json({
      success: true,
      result_id: result.id
    });

  } catch (error) {
    console.error('Record test result error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});

function calculateNewAverage(currentAvg, newValue, count) {
  if (!currentAvg || count === 0) return newValue;
  return ((currentAvg * count) + newValue) / (count + 1);
}

function calculateSuccessRate(metrics, success, count) {
  const currentSuccesses = (metrics.success_rate || 1) * count;
  const newSuccesses = currentSuccesses + (success ? 1 : 0);
  return newSuccesses / (count + 1);
}