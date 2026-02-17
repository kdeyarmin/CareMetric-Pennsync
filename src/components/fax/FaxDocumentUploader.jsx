import React, { useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Upload, Camera, FileText, X, Loader2, Image, File, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { jsPDF } from "jspdf";
import DocumentAnalysisResult from "./DocumentAnalysisResult";

export default function FaxDocumentUploader({ documents, onDocumentsChange, onDocumentAnalysis }) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [analyzingIndex, setAnalyzingIndex] = useState(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState({});

  const analyzeDocument = async (docUrl, docIndex) => {
    setAnalyzingIndex(docIndex);
    try {
      const res = await base44.integrations.Core.InvokeLLM({
        prompt: `You are a medical document analysis AI. Analyze the attached document and extract key entities and metadata. Be accurate — leave fields as empty strings if not found. Do NOT guess.

Extract:
- patient_name: Full name of the patient
- patient_dob: Date of birth
- mrn: Medical record number
- provider_name: Ordering/referring/treating provider
- document_type: Specific type (e.g. "Lab Results", "Referral Letter", "Discharge Summary", "Progress Note", "Prescription", "Imaging Report", "Consent Form", "Insurance Authorization", "Operative Report", "Medical Records Request")
- category: Broad category for filing (e.g. "Lab Results", "Referral", "Discharge Summary", "Progress Note", "Medical Records", "Prescription", "Insurance", "Consent Form", "Imaging Report", "Operative Report")
- date_of_service: Date of service or report date
- diagnosis: Primary diagnosis if present
- suggested_name: A concise descriptive filename (e.g. "Smith_John_Lab_Results_2026-02-17.pdf")
- tags: Array of 2-5 short keyword tags for searchability (e.g. ["CBC", "labs", "diabetes", "Dr. Johnson"])
- confidence: Your confidence level 0-100 in the extraction accuracy
- summary: One-sentence summary of the document`,
        file_urls: [docUrl],
        response_json_schema: {
          type: "object",
          properties: {
            patient_name: { type: "string" },
            patient_dob: { type: "string" },
            mrn: { type: "string" },
            provider_name: { type: "string" },
            document_type: { type: "string" },
            category: { type: "string" },
            date_of_service: { type: "string" },
            diagnosis: { type: "string" },
            suggested_name: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
            confidence: { type: "number" },
            summary: { type: "string" }
          }
        }
      });

      // Update the document with analysis
      const updatedDocs = [...documents];
      updatedDocs[docIndex] = { ...updatedDocs[docIndex], analysis: res };
      onDocumentsChange(updatedDocs);
      setExpandedAnalysis(prev => ({ ...prev, [docIndex]: true }));

      // Notify parent if callback provided
      if (onDocumentAnalysis) onDocumentAnalysis(docIndex, res);

      toast.success("Document analyzed");
    } catch (err) {
      console.error("Document analysis error:", err);
      toast.error("Failed to analyze document");
    } finally {
      setAnalyzingIndex(null);
    }
  };

  const uploadFile = async (file) => {
    setUploading(true);
    try {
      let newDoc;
      // If it's an image, convert to PDF
      if (file.type.startsWith('image/')) {
        const pdfFile = await convertImageToPDF(file);
        const { file_url } = await base44.integrations.Core.UploadFile({ file: pdfFile });
        newDoc = {
          name: file.name.replace(/\.[^.]+$/, '.pdf'),
          url: file_url,
          type: 'pdf',
          originalType: 'image',
          size: pdfFile.size
        };
        toast.success("Photo converted to PDF and uploaded");
      } else if (file.type === 'application/pdf') {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        newDoc = {
          name: file.name,
          url: file_url,
          type: 'pdf',
          originalType: 'pdf',
          size: file.size
        };
        toast.success("PDF uploaded");
      } else {
        toast.error("Please upload a PDF or image file");
        setUploading(false);
        return;
      }

      const newDocs = [...documents, newDoc];
      onDocumentsChange(newDocs);

      // Auto-analyze after upload
      setUploading(false);
      analyzeDocument(newDoc.url, newDocs.length - 1);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error("Failed to upload file");
      setUploading(false);
    }
  };

  const convertImageToPDF = (imageFile) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new window.Image();
        img.onload = () => {
          const doc = new jsPDF({
            orientation: img.width > img.height ? 'landscape' : 'portrait',
            unit: 'px',
            format: [img.width, img.height]
          });
          doc.addImage(e.target.result, 'JPEG', 0, 0, img.width, img.height);
          const pdfBlob = doc.output('blob');
          const pdfFile = new File([pdfBlob], imageFile.name.replace(/\.[^.]+$/, '.pdf'), { type: 'application/pdf' });
          resolve(pdfFile);
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(imageFile);
    });
  };

  const handleFileSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = '';
  };

  const removeDocument = (index) => {
    onDocumentsChange(documents.filter((_, i) => i !== index));
    setExpandedAnalysis(prev => {
      const next = {};
      Object.keys(prev).forEach(k => {
        const ki = parseInt(k);
        if (ki < index) next[ki] = prev[k];
        else if (ki > index) next[ki - 1] = prev[k];
      });
      return next;
    });
  };

  const applyRename = (index, newName) => {
    const updatedDocs = [...documents];
    updatedDocs[index] = { ...updatedDocs[index], name: newName };
    onDocumentsChange(updatedDocs);
    toast.success("Document renamed");
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  return (
    <Card>
      <CardHeader className="pb-2 p-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <FileText className="w-4 h-4" />
          Documents ({documents.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 pt-0 space-y-3">
        <input ref={fileInputRef} type="file" accept=".pdf,image/*" onChange={handleFileSelect} className="hidden" />
        <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" onChange={handleFileSelect} className="hidden" />

        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" onClick={() => fileInputRef.current?.click()} disabled={uploading} className="h-20 flex-col gap-1.5">
            {uploading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Upload className="w-5 h-5 text-blue-600" />}
            <span className="text-xs">Upload File</span>
            <span className="text-[10px] text-slate-400">PDF or Image</span>
          </Button>
          <Button variant="outline" onClick={() => cameraInputRef.current?.click()} disabled={uploading} className="h-20 flex-col gap-1.5">
            <Camera className="w-5 h-5 text-green-600" />
            <span className="text-xs">Take Photo</span>
            <span className="text-[10px] text-slate-400">Auto-converts to PDF</span>
          </Button>
        </div>

        {documents.length > 0 && (
          <div className="space-y-2">
            {documents.map((doc, index) => (
              <div key={index} className="bg-slate-50 rounded-lg border overflow-hidden">
                <div className="flex items-center gap-2 p-2">
                  {doc.originalType === 'image' ? (
                    <Image className="w-4 h-4 text-green-600 flex-shrink-0" />
                  ) : (
                    <File className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{doc.name}</p>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500">{formatSize(doc.size)}</span>
                      {doc.originalType === 'image' && (
                        <Badge className="text-[8px] px-1 py-0 bg-green-100 text-green-700">From photo</Badge>
                      )}
                      {doc.analysis?.category && (
                        <Badge className="text-[8px] px-1 py-0 bg-purple-100 text-purple-700">{doc.analysis.category}</Badge>
                      )}
                      {analyzingIndex === index && (
                        <Badge className="text-[8px] px-1 py-0 bg-purple-50 text-purple-600 animate-pulse">
                          <Sparkles className="w-2 h-2 mr-0.5" /> Analyzing...
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {!doc.analysis && analyzingIndex !== index && (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        title="Analyze document"
                        onClick={() => analyzeDocument(doc.url, index)}
                      >
                        <Sparkles className="w-3 h-3 text-purple-500" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => removeDocument(index)}>
                      <X className="w-3 h-3 text-red-500" />
                    </Button>
                  </div>
                </div>
                {/* Analysis result inline */}
                {doc.analysis && (
                  <div className="px-2 pb-2">
                    <DocumentAnalysisResult
                      analysis={doc.analysis}
                      expanded={expandedAnalysis[index]}
                      onToggle={() => setExpandedAnalysis(prev => ({ ...prev, [index]: !prev[index] }))}
                      onApplyName={(name) => applyRename(index, name)}
                    />
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {documents.length === 0 && (
          <p className="text-xs text-center text-slate-400 py-2">No documents attached yet</p>
        )}
      </CardContent>
    </Card>
  );
}