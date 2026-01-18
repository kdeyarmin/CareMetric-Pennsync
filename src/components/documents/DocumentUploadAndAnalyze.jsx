import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Upload, FileText, AlertCircle, Loader2, X, CheckCircle2, Image } from "lucide-react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";

export default function DocumentUploadAndAnalyze({ patientId, onAnalysisComplete }) {
  const [files, setFiles] = useState([]);
  const [documentType, setDocumentType] = useState("clinical_note");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [dragActive, setDragActive] = useState(false);

  const documentTypes = [
    { value: "clinical_note", label: "Clinical Note" },
    { value: "lab_report", label: "Lab Report" },
    { value: "discharge_summary", label: "Discharge Summary" },
    { value: "medication_list", label: "Medication List" },
    { value: "consultation_note", label: "Consultation Note" },
    { value: "imaging_report", label: "Imaging Report" },
    { value: "hospital_record", label: "Hospital Record" },
    { value: "other", label: "Other Document" }
  ];

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);

    const droppedFiles = Array.from(e.dataTransfer.files).filter(file =>
      ["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(file.type)
    );

    if (droppedFiles.length === 0) {
      toast.error("Only PDF and image files (PNG, JPG) are supported");
      return;
    }

    setFiles(prev => [...prev, ...droppedFiles]);
  };

  const handleFileInput = (e) => {
    const selectedFiles = Array.from(e.target.files).filter(file =>
      ["application/pdf", "image/png", "image/jpeg", "image/jpg"].includes(file.type)
    );

    if (selectedFiles.length === 0) {
      toast.error("Only PDF and image files (PNG, JPG) are supported");
      return;
    }

    setFiles(prev => [...prev, ...selectedFiles]);
  };

  const removeFile = (index) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleAnalyze = async () => {
    if (files.length === 0) {
      toast.error("Please select at least one file to analyze");
      return;
    }

    setIsAnalyzing(true);
    try {
      // Upload files and get URLs
      const fileUrls = [];
      for (const file of files) {
        const formData = new FormData();
        formData.append("file", file);

        const uploadResponse = await base44.integrations.Core.UploadFile({
          file: file
        });

        if (uploadResponse.file_url) {
          fileUrls.push(uploadResponse.file_url);
        }
      }

      if (fileUrls.length === 0) {
        throw new Error("Failed to upload files");
      }

      console.log("Uploaded files:", fileUrls);

      // Call analysis function
      const response = await fetch("/api/analyzePatientDocument", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_urls: fileUrls,
          document_type: documentType,
          patient_context: patientId ? { patient_id: patientId } : null
        })
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.details || "Analysis failed");
      }

      const result = await response.json();
      toast.success("Document analyzed successfully!");

      onAnalysisComplete({
        analysis_id: result.analysis_id,
        extracted_data: result.extracted_data,
        file_count: result.file_count
      });

      setFiles([]);
      setDocumentType("clinical_note");
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error(error.message || "Failed to analyze document");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <Card className="border-2 border-indigo-200 dark:border-indigo-800">
      <CardHeader className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950 dark:to-purple-950">
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-indigo-600" />
          Upload & Analyze Documents
        </CardTitle>
      </CardHeader>

      <CardContent className="p-6 space-y-4">
        <Alert>
          <AlertCircle className="w-4 h-4" />
          <AlertDescription>
            Upload clinical documents (PDF or images). AI will extract diagnoses, medications, labs, and clinical notes.
          </AlertDescription>
        </Alert>

        {/* Document Type Selector */}
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
            Document Type
          </label>
          <Select value={documentType} onValueChange={setDocumentType}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {documentTypes.map(type => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Drag-and-Drop Area */}
        <div
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
            dragActive
              ? "border-indigo-600 bg-indigo-50 dark:bg-indigo-950"
              : "border-slate-300 dark:border-slate-600 hover:border-indigo-500 hover:bg-slate-50 dark:hover:bg-slate-800"
          }`}
        >
          <input
            type="file"
            id="fileInput"
            multiple
            accept=".pdf,.png,.jpg,.jpeg"
            onChange={handleFileInput}
            className="hidden"
          />
          <label htmlFor="fileInput" className="cursor-pointer">
            <div className="flex flex-col items-center gap-2">
              <Upload className="w-8 h-8 text-indigo-600" />
              <p className="font-medium text-slate-900 dark:text-slate-100">
                Drop files here or click to upload
              </p>
              <p className="text-sm text-slate-500">
                Supports PDF, PNG, JPG (up to 10MB each)
              </p>
            </div>
          </label>
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Selected Files ({files.length})
            </p>
            <div className="space-y-2">
              {files.map((file, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between p-3 bg-slate-50 dark:bg-slate-900 rounded-lg"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {file.type === "application/pdf" ? (
                      <FileText className="w-4 h-4 text-red-600 flex-shrink-0" />
                    ) : (
                      <Image className="w-4 h-4 text-blue-600 flex-shrink-0" />
                    )}
                    <span className="text-sm text-slate-700 dark:text-slate-300 truncate">
                      {file.name}
                    </span>
                    <span className="text-xs text-slate-500 ml-auto flex-shrink-0">
                      {(file.size / 1024 / 1024).toFixed(2)} MB
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => removeFile(index)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950"
                  >
                    <X className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleAnalyze}
            disabled={isAnalyzing || files.length === 0}
            className="flex-1 bg-indigo-600 hover:bg-indigo-700"
          >
            {isAnalyzing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isAnalyzing ? "Analyzing..." : "Analyze Document"}
          </Button>
          {files.length > 0 && (
            <Button
              onClick={() => setFiles([])}
              variant="outline"
            >
              Clear All
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}