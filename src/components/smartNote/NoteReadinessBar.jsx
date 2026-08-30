import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck } from "lucide-react";
import { scanDraft } from "./compliance/draftScan";

/**
 * Live, deterministic compliance preview for STEP 1 — while the nurse is still
 * writing, in the editor where the draft can actually be fixed.
 *
 * Before this, every compliance signal (coverage, the required-element gaps, the
 * critical items that hard-block generation) appeared only after clicking through
 * to the review step. A nurse learned that homebound and skilled need were
 * missing on a different screen from the one holding their draft, then had to go
 * back — or, more often, answered the gap questions instead of improving the
 * note, which is the weaker documentation path.
 *
 * It runs the SAME pure scan the reviewer runs (compliance/draftScan.js), so the
 * two screens can't report different numbers. No LLM, no network: it updates as
 * fast as the nurse types and works offline.
 */
export default function NoteReadinessBar({
  roughNote,
  serviceLine = "home_health",
  visitType = "routine_visit",
  vitals = null,
  complianceRules = [],
}) {
  const scan = useMemo(
    () => scanDraft({ roughNote, serviceLine, visitType, vitals, complianceRules }),
    [roughNote, serviceLine, visitType, vitals, complianceRules],
  );

  // Nothing useful to say about a draft too short to scan.
  if (!scan) return null;

  const { required, presence, criticalGaps, draftScore, placeholders } = scan;
  const documented = presence.filter((p) => p.present).length;
  const blocked = criticalGaps.length > 0 || placeholders.length > 0;
  const tone = blocked ? "amber" : draftScore >= 90 ? "green" : "slate";

  const frame =
    tone === "green" ? "border-green-200 bg-green-50"
      : tone === "amber" ? "border-amber-200 bg-amber-50"
        : "border-slate-200 bg-white";
  const bar =
    tone === "green" ? "bg-green-500" : tone === "amber" ? "bg-amber-400" : "bg-navy-400";

  return (
    <div className={`rounded-xl border shadow-sm px-4 py-3 space-y-2 ${frame}`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <ClipboardCheck className="w-4 h-4 text-slate-500 shrink-0" aria-hidden="true" />
          <span className="text-xs font-semibold text-slate-700">Note readiness</span>
          <span className="text-xs text-slate-500 truncate">
            {documented} of {required.length} required elements documented
          </span>
        </div>
        <span className="text-sm font-bold text-slate-700 shrink-0">{draftScore}%</span>
      </div>

      <div className="h-1.5 bg-white/80 rounded-full overflow-hidden" role="presentation">
        <div className={`h-full transition-all ${bar}`} style={{ width: `${draftScore}%` }} />
      </div>

      {placeholders.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>
            <strong>{placeholders.length} unfilled blank{placeholders.length > 1 ? "s" : ""}</strong> left from a
            template ({placeholders[0].placeholders[0]}…). Fill them in or delete the line — blanks don&apos;t count as
            documentation and will block the note.
          </span>
        </p>
      )}

      {criticalGaps.length > 0 ? (
        <p className="flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          <span>
            <strong>Required to bill this visit:</strong> {criticalGaps.map((e) => e.label).join(", ")}. Add it here, or
            answer the question on the next screen.
          </span>
        </p>
      ) : (
        placeholders.length === 0 && (
          <p className="flex items-center gap-1.5 text-xs text-green-700">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            Every element Medicare requires to bill this visit type is documented.
          </p>
        )
      )}
    </div>
  );
}
