import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronDown, ChevronUp, ClipboardCheck, AlertTriangle, CheckCircle2, FileText } from "lucide-react";

const PDGM_COLOR = {
  high: "bg-red-100 text-red-700",
  moderate: "bg-amber-100 text-amber-700",
  low: "bg-blue-100 text-blue-700",
  none: "bg-slate-100 text-slate-600",
};

const SEVERITY_COLOR = {
  critical: "bg-red-100 text-red-700",
  high: "bg-amber-100 text-amber-700",
  moderate: "bg-blue-100 text-blue-700",
  low: "bg-slate-100 text-slate-600",
};

export default function AssessmentSuggestionsView({ data, onRefresh }) {
  const [showAllOasis, setShowAllOasis] = useState(false);

  if (!data) return null;

  const oasisItems = data.oasis_items || [];
  const screeningTools = data.screening_tools || [];
  const complianceGaps = data.compliance_gaps || [];
  const qualityMeasures = data.quality_measures || [];

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500">
          {oasisItems.length} OASIS items · {screeningTools.length} screenings · {complianceGaps.length} gaps
        </p>
        <Button variant="ghost" size="icon" className="h-5 w-5" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3" />
        </Button>
      </div>

      {/* OASIS Items */}
      {oasisItems.length > 0 && (
        <Section title="OASIS-E Assessment Items" icon={<FileText className="w-3 h-3 text-indigo-500" />}>
          {(showAllOasis ? oasisItems : oasisItems.slice(0, 4)).map((item, i) => (
            <div key={i} className="p-1.5 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                <Badge variant="outline" className="text-[8px] px-1 py-0 font-mono">{item.item_number}</Badge>
                <span className="text-[10px] font-medium text-slate-800">{item.item_name}</span>
                <Badge className={`text-[7px] px-1 py-0 ml-auto ${PDGM_COLOR[item.pdgm_impact]}`}>
                  PDGM: {item.pdgm_impact}
                </Badge>
              </div>
              <p className="text-[9px] text-slate-600">{item.relevance}</p>
              {item.suggested_response && (
                <p className="text-[9px] text-indigo-700 mt-0.5">
                  <strong>Suggested:</strong> {item.suggested_response}
                </p>
              )}
              <p className="text-[8px] text-slate-400 italic mt-0.5">{item.clinical_rationale}</p>
            </div>
          ))}
          {oasisItems.length > 4 && (
            <button className="text-[9px] text-indigo-600 mt-1" onClick={() => setShowAllOasis(!showAllOasis)}>
              {showAllOasis ? "Show less" : `Show all ${oasisItems.length} items`}
            </button>
          )}
        </Section>
      )}

      {/* Screening Tools */}
      {screeningTools.length > 0 && (
        <Section title="Recommended Screenings" icon={<ClipboardCheck className="w-3 h-3 text-green-500" />}>
          {screeningTools.map((tool, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <Badge className={`text-[7px] px-1 py-0 shrink-0 ${
                tool.urgency === "required_now" ? "bg-red-100 text-red-700" :
                tool.urgency === "recommended" ? "bg-amber-100 text-amber-700" :
                "bg-slate-100 text-slate-600"
              }`}>{tool.urgency?.replace(/_/g, " ")}</Badge>
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{tool.tool_name}</p>
                <p className="text-[9px] text-slate-500">{tool.reason}</p>
                {tool.frequency && (
                  <p className="text-[8px] text-slate-400">Frequency: {tool.frequency}</p>
                )}
              </div>
            </div>
          ))}
        </Section>
      )}

      {/* Compliance Gaps */}
      {complianceGaps.length > 0 && (
        <Section title="Compliance Gaps" icon={<AlertTriangle className="w-3 h-3 text-amber-500" />}>
          {complianceGaps.map((gap, i) => (
            <div key={i} className="p-1.5 border-b border-slate-100 last:border-0">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Badge className={`text-[7px] px-1 py-0 ${SEVERITY_COLOR[gap.severity]}`}>{gap.severity}</Badge>
                <p className="text-[10px] font-medium text-slate-800">{gap.gap}</p>
              </div>
              <p className="text-[9px] text-slate-500">{gap.requirement}</p>
              <p className="text-[9px] text-indigo-700 mt-0.5">
                <strong>Fix:</strong> {gap.fix_suggestion}
              </p>
            </div>
          ))}
        </Section>
      )}

      {/* Quality Measures */}
      {qualityMeasures.length > 0 && (
        <Section title="Applicable Quality Measures" icon={<CheckCircle2 className="w-3 h-3 text-blue-500" />}>
          {qualityMeasures.filter(m => m.applicable).map((m, i) => (
            <div key={i} className="flex items-start gap-1.5 py-1 border-b border-slate-100 last:border-0">
              <CheckCircle2 className="w-3 h-3 text-green-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] font-medium text-slate-800">{m.measure}</p>
                <p className="text-[9px] text-slate-500">{m.documentation_needed}</p>
              </div>
            </div>
          ))}
        </Section>
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