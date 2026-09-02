import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, CheckCircle2, Info, Pill } from "lucide-react";
import { reconcileMedications, summarizeMedicationChanges } from "./medicationReconciliation";
import { extractMedications } from "../smartNote/compliance/factExtraction";

const SEVERITY = {
  critical: { badge: "destructive", label: "Critical" },
  high: { badge: "warning", label: "High" },
  medium: { badge: "secondary", label: "Medium" },
};

/**
 * MedicationReconciliationPanel — potential discrepancies between the chart's
 * medication list and what this visit documented.
 *
 * PennSync is not the medication administration record and holds no licensed
 * drug knowledge base. The panel says so on screen (via the engine's own
 * knowledge-source description) so a finding can never read as authoritative,
 * and every row is worded as something to compare and confirm — never as a
 * medication instruction.
 */
export default function MedicationReconciliationPanel({
  patient = null,
  noteText = "",
  noteMedications = [],
  onCreateFollowUp = null,
  className = "",
}) {
  // When the caller does not supply a parsed medication list, derive one from
  // the note text. Without this the panel only ever ran the stopped/held check:
  // a note that introduced a drug, or changed a dose or frequency, could not
  // produce a not_on_list / dose_change / frequency_change finding at all, so
  // most of what this panel advertises was silently skipped.
  const noteMeds = useMemo(() => {
    if (noteMedications?.length) return noteMedications;
    if (!noteText) return [];
    return extractMedications(noteText).map((name) => {
      // Keep the strength/route/frequency context that follows the drug name in
      // the note so the normalizer can compare doses, not just names.
      const m = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^.;\n]{0,60}`, "i").exec(noteText);
      return m ? m[0].trim() : name;
    });
  }, [noteMedications, noteText]);

  const result = useMemo(() => reconcileMedications({
    chartMedications: patient?.current_medications || [],
    noteMedications: noteMeds,
    noteText,
    allergies: patient?.allergies || "",
  }), [patient, noteMeds, noteText]);

  const changes = useMemo(() => summarizeMedicationChanges(result.changes), [result.changes]);

  return (
    <section aria-labelledby="med-recon-heading" className={`space-y-3 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="med-recon-heading" className="text-sm font-semibold text-slate-900 flex items-center gap-1.5">
          <Pill className="w-4 h-4 text-navy-600" aria-hidden="true" />
          Medication reconciliation assistance
        </h3>
        {result.counts.total > 0 && (
          <Badge variant={result.counts.critical > 0 ? "destructive" : "warning"} className="text-xs">
            {result.counts.total} to compare
          </Badge>
        )}
      </div>

      {result.findings.length === 0 ? (
        <p className="flex items-start gap-2 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
          <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0 text-emerald-600" aria-hidden="true" />
          No medication discrepancies detected by PennSync&apos;s current rules.
        </p>
      ) : (
        <ul className="space-y-2">
          {result.findings.map((f) => {
            const tone = SEVERITY[f.severity] || SEVERITY.medium;
            return (
              <li
                key={f.id}
                className={`rounded-xl border p-3 space-y-1.5 ${f.severity === "critical" ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-slate-800">{f.title}</p>
                  <Badge variant={tone.badge} className="text-xs shrink-0">{tone.label}</Badge>
                </div>
                <p className="text-xs text-slate-700">{f.detail}</p>
                {f.evidence && (
                  <p className="text-xs text-slate-600 bg-white/70 border border-slate-200 rounded px-2 py-1 leading-relaxed">
                    {f.evidence}
                  </p>
                )}
                <p className="text-xs text-slate-600 italic">{f.advisory}</p>
              </li>
            );
          })}
        </ul>
      )}

      {changes.count > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 space-y-1.5">
          <p className="text-xs font-semibold text-slate-700">Medication changes this visit</p>
          <ul className="ml-4 list-disc text-xs text-slate-600 space-y-0.5">
            {changes.lines.map((line, i) => <li key={i}>{line}</li>)}
          </ul>
          {onCreateFollowUp && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onCreateFollowUp(changes)}
              className="h-9 px-3 text-xs gap-1.5"
            >
              <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" /> Create provider follow-up
            </Button>
          )}
        </div>
      )}

      {/* Honest about what is behind the findings. */}
      {result.knowledgeSource.caveat && (
        <p className="flex items-start gap-1.5 text-xs text-slate-500">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
          <span>{result.knowledgeSource.caveat}</span>
        </p>
      )}
    </section>
  );
}
