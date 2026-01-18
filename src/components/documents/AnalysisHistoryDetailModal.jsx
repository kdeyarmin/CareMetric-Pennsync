import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { FileText, Download, Copy, Calendar, User } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import jsPDF from "jspdf";

export default function AnalysisHistoryDetailModal({ analysis, isOpen, onClose }) {
  if (!analysis) return null;

  const data = analysis.full_analysis || {};

  const downloadAsJSON = () => {
    const dataStr = JSON.stringify(data, null, 2);
    const dataUri = `data:application/json;charset=utf-8,${encodeURIComponent(dataStr)}`;
    const link = document.createElement("a");
    link.href = dataUri;
    link.download = `analysis-${format(new Date(analysis.created_date), "yyyy-MM-dd-HHmmss")}.json`;
    link.click();
    toast.success("JSON downloaded");
  };

  const downloadAsPDF = () => {
    const doc = new jsPDF();
    let y = 20;

    // Header
    doc.setFillColor(59, 130, 246);
    doc.rect(0, 0, 210, 35, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(18);
    doc.text("Document Analysis", 20, 15);
    doc.setFontSize(10);
    doc.text(`${format(new Date(analysis.created_date), "MMM d, yyyy HH:mm")}`, 20, 27);

    // Reset
    doc.setTextColor(0, 0, 0);
    y = 45;

    // Analysis Summary
    if (analysis.analysis_summary) {
      doc.setFontSize(12);
      doc.setFont(undefined, "bold");
      doc.text("Summary", 20, y);
      y += 7;

      doc.setFontSize(10);
      doc.setFont(undefined, "normal");
      const summaryLines = doc.splitTextToSize(analysis.analysis_summary, 170);
      summaryLines.forEach(line => {
        if (y > 270) {
          doc.addPage();
          y = 20;
        }
        doc.text(line, 20, y);
        y += 5;
      });

      y += 5;
    }

    // File Information
    if (analysis.file_names && analysis.file_names.length > 0) {
      doc.setFontSize(11);
      doc.setFont(undefined, "bold");
      doc.text("Files Analyzed", 20, y);
      y += 6;

      doc.setFontSize(9);
      doc.setFont(undefined, "normal");
      analysis.file_names.forEach(name => {
        doc.text(`• ${name}`, 25, y);
        y += 4;
      });

      y += 3;
    }

    // Metadata
    if (y > 260) {
      doc.addPage();
      y = 20;
    }

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text("Information", 20, y);
    y += 6;

    doc.setFontSize(9);
    doc.setFont(undefined, "normal");
    const metadata = [
      ["Document Type", analysis.document_type?.replace(/_/g, " ") || "Unknown"],
      ["Provider Type", analysis.provider_type || "Unknown"],
      ["Care Setting", analysis.care_setting?.replace(/_/g, " ") || "Unknown"],
      ["File Count", analysis.file_count?.toString() || "0"],
      ["Created", format(new Date(analysis.created_date), "MMM d, yyyy HH:mm")]
    ];

    metadata.forEach(([key, value]) => {
      doc.text(`${key}:`, 20, y);
      doc.text(value, 100, y);
      y += 5;
    });

    doc.save(`analysis-${format(new Date(analysis.created_date), "yyyy-MM-dd")}.pdf`);
    toast.success("PDF downloaded");
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    toast.success("Copied to clipboard");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            Analysis Details
          </DialogTitle>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          <div className="pr-4 space-y-4">
            {/* Metadata */}
            <Card>
              <CardContent className="p-4">
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Date</span>
                    <span className="font-medium flex items-center gap-1">
                      <Calendar className="w-4 h-4" />
                      {format(new Date(analysis.created_date), "MMM d, yyyy HH:mm")}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Files</span>
                    <span className="font-medium">{analysis.file_count}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600 dark:text-slate-400">Type</span>
                    <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900">
                      {analysis.document_type?.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  {analysis.provider_type && (
                    <div className="flex items-center justify-between">
                      <span className="text-slate-600 dark:text-slate-400">Provider</span>
                      <Badge className="text-xs bg-purple-100 text-purple-800 dark:bg-purple-900">
                        {analysis.provider_type}
                      </Badge>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Summary */}
            {analysis.analysis_summary && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-semibold text-sm mb-2">Summary</h4>
                  <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                    {analysis.analysis_summary}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Files */}
            {analysis.file_names && analysis.file_names.length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-semibold text-sm mb-2">Files Analyzed</h4>
                  <ul className="space-y-1 text-sm">
                    {analysis.file_names.map((name, idx) => (
                      <li key={idx} className="text-slate-700 dark:text-slate-300 flex items-center gap-2">
                        <FileText className="w-3.5 h-3.5" />
                        {typeof name === "string" ? name.split("/").pop() : name}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}

            {/* Full Data Preview */}
            {Object.keys(data).length > 0 && (
              <Card>
                <CardContent className="p-4">
                  <h4 className="font-semibold text-sm mb-2">Full Analysis Data</h4>
                  <pre className="bg-slate-900 dark:bg-slate-950 text-slate-100 p-3 rounded text-xs overflow-auto max-h-64">
                    {JSON.stringify(data, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}
          </div>
        </ScrollArea>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-4 border-t">
          <Button size="sm" variant="outline" onClick={copyToClipboard}>
            <Copy className="w-3.5 h-3.5 mr-1.5" />
            Copy Data
          </Button>
          <Button size="sm" variant="outline" onClick={downloadAsJSON}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            JSON
          </Button>
          <Button size="sm" variant="outline" onClick={downloadAsPDF}>
            <Download className="w-3.5 h-3.5 mr-1.5" />
            PDF
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}