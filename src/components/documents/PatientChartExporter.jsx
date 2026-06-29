import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { FileDown, Lock, AlertCircle, Loader } from 'lucide-react';
import { toast } from 'sonner';

export default function PatientChartExporter({ patientId, patientName }) {
  const [isOpen, setIsOpen] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [includeOptions, setIncludeOptions] = useState({
    visits: true,
    carePlans: true,
    incidents: true
  });

  const handleExport = async () => {
    setIsGenerating(true);
    try {
      const response = await base44.functions.invoke('generatePatientChartPDF', {
        patientId,
        includeVisits: includeOptions.visits,
        includeCarePlans: includeOptions.carePlans,
        includeIncidents: includeOptions.incidents
      });

      if (!response.data.success) {
        throw new Error(response.data.error || 'Failed to generate PDF');
      }

      // Convert HTML content to PDF using jsPDF
      const { jsPDF } = await import('jspdf');
      const doc = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4'
      });

      // Add security watermark
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(60);
      doc.setTextColor(200, 200, 200);
      doc.text('CONFIDENTIAL', doc.internal.pageSize.getWidth() / 2, doc.internal.pageSize.getHeight() / 2, { align: 'center', angle: 45 });

      // Reset for actual content
      doc.setTextColor(0, 0, 0);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(11);

      // Add header
      doc.setFontSize(16);
      doc.text('PATIENT MEDICAL CHART', 20, 20);
      
      doc.setFontSize(10);
      doc.setTextColor(80, 80, 80);
      const exportDate = new Date().toLocaleString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      doc.text(`Generated: ${exportDate}`, 20, 28);
      doc.text(`Patient: ${patientName}`, 20, 34);
      doc.text(`MRN: ${response.data.mrn || 'N/A'}`, 20, 40);

      // Add confidentiality notice
      doc.setFontSize(8);
      doc.setTextColor(200, 0, 0);
      doc.text('CONFIDENTIAL - HIPAA PROTECTED HEALTH INFORMATION', 20, 48);
      doc.setTextColor(0, 0, 0);

      // Add content using HTML to PDF conversion
      const html = response.data.document;
      const pageHeight = doc.internal.pageSize.getHeight();
      const pageWidth = doc.internal.pageSize.getWidth();
      const margin = 20;
      const contentWidth = pageWidth - 2 * margin;

      // Simple HTML parser for basic text content
      const plainText = html
        .replace(/<[^>]*>/g, '\n')
        .replace(/&nbsp;/g, ' ')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .split('\n')
        .filter(line => line.trim());

      let yPosition = 56;
      doc.setFontSize(10);
      
      plainText.forEach((line) => {
        const wrappedLines = doc.splitTextToSize(line.trim(), contentWidth);
        wrappedLines.forEach(wrappedLine => {
          if (yPosition > pageHeight - margin) {
            doc.addPage();
            yPosition = margin;
            
            // Add footer with page number and confidentiality notice
            doc.setFontSize(8);
            doc.setTextColor(128, 128, 128);
            doc.text(`Page ${doc.internal.pages.length - 1}`, pageWidth - margin - 20, pageHeight - 10);
            doc.text('CONFIDENTIAL', margin, pageHeight - 10);
            doc.setTextColor(0, 0, 0);
            doc.setFontSize(10);
          }
          doc.text(wrappedLine, margin, yPosition);
          yPosition += 6;
        });
      });

      // Add footer to last page
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(`Page ${doc.internal.pages.length}`, pageWidth - margin - 20, pageHeight - 10);
      doc.text('CONFIDENTIAL', margin, pageHeight - 10);

      // Save the PDF
      const filename = `${patientName.replace(/\s+/g, '_')}_Chart_${new Date().getTime()}.pdf`;
      doc.save(filename);

      toast.success('Patient chart exported successfully');
      setIsOpen(false);
      
    } catch (error) {
      console.error('Export error:', error);
      toast.error(error.message || 'Failed to export patient chart');
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => setIsOpen(true)}
        variant="outline"
        className="gap-2"
      >
        <FileDown className="w-4 h-4" />
        Export Chart
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="w-5 h-5 text-blue-600" />
              Export Patient Chart
            </DialogTitle>
            <DialogDescription>
              Generate a professional HIPAA-compliant PDF of {patientName}'s medical chart
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <Alert className="bg-blue-50 border-blue-200">
              <AlertCircle className="h-4 w-4 text-blue-600" />
              <AlertDescription className="ml-3 text-sm text-blue-900">
                This document will be marked CONFIDENTIAL and includes Protected Health Information (PHI). Handle securely.
              </AlertDescription>
            </Alert>

            <Card className="bg-slate-50 border-slate-200">
              <CardHeader>
                <CardTitle className="text-sm">Include in Export</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-visits"
                    checked={includeOptions.visits}
                    onCheckedChange={(checked) =>
                      setIncludeOptions(prev => ({ ...prev, visits: checked }))
                    }
                  />
                  <Label htmlFor="include-visits" className="font-normal cursor-pointer">
                    Recent Visit Notes
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-care-plans"
                    checked={includeOptions.carePlans}
                    onCheckedChange={(checked) =>
                      setIncludeOptions(prev => ({ ...prev, carePlans: checked }))
                    }
                  />
                  <Label htmlFor="include-care-plans" className="font-normal cursor-pointer">
                    Active Care Plans
                  </Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="include-incidents"
                    checked={includeOptions.incidents}
                    onCheckedChange={(checked) =>
                      setIncludeOptions(prev => ({ ...prev, incidents: checked }))
                    }
                  />
                  <Label htmlFor="include-incidents" className="font-normal cursor-pointer">
                    Clinical Incidents
                  </Label>
                </div>
              </CardContent>
            </Card>

            <Alert className="bg-amber-50 border-amber-200">
              <AlertCircle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="ml-3 text-xs text-amber-900">
                Export activity is logged for HIPAA compliance. The document is watermarked CONFIDENTIAL.
              </AlertDescription>
            </Alert>
          </div>

          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setIsOpen(false)}
              disabled={isGenerating}
            >
              Cancel
            </Button>
            <Button
              onClick={handleExport}
              disabled={isGenerating}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isGenerating ? (
                <>
                  <Loader className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <FileDown className="w-4 h-4 mr-2" />
                  Export PDF
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}