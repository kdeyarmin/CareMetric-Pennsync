import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { CheckCircle2, AlertTriangle, Info, Building2 } from "lucide-react";
import {
  evaluateFacilityRules,
  sortFacilityResults,
  summarizeFacilityRules,
} from "./compliance/facilityDocRules";

const SEVERITY_STYLE = {
  critical: "text-rose-700 bg-rose-50 border-rose-200",
  high: "text-amber-700 bg-amber-50 border-amber-200",
  medium: "text-amber-700 bg-amber-50 border-amber-200",
  low: "text-slate-600 bg-slate-50 border-slate-200",
};

// Live checklist of facility-specific documentation requirements that apply to the
// SELECTED patient (e.g. "on oxygen → SpO2 in every note"). Admins author these as
// FacilityDocumentationRule records; the nurse sees only the ones triggered by this
// patient, and each flips to satisfied as they type the required detail. Purely
// advisory — it flags what still needs documenting, it never writes into the note.
export default function FacilityRequirementsChecklist({ patient, noteText = "", visitType }) {
  const { data: rules = [] } = useQuery({
    queryKey: ["facility-doc-rules"],
    queryFn: () => base44.entities.FacilityDocumentationRule.list("-severity", 200),
    initialData: [],
    staleTime: 5 * 60 * 1000,
  });

  const results = useMemo(
    () => sortFacilityResults(evaluateFacilityRules({ rules, patient, noteText, visitType })),
    [rules, patient, noteText, visitType],
  );
  const summary = useMemo(() => summarizeFacilityRules(results), [results]);

  // Nothing applies to this patient (or no patient selected) — stay out of the way.
  if (!patient || results.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-navy-50 border-b border-navy-100">
        <Building2 className="w-4 h-4 text-navy-600" />
        <span className="text-xs font-semibold text-navy-700 uppercase tracking-wide">
          Facility Documentation Requirements
        </span>
        <span className="ml-auto text-[11px] font-medium">
          {summary.missing > 0 ? (
            <span className="text-amber-700">{summary.missing} to document</span>
          ) : (
            <span className="text-emerald-600">All requirements met</span>
          )}
        </span>
      </div>
      <ul className="divide-y divide-slate-100">
        {results.map(({ rule, satisfied, missing }) => {
          const style = SEVERITY_STYLE[rule.severity] || SEVERITY_STYLE.high;
          return (
            <li key={rule.id || rule.rule_name} className="px-4 py-2.5 flex items-start gap-2.5">
              <span className="mt-0.5 shrink-0">
                {satisfied === true ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                ) : missing ? (
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                ) : (
                  <Info className="w-4 h-4 text-slate-400" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm ${satisfied === true ? "text-slate-500 line-through" : "text-slate-800"}`}>
                  {rule.requirement_label || rule.rule_name}
                </p>
                <div className="flex flex-wrap items-center gap-2 mt-0.5">
                  {rule.severity && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${style}`}>
                      {rule.severity}
                    </span>
                  )}
                  {rule.source && (
                    <span className="text-[10px] text-slate-400">{rule.source}</span>
                  )}
                  {satisfied === null && (
                    <span className="text-[10px] text-slate-400">confirm manually</span>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {summary.missing > 0 && (
        <div className="px-4 py-2 border-t border-slate-100 bg-amber-50 text-[11px] text-amber-800">
          Document the highlighted items before completing this note.
        </div>
      )}
    </div>
  );
}
