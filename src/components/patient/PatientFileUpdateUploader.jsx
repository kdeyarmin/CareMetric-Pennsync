import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  FileText,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Archive,
  Users,
  Eye,
} from "lucide-react";
import { toast } from 'sonner';

const REPORT_OPTIONS = {
  active_census: {
    label: "Current patient census",
    helper: "Adds only patients that are not already in the system after verifying by MRN or by name and DOB.",
  },
  discharge_report: {
    label: "Discharged patient report",
    helper: "Finds matching patients and marks them discharged + archived so they are hidden from active rosters.",
  },
};

// Visual styling for each per-row plan action returned by the backend.
const ACTION_STYLES = {
  create: { label: "Will add", className: "bg-green-100 text-green-800" },
  discharge: { label: "Will discharge", className: "bg-slate-200 text-slate-800" },
  matched: { label: "Already in system", className: "bg-amber-100 text-amber-800" },
  in_file_duplicate: { label: "Duplicate in file", className: "bg-orange-100 text-orange-800" },
  no_change: { label: "No change", className: "bg-slate-100 text-slate-600" },
  error: { label: "Needs attention", className: "bg-red-100 text-red-800" },
};

export default function PatientFileUpdateUploader() {
  const [fileName, setFileName] = useState("");
  const [reportType, setReportType] = useState("active_census");
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingLabel, setProcessingLabel] = useState("");
  // stage: "idle" -> "preview" (dry run shown) -> "done" (committed)
  const [stage, setStage] = useState("idle");
  const [preview, setPreview] = useState(null);
  const [pendingFileUrl, setPendingFileUrl] = useState("");
  const [results, setResults] = useState(null);
  const queryClient = useQueryClient();

  const uploadFileMutation = useMutation({
    mutationFn: async (file) => {
      const response = await base44.integrations.Core.UploadFile({ file });
      return response.file_url;
    },
  });

  const processFileMutation = useMutation({
    mutationFn: async ({ fileUrl, selectedReportType, dryRun }) => {
      const response = await base44.functions.invoke("processPatientFileUpdate", {
        file_url: fileUrl,
        report_type: selectedReportType,
        dry_run: dryRun,
      });
      return response.data || response;
    },
  });

  const resetState = () => {
    setFileName("");
    setStage("idle");
    setPreview(null);
    setPendingFileUrl("");
    setResults(null);
  };

  // Step 1: upload the file and run a dry run so the admin can review the
  // plan (who will be added vs. matched to an existing patient) before any
  // records are written.
  const handleFileUpload = async (event) => {
    const selectedFile = event.target.files?.[0];
    if (!selectedFile) return;

    setFileName(selectedFile.name);
    setIsProcessing(true);
    setProcessingLabel("Verifying uploaded patients...");
    setPreview(null);
    setResults(null);
    setStage("idle");

    try {
      const fileUrl = await uploadFileMutation.mutateAsync(selectedFile);
      const previewResults = await processFileMutation.mutateAsync({
        fileUrl,
        selectedReportType: reportType,
        dryRun: true,
      });

      if (!previewResults.success) {
        throw new Error(previewResults.error || "Failed to analyze file");
      }

      setPendingFileUrl(fileUrl);
      setPreview(previewResults.results);
      setStage("preview");
    } catch (error) {
      toast.error(error.message || "Failed to analyze file");
      resetState();
    }

    setIsProcessing(false);
    event.target.value = "";
  };

  // Step 2: the admin confirmed the preview — re-run for real to commit.
  const handleConfirmImport = async () => {
    if (!pendingFileUrl) return;
    setIsProcessing(true);
    setProcessingLabel("Applying changes...");

    try {
      const committed = await processFileMutation.mutateAsync({
        fileUrl: pendingFileUrl,
        selectedReportType: reportType,
        dryRun: false,
      });

      if (!committed.success) {
        throw new Error(committed.error || "Failed to import patients");
      }

      setResults(committed.results);
      setStage("done");
      queryClient.invalidateQueries({ queryKey: ["patients"] });
    } catch (error) {
      toast.error(error.message || "Failed to import patients");
    }

    setIsProcessing(false);
  };

  const isDischarge = reportType === "discharge_report";

  const previewCards = preview
    ? [
        { key: "processed", label: "Rows processed", value: preview.processed || 0, className: "bg-blue-50 text-blue-700", icon: FileText },
        isDischarge
          ? { key: "willDischarge", label: "Will discharge + archive", value: preview.willDischarge || 0, className: "bg-slate-50 text-slate-700", icon: Archive }
          : { key: "willCreate", label: "New patients to add", value: preview.willCreate || 0, className: "bg-green-50 text-green-700", icon: Users },
        { key: "matchedExisting", label: "Already in system", value: preview.matchedExisting || 0, className: "bg-amber-50 text-amber-700", icon: CheckCircle2 },
        { key: "issues", label: "Need attention", value: preview.errors?.length || 0, className: "bg-red-50 text-red-700", icon: AlertCircle },
      ]
    : [];

  const doneCards = results
    ? [
        { key: "processed", label: "Rows processed", value: results.processed || 0, className: "bg-blue-50 text-blue-700", icon: FileText },
        { key: "created", label: "New patients added", value: results.created || 0, className: "bg-green-50 text-green-700", icon: Users },
        { key: "matchedExisting", label: isDischarge ? "Matched in system" : "Already in system", value: results.matchedExisting || 0, className: "bg-amber-50 text-amber-700", icon: CheckCircle2 },
        { key: "discharged", label: "Discharged + archived", value: results.archived || results.discharged || 0, className: "bg-slate-50 text-slate-700", icon: Archive },
      ]
    : [];

  const renderSummaryCards = (cards) => (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.key} className={`rounded-lg p-4 ${card.className}`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold opacity-80">{card.label}</p>
                <p className="text-2xl font-bold mt-1">{card.value}</p>
              </div>
              <Icon className="w-6 h-6 opacity-80" />
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="w-5 h-5" />
          Patient roster import
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertDescription>
            Upload a CSV export with the patient headers from your census or discharge report. You will get a preview of exactly what will change — verified by MRN first, then by name + DOB — before anything is saved.
          </AlertDescription>
        </Alert>

        {stage === "idle" && (
          <>
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Report type</p>
              <Select value={reportType} onValueChange={setReportType} disabled={isProcessing}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active_census">{REPORT_OPTIONS.active_census.label}</SelectItem>
                  <SelectItem value="discharge_report">{REPORT_OPTIONS.discharge_report.label}</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-500">{REPORT_OPTIONS[reportType].helper}</p>
            </div>

            <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="patient-file-upload"
                disabled={isProcessing}
              />
              <label htmlFor="patient-file-upload" className="cursor-pointer block">
                <Upload className="w-10 h-10 mx-auto mb-3 text-slate-400" />
                <p className="text-sm font-medium text-slate-700 mb-1">
                  {fileName || "Click to upload CSV file"}
                </p>
                <p className="text-xs text-slate-500">CSV only • several hundred rows supported</p>
              </label>
            </div>
          </>
        )}

        {isProcessing && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <Loader2 className="w-4 h-4 animate-spin text-blue-600" />
              {processingLabel || "Working..."}
            </div>
            <Progress value={60} className="h-2" />
          </div>
        )}

        {/* Preview (dry run) — review before committing */}
        {stage === "preview" && preview && !isProcessing && (
          <div className="space-y-4">
            <Alert>
              <Eye className="w-4 h-4 text-blue-600" />
              <AlertDescription>
                <span className="font-semibold">Preview only — nothing has been saved yet.</span> Review the planned changes below for <span className="font-medium">{fileName}</span>, then confirm to apply them.
              </AlertDescription>
            </Alert>

            {renderSummaryCards(previewCards)}

            {preview.skippedInFileDuplicates > 0 && (
              <Alert>
                <AlertDescription>
                  {preview.skippedInFileDuplicates} duplicate row{preview.skippedInFileDuplicates === 1 ? " was" : "s were"} found within the uploaded file and will be skipped.
                </AlertDescription>
              </Alert>
            )}

            {preview.plan?.length > 0 && (
              <div>
                <h3 className="font-semibold text-slate-900 mb-2">Planned changes ({preview.plan.length})</h3>
                <ScrollArea className="h-72 border rounded-lg">
                  <div className="divide-y">
                    {preview.plan.map((item, index) => {
                      const style = ACTION_STYLES[item.action] || ACTION_STYLES.no_change;
                      return (
                        <div key={index} className="flex items-start gap-3 p-3">
                          <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold ${style.className}`}>
                            {style.label}
                          </span>
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-slate-800 truncate">
                              {item.patient}
                              {item.row ? <span className="text-slate-400 font-normal"> • row {item.row}</span> : null}
                            </p>
                            {item.detail && <p className="text-xs text-slate-500">{item.detail}</p>}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </ScrollArea>
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-3">
              <Button className="flex-1" onClick={handleConfirmImport} disabled={isProcessing}>
                {isDischarge
                  ? `Confirm — discharge ${preview.willDischarge || 0} patient${(preview.willDischarge || 0) === 1 ? "" : "s"}`
                  : `Confirm — add ${preview.willCreate || 0} patient${(preview.willCreate || 0) === 1 ? "" : "s"}`}
              </Button>
              <Button variant="outline" className="flex-1" onClick={resetState} disabled={isProcessing}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {/* Committed results */}
        {stage === "done" && results && (
          <div className="space-y-4">
            {renderSummaryCards(doneCards)}

            {results.skippedInFileDuplicates > 0 && (
              <Alert>
                <AlertDescription>
                  {results.skippedInFileDuplicates} duplicate row{results.skippedInFileDuplicates === 1 ? " was" : "s were"} skipped because the same patient appeared more than once in the uploaded file.
                </AlertDescription>
              </Alert>
            )}

            {results.errors?.length > 0 && (
              <div>
                <h3 className="font-semibold text-red-900 mb-3">Items needing attention ({results.errors.length})</h3>
                <ScrollArea className="h-56 border rounded-lg">
                  <div className="p-4 space-y-2">
                    {results.errors.map((error, index) => (
                      <Alert key={index} variant="destructive">
                        <AlertCircle className="w-4 h-4" />
                        <AlertDescription>
                          <span className="font-semibold">{error.patient}</span>
                          {error.row ? ` • row ${error.row}` : ""}
                          {`: ${error.error}`}
                        </AlertDescription>
                      </Alert>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {results.errors?.length === 0 && (
              <Alert>
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription>
                  Import completed successfully with no verification conflicts.
                </AlertDescription>
              </Alert>
            )}

            <Button variant="outline" className="w-full" onClick={resetState}>
              Upload another file
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
