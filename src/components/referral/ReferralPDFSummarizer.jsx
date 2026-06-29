import React, { useState, useRef } from "react";
import { toast } from "sonner";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { runReferralExtraction } from "./referralExtraction";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import AIFieldIndicator from "@/components/ui/ai-field-indicator";
import ProgressFeedback from "@/components/ui/progress-feedback";
import {
  validateReferralFile,
  resolveMimeType,
  formatBytes,
  REFERRAL_ACCEPT_ATTR,
} from "./referralUploadUtils";
import {
  FileText,
  UploadCloud,
  CheckCircle2,
  Copy,
  ArrowRight,
  User,
  Pill,
  Activity,
  Stethoscope,
  AlertCircle,
  AlertTriangle,
  Download,
  Brain,
  RefreshCw,
  ShieldAlert,
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import AISmartOASISAssistant from "../oasis/AISmartOASISAssistant";
import AIAdmissionNoteGenerator from "./AIAdmissionNoteGenerator";
import AICarePlanSuggestionEngine from "./AICarePlanSuggestionEngine";
import AdmissionPacketCustomizer from "./AdmissionPacketCustomizer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const processingStages = [
  "Analyzing document structure...",
  "Extracting patient demographics...",
  "Identifying diagnoses and medications...",
  "Analyzing functional status...",
  "Generating OASIS assessment...",
  "Finalizing extraction..."
];

