import React, { useRef, useState } from "react";
import {
  Upload,
  XCircle,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  FileWarning,
  FileCheck2,
  Download,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ProgressFeedback from "@/components/ui/progress-feedback";
import AICaveat from "@/components/ui/AICaveat";
import { base44 } from "@/api/base44Client";
import { invokeLLMWithFile } from "@/lib/invokeLLM";
import { runAdrPacketVerification } from "./adrAnalysis";
import { summarizePacketVerification, toPersistedVerification } from "./adrPacketReview";
import { isSafeExternalUrl } from "@/components/utils/security";

const MAX_PACKET_BYTES = 80 * 1024 * 1024; // scanned response packets run large

const processingStages = [
  "Uploading the assembled packet...",
  "Counting pages...",
  "Reviewing every page against the requirement checklist...",
  "Checking signatures, dates, and CMS compliance points...",
  "Compiling missing items and follow-ups...",
];

const statusBadge = (status) => {
  switch (status) {
    case "found":
      return <Badge className="bg-emerald-100 text-emerald-700 border border-emerald-200">Included</Badge>;
    case "partial":
      return <Badge className="bg-amber-100 text-amber-700 border border-amber-200">Partial</Badge>;
    case "not_applicable":
      return <Badge className="bg-slate-100 text-slate-600 border border-slate-200">N/A</Badge>;
    default:
      return <Badge className="bg-red-100 text-red-700 border border-red-200">Missing</Badge>;
  }
};

const severityText = (severity) =>
  severity === "critical" ? "text-red-700" : severity === "high" ? "text-amber-700" : "text-slate-600";

/** Count pages of a local PDF file without a network round-trip. */
async function countPdfPages(file) {
  try {
    const pdfjsLib = await import("pdfjs-dist");
    pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;
    const data = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    return pdf.numPages;
  } catch {
    return 0; // fall back to the AI's page_count_seen during summarization
  }
}

/**
 * Upload the assembled response packet, run the page-by-page verification
 * against the case checklist, render the honest readiness report, and generate
 * the final submission packet. Persists progress on the AdrAuditCase and calls
 * onUpdated() after every write so the parent refetches.
 */
export default function AdrPacketVerifier({ adrCase, onUpdated }) {
  const fileInputRef = useRef(null);
  const progressIntervalRef = useRef(null);
  const lastFileRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStage, setProcessingStage] = useState(0);
  const [processingError, setProcessingError] = useState(null);
  const [isGenerating, setIsGenerating] = useState(false);

  React.useEffect(
    () => () => {
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    },
    []
  );

  // The persisted summary only describes the CURRENT packet_file_url while the
  // case status says so. A re-upload moves status back to 'packet_uploaded'
  // before the long verification runs, so if that verification fails or the
  // page is reloaded mid-run, the previous packet's results (and its generated
  // final packet) must not be shown against the new file.
  const verifiedStatuses = ["packet_verified", "packet_generated", "submitted", "closed"];
  const summaryIsCurrent = verifiedStatuses.includes(adrCase?.status);
  const summary = summaryIsCurrent ? adrCase?.verification_summary : null;
  const finalPacketIsCurrent = ["packet_generated", "submitted", "closed"].includes(adrCase?.status);
  const checklist = adrCase?.checklist || [];

  const processPacket = async (file) => {
    if (!file) return;
    if (isGenerating) {
      toast.error("Wait for the final packet to finish generating before uploading a revised packet.");
      return;
    }
    if (file.type !== "application/pdf" && !/\.pdf$/i.test(file.name || "")) {
      toast.error("The packet must be a single PDF file. Combine your scans into one PDF first.");
      return;
    }
    if (file.size > MAX_PACKET_BYTES) {
      toast.error("Packet is larger than 80 MB. Split oversized attachments or rescan at a lower DPI.");
      return;
    }
    if (checklist.length === 0) {
      toast.error("Analyze the ADR letter first so the packet can be verified against its checklist.");
      return;
    }

    lastFileRef.current = file;
    setProcessingError(null);
    setIsProcessing(true);
    setProcessingStage(0);
    const progressInterval = setInterval(
      () => setProcessingStage((prev) => Math.min(prev + 1, processingStages.length - 1)),
      6000
    );
    progressIntervalRef.current = progressInterval;

    try {
      const { file_url } = await base44.integrations.Core.UploadFile({ file });
      setProcessingStage(1);
      const countedPages = await countPdfPages(file);
      await base44.entities.AdrAuditCase.update(adrCase.id, {
        packet_file_url: file_url,
        packet_page_count: countedPages,
        status: "packet_uploaded",
      });
      onUpdated?.();

      setProcessingStage(2);
      const verification = await runAdrPacketVerification(invokeLLMWithFile, {
        fileUrl: file_url,
        checklist,
      });
      if (!verification || !Array.isArray(verification.items)) {
        throw new Error("The packet verification returned no usable result");
      }
      // Page count for clamping AI page references: prefer the locally counted
      // pages; else the AI's own count; else the highest page the AI cited —
      // never a hard 1, which would erase every finding during sanitization.
      const reportedMax = Math.max(
        0,
        ...verification.items
          .flatMap((it) => (Array.isArray(it?.pages) ? it.pages.map(Number) : []))
          .filter((p) => Number.isInteger(p) && p >= 1)
      );
      const pageCount =
        countedPages || Math.max(Math.round(Number(verification.page_count_seen) || 0), reportedMax) || 1;
      const reviewSummary = summarizePacketVerification({ checklist, verification, pageCount });
      await base44.entities.AdrAuditCase.update(adrCase.id, {
        verification_summary: toPersistedVerification(reviewSummary),
        packet_page_count: pageCount,
        status: "packet_verified",
      });
      clearInterval(progressInterval);
      setIsProcessing(false);
      onUpdated?.();
      const { readiness } = reviewSummary;
      if (readiness.level === "ready") {
        toast.success("Packet verified: every required item was located.");
      } else {
        toast.warning(
          `Packet verified: ${reviewSummary.missing_count} missing, ${reviewSummary.follow_ups.length} follow-up${reviewSummary.follow_ups.length === 1 ? "" : "s"} — review before submitting.`
        );
      }
    } catch (err) {
      clearInterval(progressInterval);
      setIsProcessing(false);
      const message =
        err?.code === "AI_TIMEOUT"
          ? "Packet verification timed out — very large packets can exceed the review window. Try again."
          : "Failed to verify the packet. Please try again.";
      setProcessingError(message);
      toast.error(message);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) processPacket(file);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    if (isProcessing) return;
    processPacket(e.dataTransfer?.files?.[0]);
  };

  const generateFinalPacket = async () => {
    setIsGenerating(true);
    try {
      const response = await base44.functions.invoke("generateAdrPacket", { case_id: adrCase.id });
      const data = response?.data || {};
      if (!data.final_packet_url) {
        throw new Error(data.error || "No packet URL returned");
      }
      toast.success(`Final packet generated (${data.final_packet_pages} pages).`);
      onUpdated?.();
    } catch (err) {
      toast.error(err?.message || "Failed to generate the final packet.");
    } finally {
      setIsGenerating(false);
    }
  };

  const readiness = summary?.readiness || null;

  return (
    <div className="space-y-4">
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,application/pdf"
        onChange={handleFileUpload}
        disabled={isProcessing || isGenerating}
        className="sr-only"
        aria-label="Upload the assembled response packet PDF"
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
        disabled={isProcessing || isGenerating}
        aria-label="Upload the assembled response packet (single PDF)"
        className={`w-full rounded-lg border-2 border-dashed p-6 text-center transition-colors ${
          isDragging ? "border-blue-500 bg-blue-50" : "border-slate-300 hover:border-blue-400 hover:bg-slate-50"
        } ${isProcessing || isGenerating ? "opacity-60 cursor-not-allowed" : "cursor-pointer"}`}
      >
        <Upload className="w-8 h-8 mx-auto mb-2 text-slate-400" />
        <p className="font-medium text-slate-700">
          {summary ? "Upload a revised packet (re-runs verification)" : "Upload the assembled packet"}
        </p>
        <p className="text-sm text-slate-500 mt-1">
          One PDF containing everything on the checklist, in checklist order. Each page is reviewed against the
          requirements before the final packet is generated.
        </p>
      </button>

      {isProcessing && (
        <ProgressFeedback
          stages={processingStages}
          currentStage={processingStage}
          message="Verifying the packet page by page"
        />
      )}

      {processingError && !isProcessing && (
        <Alert className="bg-red-50 border-red-300">
          <XCircle className="w-4 h-4 text-red-600" />
          <AlertDescription className="flex items-center justify-between gap-3 text-red-900">
            <span>{processingError}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => lastFileRef.current && processPacket(lastFileRef.current)}
              className="min-h-[36px]"
            >
              <RefreshCw className="w-3 h-3 mr-1" />
              Try Again
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {summary && !isProcessing && (
        <div className="space-y-4">
          {readiness?.level === "ready" ? (
            <Alert className="bg-emerald-50 border-emerald-300">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <AlertDescription className="text-emerald-900">
                <span className="font-semibold">All applicable required items were located in the packet.</span>{" "}
                {summary.found_count} of {summary.items.length} requirements found
                {summary.na_count ? ` (${summary.na_count} not applicable to this claim)` : ""} across{" "}
                {summary.page_count ?? adrCase.packet_page_count} pages.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert className="bg-red-50 border-red-300">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <AlertDescription className="text-red-900">
                <span className="font-semibold">
                  {readiness?.level === "not_ready"
                    ? "Not submission-ready: required documentation is missing or deficient."
                    : "Needs attention before submitting."}
                </span>{" "}
                {summary.found_count} included · {summary.partial_count} partial · {summary.missing_count} missing
                {summary.na_count ? ` · ${summary.na_count} N/A` : ""}.
                {(readiness?.blocking || []).length > 0 && (
                  <ul className="list-disc pl-5 mt-1 space-y-0.5">
                    {readiness.blocking.map((b, i) => (
                      <li key={`${b.id}_${i}`}>
                        <span className="font-medium">{b.title}</span> — {b.reason.replace(/_/g, " ")} ({b.citation})
                      </li>
                    ))}
                  </ul>
                )}
              </AlertDescription>
            </Alert>
          )}

          {(summary.unreadable_pages || []).length > 0 && (
            <Alert className="bg-amber-50 border-amber-300">
              <FileWarning className="w-4 h-4 text-amber-600" />
              <AlertDescription className="text-amber-900">
                Pages too poor quality to review: {summary.unreadable_pages.join(", ")}. Rescan them if they carry
                required documentation.
              </AlertDescription>
            </Alert>
          )}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm font-semibold text-navy-700">
                Verification results ({summary.items.length} requirements)
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {summary.items.map((item) => (
                <div key={`${item.id}_${item.seq}`} className="border border-slate-200 rounded-lg p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    {statusBadge(item.status)}
                    <span className="font-medium text-slate-900">{item.title}</span>
                    {item.pages.length > 0 && (
                      <span className="text-xs text-slate-500">
                        packet page{item.pages.length > 1 ? "s" : ""} {item.pages.join(", ")}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">{item.citation}</p>
                  {item.na_reason && (
                    <p className="text-sm text-slate-600 mt-1">Not applicable: {item.na_reason}</p>
                  )}
                  {item.evidence && <p className="text-sm text-slate-600 mt-1">{item.evidence}</p>}
                  {item.reviewer_note && (
                    <p className="text-sm text-slate-600 mt-1 italic">Reviewer note: {item.reviewer_note}</p>
                  )}
                  {item.issues.length > 0 && (
                    <ul className="mt-1.5 space-y-1">
                      {item.issues.map((issue, i) => (
                        <li key={i} className={`text-sm ${severityText(issue.severity)}`}>
                          <AlertTriangle className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
                          [{issue.severity}] {issue.problem}
                          {issue.page ? ` (page ${issue.page})` : ""}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {(summary.follow_ups || []).length > 0 && (
            <Card className="border-red-200">
              <CardHeader className="py-3">
                <CardTitle className="text-sm font-semibold text-red-700">
                  Follow-ups before submission ({summary.follow_ups.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ol className="space-y-2 list-decimal pl-5">
                  {summary.follow_ups.map((fu) => (
                    <li key={fu.id} className={`text-sm ${severityText(fu.severity)}`}>
                      <span className="font-medium">[{fu.severity}]</span> {fu.action}
                      <span className="block text-xs text-slate-500">
                        {fu.why} {fu.citation}
                      </span>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          )}

          {(summary.overall_observations || []).length > 0 && (
            <Alert className="bg-slate-50 border-slate-200">
              <FileWarning className="w-4 h-4 text-slate-500" />
              <AlertDescription className="text-slate-700">
                <span className="font-semibold">Packet-level observations:</span>
                <ul className="list-disc pl-5 mt-1 space-y-0.5">
                  {summary.overall_observations.map((obs, i) => (
                    <li key={i}>{obs}</li>
                  ))}
                </ul>
              </AlertDescription>
            </Alert>
          )}

          <AICaveat label="AI page-by-page review — spot-check the cited pages before submitting" />

          <div className="border-t border-slate-200 pt-4 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center gap-3">
              <Button
                onClick={generateFinalPacket}
                disabled={isGenerating}
                className="bg-navy-700 hover:bg-navy-800 min-h-[44px] w-full sm:w-auto"
              >
                {isGenerating ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <FileCheck2 className="w-4 h-4 mr-2" />
                )}
                {adrCase.final_packet_url && finalPacketIsCurrent ? "Regenerate final packet" : "Generate final packet"}
              </Button>
              {adrCase.final_packet_url && finalPacketIsCurrent && isSafeExternalUrl(adrCase.final_packet_url) && (
                <Button asChild variant="outline" className="min-h-[44px] w-full sm:w-auto">
                  <a href={adrCase.final_packet_url} target="_blank" rel="noopener noreferrer">
                    <Download className="w-4 h-4 mr-2" />
                    Download final packet{adrCase.final_packet_pages ? ` (${adrCase.final_packet_pages} pages)` : ""}
                  </a>
                </Button>
              )}
            </div>
            <p className="text-xs text-slate-500">
              The final packet adds a cover page with the audit details, a table of contents with page numbers for
              every requirement, an outstanding-items sheet, page-number stamps on every page, and red frames with
              labels on the pages where key evidence begins — so the reviewer finds what they are looking for fast.
              {readiness?.level !== "ready" &&
                " It reports gaps honestly: generating it does not make the packet compliant."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
