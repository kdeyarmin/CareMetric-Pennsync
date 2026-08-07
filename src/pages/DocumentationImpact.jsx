import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import FinancialGate from "@/components/ui/FinancialGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableHead, TableRow, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TrendingUp, TrendingDown, Minus, Lock, ArrowRight, Database, FileText, ChevronUp, ChevronDown, Download, Trophy } from "lucide-react";
import { format } from "date-fns";
import { mergePdgmRates } from "@/components/pdgm/pdgmRates";
import { computeImpact, normalizePdgmDataToScenario } from "@/components/pdgm/reimbursementImpact";
import { reconcileScenario, storedWeightTableRows } from "@/components/pdgm/caseMixReconciliation";
import { toCsv, exportTimestamp } from "@/components/admin/csvExport";
import { downloadCsv } from "@/lib/downloadCsv";
import { toast } from "sonner";

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
const ADMISSION = [["community", "Community"], ["institutional", "Institutional"]];
const TIMING = [["early", "Early (first 30-day period)"], ["late", "Late (subsequent periods)"]];
const FUNCTIONAL = [["low", "Low impairment"], ["medium", "Medium impairment"], ["high", "High impairment"]];
const COMORBIDITY = [["none", "None"], ["low", "Low adjustment"], ["high", "High adjustment"]];

