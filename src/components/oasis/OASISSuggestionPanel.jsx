import { useState } from "react";
import { INTERVENTIONS_LIBRARY } from "@/components/oasis/interventionsLibrary";
import { AlertTriangle, Info, Sparkles, ChevronDown, ChevronUp } from "lucide-react";

function getInterventionById(id) {
  for (const cat of INTERVENTIONS_LIBRARY) {
    const found = cat.items.find(i => i.id === id);
    if (found) return { ...found, category: cat };
  }
  return null;
}

const SEVERITY_CONFIG = {
  high: {
    bg: "bg-red-50",
    border: "border-red-300",
    header: "bg-red-100",
    icon: <AlertTriangle className="w-4 h-4 text-red-600" />,
    badge: "bg-red-600 text-white",
    label: "HIGH PRIORITY",
    dot: "bg-red-500"
  },
  medium: {
    bg: "bg-amber-50",
    border: "border-amber-300",
    header: "bg-amber-100",
    icon: <AlertTriangle className="w-4 h-4 text-amber-600" />,
    badge: "bg-amber-500 text-white",
    label: "MODERATE",
    dot: "bg-amber-500"
  },
  low: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    header: "bg-blue-100",
    icon: <Info className="w-4 h-4 text-blue-600" />,
    badge: "bg-blue-500 text-white",
    label: "CONSIDER",
    dot: "bg-blue-400"
  }
};

// Display-only recommendations panel: surfaces the interventions the OASIS scores
// suggest, grouped by domain, as clinical guidance for the nurse. (It no longer
// writes to a care plan — that entity/feature was removed.)
export default function OASISSuggestionPanel({ suggestions }) {
  const [collapsed, setCollapsed] = useState({});

  const toggleCollapse = (domain) => setCollapsed(prev => ({ ...prev, [domain]: !prev[domain] }));

  if (suggestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-6 py-10 text-center">
        <div className="w-14 h-14 rounded-full bg-slate-100 flex items-center justify-center mb-3">
          <Sparkles className="w-6 h-6 text-slate-300" />
        </div>
        <p className="text-sm font-semibold text-slate-400">No suggestions yet</p>
        <p className="text-xs text-slate-300 mt-1 max-w-[180px]">Complete the assessment to see dynamic care recommendations</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 pt-4 pb-2 flex-shrink-0">
        <div className="flex items-center gap-2 mb-1">
          <Sparkles className="w-4 h-4 text-navy-500" />
          <span className="text-sm font-bold text-slate-800">Smart Recommendations</span>
          <span className="ml-auto text-xs bg-navy-100 text-navy-700 font-semibold rounded-full px-2 py-0.5">{suggestions.length} domains</span>
        </div>
        <p className="text-xs text-slate-400">Suggested interventions based on your assessment scores.</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-3">
        {suggestions.map((suggestion) => {
          const config = SEVERITY_CONFIG[suggestion.severity] || SEVERITY_CONFIG.low;
          const isCollapsed = collapsed[suggestion.domain];
          const interventions = suggestion.interventionIds.map(getInterventionById).filter(Boolean);

          return (
            <div key={suggestion.domain} className={`rounded-xl border-2 overflow-hidden ${config.bg} ${config.border}`}>
              <button
                onClick={() => toggleCollapse(suggestion.domain)}
                className={`w-full flex items-center gap-2 px-3 py-2.5 ${config.header} transition-colors`}
              >
                {config.icon}
                <div className="flex-1 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-slate-800">{suggestion.domain}</span>
                    <span className={`text-[10px] font-bold rounded-full px-2 py-0.5 ${config.badge}`}>{config.label}</span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5 leading-tight">{suggestion.reason}</p>
                </div>
                {isCollapsed ? <ChevronDown className="w-4 h-4 text-slate-400 flex-shrink-0" /> : <ChevronUp className="w-4 h-4 text-slate-400 flex-shrink-0" />}
              </button>

              {!isCollapsed && (
                <div className="px-3 py-2 space-y-1.5">
                  {interventions.map(item => (
                    <div
                      key={item.id}
                      className="w-full flex items-start gap-2.5 p-2 rounded-lg border border-transparent bg-white/60"
                    >
                      <div className={`mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0 ${config.dot}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-slate-800 leading-tight">{item.name}</p>
                        <p className="text-xs text-slate-500 mt-0.5 leading-tight line-clamp-2">{item.description}</p>
                        <div className="flex gap-1 mt-1 flex-wrap">
                          <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{item.frequency}</span>
                          {item.complianceTag && (
                            <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5">{item.complianceTag}</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
