import React, { useRef, useState } from "react";
import { Upload, FileText, XCircle, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import ProgressFeedback from "@/components/ui/progress-feedback";
import { base44 } from "@/api/base44Client";
import { invokeLLM } from "@/lib/invokeLLM";
import { validateReferralFile, formatBytes, REFERRAL_ACCEPT_ATTR } from "../referral/referralUploadUtils";
import { runAdrLetterAnalysis } from "./adrAnalysis";
import { buildAdrChecklist } from "./adrRequirements";

const processingStages = [
  "Uploading the ADR letter...",
  "Reading the letter and contractor instructions...",
  "Extracting every requested item verbatim...",
  "Merging with the CMS documentation baseline...",
];

/**
 * Upload + analyze an ADR/audit letter. Lifts the finished analysis to the
 * parent via onComplete({ letterFileUrl, fileName, analysis, checklist }) —
 * the parent owns entity creation so the dialog stays reusable.
 * onProcessingChange(bool) lets the parent lock its dialog while a billed
 * upload + LLM analysis is in flight.
 */
export default function AdrLetterAnalyzer({ onComplete, onProcessingChange }) {
  const fileInputRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lastFileRef = useRef(null);
  const mountedRef = useRef(true);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState(0);
  const [processingError, setProcessingError] = useState(null);

  React.useEffect(
    () => () => {
      mountedRef.current = false;
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    },
    []
  );

  const setProcessing = (value) => {
    setIsProcessing(value);
    onProcessingChange?.(value);
  };

  const processFile = async (file) => {
    const { valid, error } = validateReferralFile(file);
    if (!valid) {
      toast.error(error);
      return;
    }
    lastFileRef.current = file;
    setProcessingError(null);
    setProcessing(true);
    setProcessingStage(0);
    const progressInterval = setInterval(
      () => setProcessingStage((prev) => Math.min(prev + 1, processingStages.length - 1)),
      2500
    );
    progressIntervalRef.current = progressInterval;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setProcessingStage(1);
      const analysis = await runAdrLetterAnalysis(invokeLLM, { fileUrl: file_url });
      if (!analysis || !Array.isArray(analysis.requested_items)) {
        throw new Error("The letter analysis returned no usable result");
      }
      const checklist = buildAdrChecklist({
        letterItems: analysis.requested_items,
        auditType: analysis.audit_type,
      });
      clearInterval(progressInterval);
      // If the analyzer was unmounted mid-flight (dialog forced closed), a
      // late completion must not create a case behind the user's back.
      if (!mountedRef.current) return;
      setProcessing(false);
      toast.success(
        `Letter analyzed: ${analysis.requested_items.length} requested item${analysis.requested_items.length === 1 ? "" : "s"} found, ${checklist.length} checklist items prepared`
      );
      onComplete?.({ letterFileUrl: file_url, fileName: file.name, analysis, checklist });
    } catch (err) {
      clearInterval(progressInterval);
      if (!mountedRef.current) return;
      setProcessing(false);
      const message =
        err?.code === "AI_TIMEOUT"
          ? "Letter analysis timed out. Try again — a clearer scan also helps."
          : "Failed to analyze the ADR letter. Please try again.";
      setProcessingError(message);
      toast.error(message);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processFile(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    const file = e.dataTransfer?.files?.[0];
    if (file) processFile(file);
  };

  const retryProcessing = () => {
    if (lastFileRef.current) processFile(lastFileRef.current);
  };

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept={REFERRAL_ACCEPT_ATTR}
        onChange={handleFileUpload}
        disabled={isProcessing}
        className="sr-only"
        aria-label="Upload ADR or audit letter"
      />
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        disabled={isProcessing}
        aria-label="Upload the ADR or audit letter (PDF or scanned image)"
        className={`w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
        } ${isProcessing ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
        <p className="font-medium text-slate-700">Upload the ADR or audit letter</p>
        <p className="text-sm text-slate-500 mt-1">
          PDF or scanned image, up to {formatBytes(25 * 1024 * 1024)}. Every page of the letter — including the
          barcode/cover page — should be in one file.
        </p>
      </button>

      {isProcessing && (
        <ProgressFeedback
          stages={processingStages}
          currentStage={processingStage}
          message="Analyzing the letter with AI"
        />
      )}

      {processingError && !isProcessing && (
        <Alert className="bg-red-50 border-red-300">
          <XCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="flex items-center justify-between gap-3 text-red-900">
            <span>{processingError}</span>
            <Button size="sm" variant="outline" onClick={retryProcessing} className="min-h-[36px]">
              <RefreshCw className="w-3 h-3 mr-1" />
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {!isProcessing && !processingError && (
        <Alert className="bg-blue-50 border-blue-200">
          <FileText className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-900 text-sm">
            The letter will be read page by page: the review program, claim, beneficiary, response deadline, and every
            requested item are extracted verbatim, then merged with the CMS home-health documentation baseline
            (42 CFR 409.43, 424.22, 484.55/484.60) into a working checklist.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
