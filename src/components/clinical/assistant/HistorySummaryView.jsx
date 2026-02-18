import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, TrendingUp, TrendingDown, Minus, AlertTriangle,
  CheckCircle2, ChevronDown, ChevronUp, Pill, Activity, Heart
} from "lucide-react";

const ACUITY_STYLE = {
  stable: { color: "bg-green-100 text-green-700", icon: CheckCircle2 },
  improving: { color: "bg-blue-100 text-blue-700", icon: TrendingUp },
  declining: { color: "bg-amber-100 text-amber-700", icon: TrendingDown },
  critical: { color: "bg-red-100 text-red-700", icon: AlertTriangle },
};

export default function HistorySummaryView({ data, onRefresh }) {
  const [showFullDiagnoses, setShowFullDiagnoses] = useState(false);

  if (!data) return null;

  const snapshot = data.clinical_snapshot || {};
  const acuity = ACUITY_STYLE[snapshot.acuity_level] || ACUITY_STYLE.stable;
  const AcuityIcon = acuity.icon;

  return (
    <div className="space-y-3">
      {/* Clinical Snapshot */}
      <div className="p-2.5 rounded-lg bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200/40">
        <div className="flex items-center gap-2 mb-1.5">
          <Badge className={`text-[9px] px-1.5 py-0 ${acuity.color}`}>
            <AcuityIcon className="w-2.5 h-2.5 mr-0.5" />
            {snapshot.acuity_level || "Unknown"}
          </Badge>
          <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={onRefresh}>
            <RefreshCw className="w-3 h-3" />
          </Button>
        </div>
        <p className="text-[11px] text-slate-700 leading-relaxed">{snapshot.patient_summary}</p>
        {snapshot.primary_concerns?.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {snapshot.primary_concerns.map((c, i) => (
              <Badge key={i} variant="outline" className="text-[8px] px-1 py-0 border-indigo-300 text-indigo-700">{c}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Diagnoses */}
      {data.diagnoses_summary?.length > 0 && (
        <Section title="Active Diagnoses" icon={<Activity className="w-3 h-3 text-blue-500" />}>
          {(showFullDiagnoses ? data.diagnoses_summary : data.diagnoses_summary.slice(0, 3)).map((dx, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <StatusDot status={dx.status} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{dx.diagnosis}</p>
                <p className="text-[9px] text-slate-500">{dx.key_notes}</p>
              </div>
              <Badge variant="outline" className="text-[7px] px-1 py-0 shrink-0">{dx.status}</Badge>
            </div>
          ))}
          {data.diagnoses_summary.length > 3 && (
            <button className="text-[9px] text-indigo-600 mt-1" onClick={() => setShowFullDiagnoses(!showFullDiagnoses)}>
              {showFullDiagnoses ? "Show less" : `+${data.diagnoses_summary.length - 3} more`}
            </button>
          )}
        </Section>
      )}

      {/* Medications */}
      {data.medication_review && (
        <Section title={`Medications (${data.medication_review.total_medications || 0})`} icon={<Pill className="w-3 h-3 text-purple-500" />}>
          {data.medication_review.high_risk_medications?.length > 0 && (
            <div className="mb-1">
              <p className="text-[9px] font-semibold text-red-600 mb-0.5">High-Risk:</p>
              <div className="flex flex-wrap gap-1">
                {data.medication_review.high_risk_medications.map((m, i) => (
                  <Badge key={i} className="text-[8px] bg-red-100 text-red-700 px-1 py-0">{m}</Badge>
                ))}
              </div>
            </div>
          )}
          {data.medication_review.interaction_warnings?.length > 0 && (
            <div className="mb-1">
              {data.medication_review.interaction_warnings.map((w, i) => (
                <p key={i} className="text-[9px] text-amber-700 flex items-start gap-1">
                  <AlertTriangle className="w-2.5 h-2.5 mt-0.5 shrink-0" />{w}
                </p>
              ))}
            </div>
          )}
          {data.medication_review.adherence_concerns && (
            <p className="text-[9px] text-slate-600">{data.medication_review.adherence_concerns}</p>
          )}
        </Section>
      )}

      {/* Vitals Trend */}
      {data.vitals_trend && (
        <Section title="Vitals Trend" icon={<Heart className="w-3 h-3 text-red-500" />}>
          <p className="text-[10px] text-slate-700">{data.vitals_trend.trend_summary}</p>
          {data.vitals_trend.concerning_trends?.length > 0 && (
            <div className="mt-1 space-y-0.5">
              {data.vitals_trend.concerning_trends.map((t, i) => (
                <p key={i} className="text-[9px] text-red-600 flex items-start gap-1">
                  <TrendingDown className="w-2.5 h-2.5 mt-0.5 shrink-0" />{t}
                </p>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Risk Factors */}
      {data.risk_factors?.length > 0 && (
        <Section title="Risk Factors" icon={<AlertTriangle className="w-3 h-3 text-amber-500" />}>
          {data.risk_factors.map((rf, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <Badge className={`text-[7px] px-1 py-0 shrink-0 ${
                rf.severity === 'critical' ? 'bg-red-100 text-red-700' :
                rf.severity === 'high' ? 'bg-amber-100 text-amber-700' :
                rf.severity === 'moderate' ? 'bg-blue-100 text-blue-700' :
                'bg-slate-100 text-slate-600'
              }`}>{rf.severity}</Badge>
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{rf.factor}</p>
                <p className="text-[9px] text-slate-500">{rf.recommendation}</p>
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Next Visit Focus */}
      {data.next_visit_focus?.length > 0 && (
        <div className="p-2 rounded-lg bg-indigo-50 border border-indigo-200/40">
          <p className="text-[9px] font-semibold text-indigo-700 mb-1">📋 Next Visit Focus Areas</p>
          {data.next_visit_focus.map((f, i) => (
            <p key={i} className="text-[10px] text-indigo-800 pl-3 relative before:content-['•'] before:absolute before:left-0">{f}</p>
          ))}
        </div>
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

function StatusDot({ status }) {
  const color = status === 'worsening' ? 'bg-red-400' : status === 'resolving' ? 'bg-green-400' : status === 'stable' ? 'bg-blue-400' : 'bg-slate-400';
  return <div className={`w-1.5 h-1.5 rounded-full mt-1 shrink-0 ${color}`} />;
}