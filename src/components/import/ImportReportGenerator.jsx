import React from "react";
import { Button } from "@/components/ui/button";
import { toCsvRows } from "@/components/admin/csvExport";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { FileDown, FileSpreadsheet, FileText, Loader2 } from "lucide-react";
import { toast } from 'sonner';

export default function ImportReportGenerator({ 
  _importHistory, 
  validRecords, 
  validationErrors,
  importResults 
}) {
  const [isGenerating, setIsGenerating] = React.useState(false);
  const [reportOptions, setReportOptions] = React.useState({
    includeSuccessful: true,
    includeFailed: true,
    includeValidation: true,
    includeAnalytics: true,
    format: "csv"
  });

  const generateCSVReport = () => {
    const rows = [];
    
    // Header
    const headers = [
      'Import Date',
      'Status',
      'Row Number',
      'Patient Name',
      'First Name',
      'Last Name',
      'MRN',
      'DOB',
      'Error Category',
      'Error Description',
      'Resolution Suggested'
    ];
    rows.push(headers);

    // Add successful records
    if (reportOptions.includeSuccessful && validRecords) {
      validRecords.forEach((record, idx) => {
        rows.push([
          new Date().toISOString(),
          'SUCCESS',
          idx + 1,
          `${record.first_name} ${record.last_name}`,
          record.first_name || '',
          record.last_name || '',
          record.medical_record_number || '',
          record.date_of_birth || '',
          '',
          '',
          ''
        ]);
      });
    }

    // Add failed records
    if (reportOptions.includeFailed && validationErrors) {
      validationErrors.forEach((error) => {
        error.errors.forEach(errorMsg => {
          rows.push([
            new Date().toISOString(),
            'FAILED',
            error.row,
            error.patient,
            '',
            '',
            '',
            '',
            categorizeError(errorMsg),
            errorMsg,
            suggestResolution(errorMsg)
          ]);
        });
      });
    }

    // Add import results errors
    if (reportOptions.includeFailed && importResults?.errors) {
      importResults.errors.forEach((error) => {
        rows.push([
          new Date().toISOString(),
          'IMPORT_FAILED',
          error.row,
          error.patient,
          '',
          '',
          '',
          '',
          'Import Error',
          error.error,
          'Check data integrity and retry'
        ]);
      });
    }

    return rows;
  };

  const categorizeError = (errorMsg) => {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('required') || lower.includes('missing')) return 'Missing Required Field';
    if (lower.includes('format') || lower.includes('invalid')) return 'Data Format Error';
    if (lower.includes('date')) return 'Date Error';
    if (lower.includes('phone') || lower.includes('email')) return 'Contact Info Error';
    if (lower.includes('duplicate')) return 'Duplicate Record';
    return 'Validation Error';
  };

  const suggestResolution = (errorMsg) => {
    const lower = errorMsg.toLowerCase();
    if (lower.includes('required')) return 'Provide the required field value';
    if (lower.includes('format')) return 'Check data format and correct the value';
    if (lower.includes('date')) return 'Use YYYY-MM-DD format';
    if (lower.includes('phone')) return 'Use valid phone format (XXX-XXX-XXXX)';
    if (lower.includes('email')) return 'Provide valid email address';
    return 'Review and correct the data';
  };

  const handleDownloadCSV = () => {
    setIsGenerating(true);
    
    try {
      const rows = generateCSVReport();
      const csvContent = toCsvRows(rows);

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `import_report_${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error('Failed to generate report');
    }
    
    setIsGenerating(false);
  };

  const handleDownloadDetailedReport = () => {
    setIsGenerating(true);
    
    try {
      const report = {
        metadata: {
          generated_date: new Date().toISOString(),
          total_records: (validRecords?.length || 0) + (validationErrors?.length || 0),
          successful: validRecords?.length || 0,
          failed: validationErrors?.length || 0
        },
        successful_records: reportOptions.includeSuccessful ? validRecords : [],
        failed_records: reportOptions.includeFailed ? validationErrors : [],
        import_results: reportOptions.includeFailed ? importResults : null,
        analytics: reportOptions.includeAnalytics ? {
          success_rate: validRecords?.length && validationErrors?.length 
            ? ((validRecords.length / (validRecords.length + validationErrors.length)) * 100).toFixed(2) + '%'
            : 'N/A',
          common_errors: validationErrors ? 
            Object.entries(
              validationErrors.flatMap(e => e.errors).reduce((acc, err) => {
                const category = categorizeError(err);
                acc[category] = (acc[category] || 0) + 1;
                return acc;
              }, {})
            ).sort((a, b) => b[1] - a[1]) : []
        } : null
      };

      const jsonStr = JSON.stringify(report, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `detailed_import_report_${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error generating detailed report:', error);
      toast.error('Failed to generate detailed report');
    }
    
    setIsGenerating(false);
  };

  return (
    <Card className="border-2 border-green-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileDown className="w-5 h-5 text-green-600" />
          Download Import Report
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Report Options */}
        <div className="bg-slate-50 rounded-lg p-4 space-y-3">
          <Label className="font-semibold">Report Options</Label>
          
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={reportOptions.includeSuccessful}
                onCheckedChange={(checked) => 
                  setReportOptions(prev => ({ ...prev, includeSuccessful: checked }))
                }
              />
              <Label className="cursor-pointer">Include successful records</Label>
              <Badge variant="outline" className="ml-auto">
                {validRecords?.length || 0} records
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                checked={reportOptions.includeFailed}
                onCheckedChange={(checked) => 
                  setReportOptions(prev => ({ ...prev, includeFailed: checked }))
                }
              />
              <Label className="cursor-pointer">Include failed records with errors</Label>
              <Badge variant="outline" className="ml-auto bg-red-50 text-red-700">
                {validationErrors?.length || 0} records
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              <Checkbox
                checked={reportOptions.includeAnalytics}
                onCheckedChange={(checked) => 
                  setReportOptions(prev => ({ ...prev, includeAnalytics: checked }))
                }
              />
              <Label className="cursor-pointer">Include analytics and patterns</Label>
            </div>
          </div>
        </div>

        {/* Download Buttons */}
        <div className="grid grid-cols-2 gap-3">
          <Button
            onClick={handleDownloadCSV}
            disabled={isGenerating}
            className="bg-green-600 hover:bg-green-700"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileSpreadsheet className="w-4 h-4 mr-2" />
            )}
            CSV Report
          </Button>
          
          <Button
            onClick={handleDownloadDetailedReport}
            disabled={isGenerating}
            variant="outline"
            className="border-green-300 hover:bg-green-50"
          >
            {isGenerating ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileText className="w-4 h-4 mr-2" />
            )}
            JSON Report
          </Button>
        </div>

        <div className="text-xs text-slate-600 bg-blue-50 p-3 rounded-lg border border-blue-200">
          <p className="font-medium text-blue-900 mb-1">Report Contents:</p>
          <ul className="space-y-1 ml-4">
            <li>• Import timestamp and metadata</li>
            <li>• Detailed record-by-record status</li>
            <li>• Error categorization and descriptions</li>
            <li>• Resolution suggestions for each error</li>
            <li>• Analytics and success rate metrics</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}