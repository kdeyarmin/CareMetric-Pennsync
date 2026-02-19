import { createClientFromRequest } from 'npm:@base44/sdk@0.8.6';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();

    if (!user || user.role !== 'admin') {
      return Response.json({ error: 'Admin access required' }, { status: 403 });
    }

    const { period_type, period_start, period_end } = await req.json();

    if (!period_type || !period_start || !period_end) {
      return Response.json({ 
        success: false, 
        error: 'Period type, start, and end dates required' 
      }, { status: 400 });
    }

    const kpis = [];

    // Financial KPIs
    const billingRecords = await base44.asServiceRole.entities.Billing.filter({});
    const periodBilling = billingRecords.filter(b => 
      new Date(b.billing_period_start) >= new Date(period_start) &&
      new Date(b.billing_period_end) <= new Date(period_end)
    );

    const totalRevenue = periodBilling.reduce((sum, b) => sum + (b.total_paid || 0), 0);
    const totalBilled = periodBilling.reduce((sum, b) => sum + (b.total_billed || 0), 0);
    const collectionRate = totalBilled > 0 ? (totalRevenue / totalBilled) * 100 : 0;
    const avgRevenuePerVisit = periodBilling.reduce((sum, b) => sum + (b.revenue_per_visit || 0), 0) / (periodBilling.length || 1);
    const avgMargin = periodBilling.reduce((sum, b) => sum + (b.margin || 0), 0) / (periodBilling.length || 1);

    kpis.push({
      metric_name: 'Total Revenue',
      metric_category: 'financial',
      period_type,
      period_start,
      period_end,
      metric_value: totalRevenue,
      target_value: totalBilled,
      unit: '$',
      trend: 'stable',
      variance_percentage: ((totalRevenue - totalBilled) / totalBilled) * 100,
      status: collectionRate >= 95 ? 'on_target' : collectionRate >= 85 ? 'warning' : 'critical'
    });

    kpis.push({
      metric_name: 'Collection Rate',
      metric_category: 'financial',
      period_type,
      period_start,
      period_end,
      metric_value: collectionRate,
      target_value: 98,
      benchmark_value: 95,
      unit: '%',
      trend: collectionRate >= 95 ? 'up' : 'down',
      variance_percentage: ((collectionRate - 98) / 98) * 100,
      status: collectionRate >= 95 ? 'on_target' : collectionRate >= 85 ? 'warning' : 'critical'
    });

    kpis.push({
      metric_name: 'Revenue Per Visit',
      metric_category: 'financial',
      period_type,
      period_start,
      period_end,
      metric_value: avgRevenuePerVisit,
      target_value: 180,
      benchmark_value: 175,
      unit: '$',
      trend: 'stable',
      status: avgRevenuePerVisit >= 175 ? 'on_target' : 'warning'
    });

    kpis.push({
      metric_name: 'Profit Margin',
      metric_category: 'financial',
      period_type,
      period_start,
      period_end,
      metric_value: avgMargin,
      target_value: 15,
      benchmark_value: 12,
      unit: '%',
      trend: avgMargin >= 12 ? 'up' : 'down',
      status: avgMargin >= 15 ? 'on_target' : avgMargin >= 10 ? 'warning' : 'critical'
    });

    // Clinical KPIs
    const outcomeRecords = await base44.asServiceRole.entities.PatientOutcomeMetric.filter({});
    const periodOutcomes = outcomeRecords.filter(o =>
      new Date(o.episode_start) >= new Date(period_start) &&
      new Date(o.episode_start) <= new Date(period_end)
    );

    const readmissionRate = (periodOutcomes.filter(o => o.readmission_30_day).length / (periodOutcomes.length || 1)) * 100;
    const avgGoalAchievement = periodOutcomes.reduce((sum, o) => sum + (o.goal_achievement_rate || 0), 0) / (periodOutcomes.length || 1);
    const avgOutcomeQuality = periodOutcomes.reduce((sum, o) => sum + (o.outcome_quality_score || 0), 0) / (periodOutcomes.length || 1);

    kpis.push({
      metric_name: '30-Day Readmission Rate',
      metric_category: 'clinical',
      period_type,
      period_start,
      period_end,
      metric_value: readmissionRate,
      target_value: 15,
      benchmark_value: 18,
      unit: '%',
      trend: readmissionRate <= 15 ? 'down' : 'up',
      status: readmissionRate <= 15 ? 'on_target' : readmissionRate <= 20 ? 'warning' : 'critical'
    });

    kpis.push({
      metric_name: 'Care Plan Goal Achievement',
      metric_category: 'clinical',
      period_type,
      period_start,
      period_end,
      metric_value: avgGoalAchievement,
      target_value: 85,
      benchmark_value: 80,
      unit: '%',
      trend: avgGoalAchievement >= 80 ? 'up' : 'down',
      status: avgGoalAchievement >= 85 ? 'on_target' : avgGoalAchievement >= 75 ? 'warning' : 'critical'
    });

    kpis.push({
      metric_name: 'Patient Outcome Quality',
      metric_category: 'quality',
      period_type,
      period_start,
      period_end,
      metric_value: avgOutcomeQuality,
      target_value: 85,
      benchmark_value: 80,
      unit: 'score',
      trend: avgOutcomeQuality >= 80 ? 'up' : 'down',
      status: avgOutcomeQuality >= 85 ? 'on_target' : avgOutcomeQuality >= 75 ? 'warning' : 'critical'
    });

    // Operational KPIs
    const visits = await base44.asServiceRole.entities.Visit.filter({});
    const periodVisits = visits.filter(v =>
      new Date(v.visit_date) >= new Date(period_start) &&
      new Date(v.visit_date) <= new Date(period_end)
    );

    const totalVisits = periodVisits.length;
    const patientsServed = new Set(periodVisits.map(v => v.patient_id)).size;

    kpis.push({
      metric_name: 'Total Visits',
      metric_category: 'operational',
      period_type,
      period_start,
      period_end,
      metric_value: totalVisits,
      unit: 'count',
      trend: 'stable',
      status: 'on_target'
    });

    kpis.push({
      metric_name: 'Patients Served',
      metric_category: 'operational',
      period_type,
      period_start,
      period_end,
      metric_value: patientsServed,
      unit: 'count',
      trend: 'stable',
      status: 'on_target'
    });

    // Compliance KPIs
    const complianceAudits = await base44.asServiceRole.entities.ComplianceAudit.filter({});
    const periodAudits = complianceAudits.filter(a =>
      new Date(a.created_date) >= new Date(period_start) &&
      new Date(a.created_date) <= new Date(period_end)
    );

    const avgComplianceScore = periodAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / (periodAudits.length || 1);

    kpis.push({
      metric_name: 'Documentation Compliance',
      metric_category: 'compliance',
      period_type,
      period_start,
      period_end,
      metric_value: avgComplianceScore,
      target_value: 95,
      benchmark_value: 90,
      unit: '%',
      trend: avgComplianceScore >= 90 ? 'up' : 'down',
      status: avgComplianceScore >= 95 ? 'on_target' : avgComplianceScore >= 85 ? 'warning' : 'critical'
    });

    // Store all KPIs
    for (const kpi of kpis) {
      await base44.asServiceRole.entities.AgencyKPI.create(kpi);
    }

    return Response.json({
      success: true,
      kpis_generated: kpis.length,
      kpis
    });

  } catch (error) {
    console.error('KPI generation error:', error);
    return Response.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
});