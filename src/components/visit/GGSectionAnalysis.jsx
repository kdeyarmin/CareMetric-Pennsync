import { FileCheck } from "lucide-react";

/**
 * Section GG functional analysis — self-care / mobility summaries, discharge-goal
 * appropriateness, and improvement potential. Each field is optional; renders
 * nothing when there is no analysis object.
 */
export default function GGSectionAnalysis({ analysis }) {
  if (!analysis) return null;

  return (
    <div className="bg-indigo-50 p-4 rounded-lg border-2 border-indigo-200">
      <h4 className="font-bold text-indigo-900 mb-3 flex items-center gap-2">
        <FileCheck className="w-5 h-5" />
        Section GG Functional Analysis
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
        {analysis.gg0130_self_care_summary && (
          <div className="bg-white p-3 rounded border">
            <p className="text-xs font-semibold text-indigo-700 mb-1">GG0130 Self-Care</p>
            <p className="text-slate-700">{analysis.gg0130_self_care_summary}</p>
          </div>
        )}
        {analysis.gg0170_mobility_summary && (
          <div className="bg-white p-3 rounded border">
            <p className="text-xs font-semibold text-indigo-700 mb-1">GG0170 Mobility</p>
            <p className="text-slate-700">{analysis.gg0170_mobility_summary}</p>
          </div>
        )}
        {analysis.goal_appropriateness && (
          <div className="bg-white p-3 rounded border">
            <p className="text-xs font-semibold text-indigo-700 mb-1">Discharge Goal Assessment</p>
            <p className="text-slate-700">{analysis.goal_appropriateness}</p>
          </div>
        )}
        {analysis.functional_improvement_potential && (
          <div className="bg-white p-3 rounded border">
            <p className="text-xs font-semibold text-indigo-700 mb-1">Improvement Potential</p>
            <p className="text-slate-700">{analysis.functional_improvement_potential}</p>
          </div>
        )}
      </div>
    </div>
  );
}
