import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Calculator, Loader2, DollarSign, TrendingUp, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { calculatePDGM } from "@/functions/calculatePDGM";
import {
  formatPdgmCurrency,
  formatPdgmNumber,
  getAlternativeScenarioState,
  getPdgmPaymentState,
  PDGM_LEGACY_SURFACES_ENABLED,
} from "./pdgmAvailability";

/**
 * Historical saved-rate preview retained behind the default-off rate-editor and
 * reimbursement gates. It must not invoke the retired factorized calculation.
 *
 * The historical request code is preserved for later replacement, but the
 * button is disabled by an independent retirement lock as well as dirty state.
 */
const REFERENCE_PATIENT = {
  primary_diagnosis_code: "I50.9",
  primary_diagnosis: "Heart failure",
  admission_source: "community",
  episode_timing: "early",
  comorbidities: [],
  // The engine reads ONLY pdgmData.functional_scores — top-level m18xx keys
  // were ignored, scoring the reference patient 0 points ("low", x0.82) while
  // the card promised "medium functional impairment": the admin verification
  // number was silently ~18% low.
  functional_scores: {
    m1800_grooming: "2",
    m1810_dress_upper: "2",
    m1820_dress_lower: "2",
    m1830_bathing: "3",
    m1840_toilet_transfer: "2",
    m1850_transferring: "3",
    m1860_ambulation: "3",
  },
};

export default function PDGMCalculationPreview({ isDirty, baseRate }) {
  const [result, setResult] = useState(null);
  const previewEnabled = PDGM_LEGACY_SURFACES_ENABLED;

  const calcMutation = useMutation({
    mutationFn: async () => calculatePDGM({ pdgmData: REFERENCE_PATIENT, wageIndex: 1.0 }),
    onSuccess: (response) => setResult(response?.data ?? response),
    onError: (err) => {
      console.error("PDGM calculation failed:", err);
      setResult(null);
    },
  });

  const handleCalculate = () => {
    if (isDirty || !previewEnabled) return;
    calcMutation.mutate();
  };

  const original = result?.original;
  const scenarios = result?.alternativeScenarios;
  const rateBasis = result?.rateBasis;
  const paymentState = getPdgmPaymentState(original);
  const scenarioState = getAlternativeScenarioState(scenarios);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Calculator className="w-5 h-5" />
          Medicare payment preview unavailable
        </CardTitle>
        <p className="text-xs text-slate-500">
          The saved factorized rate set is not CMS HHGS. This preview remains disabled until a
          date-effective implementation matches the official CMS fixtures and passes release review.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {isDirty && (
          <Alert className="border-amber-200 bg-amber-50">
            <Info className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-sm text-amber-800">
              Save your rate changes first — the calculation uses the saved rate set, not the
              in-progress editor values.
            </AlertDescription>
          </Alert>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={handleCalculate} disabled={!previewEnabled || isDirty || calcMutation.isPending}>
            {calcMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Calculator className="w-4 h-4 mr-2" />
            )}
            {calcMutation.isPending ? "Calculating…" : "Payment calculation unavailable"}
          </Button>
          {rateBasis && (
            <Badge variant={rateBasis.isOfficial ? "default" : "secondary"}>
              {rateBasis.isOfficial ? "Legacy official marker ignored" : "Reference values only"}
            </Badge>
          )}
          {baseRate && (
            <span className="text-xs text-slate-500">
              Base rate in saved config: ${Number(baseRate).toFixed(2)}
            </span>
          )}
        </div>

        {calcMutation.isError && (
          <Alert className="border-red-200 bg-red-50">
            <AlertDescription className="text-sm text-red-800">
              Could not run the calculation. Please try again.
            </AlertDescription>
          </Alert>
        )}

        {original && !paymentState.available && (
          <Alert className="border-amber-300 bg-amber-50">
            <Info className="h-4 w-4 text-amber-700" />
            <AlertDescription className="space-y-2 text-sm text-amber-900">
              <p><strong>PDGM payment: Unavailable.</strong> {paymentState.message}</p>
              {paymentState.actions.length > 0 && (
                <ul className="list-disc space-y-1 pl-5">
                  {paymentState.actions.map((action) => <li key={action}>{action}</li>)}
                </ul>
              )}
            </AlertDescription>
          </Alert>
        )}

        {original && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-lg border bg-slate-50 p-4 dark:bg-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <DollarSign className="w-3.5 h-3.5" />
                30-day period payment
              </div>
              <p className="mt-1 text-2xl font-bold text-slate-900 dark:text-slate-100">
                {formatPdgmCurrency(paymentState.amount)}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Case-mix weight: {paymentState.available ? formatPdgmNumber(original.caseMixWeight) : "Unavailable"}
              </p>
            </div>
            <div className="rounded-lg border bg-slate-50 p-4 dark:bg-slate-800">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <TrendingUp className="w-3.5 h-3.5" />
                Clinical group
              </div>
              <p className="mt-1 text-sm font-semibold text-slate-900 dark:text-slate-100">
                {original.clinicalGroup || "—"}
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Functional level: {original.functionalLevel || "—"} · Comorbidity: {original.comorbidityLevel || "none"}
              </p>
            </div>
          </div>
        )}

        {scenarios && (
          <div className="rounded-lg border">
            <div className="border-b px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              All four admission-source × timing scenarios
            </div>
            {!scenarioState.available && (
              <div className="border-b bg-amber-50 px-3 py-2 text-sm text-amber-900">
                <strong>Unavailable.</strong> {scenarioState.message}
              </div>
            )}
            <div className="divide-y">
              {Object.entries(scenarios.scenarios || {}).map(([key, scenario]) => (
                <div key={key} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="capitalize text-slate-600 dark:text-slate-300">
                    {key.replace(/_/g, " ")}
                  </span>
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {scenarioState.available ? formatPdgmCurrency(scenario.totalPayment) : "Unavailable"}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
