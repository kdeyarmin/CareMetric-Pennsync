import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Upload,
  Loader,
  CheckCircle2,
  AlertCircle,
  Download,
  File
} from "lucide-react";
import { toast } from "sonner";

export default function PatientBulkUpload({ onImportSuccess = null }) {
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [importResult, setImportResult] = useState(null);

  const downloadTemplate = () => {
    const csv = `first_name,last_name,date_of_birth,email,phone,address,medical_record_number,primary_diagnosis,payor
John,Doe,1965-05-15,john.doe@email.com,555-0100,123 Main St,MRN001,Type 2 Diabetes,Medicare
Jane,Smith,1970-08-22,jane.smith@email.com,555-0101,456 Oak Ave,MRN002,CHF,Private Insurance`;
    
    const element = document.createElement("a");
    element.setAttribute("href", "data:text/csv;charset=utf-8," + encodeURIComponent(csv));
    element.setAttribute("download", "patient_template.csv");
    element.style.display = "none";
    document.body.appendChild(element);
    element.click();
    document.body.removeChild(element);
  };

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(e.type === "dragenter" || e.type === "dragover");
  };

  const processFile = async (file) => {
    if (!file) return;

    // Validate file type
    const validTypes = ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];
    if (!validTypes.includes(file.type) && !file.name.endsWith(".csv") && !file.name.endsWith(".xlsx")) {
      toast.error("Please upload a CSV or Excel file");
      return;
    }

    setIsProcessing(true);
    setImportResult(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const response = await base44.functions.invoke("importPatientsBatch", formData);
      const data = response.data || response;

      if (!data.success) {
        toast.error(data.error || "Import failed");
        setImportResult({ success: false, error: data.error });
        return;
      }

      setImportResult(data);
      toast.success(`Successfully imported ${data.created} patients`);
      
      if (onImportSuccess) {
        onImportSuccess();
      }
    } catch (error) {
      console.error("Import error:", error);
      toast.error("Failed to import patients");
      setImportResult({ success: false, error: error.message });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleDrop = (e) => {
    handleDrag(e);
    const files = e.dataTransfer.files;
    if (files.length) processFile(files[0]);
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  return (
    <div className="space-y-4">
      {/* Upload Area */}
      <Card
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
        className={`border-2 border-dashed transition-all cursor-pointer ${
          isDragging
            ? "border-blue-500 bg-blue-50 dark:bg-blue-950"
            : "border-slate-300 dark:border-slate-700"
        }`}
      >
        <CardContent className="p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="p-3 bg-blue-100 dark:bg-blue-900 rounded-lg">
              <Upload className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                Drag and drop your file here
              </p>
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                or click to browse (CSV or Excel)
              </p>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx"
              onChange={handleFileSelect}
              disabled={isProcessing}
              className="hidden"
              id="file-input"
            />
            <label htmlFor="file-input">
              <Button
                asChild
                variant="outline"
                size="sm"
                disabled={isProcessing}
                className="cursor-pointer"
              >
                <div className="flex items-center gap-1">
                  <File className="w-4 h-4" />
                  {isProcessing ? "Processing..." : "Select File"}
                </div>
              </Button>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Template Download */}
      <Button
        onClick={downloadTemplate}
        variant="outline"
        size="sm"
        className="w-full text-xs gap-1"
      >
        <Download className="w-3 h-3" />
        Download CSV Template
      </Button>

      {/* Processing State */}
      {isProcessing && (
        <Alert className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <Loader className="w-4 h-4 animate-spin text-blue-600" />
          <AlertDescription className="text-sm text-blue-800 dark:text-blue-200 ml-2">
            Processing your file...
          </AlertDescription>
        </Alert>
      )}

      {/* Import Results */}
      {importResult?.success && (
        <Alert className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
          <CheckCircle2 className="w-4 h-4 text-green-600 dark:text-green-400" />
          <AlertDescription className="text-sm text-green-800 dark:text-green-200 ml-2">
            Successfully imported <strong>{importResult.created}</strong> patients
            {importResult.failed > 0 && ` (${importResult.failed} errors)`}
          </AlertDescription>
        </Alert>
      )}

      {/* Import Errors */}
      {importResult?.errors && importResult.errors.length > 0 && (
        <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-red-900 dark:text-red-100">
              Import Errors ({importResult.errors.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {importResult.errors.map((err, idx) => (
                <div key={idx} className="flex gap-2 text-xs">
                  <span className="text-red-600 dark:text-red-400 font-semibold flex-shrink-0">
                    Row {err.row}:
                  </span>
                  <span className="text-red-700 dark:text-red-200">{err.error}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* File Requirements */}
      <Alert className="bg-slate-50 dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <AlertCircle className="w-4 h-4 text-slate-600 dark:text-slate-400" />
        <AlertDescription className="text-xs text-slate-700 dark:text-slate-300 ml-2">
          <strong>File Requirements:</strong> CSV or Excel format with columns: first_name, last_name, date_of_birth (optional), email, phone, address, medical_record_number, primary_diagnosis, payor
        </AlertDescription>
      </Alert>
    </div>
  );
}