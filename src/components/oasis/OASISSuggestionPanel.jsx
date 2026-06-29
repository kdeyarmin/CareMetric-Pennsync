import { useState, useEffect } from "react";
import { INTERVENTIONS_LIBRARY } from "@/components/carePlan/InterventionLibrary";
import { AlertTriangle, Info, Sparkles, ChevronDown, ChevronUp, Plus, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

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

export default function OASISSuggestionPanel({ suggestions, onAddToCarePlan, addedIds = [] }) {
  const [selected, setSelected] = useState({});
  const [collapsed, setCollapsed] = useState({});

  // Auto-select high severity interventions
  useEffect(() => {
    const autoSelected = {};
    suggestions.forEach(s => {
      if (s.severity === "high") {
        s.interventionIds.forEach(id => { autoSelected[id] = true; });
      }
    });
    setSelected(prev => ({ ...autoSelected, ...prev }));
  }, [suggestions]);

  const toggleItem = (id) => setSelected(prev => ({ ...prev, [id]: !prev[id] }));
  const toggleCollapse = (domain) => setCollapsed(prev => ({ ...prev, [domain]: !prev[domain] }));

  const selectedIds = Object.entries(selected).filter(([, v]) => v).map(([k]) => k);
  const newIds = selectedIds.filter(id => !addedIds.includes(id));

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
        <p className="text-xs text-slate-400">Based on your assessment scores. Select interventions to add.</p>
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
                  {interventions.map(item => {
                    const isChecked = !!selected[item.id];
                    const alreadyAdded = addedIds.includes(item.id);
                    return (
                      <button
                        key={item.id}
                        onClick={() => !alreadyAdded && toggleItem(item.id)}
                        disabled={alreadyAdded}
                        className={`w-full flex items-start gap-2.5 p-2 rounded-lg border text-left transition-all ${
                          alreadyAdded
                            ? "bg-green-50 border-green-200 opacity-70 cursor-default"
                            : isChecked
                            ? "bg-white border-indigo-400 ring-1 ring-indigo-200 shadow-sm"
                            : "bg-white/60 border-transparent hover:bg-white hover:border-slate-200"
                        }`}
                      >
                        <div className={`mt-0.5 w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${
                          alreadyAdded ? "bg-green-500 border-green-500" : isChecked ? "bg-indigo-600 border-indigo-600" : "border-slate-300 bg-white"
                        }`}>
                          {(isChecked || alreadyAdded) && <Check className="w-2.5 h-2.5 text-white" />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-slate-800 leading-tight">{item.name}</p>
                          <p className="text-xs text-slate-500 mt-0.5 leading-tight line-clamp-2">{item.description}</p>
                          <div className="flex gap-1 mt-1 flex-wrap">
                            <span className="text-[10px] bg-slate-100 text-slate-500 rounded px-1.5 py-0.5">{item.frequency}</span>
                            {item.complianceTag && (
                              <span className="text-[10px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5">{item.complianceTag}</span>
                            )}
                            {alreadyAdded && (
                              <span className="text-[10px] bg-green-100 text-green-700 rounded px-1.5 py-0.5 font-medium">✓ In Plan</span>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Add to Plan CTA */}
      <div className="flex-shrink-0 p-4 border-t bg-white">
        <div className="flex items-center justify-between text-xs text-slate-500 mb-2">
          <span>{newIds.length} intervention{newIds.length !== 1 ? "s" : ""} selected</span>
          {newIds.length > 0 && (
            <button onClick={() => setSelected({})} className="text-red-400 hover:text-red-600">Clear</button>
          )}
        </div>
        <Button
          className="w-full"
          disabled={newIds.length === 0}
          onClick={() => onAddToCarePlan(newIds)}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add {newIds.length > 0 ? newIds.length : ""} Intervention{newIds.length !== 1 ? "s" : ""} to Care Plan
        </Button>
      </div>
    </div>
  );
}