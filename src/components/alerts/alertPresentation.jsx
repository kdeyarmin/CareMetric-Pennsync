import { Activity, Pill, TrendingDown, Heart, Shield, AlertTriangle, Clock, Zap, Users } from "lucide-react";

/**
 * Shared presentation helpers for patient alerts, used by both PatientAlertAnalyzer
 * and PatientAlertsDashboard (which previously defined identical copies).
 */

const ALERT_ICONS = {
  vital_deterioration: Activity,
  medication_risk: Pill,
  fall_risk: TrendingDown,
  readmission_risk: Heart,
  infection_risk: Shield,
  symptom_escalation: AlertTriangle,
  care_gap: Clock,
  urgent_intervention: Zap,
  hospice_transition: Heart,
  caregiver_burnout: Users,
};

/** Icon element for an alert type (falls back to a warning triangle). */
export function getAlertIcon(type) {
  const Icon = ALERT_ICONS[type] || AlertTriangle;
  return <Icon className="w-4 h-4" />;
}

/** Tailwind badge classes for an alert severity. */
export function getSeverityColor(severity) {
  switch (severity) {
    case "critical":
      return "bg-red-600 text-white";
    case "high":
      return "bg-orange-500 text-white";
    case "medium":
      return "bg-yellow-500 text-white";
    case "low":
      return "bg-blue-500 text-white";
    default:
      return "bg-slate-500 text-white";
  }
}
