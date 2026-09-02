import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2, Copy, AlertTriangle, ArrowRightLeft, ClipboardCheck, Info,
} from "lucide-react";
import {
  EMR_HANDOFF_DISCLAIMER,
  EMR_HANDOFF_STATUSES,
  REVIEW_ACK_LABEL,
  REVIEW_ACK_NOT_A_SIGNATURE,
  SELF_REPORTED_CAVEAT,
  getHandoffStatus,
  isAcknowledgementStale,
  splitNoteSections,
} from "./emrHandoff";

/**
 * EmrHandoffPanel — the step PennSync exists to support.
 *
 * PennSync is NOT the EMR. The nurse's real deliverable is the note they enter
 * and sign in the agency's EMR; this panel makes moving PennSync's prepared text
 * into that system a first-class action instead of an unlabelled "Copy" button.
 *
 * What it deliberately does and does not claim:
 *  - "Copy to EMR" is the primary action, so the workflow's real next step is the
 *    most prominent control on the screen.
 *  - Per-section copy exists because most EMRs take a form, not one free-text
 *    box; pasting field-by-field is the actual field workflow.
 *  - Clipboard success AND failure are both shown inline. A silent failure would
 *    let a nurse switch apps and paste stale text, so a failure shows the manual
 *    fallback rather than only a toast that has already faded.
 *  - The handoff statuses are SELF-REPORTED. PennSync has no EMR integration, so
 *    every status carries "PennSync did not verify this". It never claims the
 *    note was entered, reviewed, or signed in the EMR on its own authority.
 *  - The review acknowledgement is an AI-governance record, not a signature.
 */
