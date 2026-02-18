import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, AlertTriangle, AlertCircle, CheckCircle2, ShieldAlert,
  ChevronDown, ChevronUp, Pill, Bell, Clock, Eye
} from "lucide-react";

const SEVERITY_STYLE = {
  critical: { bg: "bg-red-100 text-red-700 border-red-200", icon: ShieldAlert, dot: "bg-red-500" },
  high: { bg: "bg-amber-100 text-amber-700 border-amber-200", icon: AlertTriangle, dot: "bg-amber-500" },
  moderate: { bg: "bg-blue-100 text-blue-700 border-blue-200", icon: AlertCircle, dot: "bg-blue-500" },
  low: { bg: "bg-slate-100 text-slate-600 border-slate-200", icon: Eye, dot: "bg-slate-400" },
  informational: { bg: "bg-slate-50 text-slate-500 border-slate-200", icon: Eye, dot: "bg-slate-300" },
};

const RISK_BANNER = {
  critical: { bg: "bg-red-50 border-red-300", text: "text-red-800", label: "CRITICAL RISK" },
  high_risk: { bg: "bg-amber-50 border-amber-300", text: "text-amber-800", label: "HIGH RISK" },
  moderate_risk: { bg: "bg-blue-50 border-blue-300", text: "text-blue-800", label: "MODERATE RISK" },
  low_risk: { bg: "bg-green-50 border-green-300", text: "text-green-800", label: "LOW RISK" },
  safe: { bg: "bg-green-50 border-green-300", text: "text-green-800", label: "NO CONCERNS" },
};

const TYPE_LABEL = {
  drug_drug: "Drug-Drug",
  drug_disease: "Drug-Disease",
  drug_allergy: "Drug-Allergy",
  dose_concern: "Dose Concern",
  duplicate_therapy: "Duplicate Therapy",
  high_risk_med: "High-Risk Med",
  missing_medication: "Missing Med",
};

