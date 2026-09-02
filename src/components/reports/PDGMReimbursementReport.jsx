import { base44 } from "@/api/base44Client";
import { useAgencyScopedQuery } from "@/hooks/useAgencyScopedQuery";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, AlertTriangle } from "lucide-react";
import { exportToPDF } from "../utils/pdfExporter";
import { format } from "date-fns";

const PAYMENT_BLOCKER =
  "PDGM reimbursement is unavailable until the app uses a verified CMS HHGS 432-group grouper with golden-case tests.";
const PDGM_REPORT_ENABLED = false;

function EnabledPDGMReimbursementReport({ dateRange }) {
  const { data: oasisAssessments = [] } = useAgencyScopedQuery({
    queryKey: ["allOASISAssessments"],
    fetch: () => base44.entities.OASISAssessment.list("-created_date", 10000),
    initialData: [],
  });

  const rangeStart = new Date(`${dateRange.start}T00:00:00`);
  const rangeEnd = new Date(`${dateRange.end}T23:59:59.999`);
  const episodeCount = oasisAssessments.filter((assessment) => {
    if (!assessment.assessment_date) return false;
    const assessmentDate = new Date(`${assessment.assessment_date}T00:00:00`);
    return assessmentDate >= rangeStart && assessmentDate <= rangeEnd;
  }).length;

  const handleExport = () => {
    exportToPDF({
      filename: `pdgm-episode-report-${format(new Date(), "yyyy-MM-dd")}.pdf`,
      title: "PDGM Episode Report",
      subtitle: `Period: ${format(rangeStart, "MMM d, yyyy")} - ${format(rangeEnd, "MMM d, yyyy")}`,
      content: [
        { type: "heading", text: "Episode Summary" },
        { type: "text", text: `Total OASIS Episodes: ${episodeCount}` },
        { type: "spacer" },
        { type: "text", text: `Payment: Unavailable. ${PAYMENT_BLOCKER}` },
        {
          type: "text",
          text: "Action: use the official EMR/CMS-approved grouper for billing and reimbursement decisions.",
        },
      ],
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-xl font-semibold text-slate-900">PDGM Episode Report</h3>
        <Button onClick={handleExport}>
          <Download className="w-4 h-4 mr-2" />
          Export Episode-Only PDF
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Episode Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-600 mb-1">Total OASIS Episodes</p>
          <p className="text-3xl font-bold text-slate-900">{episodeCount}</p>
        </CardContent>
      </Card>

      <div role="alert" className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-6 h-6 text-amber-700 shrink-0 mt-0.5" aria-hidden="true" />
          <div className="text-amber-950">
            <p className="font-bold">Reimbursement unavailable — not $0.</p>
            <p className="text-sm mt-1">{PAYMENT_BLOCKER}</p>
            <p className="text-sm mt-1">
              Historical estimator values and illustrative sample dollars are excluded. Use the official
              EMR/CMS-approved grouper for billing and reimbursement decisions.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function PDGMReimbursementReport({ dateRange }) {
  if (!PDGM_REPORT_ENABLED) {
    return (
      <Card className="border-2 border-amber-300 bg-amber-50">
        <CardContent className="space-y-2 p-6 text-sm text-amber-950">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5" /> PDGM Report Paused
          </div>
          <p>Reimbursement and episode reporting are unavailable — this is not a $0 result. {PAYMENT_BLOCKER}</p>
          <p>No OASIS assessment, legacy payment field, episode count, or PDF export is loaded from this tab.</p>
        </CardContent>
      </Card>
    );
  }
  return <EnabledPDGMReimbursementReport dateRange={dateRange} />;
}
