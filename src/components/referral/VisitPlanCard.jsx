import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CalendarClock, ShieldAlert, ShieldCheck, Stethoscope, Landmark, AlertTriangle } from "lucide-react";
import { buildVisitPlan, formatOrder, DISCIPLINE_NAMES } from "./visitPlanEstimator.js";

/**
 * Payer-aware visit plan for the referral analyzer.
 *
 * Ordered visit frequencies are parsed VERBATIM from the referral (deterministic,
 * never invented — see visitPlanEstimator.js) and split across the two 30-day
 * PDGM payment periods with LUPA banding for Medicare FFS. When the referral
 * orders no frequencies, the AI analyzer's visit estimates fill in, clearly
 * labeled as planning estimates to confirm with the physician and at SOC.
 * No dollar amounts are shown here.
 */
export default function VisitPlanCard({ referralData, aiEstimates = null }) {
  const plan = useMemo(
    () => (referralData ? buildVisitPlan(referralData, aiEstimates) : null),
    [referralData, aiEstimates]
  );
  if (!plan) return null;

  const lupaTone = (band) =>
    band === "clears_all"
      ? "bg-green-50 border-green-300 text-green-900"
      : band === "in_band"
      ? "bg-yellow-50 border-yellow-300 text-yellow-900"
      : "bg-red-50 border-red-300 text-red-900";

  const ai = plan.aiEstimates;
  const aiRows = ai
    ? [
        ["Nursing — days 1–30", ai.nursingFirst30],
        ["Nursing — days 31–60", ai.nursingDays31to60],
        ["Physical Therapy", ai.pt],
        ["Occupational Therapy", ai.ot],
        ["Speech Therapy", ai.st],
        ["Medical Social Work", ai.msw],
        ["Home Health Aide", ai.aide],
      ].filter(([, v]) => v !== null && v !== undefined)
    : [];

  const ordersByDiscipline = plan.orders.reduce((acc, order) => {
    (acc[order.discipline] ||= []).push(order);
    return acc;
  }, {});

  return (
    <Card className="border-2 border-teal-300">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <CardTitle className="flex items-center gap-2 text-base">
            <CalendarClock className="w-5 h-5 text-teal-600" />
            Visit Plan & Episode Structure
          </CardTitle>
          <Badge variant="outline" className="flex items-center gap-1">
            <Landmark className="w-3 h-3" />
            {plan.payer.label}
          </Badge>
        </div>
        {plan.payer.evidence && (
          <p className="text-xs text-slate-500 mt-1">Payer read from referral: “{plan.payer.evidence}”</p>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Ordered frequencies — deterministic, parsed verbatim from the referral */}
        {plan.hasOrderedFrequencies ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-900 flex items-center gap-1">
              <Stethoscope className="w-4 h-4 text-teal-600" />
              Ordered frequencies (from the referral — authoritative)
            </p>
            {Object.entries(ordersByDiscipline).map(([discipline, orders]) => (
              <div key={discipline} className="bg-teal-50 border border-teal-200 rounded p-2 text-sm">
                <span className="font-semibold text-teal-900">{DISCIPLINE_NAMES[discipline] || discipline}: </span>
                <span className="text-slate-900">{orders.map(formatOrder).join(" → ")}</span>
                {plan.periods?.byDiscipline?.[discipline] && (
                  <span className="text-xs text-slate-600">
                    {" "}
                    ({plan.periods.byDiscipline[discipline].total} visits ordered)
                  </span>
                )}
              </div>
            ))}
            <p className="text-[11px] text-slate-500">
              Parsed from: {plan.sources.join("; ")}
            </p>
          </div>
        ) : (
          <Alert className="bg-slate-50 border-slate-300">
            <AlertTriangle className="w-4 h-4 text-slate-600" />
            <AlertDescription className="text-sm text-slate-700">
              No visit frequencies are ordered in this referral.
              {ai ? " AI planning estimates are shown below — confirm frequencies with the physician and at SOC." : " Obtain ordered frequencies from the referring physician."}
            </AlertDescription>
          </Alert>
        )}

        {/* AI estimates — only when nothing is ordered */}
        {plan.usingAiEstimates && aiRows.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-900 flex items-center gap-2">
              AI visit estimates (planning only — not orders)
              {ai.confidence && <Badge variant="outline">confidence: {ai.confidence}</Badge>}
            </p>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {aiRows.map(([label, value]) => (
                <div key={label} className="bg-indigo-50 border border-indigo-200 rounded p-2 text-xs">
                  <p className="font-semibold text-indigo-900">{label}</p>
                  <p className="text-slate-900 text-sm font-bold">{value} visits</p>
                </div>
              ))}
            </div>
            {ai.suggestedFrequency && (
              <p className="text-xs text-slate-700">
                <strong>Suggested frequency:</strong> {ai.suggestedFrequency}
              </p>
            )}
            {ai.rationale && <p className="text-xs text-slate-600 italic">{ai.rationale}</p>}
          </div>
        )}

        {/* 30-day period totals + LUPA banding (Medicare FFS only) */}
        {plan.lupa && (
          <div className="grid md:grid-cols-2 gap-2">
            {plan.lupa.map((l) => (
              <div key={l.period} className={`rounded-lg border-2 p-3 ${lupaTone(l.band)}`}>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-xs font-semibold">
                    30-day period {l.period}
                    {l.estimate ? " (estimate)" : ""}
                  </p>
                  {l.band === "clears_all" ? (
                    <ShieldCheck className="w-4 h-4" />
                  ) : (
                    <ShieldAlert className="w-4 h-4" />
                  )}
                </div>
                <p className="text-lg font-bold">{l.visits} visits</p>
                <p className="text-xs mt-1">{l.message}</p>
              </div>
            ))}
          </div>
        )}
        {plan.periods && plan.periods.beyond60 > 0 && (
          <p className="text-xs text-slate-600">
            {plan.periods.beyond60} ordered visit{plan.periods.beyond60 === 1 ? "" : "s"} fall
            {plan.periods.beyond60 === 1 ? "s" : ""} after day 60 — a recertification will be needed to continue.
          </p>
        )}

        {/* Payer strategy — how to structure the episode for full reimbursement */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-xs font-semibold text-slate-900 mb-1">Payer strategy — {plan.payer.label}</p>
          <ul className="text-xs text-slate-700 space-y-1 list-disc pl-4">
            {plan.strategy.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>

        {/* Action items */}
        {plan.actions.length > 0 && (
          <Alert className="bg-amber-50 border-amber-300">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <AlertDescription>
              <p className="text-xs font-semibold text-amber-900 mb-1">Action items</p>
              <ul className="text-xs text-amber-900 space-y-1 list-disc pl-4">
                {plan.actions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
