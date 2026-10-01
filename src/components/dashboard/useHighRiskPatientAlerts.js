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
 * Returns EVERY matching patient, newest-and-most-severe first. Callers that
 * display a list slice it themselves; the priority counts the whole set, and
 * slicing here would make it under-report.
 */
export const HIGH_RISK_PATIENT_ALERTS_KEY = ['highRiskPatients', 'scoped-alerts'];

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

export function useHighRiskPatientAlerts() {
  return useQuery({
    queryKey: HIGH_RISK_PATIENT_ALERTS_KEY,
    queryFn: async () => {
      const response = await base44.functions.invoke('getScopedPatientAlerts', {
        limit: 500,
        status: 'active',
        severity: ['high', 'critical'],
      });
      return reduceToOnePerPatient(response?.data?.alerts || []);
    },
    initialData: [],
    refetchInterval: 300000,
  });
}
