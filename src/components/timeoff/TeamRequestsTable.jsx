import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Search, ListFilter, Download } from "lucide-react";
import TimeOffStatusBadge from "./TimeOffStatusBadge";
import {
  formatDateRange,
  typeLabel,
  totalRequestedDays,
  buildTimeOffCSV,
  REQUEST_TYPES,
  STATUSES,
} from "./timeOffUtils";

function downloadCSV(filename, csv) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export default function TeamRequestsTable({ requests = [] }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [type, setType] = useState("all");

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...requests]
      .filter((r) => (status === "all" ? true : r.status === status))
      .filter((r) => (type === "all" ? true : r.request_type === type))
      .filter((r) =>
        q
          ? `${r.employee_name || ""} ${r.employee_email || ""}`.toLowerCase().includes(q)
          : true
      )
      .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  }, [requests, search, status, type]);

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListFilter className="w-5 h-5 text-slate-600" />
            All Requests
            <span className="text-sm font-normal text-slate-400">({rows.length})</span>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => downloadCSV(`time-off-${new Date().toISOString().slice(0, 10)}.csv`, buildTimeOffCSV(rows))}
          >
            <Download className="w-4 h-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
        <div className="flex flex-col sm:flex-row gap-2 pt-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              className="pl-9"
              placeholder="Search by employee…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="sm:w-40">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={type} onValueChange={setType}>
            <SelectTrigger className="sm:w-44">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {REQUEST_TYPES.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-center py-10 text-slate-400 text-sm">No requests match your filters.</div>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Employee</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Dates</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reviewed by</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const days = Number(r.total_days) || totalRequestedDays(r.start_date, r.end_date, r.half_day);
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium text-slate-900">
                        {r.employee_name || r.employee_email}
                      </TableCell>
                      <TableCell className="text-slate-600">{typeLabel(r.request_type)}</TableCell>
                      <TableCell className="text-slate-600 whitespace-nowrap">
                        {formatDateRange(r.start_date, r.end_date)}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">{days}</TableCell>
                      <TableCell>
                        <TimeOffStatusBadge status={r.status} />
                      </TableCell>
                      <TableCell className="text-slate-500 text-sm">{r.reviewer_name || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
