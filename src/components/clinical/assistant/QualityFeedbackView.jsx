import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, CheckCircle2, AlertTriangle, AlertCircle, Zap, ChevronDown, ChevronUp, Plus } from "lucide-react";
import { toast } from "sonner";

const GRADE_COLOR = {
  "A+": "bg-green-600 text-white", "A": "bg-green-600 text-white", "A-": "bg-green-500 text-white",
  "B+": "bg-blue-500 text-white", "B": "bg-blue-500 text-white", "B-": "bg-blue-400 text-white",
  "C+": "bg-amber-500 text-white", "C": "bg-amber-500 text-white", "C-": "bg-amber-400 text-white",
  "D": "bg-red-400 text-white", "F": "bg-red-600 text-white",
};

const SCORE_LABELS = {
  clinical_completeness: "Clinical Completeness",
  medicare_compliance: "Medicare Compliance",
  skilled_need: "Skilled Need",
  homebound_status: "Homebound Status",
  specificity: "Specificity & Detail",
  care_plan_alignment: "Care Plan Alignment",
  patient_education: "Patient Education",
  safety_assessment: "Safety Assessment",
  medication_documentation: "Medication Docs",
  professional_language: "Professional Language",
};

export default function QualityFeedbackView({ data, onApplyFix, onRefresh }) {
  const [showAllImprovements, setShowAllImprovements] = useState(false);
  const [showBreakdown, setShowBreakdown] = useState(false);

  if (!data) return null;

  const breakdown = data.score_breakdown || {};
  const strengths = data.strengths || [];
  const improvements = data.improvements || [];
  const missingElements = data.missing_elements || [];
  const quickFixes = data.quick_fixes || [];

  const handleApplyFix = (fix) => {
    if (onApplyFix && fix.text_to_add) {
      onApplyFix(fix.text_to_add);
      toast.success("Fix applied to note");
    } else {
      navigator.clipboard.writeText(fix.text_to_add || fix.fix);
      toast.success("Fix text copied");
    }
  };

  return (
    <div className="space-y-3">
      {/* Overall Score */}
      <div className="flex items-center gap-3 p-2.5 rounded-lg bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200/40">
        <div className="text-center">
          <div className={`text-lg font-bold px-2.5 py-0.5 rounded ${GRADE_COLOR[data.letter_grade] || "bg-slate-200"}`}>
            {data.letter_grade || "—"}
          </div>
        </div>
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-xl font-bold text-slate-800">{data.overall_score || 0}</span>
            <span className="text-[10px] text-slate-500">/100</span>
            <Button variant="ghost" size="icon" className="h-5 w-5 ml-auto" onClick={onRefresh}>
              <RefreshCw className="w-3 h-3" />
            </Button>
          </div>
          <div className="w-full bg-slate-200 rounded-full h-1.5">
            <div
              className={`h-1.5 rounded-full transition-all ${
                (data.overall_score || 0) >= 85 ? "bg-green-500" :
                (data.overall_score || 0) >= 70 ? "bg-blue-500" :
                (data.overall_score || 0) >= 50 ? "bg-amber-500" : "bg-red-500"
              }`}
              style={{ width: `${data.overall_score || 0}%` }}
            />
          </div>
        </div>
      </div>

      {/* Score Breakdown */}
      <button
        className="text-[10px] text-indigo-600 hover:underline flex items-center gap-1"
        onClick={() => setShowBreakdown(!showBreakdown)}
      >
        {showBreakdown ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        {showBreakdown ? "Hide" : "Show"} detailed breakdown
      </button>
      {showBreakdown && (
        <div className="grid grid-cols-2 gap-1">
          {Object.entries(breakdown).map(([key, value]) => (
            <div key={key} className="flex items-center gap-1.5 p-1 rounded bg-slate-50">
              <div className="w-full flex items-center gap-1">
                <span className="text-[8px] text-slate-600 w-20 shrink-0 truncate">{SCORE_LABELS[key] || key}</span>
                <div className="flex-1 bg-slate-200 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full ${value >= 80 ? "bg-green-400" : value >= 60 ? "bg-amber-400" : "bg-red-400"}`}
                    style={{ width: `${value || 0}%` }}
                  />
                </div>
                <span className={`text-[8px] font-bold w-5 text-right ${value >= 80 ? "text-green-600" : value >= 60 ? "text-amber-600" : "text-red-600"}`}>
                  {value}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Quick Fixes */}
      {quickFixes.length > 0 && (
        <div className="rounded-lg border border-indigo-200/60 bg-indigo-50/40 p-2">
          <p className="text-[9px] font-semibold text-indigo-700 flex items-center gap-1 mb-1.5">
            <Zap className="w-3 h-3" /> Quick Fixes ({quickFixes.length})
          </p>
          <div className="space-y-1.5">
            {quickFixes.map((fix, i) => (
              <div key={i} className="flex items-start gap-1.5">
                <Badge className={`text-[7px] px-1 py-0 shrink-0 ${
                  fix.impact === "high" ? "bg-green-100 text-green-700" :
                  fix.impact === "medium" ? "bg-blue-100 text-blue-700" :
                  "bg-slate-100 text-slate-600"
                }`}>{fix.impact}</Badge>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-slate-700">{fix.fix}</p>
                  {fix.text_to_add && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-5 text-[8px] px-1 text-indigo-600 mt-0.5"
                      onClick={() => handleApplyFix(fix)}
                    >
                      <Plus className="w-2.5 h-2.5 mr-0.5" />
                      {onApplyFix ? "Apply" : "Copy text"}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Strengths */}
      {strengths.length > 0 && (
        <div className="rounded-lg border border-green-200/60 bg-green-50/40 p-2">
          <p className="text-[9px] font-semibold text-green-700 flex items-center gap-1 mb-1">
            <CheckCircle2 className="w-3 h-3" /> Strengths
          </p>
          {strengths.map((s, i) => (
            <p key={i} className="text-[9px] text-green-800 pl-3 relative before:content-['✓'] before:absolute before:left-0">{s}</p>
          ))}
        </div>
      )}

      {/* Missing Elements */}
      {missingElements.length > 0 && (
        <div className="rounded-lg border border-red-200/60 bg-red-50/40 p-2">
          <p className="text-[9px] font-semibold text-red-700 flex items-center gap-1 mb-1">
            <AlertCircle className="w-3 h-3" /> Missing Elements
          </p>
          {missingElements.map((m, i) => (
            <p key={i} className="text-[9px] text-red-700 pl-3 relative before:content-['✗'] before:absolute before:left-0">{m}</p>
          ))}
        </div>
      )}

      {/* Improvements */}
      {improvements.length > 0 && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-2">
          <p className="text-[9px] font-semibold text-amber-700 flex items-center gap-1 mb-1">
            <AlertTriangle className="w-3 h-3" /> Improvements ({improvements.length})
          </p>
          {(showAllImprovements ? improvements : improvements.slice(0, 3)).map((imp, i) => (
            <div key={i} className="py-1 border-b border-amber-200/30 last:border-0">
              <div className="flex items-center gap-1 mb-0.5">
                <Badge className={`text-[7px] px-1 py-0 ${
                  imp.severity === "critical" ? "bg-red-100 text-red-700" :
                  imp.severity === "important" ? "bg-amber-100 text-amber-700" :
                  "bg-slate-100 text-slate-600"
                }`}>{imp.severity}</Badge>
                <span className="text-[9px] font-medium text-slate-700">{imp.category}</span>
              </div>
              <p className="text-[9px] text-slate-600">{imp.issue}</p>
              <p className="text-[9px] text-indigo-700 mt-0.5">{imp.suggestion}</p>
              {imp.example_text && (
                <div className="mt-0.5 p-1 bg-white/60 rounded border border-slate-200/50">
                  <p className="text-[8px] text-slate-500 italic">Example: {imp.example_text}</p>
                  {onApplyFix && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-4 text-[8px] px-1 text-indigo-600"
                      onClick={() => handleApplyFix({ text_to_add: imp.example_text })}
                    >
                      <Plus className="w-2.5 h-2.5 mr-0.5" /> Apply
                    </Button>
                  )}
                </div>
              )}
            </div>
          ))}
          {improvements.length > 3 && (
            <button
              className="text-[9px] text-amber-700 mt-1"
              onClick={() => setShowAllImprovements(!showAllImprovements)}
            >
              {showAllImprovements ? "Show less" : `+${improvements.length - 3} more improvements`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}