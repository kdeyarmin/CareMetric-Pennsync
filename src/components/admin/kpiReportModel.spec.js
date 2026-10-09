import { describe, expect, it } from 'vitest';
import { normalizeKpiReport, summarizeComplianceAudits } from './kpiReportModel';

describe('summarizeComplianceAudits', () => {
  it('counts statuses and averages only scored audits', () => {
    expect(summarizeComplianceAudits([
      { compliance_score: 90, status: 'passed' },
      { compliance_score: '70', status: 'flagged' },
      { compliance_score: null, status: 'critical' },
    ])).toEqual({ total: 3, averageScore: '80.0', passed: 1, flagged: 1, critical: 1 });
  });

  it('reports no average rather than zero when nothing is scored', () => {
    expect(summarizeComplianceAudits([]).averageScore).toBeNull();
    expect(summarizeComplianceAudits(undefined)).toMatchObject({ total: 0, averageScore: null });
  });
});

describe('normalizeKpiReport', () => {
  it('refuses a non-object answer', () => {
    expect(normalizeKpiReport(null, 30)).toBeNull();
    expect(normalizeKpiReport('report', 30)).toBeNull();
    expect(normalizeKpiReport([], 30)).toBeNull();
  });

  it('coerces numeric text, bounds percentages, and keeps absent numbers absent', () => {
    const report = normalizeKpiReport({
      executive_summary: 'Summary',
      documentation_compliance: { overall_rate: '120', common_gaps: ['Gap', 4, { x: 1 }] },
      operational_metrics: { avg_visits_per_patient: '2.54', visit_completion_rate: null },
      risk_analysis: { safety_score: -5 },
      recommendations: [
        { priority: 'urgent', recommendation: 'Do it' },
        { priority: 'high' },
        'not an object',
      ],
    }, 30);
    expect(report.timeframe_days).toBe(30);
    expect(report.documentation_compliance.overall_rate).toBe(100);
    expect(report.documentation_compliance.common_gaps).toEqual(['Gap']);
    expect(report.operational_metrics.avg_visits_per_patient).toBeCloseTo(2.54);
    expect(report.operational_metrics.visit_completion_rate).toBeNull();
    expect(report.risk_analysis.safety_score).toBe(0);
    expect(report.recommendations).toEqual([
      { priority: 'medium', category: '', recommendation: 'Do it', expected_impact: '' },
    ]);
  });
});
