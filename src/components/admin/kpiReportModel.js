/**
 * Pure helpers for the AI KPI report: summarising the compliance audits that
 * feed the prompt, and shaping the model's answer before it is rendered.
 */
const finiteNumber = (value) => {
  if (value === null || value === undefined || (typeof value === 'string' && !value.trim())) return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
};
const boundedPercent = (value) => {
  const number = finiteNumber(value);
  return number === null ? null : Math.min(100, Math.max(0, Math.round(number * 10) / 10));
};
const textOrEmpty = (value) => (typeof value === 'string' ? value : '');
const stringList = (value) => (Array.isArray(value)
  ? value.filter((item) => typeof item === 'string' && item.trim()).slice(0, 20)
  : []);
const objectList = (value) => (Array.isArray(value)
  ? value.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).slice(0, 20)
  : []);

/**
 * The model's answer is rendered directly, so shape it before it reaches the
 * page: a number the model returned as text would otherwise throw inside
 * `toFixed`, and an object where a string belongs would render as
 * "[object Object]".
 */
export function normalizeKpiReport(result, timeframeDays) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return null;
  const compliance = result.documentation_compliance && typeof result.documentation_compliance === 'object'
    ? result.documentation_compliance
    : {};
  const operations = result.operational_metrics && typeof result.operational_metrics === 'object'
    ? result.operational_metrics
    : {};
  const risk = result.risk_analysis && typeof result.risk_analysis === 'object'
    ? result.risk_analysis
    : {};
  return {
    executive_summary: textOrEmpty(result.executive_summary),
    generated_date: textOrEmpty(result.generated_date),
    timeframe_days: finiteNumber(result.timeframe_days) ?? timeframeDays,
    documentation_compliance: {
      overall_rate: boundedPercent(compliance.overall_rate),
      trend: textOrEmpty(compliance.trend),
      common_gaps: stringList(compliance.common_gaps),
      top_performers: stringList(compliance.top_performers),
    },
    patient_outcomes: objectList(result.patient_outcomes).map((outcome) => ({
      diagnosis: textOrEmpty(outcome.diagnosis),
      visit_count: finiteNumber(outcome.visit_count),
      incident_count: finiteNumber(outcome.incident_count),
      trend: textOrEmpty(outcome.trend),
      insights: textOrEmpty(outcome.insights),
    })),
    operational_metrics: {
      visit_completion_rate: boundedPercent(operations.visit_completion_rate),
      avg_visits_per_patient: finiteNumber(operations.avg_visits_per_patient),
      efficiency_score: boundedPercent(operations.efficiency_score),
      insights: textOrEmpty(operations.insights),
    },
    risk_analysis: {
      high_risk_patterns: stringList(risk.high_risk_patterns),
      incident_trends: textOrEmpty(risk.incident_trends),
      safety_score: boundedPercent(risk.safety_score),
    },
    recommendations: objectList(result.recommendations).map((rec) => ({
      priority: ['high', 'medium', 'low'].includes(rec.priority) ? rec.priority : 'medium',
      category: textOrEmpty(rec.category),
      recommendation: textOrEmpty(rec.recommendation),
      expected_impact: textOrEmpty(rec.expected_impact),
    })).filter((rec) => rec.recommendation),
  };
}

export function summarizeComplianceAudits(audits) {
  const rows = Array.isArray(audits) ? audits : [];
  const scored = rows
    .map((audit) => finiteNumber(audit?.compliance_score))
    .filter((score) => score !== null);
  return {
    total: rows.length,
    averageScore: scored.length > 0
      ? (scored.reduce((sum, score) => sum + score, 0) / scored.length).toFixed(1)
      : null,
    passed: rows.filter((audit) => audit?.status === 'passed').length,
    flagged: rows.filter((audit) => audit?.status === 'flagged').length,
    critical: rows.filter((audit) => audit?.status === 'critical').length,
  };
}
