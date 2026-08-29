import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { isAdminView } from "@/lib/roles";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ListOrdered, ShieldAlert, ClipboardCopy, FileSearch, AlertTriangle, CheckCircle2, Stethoscope } from "lucide-react";
import { toast } from "sonner";
import { generateDiagnosisCodes } from "./diagnosisCodeGenerator.js";
import { collectComorbidityCapture } from "./comorbidityCapture.js";

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

  // Case-mix weights are payment mechanics: by agency policy they render only
  // for admin-level users. The clinical sequencing itself is role-neutral.
  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });
  const adminView = isAdminView(currentUser);

  useEffect(() => {
    let cancelled = false;
    // Prefer the caller's agency rate row — never newest-row across tenants.
    (async () => {
      try {
        const { fetchCallerPdgmRateConfig } = await import("@/lib/agencySettings");
        const row = await fetchCallerPdgmRateConfig(currentUser?.agency_name);
        if (!cancelled && row) setRateConfig(row);
      } catch {
        /* fall back to built-in defaults */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentUser?.agency_name]);

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

  // Documented-but-uncoded condition signals (meds/prose/wounds) — coder/
  // physician queries, deterministic and code-free (see comorbidityCapture.js).
  const capture = useMemo(
    () => (referralData ? collectComorbidityCapture(referralData) : null),
    [referralData]
  );

  if (!result) return null;

  // With no acceptable primary, positions start at 1 on the first secondary —
  // only offset the M1023 numbering when a primary occupies position 1.
  const secondaryNumber = (dx) => dx.position - (result.primary ? 1 : 0);

  const copySequence = async () => {
    const lines = result.sequenced.map(
      (dx) =>
        `${dx.role === "primary" ? "M1021 Primary" : `M1023 Secondary ${secondaryNumber(dx)}`}: ${dx.displayCode}${dx.description ? ` — ${dx.description}` : ""}`
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
                  {dx.role === "primary" ? "M1021 Primary" : `M1023 #${secondaryNumber(dx)}`}
                </Badge>
                <span className="font-mono font-bold text-slate-900">{dx.displayCode}</span>
                {dx.description && <span className="text-sm text-slate-700">{dx.description}</span>}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="outline">{dx.clinicalGroup}</Badge>
                {adminView && dx.caseMixWeight !== null && (
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

        {capture?.opportunities?.length > 0 && (
          <div className="bg-sky-50 border border-sky-300 rounded-lg p-3">
            <p className="text-xs font-semibold text-sky-900 flex items-center gap-1 mb-2">
              <Stethoscope className="w-4 h-4" />
              Documented but not coded — confirm & query ({capture.opportunities.length})
            </p>
            <ul className="space-y-2">
              {capture.opportunities.map((o) => (
                <li key={o.key} className="text-xs text-slate-700">
                  <span className="font-semibold text-sky-900">{o.label}</span>{" "}
                  <Badge variant="outline" className="text-[10px] align-middle">
                    {o.value === "high" ? "high-value" : "medium-value"}
                  </Badge>
                  <p className="mt-0.5">{o.suggestion}</p>
                  <p className="text-slate-500 mt-0.5">
                    Evidence: {o.evidence.map((e) => `${e.source}: “${e.text}”`).join("; ")}
                  </p>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-slate-500 mt-2">
              Signals only — codes are never assigned here. Confirm with the physician/coder before adding a diagnosis.
            </p>
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
