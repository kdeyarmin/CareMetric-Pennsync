import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Upload,
  FileText,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  X,
  Eye
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription
} from "@/components/ui/dialog";

export default function DocumentIngestionUploader({ onDataExtracted, _patientId = null }) {
  const [isDragging, setIsDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [error, setError] = useState(null);
  const [showPreview, setShowPreview] = useState(false);

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      await processFile(files[0]);
    }
  };

  const handleFileSelect = async (e) => {
    const files = e.target.files;
    if (files.length > 0) {
      await processFile(files[0]);
    }
  };

  const processFile = async (file) => {
    if (!file.type.includes("pdf") && !file.type.includes("image")) {
      setError("Please upload a PDF or image file (JPG, PNG)");
      return;
    }

    setLoading(true);
    setError(null);
    setExtractedData(null);

    try {
      // Upload file
      const uploadResp = await base44.integrations.Core.UploadFile({ file });
      setUploadedFile({
        name: file.name,
        size: file.size,
        type: file.type,
        url: uploadResp.file_url
      });

      // Extract data
      const extractResp = await base44.functions.invoke('extractClinicalDocument', {
        file_url: uploadResp.file_url
      });

      if (extractResp.data?.success) {
        setExtractedData(extractResp.data.extracted_data);
        if (onDataExtracted) {
          onDataExtracted(extractResp.data.extracted_data);
        }
      } else {
        setError("Failed to extract data from document");
      }
    } catch (err) {
      setError(err.message || "Upload or extraction failed");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setUploadedFile(null);
    setExtractedData(null);
    setError(null);
    setShowPreview(false);
  };

  if (extractedData) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-4 shadow-sm space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <h3 className="font-semibold text-slate-900">Data Extracted Successfully</h3>
            </div>
            <p className="text-xs text-slate-500">{uploadedFile?.name}</p>
            {extractedData.document_info?.confidence_score && (
              <Badge className="mt-2 bg-blue-100 text-blue-800">
                {extractedData.document_info.confidence_score}% confidence
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" onClick={reset} className="text-slate-400">
            <X className="w-4 h-4" />
          </Button>
        </div>

        {extractedData.extraction_notes && (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-800 text-sm">
              {extractedData.extraction_notes}
            </AlertDescription>
          </Alert>
        )}

        <div className="grid grid-cols-2 gap-3 text-xs">
          <div>
            <p className="text-slate-500 font-medium mb-1">Patient</p>
            <p className="text-slate-900 font-semibold">
              {extractedData.patient?.first_name} {extractedData.patient?.last_name || "N/A"}
            </p>
            {extractedData.patient?.date_of_birth && (
              <p className="text-slate-600 text-xs mt-0.5">{extractedData.patient.date_of_birth}</p>
            )}
          </div>
          <div>
            <p className="text-slate-500 font-medium mb-1">Primary Diagnosis</p>
            <p className="text-slate-900">{extractedData.clinical?.primary_diagnosis || "N/A"}</p>
          </div>
          {extractedData.vitals?.blood_pressure_systolic && (
            <div>
              <p className="text-slate-500 font-medium mb-1">BP</p>
              <p className="text-slate-900">
                {extractedData.vitals.blood_pressure_systolic}/{extractedData.vitals.blood_pressure_diastolic}
              </p>
            </div>
          )}
          {extractedData.vitals?.heart_rate && (
            <div>
              <p className="text-slate-500 font-medium mb-1">HR</p>
              <p className="text-slate-900">{extractedData.vitals.heart_rate} bpm</p>
            </div>
          )}
        </div>

        <div className="flex gap-2 pt-2 border-t border-slate-100">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowPreview(true)}
            className="gap-1"
          >
            <Eye className="w-3.5 h-3.5" /> View Details
          </Button>
          <Button
            onClick={reset}
            variant="outline"
            size="sm"
            className="gap-1"
          >
            <Upload className="w-3.5 h-3.5" /> Upload Another
          </Button>
        </div>

        <Dialog open={showPreview} onOpenChange={setShowPreview}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogTitle>Extracted Clinical Data</DialogTitle>
            <DialogDescription className="text-xs text-slate-600 mb-4">
              Review and verify extracted information before mapping to patient profile
            </DialogDescription>
            <div className="space-y-4 text-sm">
              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Patient Demographics</h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg text-xs">
                  <div>
                    <p className="text-slate-600">Name</p>
                    <p className="font-medium">{extractedData.patient?.first_name} {extractedData.patient?.last_name}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">DOB</p>
                    <p className="font-medium">{extractedData.patient?.date_of_birth || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">MRN</p>
                    <p className="font-medium">{extractedData.patient?.medical_record_number || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Phone</p>
                    <p className="font-medium">{extractedData.patient?.phone || "N/A"}</p>
                  </div>
                </div>
              </div>

              {Object.values(extractedData.vitals || {}).some(v => v) && (
                <div>
                  <h4 className="font-semibold text-slate-900 mb-2">Vital Signs</h4>
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 p-3 rounded-lg text-xs">
                    {extractedData.vitals?.blood_pressure_systolic && (
                      <div>
                        <p className="text-slate-600">BP</p>
                        <p className="font-medium">{extractedData.vitals.blood_pressure_systolic}/{extractedData.vitals.blood_pressure_diastolic}</p>
                      </div>
                    )}
                    {extractedData.vitals?.heart_rate && (
                      <div>
                        <p className="text-slate-600">HR</p>
                        <p className="font-medium">{extractedData.vitals.heart_rate} bpm</p>
                      </div>
                    )}
                    {extractedData.vitals?.temperature && (
                      <div>
                        <p className="text-slate-600">Temp</p>
                        <p className="font-medium">{extractedData.vitals.temperature}°F</p>
                      </div>
                    )}
                    {extractedData.vitals?.oxygen_saturation && (
                      <div>
                        <p className="text-slate-600">O2</p>
                        <p className="font-medium">{extractedData.vitals.oxygen_saturation}%</p>
                      </div>
                    )}
                    {extractedData.vitals?.respiratory_rate && (
                      <div>
                        <p className="text-slate-600">RR</p>
                        <p className="font-medium">{extractedData.vitals.respiratory_rate}</p>
                      </div>
                    )}
                    {extractedData.vitals?.pain_level && (
                      <div>
                        <p className="text-slate-600">Pain</p>
                        <p className="font-medium">{extractedData.vitals.pain_level}/10</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Clinical Information</h4>
                <div className="space-y-2 bg-slate-50 p-3 rounded-lg text-xs">
                  <div>
                    <p className="text-slate-600">Chief Complaint</p>
                    <p className="font-medium">{extractedData.clinical?.chief_complaint || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Primary Diagnosis</p>
                    <p className="font-medium">{extractedData.clinical?.primary_diagnosis || "N/A"}</p>
                  </div>
                  {extractedData.clinical?.secondary_diagnoses?.length > 0 && (
                    <div>
                      <p className="text-slate-600">Secondary Diagnoses</p>
                      <p className="font-medium">{extractedData.clinical.secondary_diagnoses.join(", ")}</p>
                    </div>
                  )}
                  {extractedData.clinical?.allergies && (
                    <div>
                      <p className="text-slate-600">Allergies</p>
                      <p className="font-medium">{extractedData.clinical.allergies}</p>
                    </div>
                  )}
                  {extractedData.clinical?.current_medications?.length > 0 && (
                    <div>
                      <p className="text-slate-600">Medications</p>
                      <ul className="space-y-1">
                        {extractedData.clinical.current_medications.map((med, i) => (
                          <li key={i} className="font-medium">
                            {med.name} {med.dosage && `(${med.dosage})`} {med.frequency && `- ${med.frequency}`}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <h4 className="font-semibold text-slate-900 mb-2">Document Info</h4>
                <div className="grid grid-cols-2 gap-2 bg-slate-50 p-3 rounded-lg text-xs">
                  <div>
                    <p className="text-slate-600">Type</p>
                    <p className="font-medium capitalize">{extractedData.document_info?.document_type || "N/A"}</p>
                  </div>
                  <div>
                    <p className="text-slate-600">Date</p>
                    <p className="font-medium">{extractedData.document_info?.document_date || "N/A"}</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-slate-600">Source</p>
                    <p className="font-medium">{extractedData.document_info?.source_facility || "Unknown"}</p>
                  </div>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
          isDragging
            ? "border-indigo-500 bg-indigo-50"
            : "border-slate-300 bg-slate-50 hover:border-indigo-400"
        }`}
      >
        {loading ? (
          <>
            <Loader2 className="w-8 h-8 text-indigo-500 mx-auto mb-3 animate-spin" />
            <p className="font-semibold text-slate-800">Processing document…</p>
            <p className="text-xs text-slate-500 mt-1">Extracting clinical data with AI</p>
          </>
        ) : (
          <>
            <Upload className="w-8 h-8 text-slate-400 mx-auto mb-3" />
            <p className="font-semibold text-slate-900">Drop your document here or click to browse</p>
            <p className="text-xs text-slate-500 mt-1">PDF or scanned image (JPG, PNG)</p>
            <input
              type="file"
              accept=".pdf,image/*"
              onChange={handleFileSelect}
              className="hidden"
              id="doc-upload"
              disabled={loading}
            />
            <Button
              variant="outline"
              size="sm"
              className="mt-4"
              onClick={() => document.getElementById("doc-upload").click()}
              disabled={loading}
            >
              <FileText className="w-3.5 h-3.5 mr-1.5" /> Select File
            </Button>
          </>
        )}
      </div>

      {error && (
        <Alert className="border-red-300 bg-red-50">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-800">{error}</AlertDescription>
        </Alert>
      )}

      <p className="text-xs text-slate-500 text-center">
        Supported: Clinical records, faxes, lab results, imaging reports, medication lists
      </p>
    </div>
  );
}