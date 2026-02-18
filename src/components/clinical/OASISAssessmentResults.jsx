import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, ChevronDown, ChevronUp, FileText, CheckCircle2 } from "lucide-react";

export default function OASISAssessmentResults({ data }) {
  const [showAllItems, setShowAllItems] = useState(false);

  if (!data) return null;

  const items = data.items || [];
  const displayed = showAllItems ? items : items.slice(0, 6);

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="p-3 rounded-lg bg-gradient-to-br from-blue-100/40 to-slate-100/60 border border-blue-200/30">
        <div className="flex items-center gap-2 mb-1">
          <FileText className="w-3 h-3 text-blue-600" />
          <span className="text-[10px] font-semibold text-slate-700">Assessment Summary</span>
          {data.timing_type && <Badge variant="outline" className="text-[9px]">{data.timing_type}</Badge>}
          {data.clinical_grouping && <Badge className="text-[9px] bg-blue-100 text-blue-700">{data.clinical_grouping}</Badge>}
        </div>
        <p className="text-[11px] text-slate-600">{data.assessment_summary}</p>
      </div>

      {/* Functional Scores */}
      {data.functional_scores && (
        <div className="grid grid-cols-3 gap-2">
          {[
            { label: "Self-Care", val: data.functional_scores.self_care },
            { label: "Mobility", val: data.functional_scores.mobility },
            { label: "Cognitive", val: data.functional_scores.cognitive },
          ].map(s => (
            <div key={s.label} className="text-center p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/50 border border-blue-200/20">
              <p className="text-lg font-bold text-blue-700">{s.val ?? "—"}</p>
              <p className="text-[9px] text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* OASIS Items */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-semibold text-slate-700">
          OASIS Items ({items.length})
        </p>
        {displayed.map((item, i) => (
          <div key={i} className="p-2 rounded border border-slate-200/50 bg-white/60 dark:bg-slate-900/40">
            <div className="flex items-center gap-1.5 mb-0.5">
              <Badge variant="outline" className="text-[9px] px-1 py-0 font-mono">{item.item_number}</Badge>
              <span className="text-[10px] font-medium text-slate-800 flex-1">{item.item_name}</span>
              <Badge className={`text-[8px] px-1 py-0 ${
                item.confidence === 'high' ? 'bg-blue-100 text-blue-700' :
                item.confidence === 'medium' ? 'bg-amber-100 text-amber-700' :
                'bg-slate-100 text-slate-600'
              }`}>{item.confidence}</Badge>
            </div>
            <p className="text-[11px] text-slate-700 font-medium">{item.suggested_response}</p>
            <p className="text-[10px] text-slate-500 mt-0.5">{item.clinical_justification}</p>
          </div>
        ))}
        {items.length > 6 && (
          <button
            onClick={() => setShowAllItems(!showAllItems)}
            className="text-[10px] text-blue-600 hover:underline flex items-center gap-1 mx-auto"
          >
            {showAllItems ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            {showAllItems ? "Show less" : `Show all ${items.length} items`}
          </button>
        )}
      </div>

      {/* Risk Flags */}
      {data.risk_flags?.length > 0 && (
        <div className="p-2 rounded bg-gradient-to-br from-blue-100/30 to-slate-100/50 border border-blue-200/20">
          <p className="text-[9px] font-semibold text-slate-600 mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Risk Flags
          </p>
          <ul className="space-y-0.5">
            {data.risk_flags.map((f, i) => (
              <li key={i} className="text-[10px] text-slate-600">• {f}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Documentation Gaps */}
      {data.documentation_gaps?.length > 0 && (
        <div className="p-2 rounded bg-amber-50/50 border border-amber-200/30">
          <p className="text-[9px] font-semibold text-amber-700 mb-1">Documentation Gaps</p>
          <ul className="space-y-0.5">
            {data.documentation_gaps.map((g, i) => (
              <li key={i} className="text-[10px] text-amber-600">• {g}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}