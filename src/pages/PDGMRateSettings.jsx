import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isAdminLike } from "@/lib/superAdmin";
import { DEFAULT_PDGM_RATES, mergePdgmRates, DEFAULT_ICD10_CLINICAL_GROUPS, effectiveIcdGroups } from "@/components/pdgm/pdgmRates";
import { validateRateNumbers, validateIcdMappings } from "@/components/pdgm/rateSettingsValidation";
import CaseMixWeightsUpload from "@/components/pdgm/CaseMixWeightsUpload";
import WageIndexUpload from "@/components/pdgm/WageIndexUpload";
import PayerRatesManager from "@/components/pdgm/PayerRatesManager";
import PDGMCalculationPreview from "@/components/pdgm/PDGMCalculationPreview";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useConfirm } from "@/components/ui/confirm-dialog";
import AccessDeniedState from "@/components/ui/AccessDeniedState";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import { PieChart, Save, RotateCcw, Info, ShieldCheck, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

// Stable per-row key (not persisted — rowsToMap reads only prefix/group) so
// removing a middle ICD row doesn't shift focus/value by index.
let icdRowKeySeq = 0;
const freshIcdKey = () => `icd-${icdRowKeySeq++}`;
const mapToRows = (obj) => Object.entries(obj || {}).map(([prefix, group]) => ({ _key: freshIcdKey(), prefix, group }));
const rowsToMap = (rows) =>
  (rows || []).reduce((acc, r) => {
    const p = String(r.prefix || "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();
    if (p && r.group) acc[p] = r.group;
    return acc;
  }, {});

// The four editable 2-level rate tables (everything except the single base rate).
const TABLES = [
  { key: "clinicalGroupWeights", title: "Clinical-group case-mix weights", help: "Weight per clinical group × admission source / episode timing." },
  { key: "functionalThresholds", title: "Functional-impairment thresholds", help: "Point cutoffs: Low ≤ low; Medium < high; otherwise High." },
  { key: "functionalMultipliers", title: "Functional-level multipliers", help: "Payment multiplier for each functional level." },
  { key: "comorbidityMultipliers", title: "Comorbidity multipliers", help: "Payment multiplier for each comorbidity adjustment level." },
];

const prettify = (k) =>
  String(k).replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

const INITIAL_META = { label: "", effective_year: "", is_official: false, notes: "" };

// Canonical serialization of everything the Save button persists, used for the
// dirty-state guard. Row _keys are editor-local and excluded so re-keying a row
// doesn't read as an edit.
const snapshotOf = (form, icdRows, meta) =>
  JSON.stringify({ form, icd: (icdRows || []).map(({ prefix, group }) => ({ prefix, group })), meta });

// Convert a rates object's numbers → strings for free-text editing.
const ratesToForm = (rates) => {
  const out = { basePaymentRate: String(rates.basePaymentRate ?? "") };
  for (const { key } of TABLES) {
    out[key] = {};
    for (const row of Object.keys(rates[key] || {})) {
      out[key][row] = {};
      for (const col of Object.keys(rates[key][row] || {})) {
        out[key][row][col] = String(rates[key][row][col]);
      }
    }
  }
  return out;
};

// Convert the string form → a rates object of finite numbers (blanks dropped, so
// they fall back to the built-in default on the server via mergePdgmRates).
const formToRates = (form) => {
  const num = (s) => {
    const n = Number(s);
    return Number.isFinite(n) ? n : undefined;
  };
  const out = {};
  if (num(form.basePaymentRate) !== undefined) out.basePaymentRate = num(form.basePaymentRate);
  for (const { key } of TABLES) {
    out[key] = {};
    for (const row of Object.keys(form[key] || {})) {
      out[key][row] = {};
      for (const col of Object.keys(form[key][row] || {})) {
        const v = num(form[key][row][col]);
        if (v !== undefined) out[key][row][col] = v;
      }
    }
  }
  return out;
};

function RateTable({ title, help, table, onCell }) {
  const rows = Object.keys(table || {});
  const cols = rows.length ? Object.keys(table[rows[0]]) : [];
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-slate-500">{help}</p>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead> </TableHead>
              {cols.map((c) => (
                <TableHead key={c}>{prettify(c)}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row}>
                <TableCell className="text-xs font-semibold text-slate-700 px-2 py-1.5">{prettify(row)}</TableCell>
                {cols.map((col) => (
                  <TableCell key={col} className="px-1 py-1.5">
                    <Input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      aria-label={`${prettify(row)} ${prettify(col)}`}
                      value={table[row][col]}
                      onChange={(e) => onCell(row, col, e.target.value)}
                      className="h-9 w-28 text-sm"
                    />
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function PDGMRateSettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = isAdminLike(user);

  const { data: config, isLoading, isFetching: configFetching, isError: configError } = useQuery({
    queryKey: ["pdgm-rate-config", user?.agency_name || null],
    queryFn: async () => {
      const { fetchCallerPdgmRateConfig } = await import("@/lib/agencySettings");
      return fetchCallerPdgmRateConfig(user?.agency_name);
    },
    enabled: canEdit,
    initialData: null,
  });

  const [form, setForm] = useState(() => ratesToForm(DEFAULT_PDGM_RATES));
  const [meta, setMeta] = useState(INITIAL_META);
  const [icdRows, setIcdRows] = useState(() => mapToRows(DEFAULT_ICD10_CLINICAL_GROUPS));
  // Snapshot of the last SAVED (or freshly seeded) editor state, for the
  // unsaved-edits guard. Starts as the defaults the editor initializes with.
  const [savedSnapshot, setSavedSnapshot] = useState(() =>
    snapshotOf(ratesToForm(DEFAULT_PDGM_RATES), mapToRows(DEFAULT_ICD10_CLINICAL_GROUPS), INITIAL_META));

  // Seed the editor from the saved config (merged over defaults) once it loads.
  useEffect(() => {
    if (config) {
      const seededForm = ratesToForm(mergePdgmRates(config.rates));
      const seededRows = mapToRows(effectiveIcdGroups(config.icd10_clinical_groups));
      const seededMeta = {
        label: config.label || "",
        effective_year: config.effective_year || "",
        is_official: config.is_official === true,
        notes: config.notes || "",
      };
      setForm(seededForm);
      setIcdRows(seededRows);
      setMeta(seededMeta);
      setSavedSnapshot(snapshotOf(seededForm, seededRows, seededMeta));
    }
  }, [config]);

  const isDirty = useMemo(
    () => snapshotOf(form, icdRows, meta) !== savedSnapshot,
    [form, icdRows, meta, savedSnapshot],
  );

  // Dirty-state guard: warn before a refresh/close discards unsaved rate edits.
  // The app mounts a plain <BrowserRouter> (no data router), so react-router's
  // useBlocker isn't available for in-app navigation — beforeunload plus the
  // visible "Unsaved changes" indicator in the save bar is the guard.
  useEffect(() => {
    if (!isDirty) return undefined;
    const warn = (e) => {
      e.preventDefault();
      e.returnValue = ""; // required by Chrome to show the prompt
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [isDirty]);

  const groupOptions = useMemo(() => Object.keys(form.clinicalGroupWeights || {}), [form.clinicalGroupWeights]);
  const updateIcdRow = (i, patch) => setIcdRows((rows) => rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const removeIcdRow = (i) => setIcdRows((rows) => rows.filter((_, idx) => idx !== i));
  const addIcdRow = () => setIcdRows((rows) => [...rows, { _key: freshIcdKey(), prefix: "", group: groupOptions[0] || "" }]);

  const setCell = (section, row, col, value) =>
    setForm((f) => ({
      ...f,
      [section]: { ...f[section], [row]: { ...f[section][row], [col]: value } },
    }));

  // Plausibility rails, recomputed live: implausible rate cells and broken ICD
  // mappings (colliding prefixes / weightless groups) block Save with a specific
  // message; benign duplicates surface as warnings only.
  const rateErrors = useMemo(() => validateRateNumbers(formToRates(form)), [form]);
  const icdIssues = useMemo(() => validateIcdMappings(icdRows, groupOptions), [icdRows, groupOptions]);
  const blockingErrors = useMemo(() => [...rateErrors, ...icdIssues.errors], [rateErrors, icdIssues]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      // PDGMRateConfig is service-role-write only, so writes go through the
      // savePDGMRateConfig function, which gates on isAdminLike (so an account_type
      // admin / the owner — whose `role` may not be literally 'admin' — can still
      // save) and stamps updated_by_email from the authenticated caller.
      // case_mix_weight_table is deliberately omitted: the function preserves the
      // stored reference table unless the field is explicitly sent (see the
      // dedicated upload card below).
      const payload = {
        ...meta,
        rates: formToRates(form),
        icd10_clinical_groups: rowsToMap(icdRows),
      };
      return base44.functions.invoke("savePDGMRateConfig", payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pdgm-rate-config"] });
      setSavedSnapshot(snapshotOf(form, icdRows, meta));
      toast.success("PDGM rates saved. New estimates use these numbers.");
    },
    onError: (err) => {
      console.error("Failed to save PDGM rates:", err);
      toast.error("Could not save PDGM rates. Please try again.");
    },
  });

  const confirm = useConfirm();
  const handleSave = async () => {
    if (blockingErrors.length > 0) {
      // Defense in depth — the Save button is disabled while errors exist.
      toast.error(blockingErrors[0]);
      return;
    }
    // Guard official rates: overwriting a config an admin flagged as official CMS
    // numbers is deliberate, so show who last edited it and require confirmation.
    if (config?.is_official) {
      const editor = config.updated_by_email || "an unknown editor";
      const when = config.updated_date
        ? ` on ${format(new Date(config.updated_date), "MMM d, yyyy 'at' h:mm a")}`
        : "";
      const ok = await confirm({
        title: "Overwrite official CMS rates?",
        description: `The saved rate set is marked as OFFICIAL CMS rates — last edited by ${editor}${when}. Saving replaces it and applies to every PDGM payment estimate immediately.`,
        confirmText: "Overwrite official rates",
        destructive: true,
      });
      if (!ok) return;
    }
    saveMutation.mutate();
  };

  // Persist ONLY the reference weight table, re-sending the SAVED config fields
  // (never the in-progress form) so an upload can't silently commit unsaved rate
  // edits. The upload card is disabled while the editor is dirty for the same
  // reason (a save here refetches + reseeds the editor from the saved config).
  // Persist ONLY the CBSA wage-index table, re-sending the SAVED config fields
  // (same rationale as weightTableMutation; savePDGMRateConfig preserves the
  // case-mix table when the field is omitted).
  const wageIndexTableMutation = useMutation({
    mutationFn: async (tableOrNull) => {
      const payload = {
        label: config?.label ?? "",
        effective_year: config?.effective_year ?? "",
        is_official: config?.is_official === true,
        notes: config?.notes ?? "",
        rates: config?.rates ?? {},
        icd10_clinical_groups: config?.icd10_clinical_groups ?? {},
        wage_index_table: tableOrNull,
      };
      return base44.functions.invoke("savePDGMRateConfig", payload);
    },
    onSuccess: (_res, tableOrNull) => {
      queryClient.invalidateQueries({ queryKey: ["pdgm-rate-config"] });
      toast.success(tableOrNull
        ? "CBSA wage-index table stored — referral estimates now wage-adjust by the patient's address."
        : "Stored CBSA wage-index table removed.");
    },
    onError: (err) => {
      console.error("Failed to store the wage-index table:", err);
      toast.error("Could not store the wage-index table. Please try again.");
    },
  });

  const weightTableMutation = useMutation({
    mutationFn: async (tableOrNull) => {
      const payload = {
        label: config?.label ?? "",
        effective_year: config?.effective_year ?? "",
        is_official: config?.is_official === true,
        notes: config?.notes ?? "",
        rates: config?.rates ?? {},
        icd10_clinical_groups: config?.icd10_clinical_groups ?? {},
        case_mix_weight_table: tableOrNull,
      };
      return base44.functions.invoke("savePDGMRateConfig", payload);
    },
    onSuccess: (_res, tableOrNull) => {
      queryClient.invalidateQueries({ queryKey: ["pdgm-rate-config"] });
      toast.success(tableOrNull
        ? "CMS case-mix weight table stored — reference for analysis only; payment estimates remain from the PDGM engine."
        : "Stored CMS case-mix weight table removed.");
    },
    onError: (err) => {
      console.error("Failed to store the case-mix weight table:", err);
      toast.error("Could not store the case-mix weight table. Please try again.");
    },
  });

  const resetToDefaults = () => {
    setForm(ratesToForm(DEFAULT_PDGM_RATES));
    setIcdRows(mapToRows(DEFAULT_ICD10_CLINICAL_GROUPS));
    setMeta((m) => ({ ...m, is_official: false }));
    toast.message("Reset to built-in defaults (not yet saved).");
  };

  const effectivePreview = useMemo(() => formToRates(form), [form]);

  if (!canEdit) {
    return <AccessDeniedState description="PDGM rate settings are restricted to administrators." />;
  }

  return (
    <PageContainer>
      <PageHeader
        icon={PieChart}
        eyebrow="Configuration"
        title="PDGM Rate Settings"
        description="Enter and update your case-mix weights, base rate, and multipliers. Saved numbers are applied to every PDGM payment estimate immediately."
      />

      <Alert className={meta.is_official ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}>
        {meta.is_official ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : <Info className="h-4 w-4 text-amber-600" />}
        <AlertDescription className="text-sm">
          {meta.is_official
            ? "Marked as official CMS rates — PDGM results are treated as authoritative (not labeled an estimate)."
            : "These weights are treated as an ESTIMATE until you enter your official CMS numbers and toggle “Official CMS rates” below. They are not billable amounts."}
        </AlertDescription>
      </Alert>

      {isLoading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          {/* Metadata + base rate */}
          <Card>
            <CardHeader><CardTitle className="text-base">Rate set</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="rate-label">Label</Label>
                <Input id="rate-label" value={meta.label} placeholder="e.g. CY2025 Official CMS"
                  onChange={(e) => setMeta({ ...meta, label: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="rate-year">Effective rate year</Label>
                <Input id="rate-year" value={meta.effective_year} placeholder="e.g. 2025"
                  onChange={(e) => setMeta({ ...meta, effective_year: e.target.value })} className="mt-1" />
              </div>
              <div>
                <Label htmlFor="base-rate">Base 30-day payment rate ($)</Label>
                <Input id="base-rate" type="number" step="any" inputMode="decimal" value={form.basePaymentRate}
                  onChange={(e) => setForm({ ...form, basePaymentRate: e.target.value })} className="mt-1 w-40" />
              </div>
              <div className="flex items-center gap-3 pt-6">
                <Switch id="is-official" checked={meta.is_official}
                  onCheckedChange={(v) => setMeta({ ...meta, is_official: v })} />
                <Label htmlFor="is-official" className="cursor-pointer">These are official CMS rates</Label>
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="rate-notes">Notes</Label>
                <Textarea id="rate-notes" value={meta.notes} rows={2}
                  placeholder="Source of the numbers, who verified them, etc."
                  onChange={(e) => setMeta({ ...meta, notes: e.target.value })} className="mt-1" />
              </div>
            </CardContent>
          </Card>

          {TABLES.map(({ key, title, help }) => (
            <RateTable
              key={key}
              title={title}
              help={help}
              table={form[key]}
              onCell={(row, col, value) => setCell(key, row, col, value)}
            />
          ))}

          {/* ICD-10 → clinical group mapping */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ICD-10 → clinical group</CardTitle>
              <p className="text-xs text-slate-500">
                How a principal diagnosis is assigned to a clinical group. Enter an ICD-10
                prefix (e.g. <code>I50</code>, or just the chapter letter <code>J</code>); the
                longest matching prefix wins. Add, edit, or remove rows freely. (Note: chapter
                <code> S</code> is Injury, not skin — skin is chapter <code>L</code>.)
              </p>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {icdRows.map((row, i) => (
                  <div key={row._key ?? i} className="flex items-center gap-2">
                    <Input
                      aria-label={`ICD prefix ${i + 1}`}
                      value={row.prefix}
                      placeholder="ICD-10 prefix"
                      onChange={(e) => updateIcdRow(i, { prefix: e.target.value.toUpperCase() })}
                      className="h-8 w-32 text-sm font-mono"
                    />
                    <span className="text-slate-400">→</span>
                    <Select value={row.group} onValueChange={(v) => updateIcdRow(i, { group: v })}>
                      <SelectTrigger className="h-8 w-72 text-sm" aria-label={`Clinical group ${i + 1}`}>
                        <SelectValue placeholder="Select clinical group" />
                      </SelectTrigger>
                      <SelectContent>
                        {/* Keep the current value selectable even if it's not a weighted group. */}
                        {(groupOptions.includes(row.group) ? groupOptions : [row.group, ...groupOptions].filter(Boolean))
                          .map((g) => (
                            <SelectItem key={g} value={g}>{prettify(g)}</SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" size="sm" aria-label={`Remove row ${i + 1}`} onClick={() => removeIcdRow(i)}>
                      <Trash2 className="w-4 h-4 text-slate-400" />
                    </Button>
                  </div>
                ))}
                {icdRows.length === 0 && (
                  <p className="text-sm text-slate-500 italic">
                    No mappings — diagnoses will fall back to text matching / MMTA Other.
                  </p>
                )}
                <Button variant="outline" size="sm" onClick={addIcdRow} className="mt-1">
                  <Plus className="w-4 h-4 mr-1" /> Add mapping
                </Button>
              </div>
            </CardContent>
          </Card>

          <PDGMCalculationPreview
            isDirty={isDirty}
            isOfficial={meta.is_official}
            baseRate={effectivePreview.basePaymentRate ?? DEFAULT_PDGM_RATES.basePaymentRate}
          />

          {/* Official CMS case-mix weight table — reference for analysis only.
              Keyed on config arrival so the year field re-initializes from the
              stored table once the saved config finishes loading. Disabled until
              the saved config has actually loaded: initialData:null keeps
              isLoading false during the first fetch, and the persist payload
              re-sends the SAVED config fields — persisting against a not-yet-
              loaded (or failed) config would overwrite the stored rate set with
              blanks. */}
          <CaseMixWeightsUpload
            key={config ? "config-loaded" : "config-pending"}
            storedTable={config?.case_mix_weight_table || null}
            onPersist={(tableOrNull) => weightTableMutation.mutateAsync(tableOrNull)}
            uploadedBy={user?.email || null}
            defaultYear={meta.effective_year}
            // Cross-disabled on the wage-index mutation too: both tables live on the
            // same config row via preserve-unless-sent, so concurrent saves could
            // each preserve the other's PRE-save value and silently erase it.
            disabled={configFetching || configError || isDirty || saveMutation.isPending || weightTableMutation.isPending || wageIndexTableMutation.isPending}
            disabledReason={
              configError
                ? "The saved rate set could not be loaded — reload the page before storing a table (persisting now would overwrite it with blanks)."
                : configFetching
                  ? "Loading the saved rate set…"
                  : "You have unsaved rate edits — save or reset them first (storing the table reloads the saved rate set)."
            }
          />

          {/* CBSA wage-index table — the patient-location wage adjustment the
              referral revenue brief applies (unmatched addresses keep the
              single agency-wide wage index). Same disabled guards as the
              case-mix upload: never persist against an unloaded config. */}
          <WageIndexUpload
            storedTable={config?.wage_index_table || null}
            onPersist={(tableOrNull) => wageIndexTableMutation.mutateAsync(tableOrNull)}
            uploadedBy={user?.email || null}
            disabled={configFetching || configError || isDirty || saveMutation.isPending || wageIndexTableMutation.isPending || weightTableMutation.isPending}
            disabledReason={
              configError
                ? "The saved rate set could not be loaded — reload the page before storing a table."
                : configFetching
                  ? "Loading the saved rate set…"
                  : isDirty
                    ? "You have unsaved rate edits — save or reset them first."
                    : null
            }
          />

          {/* Payer reimbursement table — imported contracted rates + typical
              authorized visits, consumed by the referral revenue brief. Saves go
              through savePayerRateConfig (its own entity/row, so it is
              independent of the PDGM rate Save/dirty state above). */}
          <PayerRatesManager currentUser={user} />

          {/* Safety rails: implausible cells / broken ICD mappings block Save. */}
          {(blockingErrors.length > 0 || icdIssues.warnings.length > 0) && (
            <Alert className={blockingErrors.length > 0 ? "border-red-200 bg-red-50" : "border-amber-200 bg-amber-50"}>
              <AlertTriangle className={`h-4 w-4 ${blockingErrors.length > 0 ? "text-red-600" : "text-amber-600"}`} />
              <AlertDescription className="text-sm">
                {blockingErrors.length > 0 && (
                  <>
                    <p className="font-semibold text-red-800 mb-1">Fix before saving:</p>
                    <ul className="list-disc pl-5 space-y-0.5 text-red-800">
                      {blockingErrors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  </>
                )}
                {icdIssues.warnings.length > 0 && (
                  <ul className={`list-disc pl-5 space-y-0.5 text-amber-800 ${blockingErrors.length > 0 ? "mt-2" : ""}`}>
                    {icdIssues.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex flex-wrap items-center gap-3 sticky bottom-0 bg-white/80 backdrop-blur py-3 border-t">
            <Button onClick={handleSave} disabled={saveMutation.isPending || blockingErrors.length > 0}>
              <Save className="w-4 h-4 mr-2" />
              {saveMutation.isPending ? "Saving…" : "Save rates"}
            </Button>
            <Button variant="outline" onClick={resetToDefaults} disabled={saveMutation.isPending}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset to defaults
            </Button>
            {isDirty && !saveMutation.isPending && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600">
                <AlertTriangle className="w-3.5 h-3.5" /> Unsaved changes
              </span>
            )}
            <span className="text-xs text-slate-500">
              Base rate preview: ${Number(effectivePreview.basePaymentRate ?? DEFAULT_PDGM_RATES.basePaymentRate).toFixed(2)}
            </span>
          </div>
        </>
      )}
    </PageContainer>
  );
}