import { useMemo, useState } from "react";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import FinancialGate from "@/components/ui/FinancialGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TrendingUp, TrendingDown, Minus, Lock, ArrowRight } from "lucide-react";
import { DEFAULT_PDGM_RATES } from "@/components/pdgm/pdgmRates";
import { computeImpact } from "@/components/pdgm/reimbursementImpact";

// Friendly labels for the pdgmRates clinical-group keys (the FE mirror of the
// backend calculatePDGM groups).
const CLINICAL_GROUP_LABELS = {
  MMTA_Cardiac_Circulatory: "MMTA – Cardiac & Circulatory",
  MMTA_Respiratory: "MMTA – Respiratory",
  MMTA_Endocrine: "MMTA – Endocrine",
  MMTA_GI_GU: "MMTA – GI & GU",
  MMTA_Infectious_Disease: "MMTA – Infectious Disease",
  MMTA_Surgical_Aftercare: "MMTA – Surgical Aftercare",
  MMTA_Other: "MMTA – Other",
  MMTA_Neuro_Rehab: "Neuro Rehabilitation",
  MMTA_Wounds: "Wound",
  MMTA_Complex_Nursing: "Complex Nursing Interventions",
  MMTA_Behavioral_Health: "Behavioral Health",
  MMTA_Medication_Management: "Medication Management",
  MMTA_Musculoskeletal: "Musculoskeletal Rehabilitation",
  MMTA_Skin_Non_Surgical: "Skin (Non-Surgical)",
};
const CLINICAL_GROUPS = Object.keys(DEFAULT_PDGM_RATES.clinicalGroupWeights);
const ADMISSION = [["community", "Community"], ["institutional", "Institutional"]];
const TIMING = [["early", "Early (first 30-day period)"], ["late", "Late (subsequent periods)"]];
const FUNCTIONAL = [["low", "Low impairment"], ["medium", "Medium impairment"], ["high", "High impairment"]];
const COMORBIDITY = [["none", "None"], ["low", "Low adjustment"], ["high", "High adjustment"]];

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function LabeledSelect({ label, value, onChange, options }) {
  return (
    <div>
      <label className="text-xs font-semibold text-slate-700 mb-1.5 block">{label}</label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-10 text-sm"><SelectValue /></SelectTrigger>
        <SelectContent>
          {options.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  );
}

export default function DocumentationImpact() {
  // Shared period context — documentation enhancement typically moves the
  // functional level and comorbidity capture, holding clinical group/timing.
  const [clinicalGroup, setClinicalGroup] = useState("MMTA_Wounds");
  const [admissionSource, setAdmissionSource] = useState("community");
  const [timing, setTiming] = useState("early");
  // Before = as originally documented; After = after the app's documentation help.
  const [beforeFn, setBeforeFn] = useState("low");
  const [beforeCo, setBeforeCo] = useState("none");
  const [afterFn, setAfterFn] = useState("high");
  const [afterCo, setAfterCo] = useState("low");

  const impact = useMemo(() => computeImpact(
    { clinicalGroup, admissionSource, timing, functionalLevel: beforeFn, comorbidityLevel: beforeCo },
    { clinicalGroup, admissionSource, timing, functionalLevel: afterFn, comorbidityLevel: afterCo },
  ), [clinicalGroup, admissionSource, timing, beforeFn, beforeCo, afterFn, afterCo]);

  const delta = impact.complete ? impact.paymentDelta : 0;
  const DeltaIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const deltaTone = delta > 0 ? "text-emerald-600" : delta < 0 ? "text-red-600" : "text-slate-500";

  return (
    <PageContainer>
      <PageHeader
        icon={TrendingUp}
        eyebrow="Administration"
        title="Documentation Impact"
        description="See how stronger documentation moves the PDGM case-mix weight and estimated 30-day reimbursement. For demonstrating the value of better documentation — not billing."
      />

      <Card className="modern-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Period</CardTitle>
          <p className="text-xs text-slate-500">The clinical group, admission source, and timing for the 30-day period.</p>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <LabeledSelect label="Clinical Group" value={clinicalGroup} onChange={setClinicalGroup}
            options={CLINICAL_GROUPS.map((k) => [k, CLINICAL_GROUP_LABELS[k] || k])} />
          <LabeledSelect label="Admission Source" value={admissionSource} onChange={setAdmissionSource} options={ADMISSION} />
          <LabeledSelect label="Timing" value={timing} onChange={setTiming} options={TIMING} />
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="border-slate-200">
          <CardHeader className="pb-2"><CardTitle className="text-base text-slate-700">Before — as originally documented</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LabeledSelect label="Functional Level" value={beforeFn} onChange={setBeforeFn} options={FUNCTIONAL} />
            <LabeledSelect label="Comorbidity Adjustment" value={beforeCo} onChange={setBeforeCo} options={COMORBIDITY} />
          </CardContent>
        </Card>
        <Card className="border-emerald-200 bg-emerald-50/30">
          <CardHeader className="pb-2"><CardTitle className="text-base text-emerald-800">After — with enhanced documentation</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <LabeledSelect label="Functional Level" value={afterFn} onChange={setAfterFn} options={FUNCTIONAL} />
            <LabeledSelect label="Comorbidity Adjustment" value={afterCo} onChange={setAfterCo} options={COMORBIDITY} />
          </CardContent>
        </Card>
      </div>

      {/* Reimbursement figures are ADMIN-ONLY — nurses never see dollars. The page
          is also admin-routed; FinancialGate is defense-in-depth on the money. */}
      <FinancialGate
        fallback={
          <Card className="modern-card">
            <CardContent className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Lock className="w-4 h-4" /> Reimbursement figures are restricted to administrators.
            </CardContent>
          </Card>
        }
      >
        <Card className="modern-card">
          <CardHeader className="pb-2"><CardTitle className="text-base">Estimated 30-day reimbursement impact</CardTitle></CardHeader>
          <CardContent>
            {!impact.complete ? (
              <p className="text-sm text-amber-600">This combination isn’t in the rate table — pick a valid clinical group, level, and comorbidity.</p>
            ) : (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-center">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Before</p>
                    <p className="text-2xl font-bold text-slate-800 mt-1">{money(impact.before.payment)}</p>
                    <p className="text-xs text-slate-500 mt-1">weight {impact.before.caseMixWeight.toFixed(4)}</p>
                  </div>
                  <div className="flex flex-col items-center justify-center">
                    <ArrowRight className="w-5 h-5 text-slate-400 hidden sm:block" />
                    <span className={`mt-1 inline-flex items-center gap-1 text-lg font-bold ${deltaTone}`}>
                      <DeltaIcon className="w-5 h-5" />
                      {delta >= 0 ? "+" : ""}{money(delta).replace("$-", "-$")}
                    </span>
                    {impact.paymentPct !== null && (
                      <span className={`text-xs font-semibold ${deltaTone}`}>{delta >= 0 ? "+" : ""}{impact.paymentPct}%</span>
                    )}
                  </div>
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-center">
                    <p className="text-xs font-semibold text-emerald-600 uppercase tracking-wide">After</p>
                    <p className="text-2xl font-bold text-emerald-800 mt-1">{money(impact.after.payment)}</p>
                    <p className="text-xs text-emerald-600 mt-1">weight {impact.after.caseMixWeight.toFixed(4)}</p>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-4">
                  Illustrative, using CY2026 national default rates ({money(DEFAULT_PDGM_RATES.basePaymentRate)} base, wage index 1.0) and the same
                  case-mix formula as the agency’s PDGM calculation. Agency-specific rates/wage index refine the absolute figures; the documentation-driven
                  <strong> delta</strong> is the point. Not a billing determination.
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </FinancialGate>
    </PageContainer>
  );
}
