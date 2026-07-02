import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ListOrdered, ShieldAlert, ClipboardCopy, FileSearch, AlertTriangle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { generateDiagnosisCodes } from "./diagnosisCodeGenerator.js";

/**
 * Deterministic diagnosis-code generator for the referral analyzer.
 *
 * Every code shown was found verbatim in the uploaded referral's extracted
 * data — this component performs NO AI call and never invents a code.
 * Diagnoses documented without a code go to the "needs coder" queue instead.
 * Sequencing (M1021 principal first, then M1023 secondaries) follows the
 * app's canonical PDGM model: the agency's saved PDGMRateConfig tables
 * (ICD-10 → clinical group + case-mix weights) merged over the built-in
 * defaults, exactly as the live calculatePDGM backend merges them.
 */
export default function DiagnosisCodeGenerator({ referralData }) {
  const [rateConfig, setRateConfig] = useState(null);

  useEffect(() => {
    let cancelled = false;
    // PDGMRateConfig is readable by all authenticated users (write is
    // service-role only). Any failure just falls back to the built-in defaults.
    base44.entities.PDGMRateConfig.list("-created_date", 1)
      .then((rows) => {
        if (!cancelled && rows && rows[0]) setRateConfig(rows[0]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const result = useMemo(
    () =>
      referralData
        ? generateDiagnosisCodes(referralData, {
            rates: rateConfig?.rates,
            icdGroups: rateConfig?.icd10_clinical_groups,
          })
        : null,
    [referralData, rateConfig]
  );

  if (!result) return null;

  const copySequence = async () => {
    const lines = result.sequenced.map(
      (dx) =>
        `${dx.role === "primary" ? "M1021 Primary" : `M1023 Secondary ${dx.position - 1}`}: ${dx.displayCode}${dx.description ? ` — ${dx.description}` : ""}`
    );
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast.success("Diagnosis code sequence copied.");
    } catch {
      toast.error("Couldn't copy to clipboard.");
    }
  };

  return (
    <Card className="border-2 border-indigo-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <ListOrdered className="w-5 h-5 text-indigo-600" />
            Diagnosis Codes — PDGM Sequenced
          </CardTitle>
          {result.hasCodes && (
            <Button type="button" variant="outline" size="sm" onClick={copySequence}>
              <ClipboardCopy className="w-4 h-4 mr-1" /> Copy
            </Button>
          )}
        </div>
        <p className="text-xs text-slate-500 mt-1">
          Only codes documented in this referral are listed — codes are never generated or inferred.
          Sequenced for the {result.scenario.admissionSource} / early 30-day period
          {rateConfig ? " using this agency's saved PDGM rate tables." : " using the built-in default PDGM tables."}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {result.sequenced.map((dx) => (
          <div
            key={dx.code}
            className={`p-3 rounded-lg border-2 ${
              dx.role === "primary"
                ? "border-indigo-500 bg-indigo-50"
                : dx.acceptablePrimary
                ? "border-slate-200 bg-white"
                : "border-yellow-300 bg-yellow-50"
            }`}
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <Badge className={dx.role === "primary" ? "bg-indigo-600 text-white" : "bg-slate-600 text-white"}>
                  {dx.role === "primary" ? "M1021 Primary" : `M1023 #${dx.position - 1}`}
                </Badge>
                <span className="font-mono font-bold text-slate-900">{dx.displayCode}</span>
                {dx.description && <span className="text-sm text-slate-700">{dx.description}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{dx.clinicalGroup}</Badge>
                {dx.caseMixWeight !== null && (
                  <Badge className="bg-blue-100 text-blue-800">weight {dx.caseMixWeight.toFixed(4)}</Badge>
                )}
              </div>
            </div>
            {dx.rtpReason && (
              <p className="text-xs text-yellow-900 mt-2 flex items-start gap-1">
                <ShieldAlert className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                {dx.rtpReason}
              </p>
            )}
            <p className="text-xs text-slate-500 mt-1">
              Found in: {dx.evidence.map((e) => e.path).join("; ")}
            </p>
          </div>
        ))}

        {result.uncoded.length > 0 && (
          <div className="bg-amber-50 border border-amber-300 rounded-lg p-3">
            <p className="text-xs font-semibold text-amber-900 flex items-center gap-1 mb-2">
              <FileSearch className="w-4 h-4" />
              Documented without an ICD-10 code — needs coder assignment ({result.uncoded.length})
            </p>
            <ul className="space-y-1">
              {result.uncoded.map((u, idx) => (
                <li key={idx} className="text-xs text-slate-700">
                  • {u.description}
                  <span className="text-slate-400"> ({u.path})</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {result.warnings.length > 0 && (
          <Alert className="bg-yellow-50 border-yellow-300">
            <AlertTriangle className="w-4 h-4 text-yellow-700" />
            <AlertDescription>
              <ul className="text-xs space-y-1">
                {result.warnings.map((w, idx) => (
                  <li key={idx}>• {w}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {result.hasCodes && result.primary && result.warnings.length === 0 && (
          <p className="text-xs text-green-800 flex items-center gap-1">
            <CheckCircle2 className="w-4 h-4" />
            All documented codes verified, mapped, and sequenced with a PDGM-acceptable principal diagnosis.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
