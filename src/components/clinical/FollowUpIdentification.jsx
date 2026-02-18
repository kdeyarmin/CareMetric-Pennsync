import React from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Clock, Phone, CheckCircle2 } from "lucide-react";

const URGENCY_STYLE = {
  critical: "bg-red-100 text-red-700 border-red-300",
  high: "bg-amber-100 text-amber-700 border-amber-300",
  moderate: "bg-blue-100 text-blue-700 border-blue-300",
  low: "bg-slate-100 text-slate-600 border-slate-300",
  routine: "bg-slate-50 text-slate-500 border-slate-200",
};

const CATEGORY_ICONS = {
  vital_signs: "🫀",
  compliance: "📋",
  symptom_change: "🩺",
  care_gap: "⚠️",
  risk_escalation: "📈",
  goal_not_met: "🎯",
};

export default function FollowUpIdentification({ data }) {
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Urgency Banner */}
      <div className={`p-3 rounded-lg border ${URGENCY_STYLE[data.urgency_level] || URGENCY_STYLE.routine}`}>
        <div className="flex items-center gap-2 mb-1">
          {data.needs_immediate_followup && <AlertTriangle className="w-4 h-4" />}
          <span className="text-xs font-semibold">
            {data.needs_immediate_followup ? "Immediate Follow-Up Required" : "Follow-Up Assessment"}
          </span>
          <Badge className={`text-[9px] ${URGENCY_STYLE[data.urgency_level]}`}>{data.urgency_level}</Badge>
        </div>
        <p className="text-[11px]">{data.overall_risk_summary}</p>
      </div>

      {/* Visit Recommendation */}
      {data.visit_recommendation && (
        <div className="flex items-center gap-2 p-2 rounded bg-gradient-to-br from-blue-100/40 to-slate-100/60 border border-blue-200/30">
          <Clock className="w-3 h-3 text-blue-600" />
          <span className="text-[11px] text-slate-700"><strong>Next Visit:</strong> {data.visit_recommendation}</span>
        </div>
      )}

      {/* Physician Notification */}
      {data.physician_notification_needed && (
        <div className="flex items-center gap-2 p-2 rounded bg-amber-50/60 border border-amber-200/30">
          <Phone className="w-3 h-3 text-amber-600" />
          <span className="text-[11px] text-amber-700"><strong>Notify Physician:</strong> {data.physician_notification_reason}</span>
        </div>
      )}

      {/* Follow-Up Items */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-slate-700">Identified Issues ({data.followup_items?.length || 0})</p>
        {data.followup_items?.map((item, i) => (
          <div key={i} className={`p-2 rounded border ${URGENCY_STYLE[item.urgency] || URGENCY_STYLE.low}`}>
            <div className="flex items-center gap-1.5 mb-0.5">
              <span className="text-sm">{CATEGORY_ICONS[item.category] || "📌"}</span>
              <Badge variant="outline" className="text-[8px] px-1 py-0">{item.category?.replace(/_/g, " ")}</Badge>
              <Badge className={`text-[8px] px-1 py-0 ${URGENCY_STYLE[item.urgency]}`}>{item.urgency}</Badge>
            </div>
            <p className="text-[11px] font-medium text-slate-800">{item.finding}</p>
            <p className="text-[10px] text-slate-600 mt-0.5">
              <strong>Action:</strong> {item.recommended_action}
            </p>
            <div className="flex gap-3 mt-0.5">
              <span className="text-[9px] text-slate-500"><strong>Timeframe:</strong> {item.timeframe}</span>
              <span className="text-[9px] text-slate-500"><strong>By:</strong> {item.responsible_role}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}