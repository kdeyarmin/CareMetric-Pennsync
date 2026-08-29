import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, Loader2, Trash2, CheckCircle2, AlertTriangle, FileText, Landmark } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { validateFileUpload } from "@/components/utils/security";
import { parseCaseMixWeightsCsv, EXPECTED_GROUP_COUNT } from "./caseMixWeightsLoader.js";
import { buildStoredWeightTable } from "./caseMixReconciliation.js";
import { HH_CASE_MIX_WEIGHTS_CY2026 } from "./hhCaseMixWeightsCy2026.js";

/**
 * Admin upload of the official CMS 432-group case-mix weight CSV.
 *
 * The file is parsed client-side by caseMixWeightsLoader.parseCaseMixWeightsCsv
 * (strict mode: all 432 groups, every row mappable — unmappable rows are
 * REPORTED to the admin below, never guessed or partially loaded), then
 * persisted on PDGMRateConfig.case_mix_weight_table via the parent's
 * savePDGMRateConfig mutation.
 *
 * REFERENCE TABLE FOR ANALYSIS ONLY — payment estimates remain from the PDGM
 * engine (calculatePDGM). Per the pdgmGrouper.js header this table only feeds
 * the admin HIPPS/weight reconciliation preview; LUPA thresholds are
 * informational display only (no visit counting, no alerts).
 *
 * Props:
 *   storedTable   PDGMRateConfig.case_mix_weight_table (or null)
 *   onPersist     async (tableOrNull) => void — object stores, null clears
 *   uploadedBy    email stamped into the stored table metadata (cosmetic;
 *                 the authoritative updated_by_email is stamped server-side)
 *   defaultYear   prefill for the payment-year field (e.g. meta.effective_year)
 *   disabled      block store/clear (e.g. while rate edits are unsaved)
 *   disabledReason message shown when disabled
 */
