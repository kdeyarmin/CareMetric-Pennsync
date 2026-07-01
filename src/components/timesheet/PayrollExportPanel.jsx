import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileSpreadsheet, FileText, Download, Info } from "lucide-react";
import { toast } from "sonner";
import {
  buildPayrollTable,
  buildPayrollCSV,
  totalsRow,
  payrollFilename,
} from "./payrollExport";
import { downloadPayrollPDF } from "./payrollPdf";
import { payPeriodLabel } from "./timesheetUtils";

/** Trigger a browser download of an in-memory text blob. */
function downloadText(text, filename, type = "text/csv;charset=utf-8;") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function PayrollTableCard({ serviceType, timesheets, period }) {
  const table = useMemo(
    () => buildPayrollTable(timesheets, serviceType, { periodStart: period.start, periodEnd: period.end }),
    [timesheets, serviceType, period]
  );
  const totals = totalsRow(table);
  const empty = table.rows.length === 0;

  const onPdf = () => {
    downloadPayrollPDF(table, payrollFilename(serviceType, period.end, "pdf"));
    toast.success(`${table.title} PDF downloaded.`);
  };
  const onCsv = () => {
    downloadText(buildPayrollCSV(table), payrollFilename(serviceType, period.end, "csv"));
    toast.success(`${table.title} spreadsheet downloaded.`);
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">
            {table.title}
            <span className="ml-2 text-sm font-normal text-slate-400">
              {table.rows.length} {table.rows.length === 1 ? "employee" : "employees"}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={empty} onClick={onCsv}>
              <FileSpreadsheet className="w-4 h-4 mr-1.5" />
              Excel (CSV)
            </Button>
            <Button size="sm" className="bg-blue-600 hover:bg-blue-700" disabled={empty} onClick={onPdf}>
              <FileText className="w-4 h-4 mr-1.5" />
              PDF
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {empty ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            No approved timesheets for this service line in the selected pay period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-slate-50">
                  {table.columns.map((c) => (
                    <th
                      key={c.key}
                      className={`border border-slate-200 px-2 py-1.5 font-semibold text-slate-700 ${c.numeric ? "text-right" : "text-left"}`}
                    >
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.ts.id} className="hover:bg-slate-50">
                    {r.cells.map((cell, i) => (
                      <td
                        key={table.columns[i].key}
                        className={`border border-slate-200 px-2 py-1 text-slate-700 ${cell.numeric ? "text-right tabular-nums" : "text-left"}`}
                      >
                        {cell.display}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="bg-slate-100 font-semibold">
                  {totals.map((cell, i) => (
                    <td
                      key={table.columns[i].key}
                      className={`border border-slate-200 px-2 py-1 text-slate-900 ${table.columns[i].numeric ? "text-right tabular-nums" : "text-left"}`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
        {!empty && table.notes.length > 0 && (
          <p className="text-xs text-slate-400 mt-2">{table.notes.join(" ")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PayrollExportPanel({ timesheets = [] }) {
  // Only approved timesheets feed the final payroll.
  const approved = useMemo(() => timesheets.filter((t) => t.status === "approved"), [timesheets]);

  // Distinct pay periods present among approved timesheets, newest first.
  const periods = useMemo(() => {
    const map = new Map();
    for (const t of approved) {
      const key = `${t.pay_period_start}__${t.pay_period_end}`;
      if (!map.has(key)) map.set(key, { start: t.pay_period_start, end: t.pay_period_end });
    }
    return [...map.values()].sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  }, [approved]);

  const [selectedKey, setSelectedKey] = useState("");
  const selected =
    periods.find((p) => `${p.start}__${p.end}` === selectedKey) || periods[0] || null;

  const inPeriod = useMemo(() => {
    if (!selected) return [];
    return approved.filter(
      (t) => t.pay_period_start === selected.start && t.pay_period_end === selected.end
    );
  }, [approved, selected]);

  if (periods.length === 0) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          There are no approved timesheets yet. Approve submitted timesheets in the Approvals tab, then
          come back here to generate the payroll for the accountant.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="w-5 h-5 text-slate-600" />
            Payroll Export
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap items-end gap-4">
            <div className="min-w-[260px]">
              <Label htmlFor="payroll-period">Pay period</Label>
              <Select value={selectedKey || `${selected?.start}__${selected?.end}`} onValueChange={setSelectedKey}>
                <SelectTrigger id="payroll-period" className="mt-1">
                  <SelectValue placeholder="Select a pay period" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={`${p.start}__${p.end}`} value={`${p.start}__${p.end}`}>
                      {payPeriodLabel(p.start, p.end)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <p className="text-sm text-slate-500">
              {inPeriod.length} approved {inPeriod.length === 1 ? "timesheet" : "timesheets"} in this period.
              Home health and hospice export as separate files, matching the accountant's format.
            </p>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <>
          <PayrollTableCard serviceType="home_health" timesheets={inPeriod} period={selected} />
          <PayrollTableCard serviceType="hospice" timesheets={inPeriod} period={selected} />
        </>
      )}
    </div>
  );
}