export default function DrugInteractionView({ data, onRefresh }) {
  const [showAll, setShowAll] = useState(false);
  const [expandedIdx, setExpandedIdx] = useState(null);

  if (!data) return null;

  const alerts = data.interaction_alerts || [];
  const criticalAlerts = alerts.filter(a => a.severity === "critical" || a.severity === "high");
  const otherAlerts = alerts.filter(a => a.severity !== "critical" && a.severity !== "high");
  const displayed = showAll ? alerts : alerts.slice(0, 5);
  const banner = RISK_BANNER[data.risk_level] || RISK_BANNER.safe;

  return (
    <div className="space-y-3">
      {/* Risk Banner */}
      <div className={`p-2.5 rounded-lg border ${banner.bg} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          {data.risk_level === "critical" || data.risk_level === "high_risk" ? (
            <ShieldAlert className={`w-4 h-4 ${banner.text}`} />
          ) : (
            <CheckCircle2 className={`w-4 h-4 ${banner.text}`} />
          )}
          <div>
            <p className={`text-[10px] font-bold ${banner.text}`}>{banner.label}</p>
            <p className="text-[10px] text-slate-600">{data.total_medications || 0} medications · {alerts.length} alert(s)</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {data.polypharmacy_risk && data.polypharmacy_risk !== "none" && (
            <Badge className="text-[7px] bg-amber-100 text-amber-700 px-1 py-0">
              Polypharmacy: {data.polypharmacy_risk}
            </Badge>
          )}
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
      </div>

      {/* Summary */}
      <p className="text-[10px] text-slate-700 leading-relaxed">{data.summary}</p>

      {/* Alerts */}
      {alerts.length === 0 ? (
        <div className="text-center py-4">
          <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto mb-1" />
          <p className="text-[10px] text-green-700">No drug interactions or concerns identified</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="text-[9px] font-semibold text-slate-600">
            {criticalAlerts.length > 0 && (
              <span className="text-red-600">{criticalAlerts.length} critical/high · </span>
            )}
            {otherAlerts.length} other alert(s)
          </p>

          {displayed.map((alert, i) => {
            const sev = SEVERITY_STYLE[alert.severity] || SEVERITY_STYLE.low;
            const SevIcon = sev.icon;
            const isExpanded = expandedIdx === i;

            return (
              <div key={i} className={`rounded-lg border p-2 ${sev.bg}`}>
                <button
                  className="w-full text-left flex items-start gap-1.5"
                  onClick={() => setExpandedIdx(isExpanded ? null : i)}
                >
                  <SevIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1 flex-wrap">
                      <Badge variant="outline" className="text-[7px] px-1 py-0">{TYPE_LABEL[alert.alert_type] || alert.alert_type}</Badge>
                      <Badge className={`text-[7px] px-1 py-0 ${sev.bg}`}>{alert.severity}</Badge>
                      {alert.requires_physician_notification && (
                        <Badge className="text-[7px] bg-red-100 text-red-700 px-1 py-0">
                          <Bell className="w-2 h-2 mr-0.5" />MD Alert
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] font-semibold mt-0.5">{alert.title}</p>
                    {alert.medications_involved?.length > 0 && (
                      <div className="flex gap-1 mt-0.5 flex-wrap">
                        {alert.medications_involved.map((m, j) => (
                          <Badge key={j} variant="outline" className="text-[7px] px-1 py-0 bg-white/60">
                            <Pill className="w-2 h-2 mr-0.5" />{m}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {isExpanded ? <ChevronUp className="w-3 h-3 shrink-0 mt-1" /> : <ChevronDown className="w-3 h-3 shrink-0 mt-1" />}
                </button>

                {isExpanded && (
                  <div className="mt-2 ml-5 space-y-1.5 border-t border-current/10 pt-1.5">
                    {alert.mechanism && (
                      <Detail label="Mechanism" value={alert.mechanism} />
                    )}
                    <Detail label="Clinical Significance" value={alert.clinical_significance} />
                    <Detail label="Recommended Action" value={alert.recommended_action} highlight />
                    {alert.monitoring_needed && (
                      <Detail label="Monitoring" value={alert.monitoring_needed} />
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {alerts.length > 5 && (
            <button className="text-[9px] text-indigo-600 hover:underline flex items-center gap-1 mx-auto" onClick={() => setShowAll(!showAll)}>
              {showAll ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAll ? "Show less" : `Show all ${alerts.length} alerts`}
            </button>
          )}
        </div>
      )}

      {/* Monitoring Schedule */}
      {data.monitoring_schedule?.length > 0 && (
        <Section title="Monitoring Schedule" icon={<Clock className="w-3 h-3 text-blue-500" />}>
          {data.monitoring_schedule.map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <Pill className="w-3 h-3 text-purple-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{m.medication}</p>
                <p className="text-[9px] text-slate-500">Monitor: {m.what_to_monitor} · {m.frequency}</p>
                {m.target_range && <p className="text-[8px] text-slate-400">Target: {m.target_range}</p>}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Physician Notifications */}
      {data.physician_notifications?.length > 0 && (
        <Section title="Physician Notifications Needed" icon={<Bell className="w-3 h-3 text-red-500" />}>
          {data.physician_notifications.map((n, i) => (
            <div key={i} className="p-1.5 rounded border border-red-200/50 bg-red-50/40 mb-1 last:mb-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Badge className={`text-[7px] px-1 py-0 ${
                  n.urgency === "immediate" ? "bg-red-100 text-red-700" :
                  n.urgency === "within_24hrs" ? "bg-amber-100 text-amber-700" :
                  "bg-blue-100 text-blue-700"
                }`}>{n.urgency?.replace(/_/g, " ")}</Badge>
              </div>
              <p className="text-[10px] font-medium text-slate-800">{n.issue}</p>
              {n.suggested_message && (
                <p className="text-[9px] text-slate-600 italic mt-0.5">"{n.suggested_message}"</p>
              )}
            </div>
          ))}
        </Section>
      )}

      {/* Safe Medications */}
      {data.safe_medications?.length > 0 && (
        <details className="group">
          <summary className="text-[9px] text-green-600 cursor-pointer hover:underline flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {data.safe_medications.length} medication(s) with no concerns
          </summary>
          <div className="flex flex-wrap gap-1 mt-1 ml-4">
            {data.safe_medications.map((m, i) => (
              <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 border-green-300 text-green-700">{m}</Badge>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}

function Section({ title, icon, children }) {
  return (
    <div className="rounded-lg border border-slate-200/50 p-2">
      <p className="text-[10px] font-semibold text-slate-700 flex items-center gap-1 mb-1.5">{icon}{title}</p>
      {children}
    </div>
  );
}

function Detail({ label, value, highlight }) {
  return (
    <div>
      <p className="text-[8px] font-semibold text-slate-500 uppercase">{label}</p>
      <p className={`text-[9px] ${highlight ? "text-indigo-800 font-medium" : "text-slate-700"}`}>{value}</p>
    </div>
  );
}