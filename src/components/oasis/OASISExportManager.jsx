import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toCsvRows } from "@/components/admin/csvExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";


import { Download, FileDown, FileSpreadsheet, Loader2, CheckCircle2 } from "lucide-react";
import { generateOASISReportPDF } from "@/functions/generateOASISReportPDF";

export default function OASISExportManager({ 
  analysisResults, 
  _pdgmData, 
  revenueData,
  navigationData,
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
      csvData.push(['Revenue Optimization Score', `${analysisResults.revenue_optimization_score}%`]);
      
      if (qualityScore) {
        csvData.push(['Documentation Quality Score', `${qualityScore.overall_quality_score}%`]);
        csvData.push(['Documentation Grade', qualityScore.overall_grade]);
        csvData.push(['Audit Risk Level', qualityScore.audit_risk_level]);
      }
      csvData.push([]);

      // PDGM Navigator Results
      if (navigationData) {
        csvData.push(['PDGM GROUPING ANALYSIS']);
        csvData.push(['Category', 'Value']);
        csvData.push(['Clinical Group', navigationData.clinical_group?.group_name || 'N/A']);
        csvData.push(['Clinical Group Confidence', navigationData.clinical_group?.confidence || 'N/A']);
        csvData.push(['Functional Level', navigationData.functional_level?.level || 'N/A']);
        csvData.push(['Functional Points', navigationData.functional_level?.total_points || 'N/A']);
        csvData.push(['Comorbidity Adjustment', navigationData.comorbidity_adjustment?.level || 'N/A']);
        csvData.push(['Admission Source', navigationData.admission_timing?.admission_source || 'N/A']);
        csvData.push(['Episode Timing', navigationData.admission_timing?.episode_timing || 'N/A']);
        csvData.push([]);

        // Payment Calculation
        if (navigationData.case_mix_calculation) {
          csvData.push(['PAYMENT CALCULATION']);
          csvData.push(['Base Payment', `$${navigationData.case_mix_calculation.base_payment?.toFixed(2)}`]);
          csvData.push(['Clinical Weight', navigationData.case_mix_calculation.clinical_weight?.toFixed(4)]);
          csvData.push(['Functional Multiplier', navigationData.case_mix_calculation.functional_multiplier?.toFixed(2)]);
          csvData.push(['Comorbidity Multiplier', navigationData.case_mix_calculation.comorbidity_multiplier?.toFixed(3)]);
          csvData.push(['Final Case-Mix Weight', navigationData.case_mix_calculation.final_case_mix_weight?.toFixed(4)]);
          csvData.push(['Calculated Payment', `$${navigationData.case_mix_calculation.calculated_payment?.toFixed(2)}`]);
          csvData.push([]);
        }
      }

      // Revenue Data
      if (revenueData) {
        csvData.push(['REVENUE ANALYSIS']);
        csvData.push(['Original Payment', `$${revenueData.original?.totalPayment?.toFixed(2) || 0}`]);
        csvData.push(['Optimized Payment', `$${revenueData.corrected?.totalPayment?.toFixed(2) || 0}`]);
        csvData.push(['Revenue Difference', `$${revenueData.revenueDifference?.toFixed(2) || 0}`]);
        csvData.push(['Percentage Increase', `${revenueData.percentageIncrease?.toFixed(1) || 0}%`]);
        csvData.push([]);
      }

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

      // Revenue Tips
      if (analysisResults.revenue_tips?.length > 0) {
        csvData.push(['REVENUE OPTIMIZATION TIPS']);
        csvData.push(['Category', 'Impact', 'Opportunity', 'Action']);
        analysisResults.revenue_tips.forEach(tip => {
          csvData.push([
            tip.category || '',
            tip.potential_impact || '',
            tip.opportunity || '',
            tip.specific_action || ''
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

      // PDGM Discrepancies
      if (navigationData?.discrepancies?.length > 0) {
        csvData.push(['PDGM DISCREPANCIES']);
        csvData.push(['Type', 'Severity', 'Finding', 'Expected', 'Actual', 'Recommendation']);
        navigationData.discrepancies.forEach(disc => {
          csvData.push([
            disc.type || '',
            disc.severity || '',
            disc.finding || '',
            disc.expected || '',
            disc.actual || '',
            disc.recommendation || ''
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
      link.download = `OASIS_Analysis_${patientName?.replace(/\s+/g, '_') || 'Report'}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error('CSV export error:', error);
    }

    setIsExporting(false);
    setExportType(null);
  };

  const exportToPDF = async () => {
    setIsExporting(true);
    setExportType('pdf');

    try {
      const response = await generateOASISReportPDF({
        analysisResults
      });

      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `OASIS_Comprehensive_Report_${patientName?.replace(/\s+/g, '_') || 'Report'}_${new Date().toISOString().split('T')[0]}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      setExportSuccess(true);
      setTimeout(() => setExportSuccess(false), 3000);
    } catch (error) {
      console.error('PDF export error:', error);
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
            Download a comprehensive report including OASIS analysis, PDGM grouping, quality scores, and recommendations.
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
              <li>✓ PDGM Navigator grouping details</li>
              <li>✓ Documentation quality assessment</li>
              <li>✓ Revenue optimization opportunities</li>
              <li>✓ Compliance concerns and recommendations</li>
              <li>✓ Discrepancies and resolution workflows</li>
            </ul>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}