export default function ReferralPDFSummarizer({
  onDataExtracted,
  onUseForAdmission,
  patientId = null,
  fileUrl: externalFileUrl = null,
  onExtractionComplete = null
}) {
  const [isUploading, setIsUploading] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState(0);
  const [fileUrl, setFileUrl] = useState(externalFileUrl);
  const [fileName, setFileName] = useState(null);
  const [extractedData, setExtractedData] = useState(null);
  const [processingError, setProcessingError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [generatingPDF, setGeneratingPDF] = useState(false);
  const [generatedPdfUrl, setGeneratedPdfUrl] = useState(null);
  const [oasisResults, setOasisResults] = useState(null);
  const [showPreview, setShowPreview] = useState(true);
  const fileInputRef = useRef(null);
  const progressIntervalRef = useRef(null);
  // Remember the last document we processed so "Try again" can re-run without re-upload.
  const lastProcessedRef = useRef({ url: externalFileUrl, mime: "application/pdf" });

  // Real per-section AI confidence (0-100) self-reported by the extraction model,
  // falling back to a neutral default for older data that predates the field.
  const getConfidence = (section, fallback) => {
    const value = extractedData?.extraction_confidence?.[section];
    return typeof value === "number" && !Number.isNaN(value) ? Math.round(value) : fallback;
  };

  // Whether the uploaded source document should render as an image vs. a PDF frame.
  const previewMime = lastProcessedRef.current?.mime || "";
  const previewIsImage =
    previewMime.startsWith("image/") || /\.(png|jpe?g|tiff?|gif|webp)(\?|$)/i.test(fileUrl || "");

  // Check if current user is admin
  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const isAdmin = currentUser?.role === 'admin';

  // Clear the progress interval if the component unmounts mid-processing.
  React.useEffect(() => () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  }, []);

  // Shared entry point for both the file picker and drag-and-drop.
  const handleFile = async (file) => {
    if (!file) return;

    const { valid, error } = validateReferralFile(file);
    if (!valid) {
      toast.error(error);
      return;
    }

    setProcessingError(null);
    setFileName(file.name);
    setIsUploading(true);
    try {
      const result = await base44.integrations.Core.UploadFile({ file });
      // Preserve the real resolved MIME (with extension fallback for type-less
      // scanner/fax uploads) so downstream context/logging stays accurate.
      const mime = resolveMimeType(file) || "application/pdf";
      setFileUrl(result.file_url);
      lastProcessedRef.current = { url: result.file_url, mime };
      setIsUploading(false);
      await processReferral(result.file_url, mime);
    } catch (error) {
      console.error("Error uploading file:", error);
      toast.error("Failed to upload file. Please check your connection and try again.");
      setIsUploading(false);
    }
  };

  const handleFileUpload = (e) => {
    handleFile(e.target.files?.[0]);
    // Allow re-selecting the same file after a reset or error.
    e.target.value = "";
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (isUploading || isProcessing) return;
    handleFile(e.dataTransfer?.files?.[0]);
  };

  const handleReset = () => {
    setExtractedData(null);
    setProcessingError(null);
    setFileUrl(null);
    setFileName(null);
    setGeneratedPdfUrl(null);
    setOasisResults(null);
    lastProcessedRef.current = { url: null, mime: "application/pdf" };
  };

  const retryProcessing = () => {
    const { url, mime } = lastProcessedRef.current;
    if (url) {
      processReferral(url, mime);
    } else {
      fileInputRef.current?.click();
    }
  };

  /**
   * Generate the admission packet PDF and upload it to obtain a permanent URL.
   * The browser download is opt-in via `download` so embedded/auto flows don't
   * spam the user with surprise downloads on every extraction.
   */
  const buildAdmissionPacket = React.useCallback(async (data = extractedData, { download = false } = {}) => {
    if (!data) return null;

    setGeneratingPDF(true);
    try {
      const response = await base44.functions.invoke('generateReferralOASISPacket', {
        referralData: data
      });

      // Convert blob to file and upload to get permanent URL. Use a
      // non-identifying filename — embedding the patient's name would leak PHI
      // into browser download history and stored file metadata.
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const file = new File([blob], `admission_packet_${Date.now()}.pdf`, { type: 'application/pdf' });

      // Upload to get permanent URL
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setGeneratedPdfUrl(file_url);

      if (download) {
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        a.remove();
        toast.success("Admission packet downloaded.");
      }

      return file_url;
    } catch (error) {
      console.error('Error generating PDF:', error);
      if (download) {
        toast.error('Failed to generate admission packet. Please try again.');
      }
      return null;
    } finally {
      setGeneratingPDF(false);
    }
  }, [extractedData]);

  const processReferral = React.useCallback(async (url, fileType = 'application/pdf') => {
    setIsProcessing(true);
    setProcessingStage(0);
    // Drop any packet URL cached from a previously processed document so a
    // failed regeneration can never open the prior patient's admission packet.
    setGeneratedPdfUrl(null);

    const progressInterval = setInterval(() => {
      setProcessingStage(prev => Math.min(prev + 1, processingStages.length - 1));
    }, 3000);
    progressIntervalRef.current = progressInterval;

    try {
      const result = await runReferralExtraction(invokeLLM, { fileUrl: url, fileType });

      clearInterval(progressInterval);
      setProcessingStage(processingStages.length - 1);
      setProcessingError(null);

      setExtractedData(result);
      onDataExtracted?.(result);

      // Silently generate + store the admission packet so external workflows
      // (e.g. referral intake) get a permanent URL. The browser download only
      // happens when the user explicitly clicks "Admission Packet PDF".
      let pdfUrl = null;
      try {
        pdfUrl = await buildAdmissionPacket(result, { download: false });
      } catch (pdfError) {
        console.error("Error generating admission packet:", pdfError);
      }

      // Callback for external workflows (referral intake)
      if (onExtractionComplete) {
        onExtractionComplete(result, result, pdfUrl);
      }
      toast.success("Referral processed successfully.");
    } catch (error) {
      clearInterval(progressInterval);
      console.error('Error processing referral:', error);
      const message = error?.code === "AI_TIMEOUT"
        ? "Processing timed out. The document may be large or the service is busy — try again."
        : "Failed to process referral. Please try again.";
      setProcessingError(message);
      toast.error(message);
    } finally {
      setIsProcessing(false);
      setProcessingStage(0);
    }
  }, [onDataExtracted, onExtractionComplete, buildAdmissionPacket]);

  // Auto-process if fileUrl is provided externally
  React.useEffect(() => {
    if (externalFileUrl && !extractedData && !isProcessing) {
      setFileUrl(externalFileUrl);
      lastProcessedRef.current = { url: externalFileUrl, mime: "application/pdf" };
      processReferral(externalFileUrl);
    }
  }, [externalFileUrl, extractedData, isProcessing, processReferral]);

  const copySection = (text, label = "Section") => {
    navigator.clipboard.writeText(text)
      .then(() => toast.success(`${label} copied to clipboard`))
      .catch(() => toast.error("Unable to copy to clipboard"));
  };

  const copyAll = () => {
    const allText = JSON.stringify(extractedData, null, 2);
    copySection(allText, "All referral data");
  };

  // Explicit user-initiated download (button click).
  const downloadAdmissionPacket = async () => {
    if (generatedPdfUrl) {
      // Already generated during extraction — just open it, no re-generation.
      window.open(generatedPdfUrl, "_blank", "noopener");
      return;
    }
    await buildAdmissionPacket(extractedData, { download: true });
  };

  return (
    <div className="space-y-4">
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-blue-600" />
            Patient Referral PDF Summarizer
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-slate-600">
            Upload a patient referral PDF to automatically extract all relevant information for admission assessment and OASIS completion.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept={REFERRAL_ACCEPT_ATTR}
            onChange={handleFileUpload}
            disabled={isUploading || isProcessing}
            className="sr-only"
          />

          <button
            type="button"
            onClick={() => !isUploading && !isProcessing && fileInputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); if (!isUploading && !isProcessing) setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
            disabled={isUploading || isProcessing}
            aria-label="Upload referral document"
            className={`w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400 ${
              isDragging
                ? "border-blue-500 bg-blue-50"
                : "border-slate-300 bg-slate-50 hover:border-blue-400 hover:bg-blue-50"
            } ${(isUploading || isProcessing) ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
          >
            {isUploading ? (
              <div className="flex items-center justify-center gap-2 text-blue-700">
                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600" />
                <span className="text-sm font-medium">Uploading{fileName ? ` ${fileName}` : ""}…</span>
              </div>
            ) : (
              <div className="flex flex-col items-center gap-1">
                <UploadCloud className="w-8 h-8 text-blue-500 mb-1" />
                <p className="text-sm font-medium text-slate-700">
                  {isDragging ? "Drop the file to upload" : "Drag & drop a referral here, or click to browse"}
                </p>
                <p className="text-xs text-slate-500">
                  PDFs and faxed images (PNG, JPG, TIFF) · up to {formatBytes(25 * 1024 * 1024)}
                </p>
              </div>
            )}
          </button>

          {fileName && !isUploading && !processingError && (
            <p className="text-xs text-slate-600 flex items-center gap-1">
              <FileText className="w-3 h-3" /> {fileName}
            </p>
          )}

          {isProcessing && (
            <ProgressFeedback
              stages={processingStages}
              currentStage={processingStage}
              message="Analyzing referral with AI"
            />
          )}

          {processingError && !isProcessing && (
            <Alert className="bg-red-50 border-red-300">
              <XCircle className="w-4 h-4 text-red-600" />
              <AlertDescription className="flex items-center justify-between gap-3 text-red-900">
                <span>{processingError}</span>
                <Button size="sm" variant="outline" onClick={retryProcessing} className="shrink-0">
                  <RefreshCw className="w-3 h-3 mr-1" />
                  Try Again
                </Button>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {extractedData && (
        <div className="space-y-4">
          <Card className="border-2 border-green-300 bg-green-50">
            <CardContent className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-green-600" />
                  <p className="font-medium text-green-900">Referral Processed Successfully</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {!externalFileUrl && (
                    <Button size="sm" variant="outline" onClick={handleReset}>
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Process Another
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={copyAll}>
                    <Copy className="w-4 h-4 mr-1" />
                    Copy All
                  </Button>
                  <Button
                    size="sm"
                    onClick={downloadAdmissionPacket}
                    disabled={generatingPDF}
                    className="bg-navy-600 hover:bg-navy-700"
                  >
                    {generatingPDF ? (
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-1" />
                    ) : (
                      <Download className="w-4 h-4 mr-1" />
                    )}
                    Admission Packet PDF
                  </Button>
                  {onUseForAdmission && (
                    <Button size="sm" onClick={() => onUseForAdmission(extractedData)} className="bg-green-600 hover:bg-green-700">
                      <ArrowRight className="w-4 h-4 mr-1" />
                      Use for Admission
                    </Button>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Trustworthiness: remind clinicians to verify AI output and surface
              the model's own self-reported items needing verification. */}
          <Alert className="bg-amber-50 border-amber-300">
            <ShieldAlert className="w-4 h-4 text-amber-600" />
            <AlertDescription className="text-amber-900">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <p className="font-semibold">AI-extracted — verify before clinical or billing use</p>
                {typeof extractedData.extraction_confidence?.overall === "number" && (
                  <Badge variant="outline" className="bg-white/60 border-amber-400 text-amber-800">
                    Overall AI confidence: {getConfidence('overall', 0)}%
                  </Badge>
                )}
              </div>
              <p className="text-sm">
                This summary was generated from the uploaded document and may contain
                transcription or interpretation errors. Confirm medications, diagnoses,
                and clinical values against the source before acting on them.
              </p>
              {extractedData.extraction_confidence?.low_confidence_fields?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Lowest-confidence fields — confirm against the source:
                  </p>
                  <ul className="list-disc list-inside text-sm mt-1">
                    {extractedData.extraction_confidence.low_confidence_fields.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {extractedData.oasis_assessment?.items_needing_verification?.length > 0 && (
                <div className="mt-2">
                  <p className="text-xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Items the AI flagged for verification:
                  </p>
                  <ul className="list-disc list-inside text-sm mt-1">
                    {extractedData.oasis_assessment.items_needing_verification.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {extractedData.oasis_assessment?.confidence_notes && (
                <p className="text-xs mt-2 italic">
                  AI confidence notes: {extractedData.oasis_assessment.confidence_notes}
                </p>
              )}
            </AlertDescription>
          </Alert>

          {/* Source document alongside the extraction so clinicians can verify
              extracted values against the original referral. On large screens the
              preview stays pinned while the extraction scrolls. */}
          <div className="grid xl:grid-cols-2 gap-4 items-start">
            {fileUrl && (
              <Card className="border-2 border-slate-200 overflow-hidden xl:sticky xl:top-4 order-first">
                <CardHeader className="py-3 border-b bg-slate-50">
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <FileText className="w-4 h-4 text-slate-600" />
                      Source Document
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      <a
                        href={fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3 h-3" /> Open
                      </a>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setShowPreview((v) => !v)}
                        aria-label={showPreview ? "Hide source document" : "Show source document"}
                      >
                        {showPreview ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                {showPreview && (
                  <CardContent className="p-0">
                    {previewIsImage ? (
                      <div className="max-h-[78vh] overflow-auto bg-slate-100">
                        <img src={fileUrl} alt="Referral source document" className="w-full h-auto" />
                      </div>
                    ) : (
                      <iframe
                        src={fileUrl}
                        title="Referral source document"
                        className="w-full h-[78vh] border-0 bg-slate-100"
                      />
                    )}
                    <p className="text-[11px] text-slate-500 p-2 border-t bg-white">
                      Compare the AI extraction against this source before clinical or billing use.
                    </p>
                  </CardContent>
                )}
              </Card>
            )}

          <div className={fileUrl ? "min-w-0" : "xl:col-span-2 min-w-0"}>
          <Accordion type="multiple" className="space-y-2">
            {/* Demographics */}
            <AccordionItem value="demographics">
              <AccordionTrigger className="bg-blue-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <User className="w-4 h-4 text-blue-600" />
                  <span className="font-semibold">Demographics & Contact Information</span>
                  <AIFieldIndicator confidence={getConfidence('demographics', 95)} source="AI" showValue />
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="grid md:grid-cols-2 gap-3">
                  {Object.entries(extractedData.demographics || {}).map(([key, value]) => (
                    value && value !== "Not documented in referral." && (
                      <div key={key} className="bg-slate-50 p-2 rounded">
                        <p className="text-xs font-semibold text-slate-600 capitalize">{key.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-slate-900">{value}</p>
                      </div>
                    )
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.demographics, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Admission Details */}
            <AccordionItem value="admission">
              <AccordionTrigger className="bg-navy-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-navy-600" />
                  <span className="font-semibold">Admission Details</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="space-y-2">
                  {Object.entries(extractedData.admission_details || {}).map(([key, value]) => (
                    value && value !== "Not documented in referral." && (
                      <div key={key} className="bg-navy-50 p-2 rounded">
                        <p className="text-xs font-semibold text-navy-900 capitalize">{key.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-slate-900">{value}</p>
                      </div>
                    )
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.admission_details, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Diagnoses */}
            <AccordionItem value="diagnoses">
              <AccordionTrigger className="bg-red-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Stethoscope className="w-4 h-4 text-red-600" />
                  <span className="font-semibold">Diagnoses & Medical History</span>
                  <AIFieldIndicator confidence={getConfidence('diagnoses', 92)} source="AI" showValue />
                  {isAdmin && extractedData.diagnoses?.pdgm_clinical_group && (
                    <Badge className="bg-green-600 text-white">PDGM: {extractedData.diagnoses.pdgm_clinical_group}</Badge>
                  )}
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="space-y-3">
                  <div className="bg-red-50 p-3 rounded border-l-4 border-red-500">
                    <p className="text-xs font-semibold text-red-900">Primary Diagnosis</p>
                    <p className="text-sm font-bold text-slate-900">{extractedData.diagnoses?.primary_diagnosis}</p>
                    {extractedData.diagnoses?.primary_icd10 && (
                      <Badge className="mt-1">{extractedData.diagnoses.primary_icd10}</Badge>
                    )}
                    {isAdmin && extractedData.diagnoses?.pdgm_clinical_group && (
                      <p className="text-xs text-green-700 font-semibold mt-1">PDGM Group: {extractedData.diagnoses.pdgm_clinical_group}</p>
                    )}
                  </div>
                  
                  {isAdmin && extractedData.diagnoses?.pdgm_optimization_notes && (
                    <div className="bg-green-50 p-3 rounded border-l-4 border-green-500">
                      <p className="text-xs font-semibold text-green-900 mb-1">💰 PDGM Optimization Notes</p>
                      <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.diagnoses.pdgm_optimization_notes}</p>
                    </div>
                  )}
                  
                  {extractedData.diagnoses?.secondary_diagnoses?.length > 0 && (
                    <div className="bg-orange-50 p-3 rounded">
                      <p className="text-xs font-semibold text-orange-900 mb-1">Secondary Diagnoses</p>
                      <ul className="list-disc list-inside text-sm text-slate-900">
                        {extractedData.diagnoses.secondary_diagnoses.map((dx, i) => (
                          <li key={i}>{dx}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  {isAdmin && extractedData.diagnoses?.comorbidity_adjustments?.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded border-l-4 border-blue-500">
                      <p className="text-xs font-semibold text-blue-900 mb-1">💵 Case-Mix Comorbidities</p>
                      <p className="text-xs text-blue-800 mb-2">These comorbidities increase PDGM reimbursement:</p>
                      <ul className="list-disc list-inside text-sm text-slate-900">
                        {extractedData.diagnoses.comorbidity_adjustments.map((comorb, i) => (
                          <li key={i}>{comorb}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {extractedData.diagnoses?.allergies && extractedData.diagnoses.allergies !== "Not documented in referral." && (
                    <Alert className="bg-yellow-50 border-yellow-300">
                      <AlertCircle className="w-4 h-4 text-yellow-600" />
                      <AlertDescription className="text-yellow-900">
                        <strong>Allergies:</strong> {extractedData.diagnoses.allergies}
                      </AlertDescription>
                    </Alert>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.diagnoses, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Medications */}
            <AccordionItem value="medications">
              <AccordionTrigger className="bg-green-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Pill className="w-4 h-4 text-green-600" />
                  <span className="font-semibold">Medications ({extractedData.medications?.length || 0})</span>
                  <AIFieldIndicator confidence={getConfidence('medications', 88)} source="AI" showValue />
                  <AIFieldIndicator needsVerification={true} tooltip="Verify all medications with patient/caregiver" />
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="space-y-2">
                  {extractedData.medications?.map((med, i) => (
                    <div key={i} className="bg-green-50 p-3 rounded border-l-2 border-green-500">
                      <p className="font-semibold text-sm text-slate-900">{med.name}</p>
                      <div className="grid grid-cols-2 gap-2 mt-1 text-xs text-slate-700">
                        {med.dosage && <p><strong>Dosage:</strong> {med.dosage}</p>}
                        {med.frequency && <p><strong>Frequency:</strong> {med.frequency}</p>}
                        {med.route && <p><strong>Route:</strong> {med.route}</p>}
                        {med.prescriber && <p><strong>Prescriber:</strong> {med.prescriber}</p>}
                      </div>
                      {med.notes && <p className="text-xs text-slate-600 mt-1 italic">{med.notes}</p>}
                    </div>
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.medications, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Medical History */}
            {(extractedData.diagnoses?.past_medical_history?.length > 0 || 
              extractedData.diagnoses?.surgical_history?.length > 0 || 
              extractedData.diagnoses?.family_medical_history) && (
              <AccordionItem value="medical-history">
                <AccordionTrigger className="bg-red-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-red-600" />
                    <span className="font-semibold">Detailed Medical History</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="space-y-3">
                    {extractedData.diagnoses?.past_medical_history?.length > 0 && (
                      <div className="bg-red-50 p-3 rounded">
                        <p className="text-xs font-semibold text-red-900 mb-2">Past Medical History</p>
                        <div className="space-y-2">
                          {extractedData.diagnoses.past_medical_history.map((item, i) => (
                            <div key={i} className="bg-white p-2 rounded border border-red-200">
                              <p className="text-sm font-semibold text-slate-900">{item.condition || item}</p>
                              {item.onset_date && <p className="text-xs text-slate-600">Onset: {item.onset_date}</p>}
                              {item.current_status && <p className="text-xs text-slate-600">Status: {item.current_status}</p>}
                              {item.management && <p className="text-xs text-slate-600">Management: {item.management}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {extractedData.diagnoses?.surgical_history?.length > 0 && (
                      <div className="bg-blue-50 p-3 rounded">
                        <p className="text-xs font-semibold text-blue-900 mb-2">Surgical History</p>
                        <div className="space-y-2">
                          {extractedData.diagnoses.surgical_history.map((item, i) => (
                            <div key={i} className="bg-white p-2 rounded border border-blue-200">
                              <p className="text-sm font-semibold text-slate-900">{item.procedure || item}</p>
                              {item.date && <p className="text-xs text-slate-600">Date: {item.date}</p>}
                              {item.complications && <p className="text-xs text-slate-600">Complications: {item.complications}</p>}
                              {item.surgeon && <p className="text-xs text-slate-600">Surgeon: {item.surgeon}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {Array.isArray(extractedData.diagnoses?.recent_hospitalizations) && extractedData.diagnoses.recent_hospitalizations.length > 0 && (
                      <div className="bg-navy-50 p-3 rounded">
                        <p className="text-xs font-semibold text-navy-900 mb-2">Recent Hospitalizations</p>
                        <div className="space-y-2">
                          {extractedData.diagnoses.recent_hospitalizations.map((item, i) => (
                            <div key={i} className="bg-white p-2 rounded border border-navy-200">
                              <p className="text-sm font-semibold text-slate-900">{item.reason || item}</p>
                              {item.date && <p className="text-xs text-slate-600">Date: {item.date}</p>}
                              {item.hospital && <p className="text-xs text-slate-600">Hospital: {item.hospital}</p>}
                              {item.length_of_stay && <p className="text-xs text-slate-600">Length of Stay: {item.length_of_stay}</p>}
                              {item.outcome && <p className="text-xs text-slate-600">Outcome: {item.outcome}</p>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {extractedData.diagnoses?.family_medical_history && (
                      <div className="bg-amber-50 p-3 rounded">
                        <p className="text-xs font-semibold text-amber-900 mb-2">Family Medical History</p>
                        {extractedData.diagnoses.family_medical_history.hereditary_conditions?.length > 0 && (
                          <div className="mb-2">
                            <p className="text-xs text-amber-800 font-medium">Hereditary Conditions:</p>
                            <ul className="list-disc list-inside text-sm text-slate-900 ml-2">
                              {extractedData.diagnoses.family_medical_history.hereditary_conditions.map((cond, i) => (
                                <li key={i}>{cond}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {extractedData.diagnoses.family_medical_history.genetic_predispositions && (
                          <p className="text-sm text-slate-900 mb-1">
                            <strong>Genetic Predispositions:</strong> {extractedData.diagnoses.family_medical_history.genetic_predispositions}
                          </p>
                        )}
                        {extractedData.diagnoses.family_medical_history.family_mental_health && (
                          <p className="text-sm text-slate-900">
                            <strong>Family Mental Health:</strong> {extractedData.diagnoses.family_medical_history.family_mental_health}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify({
                    past_medical_history: extractedData.diagnoses?.past_medical_history,
                    surgical_history: extractedData.diagnoses?.surgical_history,
                    recent_hospitalizations: extractedData.diagnoses?.recent_hospitalizations,
                    family_medical_history: extractedData.diagnoses?.family_medical_history
                  }, null, 2))}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Section
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Nutritional Status */}
            {extractedData.nutritional_status && Object.values(extractedData.nutritional_status).some(v => v && v !== "Not documented in referral.") && (
              <AccordionItem value="nutrition">
                <AccordionTrigger className="bg-green-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-green-600" />
                    <span className="font-semibold">Nutritional Status & Assessment</span>
                    <AIFieldIndicator confidence={getConfidence('nutritional_status', 88)} source="AI" showValue />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="grid md:grid-cols-2 gap-3">
                    {extractedData.nutritional_status.current_weight && (
                      <div className="bg-green-50 p-2 rounded">
                        <p className="text-xs font-semibold text-green-900">Current Weight</p>
                        <p className="text-sm text-slate-900">{extractedData.nutritional_status.current_weight}</p>
                      </div>
                    )}
                    {extractedData.nutritional_status.height && (
                      <div className="bg-green-50 p-2 rounded">
                        <p className="text-xs font-semibold text-green-900">Height</p>
                        <p className="text-sm text-slate-900">{extractedData.nutritional_status.height}</p>
                      </div>
                    )}
                    {extractedData.nutritional_status.bmi && (
                      <div className="bg-green-50 p-2 rounded">
                        <p className="text-xs font-semibold text-green-900">BMI</p>
                        <p className="text-sm text-slate-900">{extractedData.nutritional_status.bmi}</p>
                      </div>
                    )}
                    {extractedData.nutritional_status.recent_weight_changes && (
                      <div className="bg-yellow-50 p-2 rounded border-l-2 border-yellow-500">
                        <p className="text-xs font-semibold text-yellow-900">Recent Weight Changes</p>
                        <p className="text-sm text-slate-900">{extractedData.nutritional_status.recent_weight_changes}</p>
                      </div>
                    )}
                  </div>
                  
                  {extractedData.nutritional_status.dietary_restrictions?.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded mt-3">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Dietary Restrictions</p>
                      <div className="flex flex-wrap gap-1">
                        {extractedData.nutritional_status.dietary_restrictions.map((restriction, i) => (
                          <Badge key={i} className="bg-blue-600">{restriction}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  
                  {extractedData.nutritional_status.swallowing_difficulties && (
                    <Alert className="mt-3 bg-red-50 border-red-300">
                      <AlertCircle className="w-4 h-4 text-red-600" />
                      <AlertDescription className="text-red-900">
                        <strong>Swallowing Difficulties:</strong> {extractedData.nutritional_status.swallowing_difficulties}
                        {extractedData.nutritional_status.dysphagia_level && ` (${extractedData.nutritional_status.dysphagia_level})`}
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  {extractedData.nutritional_status.nutritional_risk_factors?.length > 0 && (
                    <div className="bg-red-50 p-3 rounded mt-3 border-l-4 border-red-500">
                      <p className="text-xs font-semibold text-red-900 mb-1">Nutritional Risk Factors</p>
                      <ul className="list-disc list-inside text-sm text-slate-900">
                        {extractedData.nutritional_status.nutritional_risk_factors.map((factor, i) => (
                          <li key={i}>{factor}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.nutritional_status, null, 2))}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Section
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Wound Details */}
            {extractedData.wound_details?.length > 0 && (
              <AccordionItem value="wounds">
                <AccordionTrigger className="bg-orange-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-600" />
                    <span className="font-semibold">Detailed Wound Assessment ({extractedData.wound_details.length})</span>
                    <AIFieldIndicator confidence={getConfidence('wound_details', 90)} source="AI" showValue />
                    <AIFieldIndicator needsVerification={true} />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="space-y-4">
                    {extractedData.wound_details.map((wound, i) => (
                      <div key={i} className="bg-orange-50 p-4 rounded border-l-4 border-orange-500">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className="bg-orange-600">{wound.wound_type || 'Wound'} #{i + 1}</Badge>
                          {wound.stage && <Badge variant="outline">{wound.stage}</Badge>}
                        </div>
                        
                        <div className="grid md:grid-cols-3 gap-2 mt-2">
                          {wound.location && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Location</p>
                              <p className="text-sm text-slate-900">{wound.location}</p>
                            </div>
                          )}
                          {(wound.size_length_cm || wound.size_width_cm || wound.size_depth_cm) && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Size (L × W × D)</p>
                              <p className="text-sm text-slate-900">
                                {wound.size_length_cm || '?'} × {wound.size_width_cm || '?'} × {wound.size_depth_cm || '?'} cm
                              </p>
                            </div>
                          )}
                          {wound.exudate_type && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Exudate</p>
                              <p className="text-sm text-slate-900">
                                {wound.exudate_type} {wound.exudate_amount && `(${wound.exudate_amount})`}
                              </p>
                            </div>
                          )}
                          {wound.wound_bed_appearance && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Wound Bed</p>
                              <p className="text-sm text-slate-900">{wound.wound_bed_appearance}</p>
                            </div>
                          )}
                          {wound.surrounding_skin && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Surrounding Skin</p>
                              <p className="text-sm text-slate-900">{wound.surrounding_skin}</p>
                            </div>
                          )}
                          {wound.pain_level && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-orange-900">Pain Level</p>
                              <p className="text-sm text-slate-900">{wound.pain_level}</p>
                            </div>
                          )}
                        </div>
                        
                        {(wound.undermining_cm || wound.tunneling_cm) && (
                          <div className="bg-red-50 p-2 rounded mt-2">
                            <p className="text-xs font-semibold text-red-900">⚠️ Undermining/Tunneling</p>
                            <p className="text-sm text-slate-900">
                              {wound.undermining_cm && `Undermining: ${wound.undermining_cm}`}
                              {wound.undermining_cm && wound.tunneling_cm && ' | '}
                              {wound.tunneling_cm && `Tunneling: ${wound.tunneling_cm}`}
                            </p>
                          </div>
                        )}
                        
                        {wound.current_treatment && (
                          <div className="bg-blue-50 p-2 rounded mt-2">
                            <p className="text-xs font-semibold text-blue-900">Current Treatment</p>
                            <p className="text-sm text-slate-900">{wound.current_treatment}</p>
                          </div>
                        )}
                        
                        {wound.odor_present && (
                          <div className="bg-yellow-50 p-2 rounded mt-2">
                            <p className="text-xs font-semibold text-yellow-900">Odor Present</p>
                            <p className="text-sm text-slate-900">{wound.odor_character || 'Yes'}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.wound_details, null, 2))}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Wound Assessment
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Social Determinants & Mental Health */}
            {extractedData.psychosocial && (
              <AccordionItem value="psychosocial">
                <AccordionTrigger className="bg-navy-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-navy-600" />
                    <span className="font-semibold">Psychosocial & Social Determinants of Health</span>
                    <AIFieldIndicator confidence={getConfidence('psychosocial', 85)} source="AI" showValue />
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="space-y-4">
                    {/* Mental Health Assessment */}
                    {extractedData.psychosocial.mental_health_assessment && (
                      <div className="bg-navy-50 p-3 rounded border-l-4 border-navy-500">
                        <p className="text-xs font-semibold text-navy-900 mb-2">Mental Health & Behavioral Assessment</p>
                        
                        {extractedData.psychosocial.mental_health_assessment.psychiatric_diagnoses?.length > 0 && (
                          <div className="mb-2">
                            <p className="text-xs text-navy-800 font-medium">Psychiatric Diagnoses:</p>
                            <div className="flex flex-wrap gap-1 mt-1">
                              {extractedData.psychosocial.mental_health_assessment.psychiatric_diagnoses.map((dx, i) => (
                                <Badge key={i} className="bg-navy-600">{dx}</Badge>
                              ))}
                            </div>
                          </div>
                        )}
                        
                        {extractedData.psychosocial.mental_health_assessment.current_symptoms && (
                          <p className="text-sm text-slate-900 mb-1">
                            <strong>Current Symptoms:</strong> {extractedData.psychosocial.mental_health_assessment.current_symptoms}
                          </p>
                        )}
                        
                        {extractedData.psychosocial.mental_health_assessment.symptom_severity && (
                          <p className="text-sm text-slate-900 mb-1">
                            <strong>Severity:</strong> {extractedData.psychosocial.mental_health_assessment.symptom_severity}
                          </p>
                        )}
                        
                        {extractedData.psychosocial.mental_health_assessment.coping_mechanisms && (
                          <p className="text-sm text-slate-900 mb-1">
                            <strong>Coping Mechanisms:</strong> {extractedData.psychosocial.mental_health_assessment.coping_mechanisms}
                          </p>
                        )}
                        
                        {extractedData.psychosocial.mental_health_assessment.substance_use_history && (
                          <p className="text-sm text-slate-900">
                            <strong>Substance Use:</strong> {extractedData.psychosocial.mental_health_assessment.substance_use_history}
                          </p>
                        )}
                      </div>
                    )}
                    
                    {/* Social Determinants */}
                    {extractedData.psychosocial.social_determinants && (
                      <div className="bg-navy-50 p-3 rounded border-l-4 border-navy-500">
                        <p className="text-xs font-semibold text-navy-900 mb-2">Social Determinants of Health</p>
                        
                        <div className="grid md:grid-cols-2 gap-2">
                          {extractedData.psychosocial.social_determinants.living_situation && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Living Situation</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.living_situation}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.caregiver_availability && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Caregiver Availability</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.caregiver_availability}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.financial_concerns && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Financial Concerns</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.financial_concerns}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.transportation_barriers && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Transportation Barriers</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.transportation_barriers}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.food_insecurity && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Food Insecurity</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.food_insecurity}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.social_isolation && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Social Isolation</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.social_isolation}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.housing_stability && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Housing Stability</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.housing_stability}</p>
                            </div>
                          )}
                          
                          {extractedData.psychosocial.social_determinants.health_literacy && (
                            <div className="bg-white p-2 rounded">
                              <p className="text-xs font-semibold text-navy-900">Health Literacy</p>
                              <p className="text-sm text-slate-900">{extractedData.psychosocial.social_determinants.health_literacy}</p>
                            </div>
                          )}
                        </div>
                        
                        {extractedData.psychosocial.social_determinants.caregiver_burnout_signs && (
                          <Alert className="mt-2 bg-yellow-50 border-yellow-300">
                            <AlertCircle className="w-4 h-4 text-yellow-600" />
                            <AlertDescription className="text-yellow-900">
                              <strong>Caregiver Burnout Signs:</strong> {extractedData.psychosocial.social_determinants.caregiver_burnout_signs}
                            </AlertDescription>
                          </Alert>
                        )}
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.psychosocial, null, 2))}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Section
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Functional Status */}
            <AccordionItem value="functional">
              <AccordionTrigger className="bg-indigo-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-indigo-600" />
                  <span className="font-semibold">Functional Status (OASIS Relevant)</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="grid md:grid-cols-2 gap-3">
                  {Object.entries(extractedData.functional_status || {}).map(([key, value]) => (
                    value && value !== "Not documented in referral." && (
                      <div key={key} className="bg-indigo-50 p-2 rounded">
                        <p className="text-xs font-semibold text-indigo-900 capitalize">{key.replace(/_/g, ' ')}</p>
                        <p className="text-sm text-slate-900">{value}</p>
                      </div>
                    )
                  ))}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.functional_status, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Skilled Needs */}
            <AccordionItem value="skilled">
              <AccordionTrigger className="bg-yellow-50 px-4 py-3 rounded-t-lg">
                <div className="flex items-center gap-2">
                  <FileText className="w-4 h-4 text-yellow-600" />
                  <span className="font-semibold">Skilled Needs & Services</span>
                </div>
              </AccordionTrigger>
              <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                <div className="space-y-3">
                  {extractedData.skilled_needs?.services_ordered?.length > 0 && (
                    <div className="bg-yellow-50 p-3 rounded">
                      <p className="text-xs font-semibold text-yellow-900 mb-1">Services Ordered</p>
                      <div className="flex flex-wrap gap-1">
                        {extractedData.skilled_needs.services_ordered.map((service, i) => (
                          <Badge key={i} className="bg-yellow-600">{service}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                  {extractedData.skilled_needs?.specific_interventions?.length > 0 && (
                    <div className="bg-blue-50 p-3 rounded">
                      <p className="text-xs font-semibold text-blue-900 mb-1">Specific Interventions</p>
                      <ul className="list-disc list-inside text-sm text-slate-900">
                        {extractedData.skilled_needs.specific_interventions.map((int, i) => (
                          <li key={i}>{int}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.skilled_needs, null, 2))}>
                  <Copy className="w-3 h-3 mr-1" />
                  Copy Section
                </Button>
              </AccordionContent>
            </AccordionItem>

            {/* Handwritten Notes */}
            {extractedData.handwritten_notes && Object.values(extractedData.handwritten_notes).some(v => v) && (
              <AccordionItem value="handwritten">
                <AccordionTrigger className="bg-amber-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-amber-600" />
                    <span className="font-semibold">Handwritten Notes & Annotations</span>
                    <Badge className="bg-amber-500 text-white">Extracted</Badge>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="space-y-3">
                    {extractedData.handwritten_notes.clinical_notes && (
                      <div className="bg-amber-50 p-3 rounded border-l-4 border-amber-500">
                        <p className="text-xs font-semibold text-amber-900 mb-1">Clinical Notes (Handwritten)</p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.handwritten_notes.clinical_notes}</p>
                      </div>
                    )}
                    {extractedData.handwritten_notes.physician_instructions && (
                      <div className="bg-blue-50 p-3 rounded border-l-4 border-blue-500">
                        <p className="text-xs font-semibold text-blue-900 mb-1">Physician Instructions (Handwritten)</p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.handwritten_notes.physician_instructions}</p>
                      </div>
                    )}
                    {extractedData.handwritten_notes.margin_annotations && (
                      <div className="bg-navy-50 p-3 rounded border-l-4 border-navy-500">
                        <p className="text-xs font-semibold text-navy-900 mb-1">Margin Annotations</p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.handwritten_notes.margin_annotations}</p>
                      </div>
                    )}
                    {extractedData.handwritten_notes.priority_indicators && (
                      <div className="bg-red-50 p-3 rounded border-l-4 border-red-500">
                        <p className="text-xs font-semibold text-red-900 mb-1">Priority Indicators</p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.handwritten_notes.priority_indicators}</p>
                      </div>
                    )}
                    {extractedData.handwritten_notes.other_handwritten && (
                      <div className="bg-slate-50 p-3 rounded border-l-4 border-slate-500">
                        <p className="text-xs font-semibold text-slate-900 mb-1">Other Handwritten Content</p>
                        <p className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.handwritten_notes.other_handwritten}</p>
                      </div>
                    )}
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(JSON.stringify(extractedData.handwritten_notes, null, 2))}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Handwritten Notes
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Document Quality Notes */}
            {extractedData.document_quality_notes && (
              <AccordionItem value="quality">
                <AccordionTrigger className="bg-slate-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-slate-600" />
                    <span className="font-semibold">Document Quality Assessment</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="space-y-2">
                    {extractedData.document_quality_notes.legibility_assessment && (
                      <div className="bg-blue-50 p-2 rounded">
                        <p className="text-xs font-semibold text-blue-900">Legibility Assessment</p>
                        <p className="text-sm text-slate-900">{extractedData.document_quality_notes.legibility_assessment}</p>
                      </div>
                    )}
                    {extractedData.document_quality_notes.unclear_sections?.length > 0 && (
                      <div className="bg-yellow-50 p-2 rounded">
                        <p className="text-xs font-semibold text-yellow-900 mb-1">Unclear Sections</p>
                        <ul className="text-sm text-slate-900 list-disc list-inside">
                          {extractedData.document_quality_notes.unclear_sections.map((section, i) => (
                            <li key={i}>{section}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* Admission Note Template */}
            {extractedData.admission_note_template && (
              <AccordionItem value="template">
                <AccordionTrigger className="bg-navy-50 px-4 py-3 rounded-t-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-navy-600" />
                    <span className="font-semibold">AI-Generated Admission Note Template</span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="px-4 py-3 bg-white border-x border-b rounded-b-lg">
                  <div className="bg-navy-50 p-4 rounded border">
                    <pre className="text-sm text-slate-900 whitespace-pre-wrap">{extractedData.admission_note_template}</pre>
                  </div>
                  <Button size="sm" variant="ghost" className="mt-2" onClick={() => copySection(extractedData.admission_note_template)}>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Template
                  </Button>
                </AccordionContent>
              </AccordionItem>
            )}
          </Accordion>
          </div>
          </div>

          {/* AI Admission Note Generator */}
          <AIAdmissionNoteGenerator
            referralData={extractedData}
            autoGenerate={true}
            onNoteGenerated={() => {}}
          />

          {/* AI OASIS Assistant */}
          <Card className="border-2 border-navy-300">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-navy-600" />
                AI OASIS Pre-Assessment
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 mb-4">
                Based on the extracted referral data, our AI has analyzed and pre-populated relevant OASIS items with confidence scores and verification flags.
              </p>
              <AISmartOASISAssistant
                patientData={extractedData}
                referralData={extractedData}
                autoAnalyze={true}
                onApplySuggestion={(item) => {
                  setOasisResults(item);
                }}
              />
            </CardContent>
          </Card>

          {/* AI Care Plan Suggestions */}
          <AICarePlanSuggestionEngine
            referralData={extractedData}
            oasisData={oasisResults || extractedData.oasis_assessment}
            patientId={patientId}
            autoGenerate={true}
            onCarePlansGenerated={() => {}}
          />

          {/* Admission Packet Customizer */}
          <AdmissionPacketCustomizer 
            referralData={extractedData} 
            referralId={null}
          />
        </div>
      )}
    </div>
  );
}