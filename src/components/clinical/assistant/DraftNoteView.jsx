import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Copy, RefreshCw, FileInput, ChevronDown, ChevronUp, CheckCircle2, AlertCircle } from "lucide-react";
import { toast } from "sonner";

export default function DraftNoteView({ data, onInsert, onRefresh }) {
  const [showSections, setShowSections] = useState(false);
  const [showFillIns, setShowFillIns] = useState(true);

  if (!data) return null;

  const sections = data.note_sections || {};
  const fillIns = data.fill_in_prompts || [];
  const complianceNotes = data.compliance_notes || [];

  const handleCopy = () => {
    navigator.clipboard.writeText(data.draft_note || "");
    toast.success("Draft note copied to clipboard");
  };

  const handleInsert = () => {
    if (onInsert) {
      onInsert(data.draft_note);
      toast.success("Draft note inserted into editor");
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Actions */}
      <div className="flex gap-1.5 flex-wrap">
        {onInsert && (
          <Button size="sm" className="h-6 text-[10px] bg-indigo-600 hover:bg-indigo-700" onClick={handleInsert}>
            <FileInput className="w-3 h-3 mr-1" /> Use This Draft
          </Button>
        )}
        <Button size="sm" variant="outline" className="h-6 text-[10px]" onClick={handleCopy}>
          <Copy className="w-3 h-3 mr-1" /> Copy
        </Button>
        <Button size="sm" variant="ghost" className="h-6 text-[10px]" onClick={onRefresh}>
          <RefreshCw className="w-3 h-3 mr-1" /> Regenerate
        </Button>
      </div>

      {/* Full Draft Note */}
      <div className="rounded-lg border border-slate-200 bg-white/60 p-2.5 max-h-64 overflow-y-auto">
        <pre className="text-[10px] text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
          {data.draft_note}
        </pre>
      </div>

      {/* Fill-In Prompts */}
      {fillIns.length > 0 && (
        <div className="rounded-lg border border-amber-200/60 bg-amber-50/40 p-2">
          <button
            className="text-[10px] font-semibold text-amber-700 flex items-center gap-1 w-full"
            onClick={() => setShowFillIns(!showFillIns)}
          >
            <AlertCircle className="w-3 h-3" />
            {fillIns.length} section(s) need your input
            {showFillIns ? <ChevronUp className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
          </button>
          {showFillIns && (
            <div className="mt-1.5 space-y-1">
              {fillIns.map((fi, i) => (
                <div key={i} className="flex items-start gap-1.5">
                  <Badge className={`text-[7px] px-1 py-0 shrink-0 ${
                    fi.importance === "required" ? "bg-red-100 text-red-700" :
                    fi.importance === "recommended" ? "bg-amber-100 text-amber-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>{fi.importance}</Badge>
                  <div className="min-w-0">
                    <p className="text-[9px] font-medium text-slate-700">{fi.section}</p>
                    <p className="text-[9px] text-slate-500">{fi.prompt}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Compliance Notes */}
      {complianceNotes.length > 0 && (
        <div className="rounded-lg border border-green-200/60 bg-green-50/40 p-2">
          <p className="text-[9px] font-semibold text-green-700 flex items-center gap-1 mb-1">
            <CheckCircle2 className="w-3 h-3" /> Compliance Items Included
          </p>
          <div className="flex flex-wrap gap-1">
            {complianceNotes.map((cn, i) => (
              <Badge key={i} variant="outline" className="text-[7px] px-1 py-0 border-green-300 text-green-700">{cn}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* SOAP Sections Breakdown */}
      {Object.keys(sections).length > 0 && (
        <button
          className="text-[10px] text-indigo-600 hover:underline flex items-center gap-1"
          onClick={() => setShowSections(!showSections)}
        >
          {showSections ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {showSections ? "Hide" : "View"} SOAP sections breakdown
        </button>
      )}
      {showSections && (
        <div className="space-y-1.5">
          {Object.entries(sections).map(([key, value]) => (
            value && (
              <div key={key} className="rounded border border-slate-200/50 p-2 bg-slate-50/40">
                <p className="text-[9px] font-bold text-slate-600 uppercase mb-0.5">
                  {key.replace(/_/g, " ")}
                </p>
                <p className="text-[10px] text-slate-700 whitespace-pre-wrap">{value}</p>
              </div>
            )
          ))}
        </div>
      )}
    </div>
  );
}