const money = (n) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// Text columns default to ascending (A→Z); money/percent columns to descending
// (biggest first), matching what an admin scanning impact expects.
const TEXT_SORT_KEYS = new Set(["patient", "nurse", "date"]);
// A signed-money chip (handles negative uplift: "-$500.00" with the right
// tone/icon instead of a green "+$-500.00").
const signedMoney = (n) => (n < 0 ? `-${money(Math.abs(n))}` : `+${money(n)}`);
const upliftTone = (n) => (n > 0 ? "text-emerald-600" : n < 0 ? "text-red-600" : "text-slate-500");

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

  // The agency's saved PDGM rate set — the SAME PDGMRateConfig the backend
  // calculatePDGM merges over its defaults — so the simulator shows the same
  // "before" dollars as the OASIS analyzer instead of national defaults.
  // (Readable by all authenticated users; write is service-role only.)
  const { data: rateConfig = null } = useQuery({
    queryKey: ["pdgm-rate-config"],
    queryFn: async () => {
      const me = await base44.auth.me().catch(() => null);
      const { fetchCallerPdgmRateConfig } = await import("@/lib/agencySettings");
      return fetchCallerPdgmRateConfig(me?.agency_name);
    },
    initialData: null,
  });
  // Agency wage index (calculatePDGM applies AgencySettings.wage_index the same way).
  const { data: agencySettings = null } = useQuery({
    queryKey: ["agencySettings"],
    queryFn: async () => {
      const me = await base44.auth.me().catch(() => null);
      const { fetchCallerAgencySettings } = await import("@/lib/agencySettings");
      return fetchCallerAgencySettings(me?.agency_name);
    },
  });
  const effectiveRates = useMemo(() => mergePdgmRates(rateConfig?.rates), [rateConfig]);
  const wageIndex = Number.isFinite(agencySettings?.wage_index) ? agencySettings.wage_index : 1.0;
  const clinicalGroupOptions = useMemo(
    () => Object.keys(effectiveRates.clinicalGroupWeights || {}),
    [effectiveRates],
  );

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
  // Segment the impact by who documented it (created_by) and/or clinical group.
  const [nurseFilter, setNurseFilter] = useState("all");
  const [groupFilter, setGroupFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const recNurse = (u) => u?.created_by || u?.completed_by || "Unknown";
  const recGroup = (u) => normalizePdgmDataToScenario(u?.pdgm_data).clinicalGroup || "";

  const nurseOptions = useMemo(
    () => Array.from(new Set(analyzed.map(recNurse))).filter(Boolean).sort(),
    [analyzed],
  );
  const groupOptions = useMemo(
    () => Array.from(new Set(analyzed.map(recGroup))).filter(Boolean).sort(),
    [analyzed],
  );

  const recDate = (u) => u?.assessment_date || "";
  const filteredAnalyzed = useMemo(
    () => analyzed.filter((u) =>
      (nurseFilter === "all" || recNurse(u) === nurseFilter) &&
      (groupFilter === "all" || recGroup(u) === groupFilter) &&
      (!dateFrom || (recDate(u) && recDate(u) >= dateFrom)) &&
      (!dateTo || (recDate(u) && recDate(u) <= dateTo))),
    [analyzed, nurseFilter, groupFilter, dateFrom, dateTo],
  );

  const totalEstimated = useMemo(() => filteredAnalyzed.reduce((s, u) => s + u.estimated_payment, 0), [filteredAnalyzed]);
  const avgEstimated = filteredAnalyzed.length ? totalEstimated / filteredAnalyzed.length : 0;

  // Records that carry a real "after corrections" figure → a record-driven
  // before→after→uplift (respecting the active nurse/group filter).
  const documented = useMemo(
    () => filteredAnalyzed.filter((u) => Number.isFinite(u?.optimized_payment) && u.optimized_payment > 0),
    [filteredAnalyzed],
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
    else { setSortKey(key); setSortDir(TEXT_SORT_KEYS.has(key) ? "asc" : "desc"); }
  };
  const rows = useMemo(() => documented.map((u) => {
    const before = u.estimated_payment;
    const after = u.optimized_payment;
    const uplift = Math.round((after - before) * 100) / 100;
    return { id: u.id, patient: u.patient_name || "Assessment", nurse: recNurse(u), date: u.assessment_date || "", before, after, uplift, pct: before ? Math.round((uplift / before) * 1000) / 10 : 0 };
  }), [documented]);
  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const av = a[sortKey]; const bv = b[sortKey];
      if (TEXT_SORT_KEYS.has(sortKey)) {
        return sortDir === "asc" ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
      }
      return sortDir === "asc" ? av - bv : bv - av;
    });
    return arr;
  }, [rows, sortKey, sortDir]);

  // Per-nurse leaderboard — total documented uplift per clinician, ranked.
  const byNurse = useMemo(() => {
    const m = new Map();
    for (const u of documented) {
      const n = recNurse(u);
      const e = m.get(n) || { nurse: n, count: 0, before: 0, after: 0 };
      e.count += 1; e.before += u.estimated_payment; e.after += u.optimized_payment;
      m.set(n, e);
    }
    return Array.from(m.values()).map((e) => {
      const before = Math.round(e.before * 100) / 100;
      const after = Math.round(e.after * 100) / 100;
      const uplift = Math.round((after - before) * 100) / 100;
      return { ...e, before, after, uplift, pct: before ? Math.round((uplift / before) * 1000) / 10 : 0 };
    }).sort((a, b) => b.uplift - a.uplift);
  }, [documented]);

  const exportCsv = () => {
    const columns = [
      { key: "patient", label: "Assessment" },
      { key: "nurse", label: "Nurse" },
      { key: "date", label: "Date" },
      { key: "before", label: "Before" },
      { key: "after", label: "After" },
      { key: "uplift", label: "Uplift" },
      { key: "pct", label: "Uplift %" },
    ];
    downloadCsv(`documentation-impact_${exportTimestamp()}.csv`, toCsv(columns, sortedRows), {
      onError: () => toast.error("Couldn't generate the export"),
    });
  };

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
    effectiveRates,
    wageIndex,
  ), [clinicalGroup, admissionSource, timing, beforeFn, beforeCo, afterFn, afterCo, effectiveRates, wageIndex]);

  // Which rate set is in effect (shown on the estimate card so an admin can tell
  // agency-saved numbers from the built-in national defaults at a glance).
  const savedDate = rateConfig?.updated_date ? format(new Date(rateConfig.updated_date), "MMM d, yyyy") : null;
  const rateBasisLabel = rateConfig
    ? `Agency ${rateConfig.is_official ? "official CMS rates" : "saved rates — estimate"}${savedDate ? ` (saved ${savedDate})` : ""}`
    : "National defaults (CY2026)";

  // Admin-only HIPPS reconciliation against the stored official CMS case-mix
  // weight table (uploaded on PDGM Rate Settings). Reference display ONLY — it
  // never produces a second dollar figure (see pdgmGrouper.js header) and LUPA
  // thresholds are informational (no visit counting, no alerts).
  const storedWeightTable = rateConfig?.case_mix_weight_table || null;
  const reconciliation = useMemo(() => {
    if (!storedWeightTableRows(storedWeightTable)) return null;
    const period = { clinicalGroup, admissionSource, timing };
    return {
      before: reconcileScenario({ ...period, functionalLevel: beforeFn, comorbidityLevel: beforeCo }, storedWeightTable),
      after: reconcileScenario({ ...period, functionalLevel: afterFn, comorbidityLevel: afterCo }, storedWeightTable),
    };
  }, [storedWeightTable, clinicalGroup, admissionSource, timing, beforeFn, beforeCo, afterFn, afterCo]);

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
            {/* Drill down by who documented it, or by clinical group. */}
            {analyzed.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                <LabeledSelect label="Nurse / clinician" value={nurseFilter} onChange={setNurseFilter}
                  options={[["all", `All clinicians (${nurseOptions.length})`], ...nurseOptions.map((n) => [n, n])]} />
                <LabeledSelect label="Clinical group" value={groupFilter} onChange={setGroupFilter}
                  options={[["all", "All clinical groups"], ...groupOptions.map((g) => [g, CLINICAL_GROUP_LABELS[g] || g])]} />
                <div>
                  <label htmlFor="impact-from" className="text-xs font-semibold text-slate-700 mb-1.5 block">From date</label>
                  <Input id="impact-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={(e) => setDateFrom(e.target.value)} className="h-10 text-sm" />
                </div>
                <div>
                  <label htmlFor="impact-to" className="text-xs font-semibold text-slate-700 mb-1.5 block">To date</label>
                  <Input id="impact-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={(e) => setDateTo(e.target.value)} className="h-10 text-sm" />
                </div>
              </div>
            )}
            {analyzed.length === 0 ? (
              <p className="text-sm text-slate-500">No analyzed OASIS assessments with an estimated payment yet. As OASIS assessments are analyzed, their estimated PDGM reimbursement appears here.</p>
            ) : filteredAnalyzed.length === 0 ? (
              <p className="text-sm text-slate-500">No analyzed assessments match this filter.</p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Assessments</p>
                  <p className="text-2xl font-bold text-slate-800 mt-1">{filteredAnalyzed.length}</p>
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
                  {(() => {
                    const DocIcon = docUplift > 0 ? TrendingUp : docUplift < 0 ? TrendingDown : Minus;
                    return (
                      <span className={`inline-flex items-center gap-1 text-base font-bold ${upliftTone(docUplift)}`}>
                        <DocIcon className="w-4 h-4" /> {signedMoney(docUplift)}{docPct !== null ? ` (${docPct >= 0 ? "+" : ""}${docPct}%)` : ""}
                      </span>
                    );
                  })()}
                </div>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-3">Estimated PDGM payment captured at analysis time. Visible to administrators only.</p>
          </CardContent>
        </Card>
      </FinancialGate>

      {/* Per-nurse leaderboard — admin-only, ranked by uplift. */}
      {byNurse.length > 1 && (
        <FinancialGate>
          <Card className="modern-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Trophy className="w-4 h-4 text-gold-500" /> Impact by nurse
              </CardTitle>
              <p className="text-xs text-slate-500">Total documented uplift per clinician, ranked.</p>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8">#</TableHead>
                    <TableHead>Nurse</TableHead>
                    <TableHead className="text-right">Assessments</TableHead>
                    <TableHead className="text-right">Before</TableHead>
                    <TableHead className="text-right">After</TableHead>
                    <TableHead className="text-right">Uplift</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {byNurse.map((n, i) => (
                    <TableRow key={n.nurse}>
                      <TableCell className="text-slate-400 tabular-nums">{i + 1}</TableCell>
                      <TableCell className="font-medium text-slate-800 max-w-[220px] truncate" title={n.nurse}>{n.nurse}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-600">{n.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-slate-700">{money(n.before)}</TableCell>
                      <TableCell className="text-right tabular-nums text-emerald-800">{money(n.after)}</TableCell>
                      <TableCell className={`text-right tabular-nums font-semibold ${n.uplift > 0 ? "text-emerald-600" : n.uplift < 0 ? "text-red-600" : "text-slate-500"}`}>
                        {n.uplift > 0 ? "+" : ""}{money(n.uplift).replace("$-", "-$")}
                      </TableCell>
                      <TableCell className={`text-right tabular-nums ${n.uplift > 0 ? "text-emerald-600" : n.uplift < 0 ? "text-red-600" : "text-slate-500"}`}>
                        {n.uplift > 0 ? "+" : ""}{n.pct}%
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </FinancialGate>
      )}

      {/* Per-assessment drill-down — admin-only, sortable. */}
      {documented.length > 0 && (
        <FinancialGate>
          <Card className="modern-card">
            <CardHeader className="pb-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-base">Per-assessment impact</CardTitle>
                  <p className="text-xs text-slate-500">Each analyzed assessment with an after-corrections figure. Click a column to sort.</p>
                </div>
                <Button variant="outline" size="sm" onClick={exportCsv} className="gap-2 shrink-0">
                  <Download className="w-4 h-4" /> Export CSV
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortHead k="patient">Assessment</SortHead>
                    <SortHead k="nurse">Nurse</SortHead>
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
                      <TableCell className="text-slate-500 max-w-[180px] truncate" title={r.nurse}>{r.nurse}</TableCell>
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
            options={clinicalGroupOptions.map((k) => [k, CLINICAL_GROUP_LABELS[k] || k])} />
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
                <Select value={seededFrom || undefined} onValueChange={loadFromAssessment}>
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
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Estimated 30-day reimbursement impact</CardTitle>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
                  rateConfig ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"
                }`}
              >
                Rates in effect: {rateBasisLabel}
              </span>
            </div>
          </CardHeader>
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
                  Uses {rateConfig
                    ? `the agency's ${rateConfig.is_official ? "official CMS rates" : "saved rates (still an estimate until marked official)"}`
                    : "CY2026 national default rates"} — {money(effectiveRates.basePaymentRate)} base, wage index {wageIndex} — merged and applied with the
                  same case-mix formula as the agency’s PDGM calculation, so the “before” dollars match the OASIS analyzer. The documentation-driven
                  <strong> delta</strong> is the point. Not a billing determination.
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {/* HIPPS reconciliation preview — shown only once an admin has stored the
            official CMS case-mix weight table (PDGM Rate Settings). Reference
            display beside the engine estimate above; NEVER a second dollar figure. */}
        {reconciliation && (
          <Card className="modern-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="w-4 h-4 text-indigo-600" /> HIPPS reference — official CMS case-mix table
              </CardTitle>
              <p className="text-xs text-slate-500">
                Looked up in the stored CMS weight table
                {storedWeightTable.payment_year ? ` (CY${storedWeightTable.payment_year})` : ""} for this scenario.
                Reference only — the payment estimate above remains from the PDGM engine.
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[["Before", reconciliation.before], ["After", reconciliation.after]].map(([label, r]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">{label}</p>
                    {r.available ? (
                      <dl className="mt-2 space-y-1 text-sm">
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500">HIPPS code</dt>
                          <dd className="font-mono font-semibold text-slate-800">{r.hipps || "not in table"}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500">Case-mix weight</dt>
                          <dd className="tabular-nums font-semibold text-slate-800">{r.weight.toFixed(4)}</dd>
                        </div>
                        <div className="flex justify-between gap-2">
                          <dt className="text-slate-500">LUPA threshold</dt>
                          <dd className="tabular-nums text-slate-700">
                            {r.lupaThreshold != null ? `${r.lupaThreshold} visits (informational)` : "not in table"}
                          </dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-sm text-amber-600 mt-2">Not available — {r.reason}. Nothing is guessed.</p>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-xs text-slate-400 mt-3">
                Reference table for analysis — payment estimates remain from the PDGM engine. LUPA thresholds are
                informational display only: this companion app does not count visits and raises no LUPA alerts. If a
                reference weight disagrees with the engine’s weight above, reconcile the rate tables in PDGM Rate
                Settings rather than quoting two figures.
              </p>
            </CardContent>
          </Card>
        )}
      </FinancialGate>
    </PageContainer>
  );
}
