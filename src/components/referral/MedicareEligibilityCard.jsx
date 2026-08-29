import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, AlertCircle, XCircle, ClipboardCheck } from "lucide-react";
import { assessMedicareEligibility, CRITERION_STATUS } from "./medicareEligibility.js";

/**
 * Medicare home-health eligibility snapshot — deterministic, referral-only
 * (see medicareEligibility.js). Renders in every analyzer state: an AI outage
 * must never hide a coverage-criteria gap. This is intake triage; the
 * authoritative determination happens at SOC with the comprehensive assessment.
 */
export default function MedicareEligibilityCard({ referralData, f2fValidation = null }) {
  const result = useMemo(
    () => (referralData ? assessMedicareEligibility(referralData, f2fValidation) : null),
    [referralData, f2fValidation]
  );
  if (!result) return null;

  const overallBadge =
    result.overall === "supported"
      ? { className: "bg-green-600 text-white", label: "Criteria supported" }
      : result.overall === "needs_review"
      ? { className: "bg-yellow-600 text-white", label: "Needs review" }
      : { className: "bg-red-600 text-white", label: "Gaps to resolve" };

  const statusIcon = (status) =>
    status === CRITERION_STATUS.MET ? (
      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
    ) : status === CRITERION_STATUS.NEEDS_REVIEW ? (
      <AlertCircle className="w-4 h-4 text-yellow-600 flex-shrink-0 mt-0.5" />
    ) : (
      <XCircle className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5" />
    );

  return (
    <Card className="border-2 border-emerald-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="w-5 h-5 text-emerald-600" />
            Medicare Home Health Criteria
          </CardTitle>
          <Badge className={overallBadge.className}>{overallBadge.label}</Badge>
        </div>
        <p className="text-xs text-slate-500 mt-1">
          {result.applicable
            ? "Referral-level snapshot — the authoritative determination happens at the SOC comprehensive assessment."
            : `Payer is ${result.payer.label} — Medicare criteria shown for reference; plan-specific rules apply.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-2">
        {result.criteria.map((c) => (
          <div
            key={c.key}
            className={`flex items-start gap-2 p-2 rounded border ${
              c.status === CRITERION_STATUS.MET
                ? "bg-green-50 border-green-200"
                : c.status === CRITERION_STATUS.NEEDS_REVIEW
                ? "bg-yellow-50 border-yellow-200"
                : "bg-red-50 border-red-200"
            }`}
          >
            {statusIcon(c.status)}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-900 flex items-center gap-2 flex-wrap">
                {c.label}
                <span className="text-[10px] font-normal text-slate-500">{c.citation}</span>
              </p>
              <p className="text-xs text-slate-700">{c.detail}</p>
            </div>
          </div>
        ))}

        {result.missingForAdmission.length > 0 && (
          <div className="bg-slate-50 border border-slate-200 rounded p-3 mt-2">
            <p className="text-xs font-semibold text-slate-900 mb-1">
              Still needed to complete this admission ({result.missingForAdmission.length})
            </p>
            <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
              {result.missingForAdmission.map((m, i) => (
                <li key={i}>{m}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
