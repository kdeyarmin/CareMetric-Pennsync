import React from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sparkles, User, Calendar, FileText, Stethoscope, Hash,
  Tag, ChevronDown, ChevronUp, Pencil, Check, X
} from "lucide-react";

const CATEGORY_COLORS = {
  "Lab Results": "bg-blue-100 text-blue-700",
  "Referral": "bg-purple-100 text-purple-700",
  "Discharge Summary": "bg-amber-100 text-amber-700",
  "Progress Note": "bg-green-100 text-green-700",
  "Medical Records": "bg-slate-100 text-slate-700",
  "Prescription": "bg-pink-100 text-pink-700",
  "Insurance": "bg-cyan-100 text-cyan-700",
  "Consent Form": "bg-orange-100 text-orange-700",
  "Imaging Report": "bg-indigo-100 text-indigo-700",
  "Operative Report": "bg-red-100 text-red-700",
};

function getCategoryColor(category) {
  for (const [key, val] of Object.entries(CATEGORY_COLORS)) {
    if (category?.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return "bg-slate-100 text-slate-600";
}

export default function DocumentAnalysisResult({ analysis, expanded, onToggle, onApplyName }) {
  if (!analysis) return null;

  const fields = [
    { key: "patient_name", label: "Patient", icon: User },
    { key: "patient_dob", label: "DOB", icon: Calendar },
    { key: "mrn", label: "MRN", icon: Hash },
    { key: "provider_name", label: "Provider", icon: Stethoscope },
    { key: "date_of_service", label: "Date of Service", icon: Calendar },
    { key: "document_type", label: "Type", icon: FileText },
    { key: "diagnosis", label: "Diagnosis", icon: Stethoscope },
  ].filter(f => analysis[f.key]);

  const hasTags = analysis.tags?.length > 0;
  const hasCategory = !!analysis.category;
  const hasSuggestedName = !!analysis.suggested_name;

  return (
    <div className="border border-purple-200 bg-gradient-to-r from-purple-50/60 to-blue-50/40 rounded-lg overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-2.5 py-1.5 hover:bg-purple-50/50 transition-colors"
      >
        <div className="flex items-center gap-1.5 min-w-0">
          <Sparkles className="w-3 h-3 text-purple-500 flex-shrink-0" />
          <span className="text-[10px] font-medium text-purple-700 truncate">AI Analysis</span>
          {hasCategory && (
            <Badge className={`text-[8px] px-1 py-0 ${getCategoryColor(analysis.category)}`}>
              {analysis.category}
            </Badge>
          )}
        </div>
        {expanded ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-2.5 pb-2.5 space-y-2">
          {/* Suggested name */}
          {hasSuggestedName && (
            <div className="flex items-center gap-1.5 bg-white rounded p-1.5 border border-purple-100">
              <Pencil className="w-3 h-3 text-purple-500 flex-shrink-0" />
              <span className="text-[10px] text-slate-500">Name:</span>
              <span className="text-[10px] font-medium text-slate-800 truncate flex-1">{analysis.suggested_name}</span>
              {onApplyName && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-5 px-1.5 text-[9px] text-purple-600 hover:bg-purple-100"
                  onClick={(e) => { e.stopPropagation(); onApplyName(analysis.suggested_name); }}
                >
                  <Check className="w-2.5 h-2.5 mr-0.5" /> Rename
                </Button>
              )}
            </div>
          )}

          {/* Extracted fields */}
          {fields.length > 0 && (
            <div className="grid grid-cols-2 gap-x-3 gap-y-1">
              {fields.map(f => {
                const Icon = f.icon;
                return (
                  <div key={f.key} className="flex items-center gap-1 min-w-0">
                    <Icon className="w-2.5 h-2.5 text-slate-400 flex-shrink-0" />
                    <span className="text-[9px] text-slate-400 flex-shrink-0">{f.label}:</span>
                    <span className="text-[10px] font-medium text-slate-700 truncate">{analysis[f.key]}</span>
                  </div>
                );
              })}
            </div>
          )}

          {/* Tags */}
          {hasTags && (
            <div className="flex flex-wrap gap-1">
              <Tag className="w-2.5 h-2.5 text-slate-400 mt-0.5" />
              {analysis.tags.map((tag, i) => (
                <Badge key={i} className="text-[8px] px-1.5 py-0 bg-slate-100 text-slate-600 font-normal">
                  {tag}
                </Badge>
              ))}
            </div>
          )}

          {/* Confidence */}
          {analysis.confidence && (
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] text-slate-400">Confidence:</span>
              <div className="flex-1 h-1 bg-slate-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${
                    analysis.confidence >= 80 ? 'bg-green-500' :
                    analysis.confidence >= 50 ? 'bg-amber-500' : 'bg-red-400'
                  }`}
                  style={{ width: `${analysis.confidence}%` }}
                />
              </div>
              <span className="text-[9px] font-medium text-slate-500">{analysis.confidence}%</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}