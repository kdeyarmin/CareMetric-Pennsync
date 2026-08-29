import { useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { MapPin, UploadCloud, Download, Trash2, Save, AlertTriangle, CheckCircle2, Landmark } from "lucide-react";
import { toast } from "sonner";
import { parseWageIndexCsv, wageIndexCsvTemplate } from "./wageIndex.js";
import { PA_WAGE_INDEX_CY2026 } from "./paWageIndexCy2026.js";

/**
 * CBSA wage-index table import — the agency's own rows from the year's CMS HH
 * PPS wage index file, for the counties/ZIP prefixes they serve. The referral
 * revenue brief matches each patient's address to a row and hands that wage
 * index explicitly to calculatePDGM; unmatched addresses keep the single
 * AgencySettings.wage_index fallback. Persistence goes through the page's
 * savePDGMRateConfig mutation (service-role-write entity), which re-sends the
 * SAVED config fields so an import can't commit unsaved rate edits.
 */
export default function WageIndexUpload({ storedTable, onPersist, uploadedBy, disabled, disabledReason }) {
  const fileInputRef = useRef(null);
  const [parseResult, setParseResult] = useState(null);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);

  const storedRows = Array.isArray(storedTable?.rows) ? storedTable.rows : [];

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    const result = parseWageIndexCsv(await file.text());
    setParseResult(result);
    if (!result.ok) toast.error("The wage-index CSV could not be imported — see the errors below.");
  };

  // Bundled official dataset (values verbatim from the CMS CY2026 final HH PPS
  // wage index file — see paWageIndexCy2026.js for provenance): loads into the
  // same preview → Store flow as a CSV import, never straight into storage.
  const loadBundledPa = () => {
    setFileName(PA_WAGE_INDEX_CY2026.source_file);
    setParseResult({ ok: true, rows: PA_WAGE_INDEX_CY2026.rows, errors: [], warnings: [] });
  };

  const downloadTemplate = () => {
    const blob = new Blob([wageIndexCsvTemplate()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "cbsa_wage_index_template.csv";
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };

  const persist = async (tableOrNull) => {
    setBusy(true);
    try {
      await onPersist(tableOrNull);
      setParseResult(null);
      setFileName("");
    } catch (error) {
      console.error("Storing the wage-index table failed:", error);
      toast.error("Couldn't store the wage-index table. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const storeParsed = () =>
    persist({
      source: fileName || null,
      uploaded_at: new Date().toISOString(),
      uploaded_by_email: uploadedBy || null,
      rows: parseResult.rows,
    });

  return (
    <Card className="border-2 border-sky-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <MapPin className="w-5 h-5 text-sky-600" />
          CBSA Wage-Index Table
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          Import your service area's CBSA rows (from the year's CMS HH PPS wage index file) with the
          counties/ZIP prefixes you serve, or load the bundled Pennsylvania table — all 67 PA counties,
          values verbatim from the CMS CY2026 final HH PPS wage index file. The referral revenue brief
          matches each patient's address to a row and wage-adjusts the PDGM estimate for THAT location;
          unmatched addresses keep the single agency-wide wage index. No value is ever guessed.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {disabled && disabledReason && (
          <Alert className="bg-slate-50 border-slate-300">
            <AlertTriangle className="w-4 h-4 text-slate-600" />
            <AlertDescription className="text-xs text-slate-700">{disabledReason}</AlertDescription>
          </Alert>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
            <Download className="w-4 h-4 mr-1" /> Download CSV template
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => {
              handleFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={disabled || busy}>
            <UploadCloud className="w-4 h-4 mr-1" /> Choose CSV to import
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={loadBundledPa} disabled={disabled || busy}>
            <Landmark className="w-4 h-4 mr-1" /> Load PA counties (CMS CY2026)
          </Button>
        </div>

        {parseResult && (
          <div className="space-y-2">
            {parseResult.errors.length > 0 && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription>
                  <ul className="text-xs text-red-900 list-disc pl-4 space-y-0.5">
                    {parseResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {parseResult.warnings.length > 0 && (
              <Alert className="bg-yellow-50 border-yellow-300">
                <AlertTriangle className="w-4 h-4 text-yellow-700" />
                <AlertDescription>
                  <ul className="text-xs text-yellow-900 list-disc pl-4 space-y-0.5">
                    {parseResult.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {parseResult.ok && (
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-sm text-slate-700">
                  {parseResult.rows.length} CBSA row{parseResult.rows.length === 1 ? "" : "s"} parsed from{" "}
                  <span className="font-mono text-xs">{fileName}</span>. Storing REPLACES the saved table.
                </p>
                <Button type="button" size="sm" onClick={storeParsed} disabled={disabled || busy}>
                  <Save className="w-4 h-4 mr-1" /> Store table
                </Button>
              </div>
            )}
          </div>
        )}

        {storedRows.length > 0 ? (
          <div className="flex items-center justify-between gap-2 flex-wrap bg-sky-50 border border-sky-200 rounded p-2">
            <p className="text-xs text-sky-900 flex items-center gap-1">
              <CheckCircle2 className="w-4 h-4" />
              {storedRows.length} CBSA row{storedRows.length === 1 ? "" : "s"} stored
              {storedTable?.source ? ` (from ${storedTable.source})` : ""}:
              {" "}
              {storedRows.slice(0, 4).map((r) => (
                <Badge key={r.cbsa || r.label} variant="outline" className="ml-1">
                  {r.label || r.cbsa} · {r.wage_index}
                </Badge>
              ))}
              {storedRows.length > 4 ? ` +${storedRows.length - 4} more` : ""}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => persist(null)}
              disabled={disabled || busy}
              aria-label="Remove stored wage-index table"
            >
              <Trash2 className="w-4 h-4 text-red-500" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">
            No wage-index table stored — PDGM estimates use the single agency-wide wage index.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
