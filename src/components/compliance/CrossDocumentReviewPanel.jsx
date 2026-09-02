import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, GitCompare, ListChecks } from "lucide-react";
import { RESOLUTIONS, resolveFinding, reviewCrossDocumentConsistency } from "./crossDocumentConsistency";
import DocumentationGapPanel from "@/components/oasis/DocumentationGapPanel";
import { findDocumentationGaps } from "@/components/oasis/documentationGaps.js";

const ACTION_LABEL = {
  acknowledged: "Acknowledge",
  resolved: "Mark resolved",
  task_created: "Create task",
  not_applicable: "Not applicable",
};

/**
 * CrossDocumentReviewPanel — where the note, the OASIS copy and the care plan
 * disagree.
 *
 * PennSync never rewrites any of the three and never decides which side is
 * right: each row shows source A, source B, the evidence sentences and a
 * suggested review action, and the reviewer chooses. Marking a finding "not
 * applicable" requires a reason, so a real finding cannot be dismissed silently.
 */
export default function CrossDocumentReviewPanel({
  noteText = "",
  patient = null,
  oasis = null,
  carePlans = [],
  openTasks = [],
  currentUserEmail = null,
  onCreateTask = null,
  className = "",
}) {
  const review = useMemo(
    () => reviewCrossDocumentConsistency({ noteText, patient, oasis, carePlans, openTasks }),
    [noteText, patient, oasis, carePlans, openTasks],
  );
  // Item-level note-versus-code gaps. Evidence-triggered and symmetric: the
  // same rules fire when the note describes MORE independence than the recorded
  // response as when it describes less. Nothing financial reaches this — see
  // documentationGaps.js.
  const documentationGaps = useMemo(
    () => findDocumentationGaps({ documentation: noteText, oasis }),
    [noteText, oasis],
  );
  // { [findingId]: resolution } — local review state; PennSync stores the
  // reviewer's choice, never an edit to the underlying record.
  const [resolutions, setResolutions] = useState({});
  const [reasons, setReasons] = useState({});
  const [errors, setErrors] = useState({});

  // "Create task" is only offered when a caller can actually create one.
  // Rendering it without `onCreateTask` recorded the finding as `task_created`
  // and confirmed the action in the UI while no Task row existed — a clinical
  // follow-up assumed rather than queued, which is precisely the failure this
  // module's wording rules exist to prevent.
  const available = onCreateTask ? RESOLUTIONS : RESOLUTIONS.filter((r) => r !== "task_created");

  const decide = (finding, resolution) => {
    if (resolution === "task_created" && !onCreateTask) return;
    const out = resolveFinding(finding, resolution, {
      actorEmail: currentUserEmail,
      reason: reasons[finding.id] || "",
    });
    if (!out.ok) {
      setErrors((prev) => ({ ...prev, [finding.id]: out.reason }));
      return;
    }
    setErrors((prev) => ({ ...prev, [finding.id]: null }));
    setResolutions((prev) => ({ ...prev, [finding.id]: out.finding.resolution }));
    if (resolution === "task_created") onCreateTask?.(finding);
  };

  return (
    <section aria-labelledby="cross-doc-heading" className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="cross-doc-heading" className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <GitCompare className="w-4 h-4 text-navy-600" aria-hidden="true" />
          Note · OASIS · care-plan review
        </h3>
        {review.counts.total + documentationGaps.length > 0 && (
          <Badge variant="warning" className="text-xs">
            {review.counts.total + documentationGaps.length} to review
          </Badge>
        )}
      </div>

      <DocumentationGapPanel gaps={documentationGaps} />

      {/* The all-clear must account for BOTH engines. Checking only
          `review.findings` rendered the gap panel and a green "no
          inconsistencies" message about the same record, in the same view. */}
      {review.findings.length === 0 && documentationGaps.length === 0 ? (
        <p className="flex items-start gap-2 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          No inconsistencies detected by PennSync&apos;s current rules across the records it holds.
        </p>
      ) : (
        <ul className="space-y-2">
          {review.findings.map((f) => {
            const decided = resolutions[f.id];
            return (
              <li key={f.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-amber-900">{f.title}</p>
                  <Badge variant={f.severity === "high" ? "destructive" : "warning"} className="text-xs shrink-0">
                    {f.severity === "high" ? "High" : "Medium"}
                  </Badge>
                </div>

                <div className="grid gap-1.5 sm:grid-cols-2">
                  {[f.sourceA, f.sourceB].map((src, i) => (
                    <div key={i} className="rounded-lg border border-white/60 bg-white/70 px-2.5 py-1.5">
                      <p className="text-xs font-semibold text-slate-700">{src.record}</p>
                      <p className="text-xs text-slate-600 mt-0.5">{src.detail}</p>
                    </div>
                  ))}
                </div>

                {f.evidence?.length > 0 && (
                  <ul className="space-y-1">
                    {f.evidence.map((e, i) => (
                      <li key={i} className="text-xs text-slate-700 bg-white/70 border border-slate-200 rounded px-2 py-1 leading-relaxed">
                        {e}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="text-xs text-slate-700">
                  <span className="font-semibold">Suggested review:</span> {f.action}
                </p>

                {decided ? (
                  <p className="flex items-center gap-1.5 text-xs text-emerald-800">
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                    {ACTION_LABEL[decided.status]}
                    {decided.reason ? ` — ${decided.reason}` : ""}
                  </p>
                ) : (
                  <>
                    <label className="block">
                      <span className="sr-only">Reason (required to mark not applicable)</span>
                      <input
                        type="text"
                        value={reasons[f.id] || ""}
                        onChange={(e) => setReasons((prev) => ({ ...prev, [f.id]: e.target.value }))}
                        placeholder="Reason (required to mark not applicable)"
                        className="w-full text-xs rounded-lg border border-amber-300 bg-white px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
                      />
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {available.map((r) => (
                        <Button
                          key={r}
                          size="sm"
                          variant="outline"
                          onClick={() => decide(f, r)}
                          className="h-9 px-2.5 text-xs"
                        >
                          {ACTION_LABEL[r]}
                        </Button>
                      ))}
                    </div>
                    {errors[f.id] && (
                      <p role="alert" className="flex items-start gap-1.5 text-xs text-red-700">
                        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                        {errors[f.id]}
                      </p>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 min-h-[32px] flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> What PennSync compared ({review.checked.length})
        </summary>
        <ul className="mt-1 ml-4 list-disc text-xs text-slate-500 space-y-0.5">
          {review.checked.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </details>

      <p className="text-xs text-slate-500">
        PennSync compares only the records it holds and never changes any of them. Corrections to an
        official OASIS assessment or plan of care are made in your EMR.
      </p>
    </section>
  );
}
