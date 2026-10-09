import { useState } from "react";
import { Download, Loader2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { downloadAuthorityBoundBlob } from "@/lib/downloadBlob";
import { todayEastern } from "@/components/utils/timezone";

export const COMPREHENSIVE_REPORT_RANGES = Object.freeze([
  { value: "7", label: "Last 7 days" },
  { value: "30", label: "Last 30 days" },
  { value: "90", label: "Last 90 days" },
  { value: "365", label: "Last 12 months" },
]);

async function refusalMessage(response) {
  try {
    const body = await response.json();
    if (typeof body?.error === "string" && body.error) return body.error;
  } catch {
    // A non-JSON failure falls through to the generic message.
  }
  return `The report could not be generated (${response.status}).`;
}

/**
 * Downloads the agency-wide comprehensive PDF that generateComprehensiveReport
 * renders on the server. The server decides everything: it admits an
 * agency_admin or manager rebuilt from their exact active membership, reads
 * only that agency's charts, visits, staff, incidents, audits and alerts, and
 * refuses anyone else before reading the request. The browser sends the report
 * window and the agency of its verified tenant context, and the server
 * re-checks that agency: a lead naming any agency but their own is refused,
 * and only the built-in administrator's named agency is taken as given.
 */
export default function AgencyComprehensiveReport({ agencyId }) {
  const [dateRange, setDateRange] = useState("30");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);

  const run = async () => {
    setRunning(true);
    setError(null);
    setDone(false);
    try {
      // functions.invoke decodes the body as JSON text, which corrupts PDF
      // bytes, so the binary answer is fetched directly.
      const response = await base44.functions.fetch("generateComprehensiveReport", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportType: "comprehensive", dateRange: Number(dateRange), agency_id: agencyId }),
      });
      if (!response.ok) {
        setError(await refusalMessage(response));
        return;
      }
      const type = response.headers.get("content-type") || "";
      if (!type.includes("application/pdf")) {
        setError("The server did not return a PDF.");
        return;
      }
      const blob = new Blob([await response.arrayBuffer()], { type: "application/pdf" });
      downloadAuthorityBoundBlob(blob, `pennsync-agency-report-${todayEastern()}.pdf`);
      setDone(true);
    } catch {
      setError("The report could not be generated. Please try again.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label htmlFor="comprehensive-report-range">Agency PDF report window</Label>
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger id="comprehensive-report-range" className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPREHENSIVE_REPORT_RANGES.map((range) => (
              <SelectItem key={range.value} value={range.value}>{range.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="button" variant="outline" onClick={run} disabled={running}>
        {running ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
        Download agency PDF report
      </Button>
      {error && <span role="alert" className="text-sm text-red-700">{error}</span>}
      {done && !error && <span role="status" className="text-sm text-slate-600">Report downloaded.</span>}
    </div>
  );
}
