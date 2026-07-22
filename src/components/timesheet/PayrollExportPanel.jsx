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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, FileText, Download, Info, CheckCircle2, Hourglass, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  buildPayrollTable,
  buildPayrollCSV,
  totalsRow,
  payrollFilename,
} from "./payrollExport";
import { downloadPayrollPDF } from "./payrollPdf";
import { payPeriodLabel, submissionCoverage, serviceTypeLabel } from "./timesheetUtils";
import { periodIndexForDate, payPeriodByIndex, paydayLabel, dueLabel } from "./payPeriodSchedule";

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

function CoverageStrip({ coverage }) {
  if (!coverage || coverage.expected.length === 0) return null;
  const { approved, awaiting, missing } = coverage;
  return (
    <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
      <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
        <CheckCircle2 className="w-3.5 h-3.5" /> {approved.length} approved
      </span>
      {awaiting.length > 0 && (
        <span className="inline-flex items-center gap-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-0.5">
          <Hourglass className="w-3.5 h-3.5" /> {awaiting.length} awaiting approval
        </span>
      )}
      {missing.length > 0 && (
        <span className="inline-flex items-center gap-1 text-red-700 bg-red-50 border border-red-200 rounded-full px-2.5 py-0.5">
          <AlertTriangle className="w-3.5 h-3.5" /> {missing.length} not submitted: {missing.map((e) => e.name || e.email).join(", ")}
        </span>
      )}
    </div>
  );
}

function PayrollTableCard({ serviceType, approvedTimesheets, allTimesheets, employees, period }) {
  const table = useMemo(
    () => buildPayrollTable(approvedTimesheets, serviceType, { periodStart: period.start, periodEnd: period.end }),
    [approvedTimesheets, serviceType, period]
  );
  const coverage = useMemo(
    () => submissionCoverage(employees, allTimesheets, { serviceType, periodStart: period.start, periodEnd: period.end }),
    [employees, allTimesheets, serviceType, period]
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
        <CoverageStrip coverage={coverage} />
        {empty ? (
          <p className="text-sm text-slate-400 py-6 text-center">
            No approved timesheets for {serviceTypeLabel(serviceType)} in the selected pay period.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {table.columns.map((c) => (
                    <TableHead key={c.key} className={c.numeric ? "text-right" : ""}>
                      {c.label}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {table.rows.map((r) => (
                  <TableRow key={r.ts.id}>
                    {r.cells.map((cell, i) => (
                      <TableCell
                        key={table.columns[i].key}
                        className={`text-slate-700 ${cell.numeric ? "text-right tabular-nums" : ""}`}
                      >
                        {cell.display}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="bg-slate-100 font-semibold">
                  {totals.map((cell, i) => (
                    <TableCell
                      key={table.columns[i].key}
                      className={`text-slate-900 ${table.columns[i].numeric ? "text-right tabular-nums" : ""}`}
                    >
                      {cell}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
        {!empty && table.notes.length > 0 && (
          <p className="text-xs text-slate-400 mt-2">{table.notes.join(" ")}</p>
        )}
      </CardContent>
    </Card>
  );
}

export default function PayrollExportPanel({ timesheets = [], employees = [] }) {
  // Pay periods present among ALL timesheets (any status) so coverage shows even
  // before approvals; the export tables themselves only use approved sheets.
  const periods = useMemo(() => {
    const map = new Map();
    for (const t of timesheets) {
      if (!t?.pay_period_start || !t?.pay_period_end) continue;
      const key = `${t.pay_period_start}__${t.pay_period_end}`;
      if (!map.has(key)) map.set(key, { start: t.pay_period_start, end: t.pay_period_end });
    }
    return [...map.values()].sort((a, b) => (b.start || "").localeCompare(a.start || ""));
  }, [timesheets]);

  const [selectedKey, setSelectedKey] = useState("");
  const selected = periods.find((p) => `${p.start}__${p.end}` === selectedKey) || periods[0] || null;

  const allInPeriod = useMemo(() => {
    if (!selected) return [];
    return timesheets.filter((t) => t.pay_period_start === selected.start && t.pay_period_end === selected.end);
  }, [timesheets, selected]);

  const approvedInPeriod = useMemo(() => allInPeriod.filter((t) => t.status === "approved"), [allInPeriod]);

  // Schedule descriptor (due date + payday) for the selected period.
  const schedule = useMemo(
    () => (selected ? payPeriodByIndex(periodIndexForDate(selected.start)) : null),
    [selected]
  );

  if (periods.length === 0) {
    return (
      <Alert className="bg-blue-50 border-blue-200">
        <Info className="h-4 w-4 text-blue-600" />
        <AlertDescription className="text-blue-800 text-sm">
          There are no timesheets yet. Once employees submit and you approve them, come back here to
          generate the payroll for the accountant.
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
            <div className="text-sm text-slate-500 space-y-1">
              {schedule?.payday && (
                <p className="text-slate-600">
                  Due <span className="font-medium">{dueLabel(schedule)}</span> · Payday{" "}
                  <span className="font-medium">{paydayLabel(schedule)}</span>
                </p>
              )}
              <p>
                {approvedInPeriod.length} approved {approvedInPeriod.length === 1 ? "timesheet" : "timesheets"} in this period.
                Home health and hospice export as separate files, matching the accountant's format. Only approved
                timesheets are included.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <>
          <PayrollTableCard
            serviceType="home_health"
            approvedTimesheets={approvedInPeriod}
            allTimesheets={allInPeriod}
            employees={employees}
            period={selected}
          />
          <PayrollTableCard
            serviceType="hospice"
            approvedTimesheets={approvedInPeriod}
            allTimesheets={allInPeriod}
            employees={employees}
            period={selected}
          />
        </>
      )}
    </div>
  );
}
