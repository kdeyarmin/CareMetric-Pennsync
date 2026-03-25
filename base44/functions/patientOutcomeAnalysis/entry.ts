import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { time_period = '90days', diagnosis_filter, provider_type } = await req.json();

    // Fetch patients and visit data
    const patients = await base44.entities.Patient.list('-updated_date', 1000);
    const visits = await base44.entities.Visit.list('-created_date', 5000);

    // Filter data by time period
    const now = new Date();
    const dayOffset = time_period === '30days' ? 30 : time_period === '6months' ? 180 : 90;
    const startDate = new Date(now.getTime() - dayOffset * 24 * 60 * 60 * 1000);

    const recentVisits = visits.filter(v => new Date(v.created_date) >= startDate);

    // Build outcome analysis
    const outcomeData = recentVisits.reduce((acc, visit) => {
      if (diagnosis_filter && visit.diagnosis !== diagnosis_filter) return acc;

      const patient = patients.find(p => p.id === visit.patient_id);
      if (!patient) return acc;

      const diagnosis = visit.diagnosis || 'Unknown';
      
      if (!acc[diagnosis]) {
        acc[diagnosis] = {
          total_visits: 0,
          improved: 0,
          stable: 0,
          declined: 0,
          hospitalized: 0,
          avg_recovery_days: 0,
          total_recovery_days: 0,
          outcomes: []
        };
      }

      const outcome = visit.clinical_outcome || 'stable';
      acc[diagnosis].total_visits++;
      acc[diagnosis][outcome] = (acc[diagnosis][outcome] || 0) + 1;
      
      if (patient.recovery_days) {
        acc[diagnosis].total_recovery_days += patient.recovery_days;
      }

      acc[diagnosis].outcomes.push({
        visit_date: visit.created_date,
        outcome,
        provider: visit.provider_type,
        compliance_score: visit.compliance_score || 0
      });

      return acc;
    }, {});

    // Calculate averages and success rates
    const summary = Object.entries(outcomeData).map(([diagnosis, data]) => ({
      diagnosis,
      total_visits: data.total_visits,
      success_rate: data.total_visits > 0 ? ((data.improved / data.total_visits) * 100).toFixed(1) : 0,
      improved_count: data.improved,
      stable_count: data.stable,
      declined_count: data.declined,
      hospitalized_count: data.hospitalized,
      avg_recovery_days: data.total_recovery_days > 0 ? (data.total_recovery_days / data.improved || 1).toFixed(1) : 'N/A',
      avg_compliance_score: data.outcomes.length > 0 
        ? (data.outcomes.reduce((sum, o) => sum + o.compliance_score, 0) / data.outcomes.length).toFixed(1)
        : 0
    })).sort((a, b) => parseFloat(b.success_rate) - parseFloat(a.success_rate));

    // Generate AI insights
    const topDiagnoses = summary.slice(0, 5);
    const insightPrompt = `Analyze these patient outcome metrics and provide 3-4 key insights about treatment effectiveness:

${topDiagnoses.map(d => `
${d.diagnosis}:
- Success Rate: ${d.success_rate}%
- Total Cases: ${d.total_visits}
- Avg Recovery: ${d.avg_recovery_days} days
- Compliance Score: ${d.avg_compliance_score}/100
`).join('\n')}

Provide actionable insights about which diagnoses are performing best, any concerning trends, and recommendations for improvement.`;

    const aiInsights = await base44.integrations.Core.InvokeLLM({
      prompt: insightPrompt
    });

    return Response.json({
      summary,
      top_performers: topDiagnoses.slice(0, 3),
      needs_attention: summary.filter(s => parseFloat(s.success_rate) < 60),
      ai_insights: aiInsights,
      total_patients_analyzed: patients.length,
      period: time_period
    });
  } catch (error) {
    console.error('Patient outcome analysis error:', error);
    return Response.json({ error: error.message }, { status: 500 });
  }
});