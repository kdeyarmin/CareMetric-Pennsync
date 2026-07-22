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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { BarChart3, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import {
  REPORT_METRICS,
  REPORT_GROUPINGS,
  SERVICE_TYPES,
  aggregateTimesheets,
  aggregateTotals,
} from "./timesheetUtils";
import { buildReportCSV, formatNum } from "./payrollExport";

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

export default function PayrollReports({ timesheets = [] }) {
  const [groupBy, setGroupBy] = useState("period");
  const [serviceFilter, setServiceFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("approved");

  // Distinct employees present in the data, for the employee filter.
  const employees = useMemo(() => {
    const map = new Map();
    for (const t of timesheets) {
      if (t?.employee_email && !map.has(t.employee_email)) {
        map.set(t.employee_email, t.employee_name || t.employee_email);
      }
    }
    return [...map.entries()].map(([email, name]) => ({ email, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [timesheets]);

  const filtered = useMemo(() => {
    return timesheets.filter((t) => {
      if (!t) return false;
      if (statusFilter === "approved" && t.status !== "approved") return false;
      if (statusFilter === "submitted_approved" && !["approved", "submitted"].includes(t.status)) return false;
      if (serviceFilter !== "all" && t.service_type !== serviceFilter) return false;
      if (employeeFilter !== "all" && t.employee_email !== employeeFilter) return false;
      return true;
    });
  }, [timesheets, statusFilter, serviceFilter, employeeFilter]);

  const rows = useMemo(() => aggregateTimesheets(filtered, groupBy), [filtered, groupBy]);
  const totals = useMemo(() => aggregateTotals(rows), [rows]);
  const groupHeader = REPORT_GROUPINGS.find((g) => g.value === groupBy)?.label || "Group";

  const onExport = () => {
    if (rows.length === 0) return;
    downloadText(buildReportCSV(rows, groupHeader), `timesheet_report_${groupBy}.csv`);
    toast.success("Report exported.");
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <BarChart3 className="w-5 h-5 text-slate-600" />
            Hours &amp; Points Report
          </CardTitle>
          <Button size="sm" variant="outline" disabled={rows.length === 0} onClick={onExport}>
            <FileSpreadsheet className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <div>
            <Label className="text-xs text-slate-500">Group by</Label>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {REPORT_GROUPINGS.map((g) => (
                  <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Service line</Label>
            <Select value={serviceFilter} onValueChange={setServiceFilter}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All service lines</SelectItem>
                {SERVICE_TYPES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Employee</Label>
            <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All employees</SelectItem>
                {employees.map((e) => (
                  <SelectItem key={e.email} value={e.email}>{e.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs text-slate-500">Status</Label>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="mt-1 h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="approved">Approved only</SelectItem>
                <SelectItem value="submitted_approved">Submitted + approved</SelectItem>
                <SelectItem value="all">All</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-slate-400 py-8 text-center">
            No timesheets match these filters yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{groupHeader}</TableHead>
                  <TableHead className="text-right">Sheets</TableHead>
                  {REPORT_METRICS.map((m) => (
                    <TableHead key={m.key} className="text-right">{m.label}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.key}>
                    <TableCell className="text-slate-800">{r.label}</TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">{r.count}</TableCell>
                    {REPORT_METRICS.map((m) => (
                      <TableCell key={m.key} className="text-right tabular-nums text-slate-700">
                        {formatNum(r.metrics[m.key])}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
                <TableRow className="bg-slate-100 font-semibold">
                  <TableCell className="text-slate-900">Total</TableCell>
                  <TableCell className="text-right tabular-nums text-slate-900">{totals.count}</TableCell>
                  {REPORT_METRICS.map((m) => (
                    <TableCell key={m.key} className="text-right tabular-nums text-slate-900">
                      {formatNum(totals.metrics[m.key], { blankZero: false })}
                    </TableCell>
                  ))}
                </TableRow>
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