export default function EmrHandoffPanel({
  noteText = "",
  aiAssisted = true,
  nurseEdited = false,
  handoffStatus = "not_started",
  onReportStatus = null,
  reviewAck = null,
  onReviewAck = null,
  statusError = null,
  disabled = false,
}) {
  // { [key]: { state: "ok" | "failed", text } } — keyed by "all" or a section id.
  // The copied TEXT is kept so a "Copied" badge cannot outlive the content it
  // referred to: after an edit the clipboard holds the old note, and a stale
  // green tick would tell the nurse the wrong thing at the exact moment it
  // matters.
  const [copyState, setCopyState] = useState({});
  const [showSections, setShowSections] = useState(false);

  const sections = useMemo(() => splitNoteSections(noteText), [noteText]);
  const status = getHandoffStatus(handoffStatus);
  const ackStale = isAcknowledgementStale(reviewAck, noteText);
  const acknowledged = !!reviewAck?.acknowledged && !ackStale;

  const copy = async (key, text) => {
    try {
      // `typeof navigator` — a bare `navigator?.` still throws where the global
      // is undefined rather than merely null (SSR, a worker, some test hosts).
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("Clipboard unavailable");
      }
      await navigator.clipboard.writeText(text);
      setCopyState((prev) => ({ ...prev, [key]: { state: "ok", text } }));
      // DELIBERATELY does not report `copied_to_emr`.
      //
      // A clipboard write puts text on the device clipboard. It is not evidence
      // that the nurse switched to the EMR, pasted, or that the paste worked —
      // and this panel's whole contract is that a status means the nurse
      // reported doing something, never that PennSync inferred it. Auto-reporting
      // here would have let Documentation Readiness treat a visit as handed off
      // on the strength of a button press.
    } catch {
      setCopyState((prev) => ({ ...prev, [key]: { state: "failed", text } }));
    }
  };

  /** The copy state for `key`, but only while it still refers to `text`. */
  const stateFor = (key, text) => {
    const entry = copyState[key];
    if (!entry) return null;
    if (entry.state === "ok" && entry.text !== text) return null;
    return entry.state;
  };

  const allState = stateFor("all", noteText);

  return (
    <section
      aria-labelledby="emr-handoff-heading"
      className="rounded-xl border-2 border-navy-200 bg-white shadow-sm overflow-hidden"
    >
      <header className="flex items-center gap-2 px-4 py-3 bg-navy-50 border-b border-navy-100">
        <ArrowRightLeft className="w-4 h-4 text-navy-700 shrink-0" aria-hidden="true" />
        <h3 id="emr-handoff-heading" className="text-sm font-semibold text-navy-900">
          Move this into your EMR
        </h3>
      </header>

      <div className="p-4 space-y-4">
        {/* The standing scope statement. Never hidden behind a disclosure: it is
            the sentence that keeps PennSync from reading as the legal record. */}
        <p className="flex items-start gap-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0 text-slate-500" aria-hidden="true" />
          <span>{EMR_HANDOFF_DISCLAIMER}</span>
        </p>

        {/* Provenance. An AI-assisted suggestion must stay visibly distinct from
            clinician-confirmed text right up to the moment it is copied out. */}
        <div className="flex flex-wrap items-center gap-2">
          {aiAssisted && (
            <Badge variant="warning" className="text-xs">
              AI-assisted draft — review before use
            </Badge>
          )}
          {nurseEdited && (
            <Badge variant="info" className="text-xs">
              Edited by you
            </Badge>
          )}
        </div>

        {/* Primary action. */}
        <div className="space-y-2">
          <Button
            onClick={() => copy("all", noteText)}
            disabled={disabled || !noteText.trim()}
            className="w-full h-12 gap-2 text-sm font-semibold bg-navy-600 hover:bg-navy-700 text-white"
          >
            {allState === "ok"
              ? <><CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Copied — paste into your EMR</>
              : <><Copy className="w-4 h-4" aria-hidden="true" /> Copy to EMR</>}
          </Button>
          {allState === "ok" && onReportStatus && getHandoffStatus(handoffStatus).order === 0 && (
            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              Copied to your clipboard. Once you have pasted it into your EMR, record that below —
              PennSync cannot see the EMR and will not assume the step happened.
            </p>
          )}
          {allState === "failed" && (
            <p role="alert" className="flex items-start gap-2 text-xs text-red-800 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>
                Couldn&apos;t reach the clipboard on this device. Select the note text above and copy it
                manually — nothing was lost, and your note is still here.
              </span>
            </p>
          )}
        </div>

        {/* Section-by-section copy, for EMRs that take a form rather than one box. */}
        {sections.length > 1 && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <button
              type="button"
              onClick={() => setShowSections((s) => !s)}
              aria-expanded={showSections}
              className="w-full flex items-center justify-between px-3 py-2.5 min-h-[44px] bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700"
            >
              <span>Copy one section at a time ({sections.length})</span>
              <span className="text-xs font-normal text-slate-500">{showSections ? "Hide" : "Show"}</span>
            </button>
            {showSections && (
              <ul className="divide-y divide-slate-100">
                {sections.map((section) => {
                  const state = stateFor(section.id, section.text);
                  return (
                    <li key={section.id} className="p-3 space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-semibold text-slate-700 truncate">{section.heading}</span>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={disabled}
                          onClick={() => copy(section.id, section.text)}
                          className="h-9 px-3 gap-1.5 text-xs shrink-0"
                        >
                          {state === "ok"
                            ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" /> Copied</>
                            : <><Copy className="w-3.5 h-3.5" aria-hidden="true" /> Copy</>}
                        </Button>
                      </div>
                      <p className="text-xs text-slate-500 line-clamp-2">{section.body}</p>
                      {state === "failed" && (
                        <p role="alert" className="text-xs text-red-700">
                          Couldn&apos;t copy this section — select and copy it manually.
                        </p>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {/* AI-governance review record. Explicitly not a signature. */}
        {onReviewAck && (
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-1.5">
            <label className="flex items-start gap-2 text-sm text-slate-800 cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={disabled}
                onChange={(e) => onReviewAck(e.target.checked)}
                className="w-4 h-4 mt-0.5 rounded shrink-0"
              />
              <span>{REVIEW_ACK_LABEL}</span>
            </label>
            <p className="text-xs text-slate-500 pl-6">{REVIEW_ACK_NOT_A_SIGNATURE}</p>
            {ackStale && reviewAck?.acknowledged && (
              <p role="status" className="text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1 ml-6">
                You edited the note after reviewing it. Re-confirm your review so the record matches
                what you are copying.
              </p>
            )}
          </div>
        )}

        {/* Self-reported workflow status. */}
        {onReportStatus && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                EMR progress
              </span>
              <Badge variant={status.id === "not_started" ? "secondary" : "success"} className="text-xs">
                {status.label}
              </Badge>
            </div>
            <div className="flex flex-wrap gap-2">
              {EMR_HANDOFF_STATUSES.filter((s) => s.id !== "not_started").map((s) => {
                const done = getHandoffStatus(handoffStatus).order >= s.order;
                return (
                  <Button
                    key={s.id}
                    variant={done ? "secondary" : "outline"}
                    size="sm"
                    disabled={disabled || done}
                    onClick={() => onReportStatus(s.id)}
                    title={s.help}
                    className="h-10 px-3 text-xs gap-1.5"
                  >
                    {done && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" aria-hidden="true" />}
                    {s.label}
                  </Button>
                );
              })}
            </div>
            <p className="flex items-start gap-1.5 text-xs text-slate-500">
              <ClipboardCheck className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
              <span>{SELF_REPORTED_CAVEAT}</span>
            </p>
            {statusError && (
              <p role="alert" className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1">
                {statusError}
              </p>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
