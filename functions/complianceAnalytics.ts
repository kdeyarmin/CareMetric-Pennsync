import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { time_period = '90days', provider_type, department } = await req.json();

    // Fetch visits and compliance data
    const visits = await base44.entities.Visit.list('-created_date', 5000);
    const complianceViolations = await base44.entities.ComplianceViolation.list('-created_date', 5000);

    // Filter by time period
    const now = new Date();
    const dayOffset = time_period === '30days' ? 30 : time_period === '6months' ? 180 : 90;
    const startDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);

    const recentVisits = visits.filter(v => new Date(v.created_date) >= startDate);
    const recentViolations = complianceViolations.filter(v => new Date(v.created_date) >= startDate);

    // Group by provider and date
    const providerMetrics = {};
    const dateMetrics = {};

    recentVisits.forEach(visit => {
      const provider = visit.provider_type || 'Unknown';
      const date = new Date(visit.created_date).toISOString().split('T')[0];
      const score = visit.compliance_score || 0;

      // Provider metrics
      if (!providerMetrics[provider]) {
        providerMetrics[provider] = {
          total: 0,
          scores: [],
          violations: 0,
          quality_issues: 0
        };
      }
      providerMetrics[provider].total++;
      providerMetrics[provider].scores.push(score);

      // Date metrics
      if (!dateMetrics[date]) {
        dateMetrics[date] = { avg_score: 0, count: 0, violations: 0 };
      }
      dateMetrics[date].count++;
    });

    // Count violations by provider
    recentViolations.forEach(v => {
      const provider = v.user_email?.split('@')[0] || 'Unknown';
      if (providerMetrics[provider]) {
        providerMetrics[provider].violations++;
      }
    });

    // Calculate provider statistics
    const providerStats = Object.entries(providerMetrics).map(([provider, data]) => {
      const avgScore = data.scores.length > 0 
        ? (data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(1)
        : 0;
      const violationRate = ((data.violations / data.total) * 100).toFixed(1);

      return {
        provider,
        avg_compliance_score: avgScore,
        total_documents: data.total,
        violations_count: data.violations,
        violation_rate: violationRate,
        consistency: calculateConsistency(data.scores)
      };
    }).sort((a, b) => parseFloat(b.avg_compliance_score) - parseFloat(a.avg_compliance_score));

    // Trend data for chart
    const trendData = Object.entries(dateMetrics)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-30) // Last 30 days
      .map(([date, data]) => ({
        date,
        avg_score: (data.scores?.reduce((a, b) => a + b, 0) / (data.count || 1) || 0).toFixed(1),
        count: data.count,
        violations: data.violations
      }));

    // Violation categories
    const violationsByCategory = {};
    recentViolations.forEach(v => {
      const cat = v.rule_category || 'Uncategorized';
      violationsByCategory[cat] = (violationsByCategory[cat] || 0) + 1;
    });

    // AI analysis of trends
    const analysisPrompt = `Analyze these documentation compliance trends:

Top Performers:
${providerStats.slice(0, 3).map(p => `${p.provider}: ${p.avg_compliance_score}% (${p.total_documents} docs)`).join('\n')}

Needs Improvement:
${providerStats.filter(p => parseFloat(p.avg_compliance_score) < 75).map(p => `${p.provider}: ${p.avg_compliance_score}% (${p.violations_count} violations)`).join('\n')}

Common Violations:
${Object.entries(violationsByCategory).map(([cat, count]) => `${cat}: ${count}`).join('\n')}

Provide 3-4 actionable recommendations to improve compliance and consistency across the team.`;

    const aiAnalysis = await base44.integrations.Core.InvokeLLM({
      prompt: analysisPrompt
    });

    return Response.json({
      provider_rankings: providerStats,
      trend_data: trendData,
      violations_by_category: Object.entries(violationsByCategory).map(([category, count]) => ({ category, count })),
      total_violations: recentViolations.length,
      average_compliance: (providerStats.reduce((sum, p) => sum + parseFloat(p.avg_compliance_score), 0) / providerStats.length).toFixed(1),
      ai_analysis: aiAnalysis,
      period: time_period
    });
  } catch (error) {
    console.error('Compliance analytics error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});

function calculateConsistency(scores) {
  if (scores.length === 0) return 100;
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const variance = scores.reduce((sum, score) => sum + Math.pow(score - avg, 2), 0) / scores.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, 100 - stdDev).toFixed(1);
}