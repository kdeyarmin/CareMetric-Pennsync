import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import FinancialGate from "@/components/ui/FinancialGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { TrendingUp, TrendingDown, Minus, Lock, ArrowRight, Database, FileText, ChevronUp, ChevronDown } from "lucide-react";
import { DEFAULT_PDGM_RATES } from "@/components/pdgm/pdgmRates";
import { computeImpact, normalizePdgmDataToScenario } from "@/components/pdgm/reimbursementImpact";

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
  const [seededFrom, setSeededFrom] = useState("");

  // Real analyzed OASIS assessments, via listOASISUploads — which strips financial
  // fields server-side for non-financial users, so estimated_payment is only present
  // for admins. (FinancialGate also hides the rendered figures, defense-in-depth.)
  const { data: uploadsResp = {} } = useQuery({
    queryKey: ["oasis-uploads-impact"],
    queryFn: async () => (await base44.functions.invoke("listOASISUploads", { sort: "-created_date", limit: 200 }))?.data || {},
    initialData: {},
  });
  const uploads = useMemo(() => (Array.isArray(uploadsResp.uploads) ? uploadsResp.uploads : []), [uploadsResp]);

  const analyzed = useMemo(
    () => uploads.filter((u) => Number.isFinite(u?.estimated_payment) && u.estimated_payment > 0),
    [uploads],
  );
  const totalEstimated = useMemo(() => analyzed.reduce((s, u) => s + u.estimated_payment, 0), [analyzed]);
  const avgEstimated = analyzed.length ? totalEstimated / analyzed.length : 0;

  // Records that carry a real "after corrections" figure → a record-driven
  // before→after→uplift across the agency (no modeling required).
  const documented = useMemo(
    () => analyzed.filter((u) => Number.isFinite(u?.optimized_payment) && u.optimized_payment > 0),
    [analyzed],
  );
  const docBefore = useMemo(() => documented.reduce((s, u) => s + u.estimated_payment, 0), [documented]);
  const docAfter = useMemo(() => documented.reduce((s, u) => s + u.optimized_payment, 0), [documented]);
  const docUplift = Math.round((docAfter - docBefore) * 100) / 100;
  const docPct = docBefore ? Math.round((docUplift / docBefore) * 1000) / 10 : null;

  // Per-assessment drill-down rows (sortable).
  const [sortKey, setSortKey] = useState("uplift");
  const [sortDir, setSortDir] = useState("desc");
  const toggleSort = (key) => {
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "patient" || key === "date" ? "asc" : "desc"); }
  };
  const rows = useMemo(() => documented.map((u) => {
    const before = u.estimated_payment;
    const after = u.optimized_payment;
    const uplift = Math.round((after - before) * 100) / 100;
    return { id: u.id, patient: u.patient_name || "Assessment", date: u.assessment_date || "", before, after, uplift, pct: before ? Math.round((uplift / before) * 1000) / 10 : 0 };
  }), [documented]);
  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (sortKey === "patient" || sortKey === "date") {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  // Assessments whose pdgm_data can seed a "before" scenario.
  const seedable = useMemo(
    () => uploads.filter((u) => u?.pdgm_data && Object.keys(normalizePdgmDataToScenario(u.pdgm_data)).length > 0),
    [uploads],
  );

  const loadFromAssessment = (id) => {
    setSeededFrom(id);
    const u = uploads.find((x) => x.id === id);
    const s = normalizePdgmDataToScenario(u?.pdgm_data);
    if (s.clinicalGroup) setClinicalGroup(s.clinicalGroup);
    if (s.admissionSource) setAdmissionSource(s.admissionSource);
    if (s.timing) setTiming(s.timing);
    if (s.functionalLevel) setBeforeFn(s.functionalLevel);
    if (s.comorbidityLevel) setBeforeCo(s.comorbidityLevel);
  };

  const impact = useMemo(() => computeImpact(
    { clinicalGroup, admissionSource, timing, functionalLevel: beforeFn, comorbidityLevel: beforeCo },
    { clinicalGroup, admissionSource, timing, functionalLevel: afterFn, comorbidityLevel: afterCo },
  ), [clinicalGroup, admissionSource, timing, beforeFn, beforeCo, afterFn, afterCo]);

  const SortHead = ({ k, children, className = "" }) => (
    <TableHead className={`cursor-pointer select-none ${className}`} onClick={() => toggleSort(k)} aria-sort={sortKey === k ? (sortDir === "asc" ? "ascending" : "descending") : "none"}>
      <span className="inline-flex items-center gap-1">
        {children}
        {sortKey === k && (sortDir === "asc" ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </span>
    </TableHead>
  );

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

      {/* Real analyzed assessments — admin-only aggregate. */}
      <FinancialGate>
        <Card className="modern-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-4 h-4 text-indigo-600" /> Across your analyzed OASIS assessments
            </CardTitle>
          </CardHeader>
          <CardContent>
            {analyzed.length === 0 ? (
              <p className="text-sm text-slate-500">No analyzed OASIS assessments with an estimated payment yet. As OASIS assessments are analyzed, their estimated PDGM reimbursement appears here.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Assessments</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{analyzed.length}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Total estimated reimbursement</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{money(totalEstimated)}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Average per assessment</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{money(avgEstimated)}</p>
                </div>
              </div>
            )}
            {documented.length > 0 && (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/40 p-4">
                <p className="text-sm font-semibold text-emerald-800">Documented impact of stronger documentation</p>
                <p className="text-xs text-slate-500 mb-3">{documented.length} assessment{documented.length === 1 ? "" : "s"} where the analyzer captured an after-corrections figure.</p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="text-sm text-slate-600">Before <strong className="text-slate-800">{money(docBefore)}</strong></span>
                  <ArrowRight className="w-4 h-4 text-slate-400" />
                  <span className="text-sm text-slate-600">After <strong className="text-emerald-800">{money(docAfter)}</strong></span>
                  <span className="inline-flex items-center gap-1 text-base font-bold text-emerald-600">
                    <TrendingUp className="w-4 h-4" /> +{money(docUplift)}{docPct !== null ? ` (+${docPct}%)` : ""}
                  </span>
                </div>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-3">Estimated PDGM payment captured at analysis time. Visible to administrators only.</p>
          </CardContent>
        </Card>
      </FinancialGate>

      {/* Per-assessment drill-down — admin-only, sortable. */}
      {documented.length > 0 && (
        <FinancialGate>
          <Card className="modern-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Per-assessment impact</CardTitle>
              <p className="text-xs text-slate-500">Each analyzed assessment with an after-corrections figure. Click a column to sort.</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead k="patient">Assessment</SortHead>
                    <SortHead k="date">Date</SortHead>
                    <SortHead k="before" className="text-right">Before</SortHead>
                    <SortHead k="after" className="text-right">After</SortHead>
                    <SortHead k="uplift" className="text-right">Uplift</SortHead>
                    <SortHead k="pct" className="text-right">%</SortHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedRows.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-slate-800">{r.patient}</TableCell>
                      <TableCell className="text-slate-500">{r.date || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">{money(r.before)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-800">{money(r.after)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${r.uplift > 0 ? "text-emerald-600" : r.uplift < 0 ? "text-red-600" : "text-slate-500"}`}>
                        {r.uplift > 0 ? "+" : ""}{money(r.uplift).replace("$-", "-$")}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${r.uplift > 0 ? "text-emerald-600" : r.uplift < 0 ? "text-red-600" : "text-slate-500"}`}>
                        {r.uplift > 0 ? "+" : ""}{r.pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </FinancialGate>
      )}

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
          <CardContent className="space-y-4">
            {seedable.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1.5">
                  <FileText className="w-3.5 h-3.5 text-slate-400" /> Pre-fill from a real assessment (optional)
                </span>
                <Select value={seededFrom} onValueChange={loadFromAssessment}>
                  <SelectTrigger className="h-10 text-sm"><SelectValue placeholder="Choose an analyzed assessment…" /></SelectTrigger>
                  <SelectContent>
                    {seedable.slice(0, 50).map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {(u.patient_name || "Assessment")}{u.assessment_date ? ` · ${u.assessment_date}` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {seededFrom && <p className="text-xs text-amber-600 mt-1">Pre-filled from the selected assessment — review and adjust before reading the impact.</p>}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <LabeledSelect label="Functional Level" value={beforeFn} onChange={setBeforeFn} options={FUNCTIONAL} />
              <LabeledSelect label="Comorbidity Adjustment" value={beforeCo} onChange={setBeforeCo} options={COMORBIDITY} />
            </div>
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
