import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';

/**
 * The dashboard's high-risk signal: active high/critical PatientAlert rows,
 * reduced to one row per patient.
 *
 * This was HighRiskPatientsWidget's own query, lifted here so the widget and
 * the "N high-risk patients to review" priority ask the same question through
 * the same query key — react-query then serves both from one request.
 *
 * Why alerts and not a risk table: `PatientRiskAssessment` and `RiskAnalysis`
 * each have a record-store table and an entity schema, and neither has a
 * single writer anywhere in this repository. `patient.risk_level` and
 * `patient.hospitalization_risk`, which the priority used to read, are columns
 * on no table at all. PatientAlert is what the product writes.
 *
 * Returns `{ alerts, truncated }`. `alerts` is every matching patient,
 * newest-and-most-severe first — callers that display a list slice it
 * themselves, and slicing here would make the priority under-report.
 *
 * `truncated` says the page came back full, so there may be matching patients
 * this read never saw. Both implementations cap the page at 500 and order by
 * `created_date` descending — `MAX_ALERT_LIMIT` in
 * base44/functions/getScopedPatientAlerts/entry.ts and `least(p_limit, 500)` in
 * contract_alert_list — and the cap is applied to ALERTS, before anything
 * reduces them to one per patient. Five hundred recent alerts, even many of
 * them for one patient, can therefore crowd an older patient out. A count that
 * cannot say so is the defect this file exists to fix, one size smaller, so the
 * flag travels with the rows and the caller says "at least".
 */
export const HIGH_RISK_PATIENT_ALERTS_KEY = ['highRiskPatients', 'scoped-alerts'];

// The ceiling both implementations enforce; asking for more returns 500.
export const ALERT_PAGE_LIMIT = 500;

// A stable reference, so react-query's placeholder does not re-render the
// dashboard on every pass.
const EMPTY_PAGE = Object.freeze({ alerts: [], truncated: false });

const SEVERITY_RANK = { critical: 2, high: 1 };

export function reduceToOnePerPatient(alerts) {
  const byPatient = new Map();
  for (const alert of alerts) {
    if (!alert?.patient_id) continue;
    const previous = byPatient.get(alert.patient_id);
    if (!previous) {
      byPatient.set(alert.patient_id, alert);
      continue;
    }
    const previousRank = SEVERITY_RANK[previous.severity] || 0;
    const nextRank = SEVERITY_RANK[alert.severity] || 0;
    if (nextRank > previousRank) {
      byPatient.set(alert.patient_id, alert);
    } else if (nextRank === previousRank) {
      const previousDate = new Date(previous.created_date || 0).getTime();
      const nextDate = new Date(alert.created_date || 0).getTime();
      if (nextDate > previousDate) byPatient.set(alert.patient_id, alert);
    }
  }
  return Array.from(byPatient.values())
    .sort((a, b) => (SEVERITY_RANK[b.severity] || 0) - (SEVERITY_RANK[a.severity] || 0));
}

// The page's shape, kept out of the query so it can be exercised directly.
export function toHighRiskPage(alerts) {
  return {
    alerts: reduceToOnePerPatient(alerts),
    truncated: alerts.length >= ALERT_PAGE_LIMIT,
  };
}

export function useHighRiskPatientAlerts() {
  return useQuery({
    queryKey: HIGH_RISK_PATIENT_ALERTS_KEY,
    queryFn: async () => {
      const response = await base44.functions.invoke('getScopedPatientAlerts', {
        limit: ALERT_PAGE_LIMIT,
        status: 'active',
        severity: ['high', 'critical'],
      });
      return toHighRiskPage(response?.data?.alerts || []);
    },
    initialData: EMPTY_PAGE,
    refetchInterval: 300000,
  });
}
