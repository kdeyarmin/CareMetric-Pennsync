import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, Loader2, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Quote, ClipboardList,
} from "lucide-react";
import { toast } from "sonner";
import { mapNoteToOASIS } from "@/functions/mapNoteToOASIS";
import { buildOasisAutofill } from "./noteToOasisAutofill";

// "Pre-fill OASIS from this note": runs mapNoteToOASIS on a clinical note, then
// lands the verbatim-evidenced, confidence-scored M-item suggestions as
// ATTESTABLE DRAFTS. Nothing writes to the form until the nurse attests (clicks
// Apply) — each draft shows its suggested value, confidence, and the verbatim
// evidence, so the nurse confirms rather than the AI silently overwriting.
const AUTO_APPLY_CONFIDENCE = 85;

function confidenceColor(c) {
  if (c >= 85) return "bg-green-100 text-green-800";
  if (c >= 70) return "bg-yellow-100 text-yellow-800";
  return "bg-slate-100 text-slate-700";
}

export default function NoteToOasisPrefill({ patientId, sections, onApply }) {
  const [open, setOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [loading, setLoading] = useState(false);
  const [drafts, setDrafts] = useState({});
  const [skippedCount, setSkippedCount] = useState(0);
  const [appliedIds, setAppliedIds] = useState(() => new Set());

  const draftList = Object.values(drafts).sort((a, b) => b.confidence - a.confidence);

  const runPrefill = async () => {
    if (!noteText.trim()) {
      toast.error("Paste a clinical note first.");
      return;
    }
    setLoading(true);
    setAppliedIds(new Set());
    try {
      const { data } = await mapNoteToOASIS({ enhancedNote: noteText, patientId });
      if (data && data.success === false) throw new Error(data.error || "Mapping failed");
      const suggestions = data?.oasis_suggestions || [];
      const { drafts: built, skipped } = buildOasisAutofill(suggestions, sections);
      setDrafts(built);
      setSkippedCount(skipped.length);
      const count = Object.keys(built).length;
      if (count === 0) toast.info("No confident OASIS suggestions found in this note.");
      else toast.success(`${count} OASIS item${count > 1 ? "s" : ""} ready to review.`);
    } catch (err) {
      console.error("mapNoteToOASIS failed:", err);
      toast.error("Couldn't map the note to OASIS. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const apply = (draft) => {
    onApply?.(draft.id, draft.value);
    setAppliedIds((prev) => new Set(prev).add(draft.id));
  };

  const applyAllConfident = () => {
    const toApply = draftList.filter((d) => d.confidence >= AUTO_APPLY_CONFIDENCE && !appliedIds.has(d.id));
    if (!toApply.length) {
      toast.info(`No un-applied items at ≥${AUTO_APPLY_CONFIDENCE}% confidence.`);
      return;
    }
    const next = new Set(appliedIds);
    for (const d of toApply) {
      onApply?.(d.id, d.value);
      next.add(d.id);
    }
    setAppliedIds(next);
    toast.success(`Applied ${toApply.length} high-confidence item${toApply.length > 1 ? "s" : ""}.`);
  };

  return (
    <div className="bg-white border border-indigo-200 rounded-xl shadow-sm overflow-hidden">
      <button
        className="w-full px-4 py-3 bg-gradient-to-r from-indigo-50 to-indigo-100 border-b border-indigo-100 flex items-center justify-between"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <div className="flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-indigo-600" />
          <span className="text-sm font-bold text-indigo-800">Pre-fill OASIS from a Note</span>
          <Badge className="bg-indigo-100 text-indigo-700 text-xs">Attestable</Badge>
        </div>
        {open ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
      </button>

      {open && (
        <div className="p-4 space-y-3">
          <p className="text-xs text-slate-500">
            Paste a visit note to map it to OASIS M-items with verbatim evidence. Suggestions land as drafts —
            review each and click <span className="font-semibold">Attest &amp; apply</span> to fill the form.
          </p>
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Paste the clinical / visit note here…"
            className="w-full min-h-[110px] text-sm border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:ring-2 focus:ring-indigo-300 outline-none resize-none leading-relaxed"
          />
          <div className="flex items-center gap-2">
            <Button onClick={runPrefill} disabled={loading || !noteText.trim()} className="bg-indigo-600 hover:bg-indigo-700 h-9 gap-2 text-sm font-semibold">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Pre-fill OASIS from this note
            </Button>
            {draftList.length > 0 && (
              <Button onClick={applyAllConfident} variant="outline" className="h-9 text-xs gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" /> Attest all ≥{AUTO_APPLY_CONFIDENCE}%
              </Button>
            )}
          </div>

          {draftList.length > 0 && (
            <div className="space-y-2 pt-1">
              {draftList.map((d) => {
                const applied = appliedIds.has(d.id);
                return (
                  <div key={d.id} className={`border rounded-lg p-3 ${applied ? "border-green-200 bg-green-50" : "border-slate-200 bg-white"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800">{d.label}</span>
                          <Badge className={`text-xs ${confidenceColor(d.confidence)}`}>{d.confidence}%</Badge>
                          {d.discrepancy && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="w-3 h-3" /> differs from current{d.current_value != null ? ` (${d.current_value})` : ""}
                            </span>
                          )}
                        </div>
                        <p className="text-sm text-slate-700 mt-0.5">→ {d.value_label}</p>
                        {d.evidence && (
                          <p className="text-xs text-slate-500 italic mt-1 flex gap-1">
                            <Quote className="w-3 h-3 flex-shrink-0 mt-0.5" /> {d.evidence}
                          </p>
                        )}
                      </div>
                      {applied ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-green-700 whitespace-nowrap">
                          <CheckCircle2 className="w-4 h-4" /> Applied
                        </span>
                      ) : (
                        <Button size="sm" className="h-7 text-xs bg-indigo-600 hover:bg-indigo-700 whitespace-nowrap" onClick={() => apply(d)}>
                          Attest &amp; apply
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
              {skippedCount > 0 && (
                <p className="text-xs text-slate-400">
                  {skippedCount} suggestion{skippedCount > 1 ? "s" : ""} not shown (low confidence, unrecognized item, or an out-of-range value).
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
