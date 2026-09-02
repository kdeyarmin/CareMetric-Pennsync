import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, HelpCircle, Quote, Wrench } from "lucide-react";
import { describeCalibration } from "./compliance/thresholds";

const TONE = {
  weak: { frame: "border-amber-200 bg-amber-50", heading: "text-amber-900", badge: "warning", icon: AlertTriangle },
  partial: { frame: "border-slate-200 bg-slate-50", heading: "text-slate-800", badge: "secondary", icon: HelpCircle },
  absent: { frame: "border-slate-200 bg-slate-50", heading: "text-slate-800", badge: "secondary", icon: HelpCircle },
  strong: { frame: "border-emerald-200 bg-emerald-50", heading: "text-emerald-900", badge: "success", icon: CheckCircle2 },
};

/**
 * DocumentationStrengthPanel — why a documentation element was flagged, in full.
 *
 * The brief's rule is "avoid black-box scores without explanation", so every row
 * shows four things: the rule it is measured against (with its citation), the
 * evidence from the note that triggered it, what appears to be missing, and the
 * remediation. The questions are exactly the deterministic questions the engine
 * produced — PennSync asks the nurse for the facts, it never supplies them.
 *
 * Advisory throughout. Nothing here blocks a save, and nothing here says a note
 * is or is not Medicare compliant.
 */
export default function DocumentationStrengthPanel({ findings = [], compact = false }) {
  const rows = compact ? findings.filter((f) => f.level === "weak" || f.level === "partial") : findings;
  if (!rows.length) return null;
  // The grading bands are PennSync defaults until an agency tunes them on its
  // own denials; a screen must not imply otherwise.
  const calibration = describeCalibration();

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        PennSync checks whether these statements carry the factual support a reviewer looks for.
        These are review prompts, not a compliance determination — answer what applies from your
        own assessment.
        {!calibration.complete && (
          <> The grading bands are PennSync defaults, not standards, and have not been calibrated
          on your agency&apos;s documentation.</>
        )}
      </p>
      {rows.map((finding) => {
        const tone = TONE[finding.level] || TONE.partial;
        const Icon = tone.icon;
        return (
          <section
            key={finding.id}
            aria-labelledby={`strength-${finding.id}`}
            className={`rounded-xl border p-3 space-y-2 ${tone.frame}`}
          >
            <div className="flex items-start justify-between gap-2">
              <h4 id={`strength-${finding.id}`} className={`text-sm font-semibold flex items-center gap-1.5 ${tone.heading}`}>
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                {finding.title}
              </h4>
              <Badge variant={tone.badge} className="text-xs shrink-0">{finding.label}</Badge>
            </div>

            <p className="text-xs text-slate-600">
              <span className="font-semibold">Rule:</span> {finding.rule}
              {finding.citation && <span className="text-slate-400"> ({finding.citation})</span>}
            </p>

            {finding.evidence?.length > 0 && (
              <div className="text-xs text-slate-700">
                <span className="font-semibold flex items-center gap-1">
                  <Quote className="w-3 h-3" aria-hidden="true" /> What you wrote:
                </span>
                <ul className="mt-1 space-y-1">
                  {finding.evidence.map((line, i) => (
                    <li key={i} className="bg-white/70 border border-slate-200 rounded px-2 py-1 leading-relaxed">
                      {line}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {finding.questions?.length > 0 && (
              <div className="text-xs text-slate-700">
                <span className="font-semibold">What appears to be missing:</span>
                <ul className="mt-1 ml-4 list-disc space-y-0.5">
                  {finding.questions.map((q, i) => <li key={i}>{q}</li>)}
                </ul>
              </div>
            )}

            {finding.remediation && (
              <p className="text-xs text-slate-600 flex items-start gap-1.5">
                <Wrench className="w-3 h-3 mt-0.5 shrink-0" aria-hidden="true" />
                <span><span className="font-semibold">Suggested fix:</span> {finding.remediation}</span>
              </p>
            )}
          </section>
        );
      })}
    </div>
  );
}
