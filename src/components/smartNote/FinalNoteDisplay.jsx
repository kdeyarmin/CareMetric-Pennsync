import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Copy, RotateCcw, Loader2 } from "lucide-react";
import SmartNotePDFExporterEnhanced from "./SmartNotePDFExporterEnhanced";
import NoteDiffView from "./NoteDiffView";
import EmrHandoffPanel from "./EmrHandoffPanel";

/**
 * The finished-note screen.
 *
 * IMPORTANT — this screen must never certify Medicare compliance. It used to be
 * headed "Medicare-Compliant Note Ready", which asserted a regulatory conclusion
 * PennSync cannot make: PennSync is a documentation-assistance tool, not the
 * EMR, not agency QA, and not a Medicare adjudicator. The heading now reports
 * only what PennSync actually did (ran its own rules over the note) and the
 * score is labelled as PennSync rule coverage, not a compliance verdict.
 *
 * "Save to PennSync" is deliberately distinct from the EMR handoff below it:
 * saving keeps PennSync's working copy (which seeds the next visit's prior-note
 * comparison and the compliance record); the OFFICIAL note is the one the nurse
 * enters and signs in the agency's EMR.
 */
export default function FinalNoteDisplay({
  finalNote, setFinalNote, onCopy, copied, patient, visitType, analysisScore, currentUser,
  signatureImage, onReset, originalNote, analysis, onSave, saving, saved, saveDisabled,
  // EMR handoff (optional so existing callers keep working unchanged).
  aiAssisted = true, nurseEdited = false, handoffStatus = "not_started",
  onReportHandoffStatus = null, reviewAck = null, onReviewAck = null, handoffStatusError = null,
}) {

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 bg-white border-2 border-green-400 rounded-xl px-4 py-3 shadow-sm">
        <CheckCircle2 className="w-6 h-6 text-green-600 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-bold text-green-800">Documentation review complete</p>
          <p className="text-xs text-slate-500">
            Built only from information you provided. Review it and enter the official
            documentation in your EMR.
          </p>
        </div>
        {Number.isFinite(analysisScore) && (
          <Badge
            className={`${analysisScore >= 90 ? "bg-green-600" : analysisScore >= 70 ? "bg-amber-500" : "bg-red-600"} text-white px-2.5 py-1 text-sm`}
            title={`PennSync rule coverage: ${analysisScore}% of the required elements PennSync checks were documented. This is not a Medicare compliance determination.`}
          >
            {analysisScore}%
          </Badge>
        )}
        <Button onClick={onCopy} className="h-10 px-4 gap-2 font-semibold shrink-0">
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
          <Button onClick={onCopy} className="flex-1 h-12 sm:h-10 gap-2 font-semibold">
            {copied ? <><CheckCircle2 className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy All</>}
          </Button>
          <SmartNotePDFExporterEnhanced finalNote={finalNote} patient={patient} visitType={visitType} analysisScore={analysisScore} currentUser={currentUser} signatureImage={signatureImage} analysis={analysis} />
          {onSave && (
            <Button
              variant={saved ? "outline" : "default"}
              onClick={onSave}
              disabled={saveDisabled}
              className={`h-12 sm:h-10 px-4 text-sm gap-1.5 font-semibold ${saved ? "" : "bg-indigo-600 hover:bg-indigo-700 text-white"}`}
              title={saveDisabled
                ? "Select a patient and resolve any fact-check issues to save PennSync's working copy"
                : "Save PennSync's working copy so it can seed the next note and the compliance record. The official note is the one you enter in your EMR."}
            >
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : saved ? <><CheckCircle2 className="w-4 h-4" /> Saved</> : "Save to PennSync"}
            </Button>
          )}
          <Button variant="outline" className="h-12 sm:h-10 px-3" onClick={onReset} aria-label="Start a new note" title="Start a new note"><RotateCcw className="w-4 h-4" /></Button>
        </div>
      </div>

      <EmrHandoffPanel
        noteText={finalNote}
        aiAssisted={aiAssisted}
        nurseEdited={nurseEdited}
        handoffStatus={handoffStatus}
        onReportStatus={onReportHandoffStatus}
        reviewAck={reviewAck}
        onReviewAck={onReviewAck}
        statusError={handoffStatusError}
      />

      <NoteDiffView originalNote={originalNote} enhancedNote={finalNote} />
    </div>
  );
}