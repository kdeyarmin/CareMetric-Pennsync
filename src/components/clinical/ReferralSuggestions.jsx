import React from "react";
import { Badge } from "@/components/ui/badge";
import { ArrowRightLeft, Target, MapPin } from "lucide-react";

const URGENCY_STYLE = {
  urgent: "bg-red-100 text-red-700",
  routine: "bg-blue-100 text-blue-700",
  when_available: "bg-slate-100 text-slate-600",
};

const TYPE_STYLE = {
  new_problem: "bg-blue-100 text-blue-700",
  revise_goal: "bg-amber-100 text-amber-700",
  add_intervention: "bg-green-100 text-green-700",
  increase_frequency: "bg-purple-100 text-purple-700",
  decrease_frequency: "bg-slate-100 text-slate-600",
  discontinue: "bg-red-100 text-red-700",
};

export default function ReferralSuggestions({ data }) {
  if (!data) return null;

  return (
    <div className="space-y-3">
      {/* Referrals */}
      {data.referral_suggestions?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-700 flex items-center gap-1">
            <ArrowRightLeft className="w-3 h-3" /> Suggested Referrals ({data.referral_suggestions.length})
          </p>
          {data.referral_suggestions.map((ref, i) => (
            <div key={i} className="p-2 rounded border border-slate-200/50 bg-white/60 dark:bg-slate-900/40">
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className="text-[11px] font-semibold text-slate-800">{ref.specialty}</span>
                <Badge className={`text-[8px] px-1 py-0 ${URGENCY_STYLE[ref.urgency]}`}>{ref.urgency}</Badge>
              </div>
              <p className="text-[10px] text-slate-600">{ref.referral_type}</p>
              <p className="text-[10px] text-slate-500 mt-0.5"><strong>Rationale:</strong> {ref.clinical_rationale}</p>
              <p className="text-[10px] text-slate-500"><strong>Expected Outcome:</strong> {ref.expected_outcome}</p>
            </div>
          ))}
        </div>
      )}

      {/* Care Plan Adjustments */}
      {data.care_plan_adjustments?.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-slate-700 flex items-center gap-1">
            <Target className="w-3 h-3" /> Care Plan Adjustments ({data.care_plan_adjustments.length})
          </p>
          {data.care_plan_adjustments.map((adj, i) => (
            <div key={i} className="p-2 rounded border border-slate-200/50 bg-white/60 dark:bg-slate-900/40">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Badge className={`text-[8px] px-1 py-0 ${TYPE_STYLE[adj.type] || TYPE_STYLE.new_problem}`}>
                  {adj.type?.replace(/_/g, " ")}
                </Badge>
              </div>
              {adj.current_problem && (
                <p className="text-[11px] font-medium text-slate-800">{adj.current_problem}</p>
              )}
              <p className="text-[10px] text-slate-600">{adj.suggested_change}</p>
              <p className="text-[10px] text-slate-500 mt-0.5"><strong>Rationale:</strong> {adj.rationale}</p>
            </div>
          ))}
        </div>
      )}

      {/* Community Resources */}
      {data.community_resources?.length > 0 && (
        <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/50 border border-blue-200/20">
          <p className="text-[9px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Community Resources
          </p>
          <ul className="space-y-0.5">
            {data.community_resources.map((r, i) => (
              <li key={i} className="text-[10px] text-slate-600">
                <strong>{r.resource}:</strong> {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}