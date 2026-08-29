import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { fetchCallerPayerRateConfig } from "@/lib/agencySettings";
import { parsePayerRatesCsv, payerRatesCsvTemplate, PAYER_DISCIPLINES } from "./payerRates.js";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Landmark, UploadCloud, Download, Trash2, Save, AlertTriangle, CheckCircle2, Calculator } from "lucide-react";
import { toast } from "sonner";

const money = (n) => (Number.isFinite(n) ? `$${n.toFixed(2)}` : "—");

/**
 * Payer reimbursement table manager — the import surface for the agency's own
 * contracted payer rates and typically-authorized visit counts (PayerRateConfig).
 *
 * The entity is service-role-write only; every save goes through the
 * savePayerRateConfig backend function (admin-gated server-side). The imported
 * table feeds the clinical-manager referral brief's per-payer reimbursement
 * estimate and planned-vs-authorized visit comparison. Rendered on the PDGM
 * Rate Settings page, which is already admin-gated.
 */
export default function PayerRatesManager({ currentUser }) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef(null);
  const [parseResult, setParseResult] = useState(null);
  const [fileName, setFileName] = useState("");

  const { data: config, isLoading } = useQuery({
    queryKey: ["payerRateConfig", currentUser?.agency_name || "platform"],
    queryFn: () => fetchCallerPayerRateConfig(currentUser?.agency_name),
    enabled: !!currentUser,
  });
  const savedPayers = Array.isArray(config?.payers) ? config.payers : [];

  // Agency-wide per-visit COSTS (string form for editing) — seeded from the
  // saved config once it loads; the margin section of the referral revenue
  // brief multiplies these by the planned visits.
  const [costs, setCosts] = useState(() => Object.fromEntries(PAYER_DISCIPLINES.map((d) => [d, ""])));
  const [costsSeeded, setCostsSeeded] = useState(false);
  useEffect(() => {
    if (config && !costsSeeded) {
      setCosts(
        Object.fromEntries(
          PAYER_DISCIPLINES.map((d) => [d, config.visit_costs?.[d] != null ? String(config.visit_costs[d]) : ""])
        )
      );
      setCostsSeeded(true);
    }
  }, [config, costsSeeded]);
  const costsObject = () =>
    Object.fromEntries(
      PAYER_DISCIPLINES.map((d) => [d, costs[d]]).filter(([, v]) => String(v).trim() !== "" && Number.isFinite(Number(v)))
        .map(([d, v]) => [d, Number(v)])
    );

  const saveMutation = useMutation({
    mutationFn: (payload) => base44.functions.invoke("savePayerRateConfig", payload),
    onSuccess: (res, payload) => {
      queryClient.invalidateQueries({ queryKey: ["payerRateConfig"] });
      setParseResult(null);
      setFileName("");
      toast.success(`Payer table saved (${res?.data?.saved_count ?? payload.payers.length} payers).`);
    },
    onError: (err) => {
      console.error("Error saving payer rates:", err);
      toast.error("Failed to save the payer table. Please try again.");
    },
  });

  const handleFile = async (file) => {
    if (!file) return;
    setFileName(file.name);
    const text = await file.text();
    const result = parsePayerRatesCsv(text);
    setParseResult(result);
    if (!result.ok) toast.error("The CSV could not be imported — see the errors below.");
  };

  const downloadTemplate = () => {
    const blob = new Blob([payerRatesCsvTemplate()], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "payer_rates_template.csv";
    document.body.appendChild(a);
    a.click();
    URL.revokeObjectURL(url);
    a.remove();
  };

  const importParsed = () => {
    if (!parseResult?.ok) return;
    saveMutation.mutate({
      payers: parseResult.payers,
      source_file: fileName,
      label: config?.label || "",
      effective_year: config?.effective_year || "",
      notes: config?.notes || "",
    });
  };

  const removePayer = (name) => {
    const remaining = savedPayers.filter((p) => p.payer_name !== name);
    saveMutation.mutate({
      payers: remaining,
      source_file: config?.source_file || "",
      label: config?.label || "",
      effective_year: config?.effective_year || "",
      notes: config?.notes || "",
    });
  };

  const saveCosts = () => {
    saveMutation.mutate({
      payers: savedPayers,
      visit_costs: costsObject(),
      source_file: config?.source_file || "",
      label: config?.label || "",
      effective_year: config?.effective_year || "",
      notes: config?.notes || "",
    });
  };

  const renderPayerTable = (payers, { removable = false } = {}) => (
    <div className="overflow-x-auto">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Payer</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Model</TableHead>
            <TableHead>Episode rate</TableHead>
            {PAYER_DISCIPLINES.map((d) => (
              <TableHead key={d} className="text-right">{d} rate / auth</TableHead>
            ))}
            <TableHead>Auth</TableHead>
            {removable && <TableHead />}
          </TableRow>
        </TableHeader>
        <TableBody>
          {payers.map((p) => (
            <TableRow key={p.payer_name}>
              <TableCell className="font-medium">
                {p.payer_name}
                {p.match_terms?.length > 0 && (
                  <p className="text-[10px] text-slate-500">matches: {p.match_terms.join(", ")}</p>
                )}
              </TableCell>
              <TableCell><Badge variant="outline">{p.payer_type}</Badge></TableCell>
              <TableCell>{p.payment_model}</TableCell>
              <TableCell>{p.payment_model === "episodic" ? money(p.episode_rate) : "—"}</TableCell>
              {PAYER_DISCIPLINES.map((d) => (
                <TableCell key={d} className="text-right text-xs">
                  {p.per_visit_rates?.[d] != null ? money(p.per_visit_rates[d]) : "—"}
                  {" / "}
                  {p.approved_visits?.[d] != null ? `${p.approved_visits[d]}v` : "—"}
                </TableCell>
              ))}
              <TableCell>{p.auth_required ? "Required" : "No"}</TableCell>
              {removable && (
                <TableCell>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => removePayer(p.payer_name)}
                    disabled={saveMutation.isPending}
                    aria-label={`Remove ${p.payer_name}`}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </Button>
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );

  return (
    <Card className="border-2 border-cyan-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <Landmark className="w-5 h-5 text-cyan-600" />
          Payer Reimbursement Table
        </CardTitle>
        <p className="text-xs text-slate-500 mt-1">
          Import your contracted payer rates and typically-authorized visit counts (CSV). The referral
          revenue brief uses this table to estimate each payer's episode reimbursement and to compare the
          planned visits against the expected authorization. Nothing is shipped or guessed — only your
          imported numbers are used.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
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
          <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()}>
            <UploadCloud className="w-4 h-4 mr-1" /> Choose CSV to import
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
              <>
                <p className="text-sm text-slate-700">
                  Preview — {parseResult.payers.length} payer{parseResult.payers.length === 1 ? "" : "s"} parsed from{" "}
                  <span className="font-mono text-xs">{fileName}</span>. Importing REPLACES the saved table.
                </p>
                {renderPayerTable(parseResult.payers)}
                <Button type="button" onClick={importParsed} disabled={saveMutation.isPending}>
                  {saveMutation.isPending ? (
                    <span className="flex items-center"><span className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />Saving…</span>
                  ) : (
                    <><Save className="w-4 h-4 mr-1" /> Import & replace saved table</>
                  )}
                </Button>
              </>
            )}
          </div>
        )}

        {/* Agency-wide per-visit costs — feeds the episode-margin estimate on
            the referral revenue brief (revenue − planned visits × cost). */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
          <p className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
            <Calculator className="w-4 h-4 text-slate-600" />
            Your per-visit costs (agency-wide, for the margin estimate)
          </p>
          <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
            {PAYER_DISCIPLINES.map((d) => (
              <div key={d}>
                <label htmlFor={`cost-${d}`} className="text-xs font-medium mb-1 block">{d} cost $</label>
                <Input
                  id={`cost-${d}`}
                  inputMode="decimal"
                  value={costs[d]}
                  onChange={(e) => setCosts((prev) => ({ ...prev, [d]: e.target.value }))}
                  placeholder="—"
                />
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between gap-2 mt-2 flex-wrap">
            <p className="text-[11px] text-slate-500">
              Fully-loaded cost per completed visit (wages, mileage, supplies, overhead). Blank = uncosted;
              the margin then shows a cost floor. Never shown to clinical staff.
            </p>
            <Button type="button" size="sm" variant="outline" onClick={saveCosts} disabled={saveMutation.isPending}>
              <Save className="w-4 h-4 mr-1" /> Save costs
            </Button>
          </div>
        </div>

        <div>
          <p className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
            Saved payer table
            {config?.source_file && (
              <span className="text-xs font-normal text-slate-500">last import: {config.source_file}</span>
            )}
          </p>
          {isLoading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : savedPayers.length === 0 ? (
            <p className="text-sm text-slate-500">
              No payer rates imported yet — download the template, fill in your contracted numbers, and import it.
            </p>
          ) : (
            <>
              {renderPayerTable(savedPayers, { removable: true })}
              <p className="text-xs text-green-800 flex items-center gap-1 mt-2">
                <CheckCircle2 className="w-4 h-4" />
                {savedPayers.length} payer{savedPayers.length === 1 ? "" : "s"} available to the referral revenue brief.
              </p>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
