import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Copy, RotateCcw, Loader2 } from "lucide-react";
import SmartNotePDFExporterEnhanced from "./SmartNotePDFExporterEnhanced";
import NoteDiffView from "./NoteDiffView";

export default function FinalNoteDisplay({ finalNote, setFinalNote, onCopy, copied, patient, visitType, analysisScore, currentUser, signatureImage, onReset, originalNote, analysis, onSave, saving, saved, saveDisabled }) {

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-white border-2 border-green-400 rounded-xl px-4 py-3 shadow-sm">
        <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-green-800">Medicare-Compliant Note Ready</p>
          <p className="text-xs text-slate-400">Based only on information you provided</p>
        </div>
        {analysisScore && <Badge className="bg-green-600 text-white px-2.5 py-1 text-sm">{analysisScore}%</Badge>}
        <Button onClick={onCopy} className="bg-green-600 hover:bg-green-700 h-10 px-4 gap-2 font-semibold shrink-0">
          {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
        </Button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <span className="text-sm font-semibold text-slate-700">Final Clinical Note</span>
          <span className="text-xs text-slate-400">editable · {finalNote.length} chars</span>
        </div>
        <textarea
          value={finalNote}
          onChange={e => {
            setFinalNote(e.target.value);
          }}
          className="w-full min-h-[320px] font-mono text-sm border-0 px-4 py-3 focus:ring-0 bg-white resize-none outline-none"
        />
        <div className="flex gap-2 px-4 py-3 border-t border-slate-100 bg-slate-50">
          <Button onClick={onCopy} className="flex-1 bg-green-600 hover:bg-green-700 h-12 sm:h-10 gap-2 font-semibold">
            {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy All</>}
          </Button>
          <SmartNotePDFExporterEnhanced finalNote={finalNote} patient={patient} visitType={visitType} analysisScore={analysisScore} currentUser={currentUser} signatureImage={signatureImage} analysis={analysis} />
          {onSave && (
            <Button
              variant={saved ? "outline" : "default"}
              onClick={onSave}
              disabled={saveDisabled}
              className={`h-12 sm:h-10 px-4 text-sm gap-1.5 font-semibold ${saved ? "" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
              title={saveDisabled ? "Select a patient and resolve any fact-check issues to save to the chart" : "Save to the patient's chart so it can seed the next note"}
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="w-4 h-4" /> Saved</> : "Save to chart"}
            </Button>
          )}
          <Button variant="outline" className="h-12 sm:h-10 px-3" onClick={onReset} aria-label="Start a new note" title="Start a new note"><RotateCcw className="w-4 h-4" /></Button>
        </div>
      </div>

      <NoteDiffView originalNote={originalNote} enhancedNote={finalNote} />
    </div>
  );
}