export default function CaseMixWeightsUpload({
  storedTable = null,
  onPersist,
  uploadedBy = null,
  defaultYear = "",
  disabled = false,
  disabledReason = "",
}) {
  const inputRef = useRef(null);
  const [year, setYear] = useState(() => storedTable?.payment_year || defaultYear || "");
  const [parsed, setParsed] = useState(null); // { fileName, result } after a file is chosen
  const [isPersisting, setIsPersisting] = useState(false);

  const handleFile = async (event) => {
    const file = event.target.files?.[0];
    if (inputRef.current) inputRef.current.value = "";
    if (!file) return;

    const check = validateFileUpload(file, {
      maxSize: 10 * 1024 * 1024,
      allowedTypes: ["text/csv", "application/vnd.ms-excel", "text/plain", ""],
      allowedExtensions: [".csv"],
    });
    if (!check.valid) {
      toast.error(check.error);
      return;
    }

    try {
      const text = await file.text();
      const result = parseCaseMixWeightsCsv(text, {
        year: year.trim() || null,
        source: file.name,
      });
      setParsed({ fileName: file.name, result });
    } catch (err) {
      console.error("Failed to read case-mix weights CSV:", err);
      toast.error("Couldn't read that file. Please re-export the CSV and try again.");
    }
  };

  // Bundled official dataset (all 432 groups verbatim from the CMS CY2026
  // final case-mix weights file — see hhCaseMixWeightsCy2026.js for
  // provenance). Runs through the SAME strict parser + preview → Store flow
  // as a hand-imported CSV, never straight into storage.
  const loadBundledCy2026 = () => {
    setYear(HH_CASE_MIX_WEIGHTS_CY2026.payment_year);
    setParsed({
      fileName: HH_CASE_MIX_WEIGHTS_CY2026.source_file,
      result: parseCaseMixWeightsCsv(HH_CASE_MIX_WEIGHTS_CY2026.csv, {
        year: HH_CASE_MIX_WEIGHTS_CY2026.payment_year,
        source: HH_CASE_MIX_WEIGHTS_CY2026.source_file,
      }),
    });
  };

  const persist = async (tableOrNull) => {
    setIsPersisting(true);
    try {
      await onPersist(tableOrNull);
      setParsed(null);
    } catch {
      // Parent mutation surfaces the error toast; keep the parse report so the
      // admin can retry without re-selecting the file.
    } finally {
      setIsPersisting(false);
    }
  };

  const storeParsed = () => {
    if (!parsed?.result?.ok) return;
    return persist(
      buildStoredWeightTable(parsed.result, {
        year: year.trim() || null,
        source: parsed.fileName,
        uploadedBy,
      }),
    );
  };

  const result = parsed?.result;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">CMS case-mix weight table (reference)</CardTitle>
        <p className="text-xs text-slate-500">
          Upload the official CMS {EXPECTED_GROUP_COUNT}-group case-mix weights CSV for your payment
          year (see docs/PDGM_CASE_MIX_WEIGHTS.md for the expected columns), or load the bundled
          CY 2026 table — all {EXPECTED_GROUP_COUNT} groups verbatim from the CMS final-rule file.
          <strong> Reference table for analysis — payment estimates remain from the PDGM
          engine.</strong> It powers the admin-only HIPPS/weight reconciliation preview; LUPA
          thresholds are informational display only. Unmappable rows are reported below, never
          guessed.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Currently stored table */}
        {storedTable ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              Stored: <strong>{storedTable.payment_year ? `CY${storedTable.payment_year}` : "year not recorded"}</strong>
              {" · "}{storedTable.groups ?? Object.keys(storedTable.rows || {}).length} payment groups
              {storedTable.uploaded_at ? ` · uploaded ${format(new Date(storedTable.uploaded_at), "MMM d, yyyy")}` : ""}
              {storedTable.uploaded_by_email ? ` by ${storedTable.uploaded_by_email}` : ""}
              {storedTable.source ? ` · ${storedTable.source}` : ""}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => persist(null)}
              disabled={disabled || isPersisting}
              className="text-slate-500"
            >
              <Trash2 className="w-4 h-4 mr-1" /> Remove
            </Button>
          </div>
        ) : (
          <p className="text-sm text-slate-500 italic">
            No CMS case-mix weight table stored yet — the reconciliation preview stays hidden until one is uploaded.
          </p>
        )}

        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="case-mix-year">Payment year</Label>
            <Input
              id="case-mix-year"
              value={year}
              placeholder="e.g. 2026"
              onChange={(e) => setYear(e.target.value)}
              className="mt-1 w-28"
            />
          </div>
          <input ref={inputRef} type="file" accept=".csv" onChange={handleFile} className="hidden" />
          <Button
            type="button"
            variant="outline"
            onClick={() => inputRef.current?.click()}
            disabled={isPersisting}
          >
            <Upload className="w-4 h-4 mr-2" /> Choose CMS weights CSV…
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={loadBundledCy2026}
            disabled={isPersisting}
          >
            <Landmark className="w-4 h-4 mr-2" /> Load CMS CY 2026 table (bundled)
          </Button>
        </div>

        {/* Parse report — the loader's unmappable-row / completeness report. */}
        {result && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600 flex items-center gap-1.5">
              <FileText className="w-4 h-4 text-slate-400" />
              <span className="font-medium">{parsed.fileName}</span>
              <span className="text-slate-400">·</span>
              {result.meta.rowsParsed} row{result.meta.rowsParsed === 1 ? "" : "s"} parsed,{" "}
              {result.meta.groups} of {EXPECTED_GROUP_COUNT} payment groups
            </p>

            {result.errors.length > 0 && (
              <Alert className="border-red-200 bg-red-50">
                <AlertTriangle className="h-4 w-4 text-red-600" />
                <AlertDescription className="text-sm text-red-800">
                  <p className="font-semibold mb-1">
                    Not stored — {result.errors.length} problem{result.errors.length === 1 ? "" : "s"} found
                    (rows are reported, never guessed):
                  </p>
                  <ul className="list-disc pl-5 space-y-0.5 max-h-48 overflow-y-auto">
                    {result.errors.map((e, i) => <li key={i}>{e}</li>)}
                  </ul>
                  <p className="mt-1.5">Fix the CSV and upload it again — a partial table is never stored.</p>
                </AlertDescription>
              </Alert>
            )}

            {result.warnings.length > 0 && (
              <Alert className="border-amber-200 bg-amber-50">
                <AlertTriangle className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-sm text-amber-800">
                  <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto">
                    {result.warnings.map((w, i) => <li key={i}>{w}</li>)}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {result.ok && (
              <div className="flex flex-wrap items-center gap-3">
                <Button onClick={storeParsed} disabled={disabled || isPersisting}>
                  {isPersisting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
                  {isPersisting ? "Storing…" : `Store reference table${year.trim() ? ` (CY${year.trim()})` : ""}`}
                </Button>
                <span className="text-xs text-emerald-700">
                  Complete table: all {EXPECTED_GROUP_COUNT} payment groups mapped.
                </span>
              </div>
            )}

            {disabled && disabledReason && (
              <p className="text-xs text-amber-600">{disabledReason}</p>
            )}
          </div>
        )}

        {!result && disabled && disabledReason && (
          <p className="text-xs text-amber-600">{disabledReason}</p>
        )}
      </CardContent>
    </Card>
  );
}
