import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Loader2, ChevronDown, ChevronUp, AlertTriangle, Quote, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { mapNoteToOASIS } from "@/functions/mapNoteToOASIS";
import { buildOasisEvidence, EVIDENCE_ONLY_NOTICE } from "./noteToOasisAutofill";

// Note → OASIS EVIDENCE.
//
// This panel used to be "Pre-fill OASIS from this note": it turned model output
// into per-item draft VALUES, with an Apply button on each and a bulk
// "Attest all ≥85%". However it was labelled, that is AI selecting official
// OASIS responses, and a nurse clicking through a confident-looking list is not
// the explicit clinical selection the record requires.
//
// It now shows what the note actually says, next to the item it relates to, and
// asks a question. There is no value to apply and no apply control, so no code
// path can write a model-chosen response into the form.
export default function NoteToOasisPrefill({ patientId, sections }) {
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [evidence, setEvidence] = useState([]);
  const [skippedCount, setSkippedCount] = useState(0);

  const runReview = async () => {
    if (!noteText.trim()) {
      toast.error("Paste a clinical note first.");
      return;
    }
    setLoading(true);
    try {
      const { data } = await mapNoteToOASIS({ enhancedNote: noteText, patientId });
      if (data && data.success === false) throw new Error(data.error || "Mapping failed");
      const { evidence: built, skipped } = buildOasisEvidence(data?.oasis_suggestions || [], sections);
      setEvidence(built);
      setSkippedCount(skipped.length);
      if (built.length === 0) toast.info("No item-related evidence found in this note.");
      else toast.success(`${built.length} item${built.length > 1 ? "s" : ""} to review.`);
    } catch (err) {
      console.error("mapNoteToOASIS failed:", err);
      toast.error("Couldn't review the note. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-xl shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 bg-gradient-to-r from-indigo-50 to-indigo-100 border-b border-indigo-100 flex items-center justify-between"
        onClick={() => setOpen((v) => !v)}
        type="button"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-indigo-800">Find note evidence for OASIS items</span>
          <Badge className="bg-indigo-100 text-indigo-700 text-xs">Evidence only</Badge>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-600">{EVIDENCE_ONLY_NOTICE}</p>
          <label className="sr-only" htmlFor="note-evidence-text">Clinical or visit note</label>
          <textarea
            id="note-evidence-text"
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Paste the clinical / visit note here…"
            className="w-full min-h-[110px] text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:ring-2 focus:ring-indigo-300 outline-none resize-none leading-relaxed"
          />
          <Button
            onClick={runReview}
            disabled={loading || !noteText.trim()}
            className="bg-indigo-600 hover:bg-indigo-700 h-9 gap-2 text-sm font-semibold"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            Find evidence in this note
          </Button>

          {evidence.length > 0 && (
            <ul className="space-y-2 pt-1 list-none p-0">
              {evidence.map((e) => (
                <li key={e.id} className="border border-slate-200 rounded-lg p-3 bg-white">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-semibold text-slate-800">{e.label}</span>
                    {e.discrepancy && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                        <AlertTriangle className="w-3 h-3" aria-hidden="true" /> may differ from what is recorded
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 italic mt-1 flex gap-1">
                    <Quote className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
                    <span>{e.evidence}</span>
                  </p>
                  {e.note && <p className="text-xs text-slate-500 mt-1">{e.note}</p>}
                  <p className="text-xs text-slate-700 mt-2">{e.question}</p>
                </li>
              ))}
            </ul>
          )}

          {skippedCount > 0 && (
            <p className="text-xs text-slate-400">
              {skippedCount} suggestion{skippedCount > 1 ? "s" : ""} not shown (no verbatim evidence, or not an item on this form).
            </p>
          )}
        </div>
      )}
    </div>
  );
}
