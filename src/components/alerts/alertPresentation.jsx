import { Activity, Pill, TrendingDown, Heart, Shield, AlertTriangle, Clock, Zap, Users } from "lucide-react";
import { severitySolidClass } from "@/lib/severityStyles";

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
  return severitySolidClass(severity);
}
