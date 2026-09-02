import { Badge } from "@/components/ui/badge";
import { AlertTriangle, CheckCircle2, Info, ListChecks } from "lucide-react";
import { assessDocumentationReadiness } from "./documentationReadiness";

const TONE = {
  success: { frame: "border-emerald-200 bg-emerald-50", text: "text-emerald-900", icon: CheckCircle2 },
  warning: { frame: "border-amber-200 bg-amber-50", text: "text-amber-900", icon: Info },
  destructive: { frame: "border-red-200 bg-red-50", text: "text-red-900", icon: AlertTriangle },
};

/**
 * DocumentationReadinessPanel — the QA/office view of what PennSync knows.
 *
 * NOT a billing gate. It never says "ready to bill" and never asserts a claim is
 * payable; PennSync holds neither the EMR, the billing system, the payer rules,
 * nor the agency's QA queue. The disclaimer stating that limit is always on
 * screen, not behind a disclosure.
 *
 * Every finding drills down to the exact reason and the records that triggered
 * it, and the list of checks that RAN is shown even when nothing was found —
 * "we found nothing" and "we did not look" must read differently.
 */
export default function DocumentationReadinessPanel({
  // Deliberately NOT defaulted to []. The engine treats "not supplied" and
  // "empty" as different answers, and a default here would erase that
  // distinction for every caller — turning "we did not look" back into "we
  // found nothing".
  visits,
  drafts,
  complianceAudits,
  openTasks,
  oasisFindings,
  adrCases,
  incidents,
  patient = null,
  handoffTrackingSince = null,
  className = "",
}) {
  const result = assessDocumentationReadiness({
    visits, drafts, complianceAudits, openTasks, oasisFindings, adrCases, incidents, patient,
    handoffTrackingSince,
  });
  const tone = TONE[result.status.tone] || TONE.warning;
  const StatusIcon = tone.icon;

  return (
    <section aria-labelledby="readiness-heading" className={`space-y-3 ${className}`}>
      <div className={`rounded-xl border p-3 ${tone.frame}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="readiness-heading" className={`text-sm font-semibold flex items-center gap-1.5 ${tone.text}`}>
            <StatusIcon className="w-4 h-4 shrink-0" aria-hidden="true" />
            Documentation readiness: {result.status.label}
          </h3>
          <div className="flex items-center gap-1.5">
            {result.counts.action > 0 && (
              <Badge variant="destructive" className="text-xs">{result.counts.action} action needed</Badge>
            )}
            {result.counts.review > 0 && (
              <Badge variant="warning" className="text-xs">{result.counts.review} to review</Badge>
            )}
          </div>
        </div>

        {result.findings.length > 0 && (
          <ul className="mt-2 space-y-2">
            {result.findings.map((f) => (
              <li key={f.id} className="rounded-lg border border-white/60 bg-white/70 px-3 py-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-800">{f.title}</p>
                  <Badge variant={f.status === "action" ? "destructive" : "warning"} className="text-xs shrink-0">
                    {f.status === "action" ? "Action needed" : "Review"}
                  </Badge>
                </div>
                <p className="text-xs text-slate-600 mt-0.5 leading-relaxed">{f.detail}</p>
                {f.records?.length > 0 && (
                  <p className="text-xs text-slate-400 mt-0.5">
                    {f.records.length} record{f.records.length === 1 ? "" : "s"}: {f.records.slice(0, 4).join(", ")}
                    {f.records.length > 4 ? "…" : ""}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Showing what was checked keeps "nothing found" distinct from "not looked at". */}
      {result.notChecked.length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2">
          <p className="text-xs font-semibold text-slate-600">
            {result.notChecked.length} check{result.notChecked.length === 1 ? "" : "s"} could not run
          </p>
          <ul className="mt-1 ml-4 list-disc text-xs text-slate-500 space-y-0.5">
            {result.notChecked.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
          <p className="text-xs text-slate-400 mt-1">
            This status covers only the checks that ran.
          </p>
        </div>
      )}

      <details className="rounded-lg border border-slate-200 bg-white px-3 py-2">
        <summary className="cursor-pointer text-xs font-semibold text-slate-700 min-h-[32px] flex items-center gap-1.5">
          <ListChecks className="w-3.5 h-3.5" aria-hidden="true" /> What PennSync checked ({result.checked.length})
        </summary>
        <ul className="mt-1 ml-4 list-disc text-xs text-slate-500 space-y-0.5">
          {result.checked.map((c, i) => <li key={i}>{c}</li>)}
        </ul>
      </details>

      <p className="flex items-start gap-1.5 text-xs text-slate-500">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        <span>{result.disclaimer}</span>
      </p>
    </section>
  );
}
