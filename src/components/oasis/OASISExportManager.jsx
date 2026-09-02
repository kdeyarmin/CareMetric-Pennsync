import { useState } from "react";
import { toLocalISODate } from "@/lib/dateLocal";
import { Button } from "@/components/ui/button";
import { toCsvRows } from "@/components/admin/csvExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";


import { Download, FileDown, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { toast } from "sonner";
import {
  PDGM_REIMBURSEMENT_ACTION,
  PDGM_REIMBURSEMENT_BLOCKER,
} from "@/components/pdgm/pdgmAvailability";

export default function OASISExportManager({ 
  analysisResults, 
  _pdgmData, 
  _revenueData,
  _navigationData,
  qualityScore,
  patientName 
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState(null);
  const [exportSuccess, setExportSuccess] = useState(false);

  const exportToCSV = () => {
    setIsExporting(true);
    setExportType('csv');

    try {
      const csvData = [];
      
      // Header
      csvData.push(['OASIS Analysis Report']);
      csvData.push(['Patient Name', patientName || 'Unknown']);
      csvData.push(['Export Date', new Date().toLocaleDateString()]);
      csvData.push([]);

      // Overall Scores
      csvData.push(['OVERALL SCORES']);
      csvData.push(['Metric', 'Score']);
      csvData.push(['Overall Score', `${analysisResults.overall_score}%`]);
      csvData.push(['Accuracy Score', `${analysisResults.accuracy_score}%`]);
      csvData.push(['Compliance Score', `${analysisResults.compliance_score}%`]);
      
      if (qualityScore) {
        csvData.push(['Documentation Quality Score', `${qualityScore.overall_quality_score}%`]);
        csvData.push(['Documentation Grade', qualityScore.overall_grade]);
        csvData.push(['Audit Risk Level', qualityScore.audit_risk_level]);
      }
      csvData.push([]);

      // PDGM Navigator grouping and financial output is intentionally excluded.
      // The prior navigator used LLM-derived functional points, grouping, and
      // payments that are not a verified CMS HHGS 432-group result.
      csvData.push(['PDGM GROUPING AND REIMBURSEMENT']);
      csvData.push(['Status', 'Unavailable — not $0']);
      csvData.push(['Reason', PDGM_REIMBURSEMENT_BLOCKER]);
      csvData.push(['Required Action', PDGM_REIMBURSEMENT_ACTION]);
      csvData.push([]);

      // Accuracy Issues
      if (analysisResults.accuracy_issues?.length > 0) {
        csvData.push(['ACCURACY ISSUES']);
        csvData.push(['Item', 'Severity', 'Issue', 'Recommendation']);
        analysisResults.accuracy_issues.forEach(issue => {
          csvData.push([
            issue.item || '',
            issue.severity || '',
            issue.issue || '',
            issue.recommendation || ''
          ]);
        });
        csvData.push([]);
      }

      // Compliance Concerns
      if (analysisResults.compliance_concerns?.length > 0) {
        csvData.push(['COMPLIANCE CONCERNS']);
        csvData.push(['Area', 'Severity', 'Issue', 'Recommendation']);
        analysisResults.compliance_concerns.forEach(concern => {
          csvData.push([
            concern.area || '',
            concern.severity || '',
            concern.issue || '',
            concern.recommendation || ''
          ]);
        });
        csvData.push([]);
      }

      // Quality Criteria Breakdown
      if (qualityScore?.criteria_scores) {
        csvData.push(['DOCUMENTATION QUALITY CRITERIA']);
        csvData.push(['Criterion', 'Score', 'Key Findings']);
        Object.entries(qualityScore.criteria_scores).forEach(([key, data]) => {
          csvData.push([
            key.charAt(0).toUpperCase() + key.slice(1),
            `${data.score}%`,
            data.findings?.join('; ') || ''
          ]);
        });
        csvData.push([]);
      }

      // Convert to CSV string (escaping + formula-injection neutralization)
      const csvString = toCsvRows(csvData);

      // Download
      const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OASIS_Analysis_${patientName?.replace(/\s+/g, '_') || 'Report'}_${toLocalISODate()}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error('CSV export error:', error);
      // The button just reverts to idle on failure, which looks identical to never
      // having clicked it, so the failure has to be announced.
      toast.error('Failed to export the CSV. Please try again.');
    }

    setIsExporting(false);
    setExportType(null);
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    setExportType('pdf');

    try {
      // Fetch the PDF as binary. The axios-based functions.invoke wrapper uses
      // responseType 'json' and decodes the PDF bytes as UTF-8 text, which
      // corrupts the binary (replacement characters shift xref offsets).
      const response = await base44.functions.fetch('generateOASISReportPDF', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ analysisResults })
      });
      if (!response.ok) {
        throw new Error(`PDF generation failed (${response.status})`);
      }

      const blob = new Blob([await response.arrayBuffer()], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OASIS_Comprehensive_Report_${patientName?.replace(/\s+/g, '_') || 'Report'}_${toLocalISODate()}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error('PDF export error:', error);
      // Same here: without a toast a failed generation is indistinguishable from idle.
      toast.error('Failed to generate the PDF report. Please try again.');
    }

    setIsExporting(false);
    setExportType(null);
  };

  if (!analysisResults) return null;

  return (
    <Card className="border-2 border-green-200">
      <CardHeader className="pb-3 bg-gradient-to-r from-green-50 to-emerald-50">
        <CardTitle className="text-lg flex items-center gap-2">
          <Download className="w-5 h-5 text-green-600" />
          Export Analysis Report
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="space-y-3">
          <p className="text-sm text-slate-600">
            Download OASIS analysis, quality scores, and recommendations. Unverified PDGM grouping and payment are excluded.
          </p>

          <div className="grid grid-cols-2 gap-3">
            <Button
              onClick={exportToCSV}
              disabled={isExporting}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isExporting && exportType === 'csv' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Exporting...</>
              ) : exportSuccess && exportType === 'csv' ? (
                <><CheckCircle2 className="w-4 h-4 mr-2" /> Exported!</>
              ) : (
                <><FileSpreadsheet className="w-4 h-4 mr-2" /> Export CSV</>
              )}
            </Button>

            <Button
              onClick={exportToPDF}
              disabled={isExporting}
              className="bg-red-600 hover:bg-red-700"
            >
              {isExporting && exportType === 'pdf' ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Generating...</>
              ) : exportSuccess && exportType === 'pdf' ? (
                <><CheckCircle2 className="w-4 h-4 mr-2" /> Generated!</>
              ) : (
                <><FileDown className="w-4 h-4 mr-2" /> Export PDF</>
              )}
            </Button>
          </div>

          <div className="bg-slate-50 p-3 rounded border text-xs text-slate-600">
            <p className="font-medium mb-1">Export includes:</p>
            <ul className="space-y-0.5">
              <li>✓ Overall analysis scores</li>
              <li>✓ Explicit PDGM grouping/payment unavailable notice</li>
              <li>✓ Documentation quality assessment</li>
              <li>✓ Compliance concerns and recommendations</li>
              <li>✓ Discrepancies and resolution workflows</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
