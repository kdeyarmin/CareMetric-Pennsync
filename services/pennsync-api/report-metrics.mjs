// What feeds the carried report arithmetic in `report-metrics-source.mjs`.
//
// `contract_report_metrics` counts in the store and returns totals, sums and
// group keys — no chart and no colleague row crosses the boundary. The
// original's `calculateMetrics` takes nine ARRAYS. This module rebuilds arrays
// the aggregates describe, so that function can be handed them unmodified.
//
// **Why that is faithful rather than a re-implementation.** `calculateMetrics`
// reads each array in exactly two ways: it counts members matching a literal
// field value, and it sums one numeric field. A rebuilt array with the same
// number of members carrying the same field values therefore produces the same
// answer — and it is the ORIGINAL's `.filter`, `.reduce`, `.toFixed(1)` and
// division doing the producing, so none of the report's arithmetic is retyped.
// The one place that could have gone wrong is a float sum, and it cannot: the
// contract's two groupings are complete PARTITIONS of the rows they count, so
// every sum is carried whole on one member and the rest add zero, which is
// exact. Where the sum came from, the contract pins its accumulation order.
//
// The parity test drives the original's own function over real rows and this
// path over the aggregates counted from those same rows, and compares field for
// field. That is D57's harness, and it is the only reason to believe any of the
// above.

import {
  buildAiReport, calculateDailyTrend, calculateMetrics,
} from './report-metrics-source.mjs';

export { buildAiReport };

/** The original clamps `date_range_days` to 1..365; the contract re-applies the
 *  ceiling, because a bound a caller could raise is not a bound (D71). */
export function reportWindow(rawDateRangeDays, now = new Date()) {
  const days = Math.min(Math.max(Math.floor(Number(rawDateRangeDays) || 30), 1), 365);
  const endDate = new Date(now);
  const startDate = new Date(endDate);
  startDate.setDate(startDate.getDate() - days);
  return { days, startDate, endDate };
}

const repeat = (count, make) => Array.from({ length: Math.max(0, count | 0) }, (_, i) => make(i));

/**
 * The nine arrays `calculateMetrics` expects, rebuilt from the aggregates.
 *
 * `trainings` is empty ON PURPOSE and its two figures are replaced afterwards:
 * `TrainingAssignment` is `hub` and D84's `uncarried_legs` entry settles the
 * leg by name, so a zero here would read as "nobody trained".
 */
export function reportCorpus(a) {
  const visitGroups = Array.isArray(a.nurse_visits) ? a.nurse_visits : [];
  const noteGroups = Array.isArray(a.nurse_notes) ? a.nurse_notes : [];

  const visits = visitGroups.flatMap(group => repeat(group.total, i => ({
    created_by: group.email || '',
    status: i < (group.completed | 0) ? 'completed' : 'scheduled',
  })));

  const noteConversions = noteGroups.flatMap(group => repeat(group.count, i => ({
    nurse_email: group.email || '',
    quality_score: i === 0 ? Number(group.quality_sum ?? 0) : 0,
    compliance_improvement: i === 0 ? Number(group.improvement_sum ?? 0) : 0,
  })));

  const audits = [
    ...repeat(a.audits_passed, () => ({ status: 'passed' })),
    ...repeat(a.audits_flagged, () => ({ status: 'flagged' })),
    ...repeat(a.audits_critical, () => ({ status: 'critical' })),
  ];
  // Any audit whose status is none of the three still counts toward the
  // average, exactly as it does in the original.
  while (audits.length < (a.audits_total | 0)) audits.push({ status: 'pending_review' });
  if (audits.length > 0) audits[0].compliance_score = Number(a.audit_score_sum ?? 0);

  return {
    visits,
    patients: [
      ...repeat(a.patients_active, () => ({ status: 'active' })),
      ...repeat((a.patients_total | 0) - (a.patients_active | 0), () => ({ status: 'discharged' })),
    ],
    incidents: [
      ...repeat(a.falls, () => ({ incident_type: 'fall' })),
      ...repeat(a.hospitalizations, () => ({ incident_type: 'hospitalized' })),
      ...repeat(a.medication_errors, () => ({ incident_type: 'medication_error' })),
    ],
    audits,
    trainings: [],
    noteConversions,
    alerts: repeat(a.critical_alerts, () => ({ severity: 'critical', status: 'active' })),
    tasks: [
      ...repeat(a.tasks_completed, () => ({ status: 'completed' })),
      ...repeat((a.tasks_total | 0) - (a.tasks_completed | 0), () => ({ status: 'pending' })),
    ],
    // D41. The roster IS the population: the original's `role === 'user'` test
    // excluded only the built-in admin, a tier D14 and D22 removed. It carries
    // no `full_name`, so the original's `full_name || email` falls through to
    // the address — which is the only name this store has (D38), and unlike
    // D69's roster PDF there is no Email column beside it to print twice.
    users: (Array.isArray(a.roster) ? a.roster : []).map(email => ({ role: 'user', email })),
  };
}

/**
 * The daily trend, through the original's own `calculateDailyTrend`.
 *
 * The stub instant is UTC NOON of the day the contract counted, not midnight.
 * That function buckets with `setHours(0, 0, 0, 0)`, which is local time, so a
 * midnight instant lands on the previous day for any process west of UTC. Noon
 * lands on the intended day for every zone this service can run in.
 */
export function reportTrend(a, startDate, endDate) {
  const rows = (Array.isArray(a.daily_notes) ? a.daily_notes : []).flatMap(day =>
    repeat(day.count, () => ({ created_date: `${day.day}T12:00:00.000Z` })));
  return calculateDailyTrend(rows, startDate, endDate);
}

/** Everything the report renders, from one contract answer. */
export function reportMetrics(a, startDate, endDate) {
  const corpus = reportCorpus(a);
  const metrics = calculateMetrics({
    ...corpus,
    dailyEnhancementTrend: reportTrend(a, startDate, endDate),
  });
  // Absent, not zero: an empty `trainings` array makes the original answer 0
  // and 0, and an administrator reading "Training Completed: 0" would be told
  // something false. The carried page omits a null line and the handler's
  // answer says where the leg is served (D84).
  metrics.staff_performance.training_completed = null;
  metrics.staff_performance.avg_training_score = null;
  return metrics;
}

/**
 * What the model is allowed to see.
 *
 * The original sends the whole metrics object to `InvokeLLM`, and
 * `staff_performance.nurse_stats` carries every top performer's name and
 * address. D64's rule is that every column reaching a prompt is NAMED, and the
 * prompt asks for trends and benchmarks — it has no use for who anybody is.
 * So the staff table reaches the PDF, which goes to the administrator whose own
 * roster it is, and the per-person rows are replaced by their shape on the way
 * to the model. Nothing else is withheld.
 */
export function insightPayload(metrics) {
  const staff = metrics.staff_performance ?? {};
  const stats = Array.isArray(staff.nurse_stats) ? staff.nurse_stats : [];
  return {
    ...metrics,
    staff_performance: {
      ...staff,
      nurse_stats: stats.map(({ name, email, ...rest }) => rest),
    },
  };
}
