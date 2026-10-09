import { toCsvRows } from '@/components/admin/csvExport';

/** Completion counts for the training tab; `rate` is null with no assignments. */
export function trainingCompletionStats(assignments) {
  const rows = Array.isArray(assignments) ? assignments : [];
  const completed = rows.filter((row) => row?.status === 'completed' || row?.pass_fail_result === 'passed').length;
  return {
    completed,
    total: rows.length,
    rate: rows.length > 0 ? ((completed / rows.length) * 100).toFixed(1) : null,
  };
}

/**
 * The Agency Analytics CSV. A section whose source was not loaded is written
 * as "Unavailable" rather than as a zero, so a spreadsheet built from the
 * export cannot mistake a missing source for a measured one.
 */
export function buildAgencyAnalyticsCsv({ overallStats, topPerformers, trainingStats, available, generatedAt }) {
  const unavailable = 'Unavailable';
  const rows = [
    ['Agency Analytics Report'],
    ['Generated', generatedAt],
    [],
    ['Metric', 'Value'],
    ['Total Visits', overallStats.visits.total],
    ['Completed Visits', overallStats.visits.completed],
    ['Visit Completion Rate (%)', overallStats.visits.completionRate],
    ['Total Patients', overallStats.patients.total],
    ['Active Patients', overallStats.patients.active],
    ['Total Incidents', available.incidents ? overallStats.incidents.total : unavailable],
    ['Avg Compliance Score', available.compliance && overallStats.compliance.auditsInRange > 0
      ? overallStats.compliance.avgScore
      : unavailable],
    ['Training Completion Rate (%)', trainingStats?.rate ?? unavailable],
    [],
    ['Top Performers'],
    ['Name', 'Email', 'Total Visits', 'Completion Rate (%)'],
    ...topPerformers.map((nurse) => [
      nurse.full_name || '',
      nurse.email || '',
      nurse.stats.totalVisits,
      nurse.stats.completionRate,
    ]),
  ];
  return toCsvRows(rows);
}
