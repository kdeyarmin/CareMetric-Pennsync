import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { format, differenceInCalendarDays } from "date-fns";
import { parseLocalDate } from "@/lib/dateLocal";
import {
  FileSearch,
  Plus,
  ArrowLeft,
  FolderOpen,
  CalendarClock,
  ShieldAlert,
  CheckCircle2,
  FileText,
  Trash2,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import PageContainer from "@/components/ui/PageContainer";
import PageHeader from "@/components/ui/PageHeader";
import StatCard from "@/components/ui/stat-card";
import LoadingState from "@/components/ui/LoadingState";
import EmptyState from "@/components/ui/empty-state";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "react-router";
import { createPageUrl } from "@/utils";
import SearchablePatientSelect from "@/components/ui/SearchablePatientSelect";
import { base44 } from "@/api/base44Client";
import { useScopedPatients } from '@/hooks/useScopedPatients';
import AdrLetterAnalyzer from "../components/adr/AdrLetterAnalyzer";
import AdrChecklistPanel from "../components/adr/AdrChecklistPanel";
import AdrPacketVerifier from "../components/adr/AdrPacketVerifier";
import AdrSubmissionPanel from "../components/adr/AdrSubmissionPanel";
import { AUDIT_TYPES } from "../components/adr/adrRequirements";
import { resolveResponseDueDate } from "../components/adr/adrDeadlines";
import { isSafeExternalUrl } from "@/components/utils/security";

const AUDIT_TYPE_LABELS = Object.fromEntries(AUDIT_TYPES.map((t) => [t.id, t.label]));

const STATUS_META = {
  letter_uploaded: { label: "Letter uploaded", className: "bg-slate-100 text-slate-700" },
  checklist_ready: { label: "Checklist ready", className: "bg-blue-100 text-blue-700" },
  packet_uploaded: { label: "Packet uploaded", className: "bg-indigo-100 text-indigo-700" },
  packet_verified: { label: "Packet verified", className: "bg-amber-100 text-amber-700" },
  packet_generated: { label: "Packet generated", className: "bg-emerald-100 text-emerald-700" },
  submitted: { label: "Submitted", className: "bg-emerald-100 text-emerald-800" },
  closed: { label: "Closed", className: "bg-slate-100 text-slate-500" },
};

const OPEN_STATUSES = ["letter_uploaded", "checklist_ready", "packet_uploaded", "packet_verified", "packet_generated"];

// Letter dates are date-only strings — parseLocalDate avoids the UTC-midnight
// day-shift that would render an ADR deadline one day early/late.
const safeDate = (value) => {
  if (!value) return "—";
  const d = parseLocalDate(value);
  return d ? format(d, "MM/dd/yyyy") : String(value);
};

const daysUntil = (value) => {
  if (!value) return null;
  const d = parseLocalDate(value);
  return d ? differenceInCalendarDays(d, new Date()) : null;
};

export default function ADRCenter() {
  const queryClient = useQueryClient();
  const [newCaseOpen, setNewCaseOpen] = useState(false);
  const [letterAnalyzing, setLetterAnalyzing] = useState(false);
  const [pendingCase, setPendingCase] = useState(null); // analyzed payload whose entity create failed
  const [isSavingCase, setIsSavingCase] = useState(false);
  const [selectedCaseId, setSelectedCaseId] = useState(null);
  const [caseToDelete, setCaseToDelete] = useState(null);

  const { data: cases = [], isLoading } = useQuery({
    queryKey: ["adrCases"],
    queryFn: () => base44.entities.AdrAuditCase.list("-created_date", 200),
    initialData: [],
  });

  // Patient roster for chart linking — loaded only once a case is open.
  const { data: patients = [] } = useScopedPatients({ sort: '-created_date', limit: 500, enabled: !!selectedCaseId });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["adrCases"] });
  const selectedCase = useMemo(
    () => cases.find((c) => c.id === selectedCaseId) || null,
    [cases, selectedCaseId]
  );

  const stats = useMemo(() => {
    const open = cases.filter((c) => OPEN_STATUSES.includes(c.status));
    const dueSoon = open.filter((c) => {
      const days = daysUntil(c.response_due_date);
      return days !== null && days <= 7;
    });
    const notReady = open.filter((c) => c.verification_summary?.readiness?.level === "not_ready");
    const completed = cases.filter((c) => c.status === "submitted" || c.status === "closed");
    return { open: open.length, dueSoon: dueSoon.length, notReady: notReady.length, completed: completed.length };
  }, [cases]);

  const saveAnalyzedCase = async (payload) => {
    const { letterFileUrl, analysis, checklist } = payload;
    setIsSavingCase(true);
    try {
      const caseName = [
        analysis.contractor_name || AUDIT_TYPE_LABELS[analysis.audit_type] || "ADR",
        analysis.patient_name || "Unknown patient",
        analysis.dates_of_service,
      ]
        .filter(Boolean)
        .join(" — ");
      // Normalize the due date to the strict YYYY-MM-DD the reminder planner
      // requires (a raw "07/03/2026" displayed fine but silently planned zero
      // reminders), and derive it from letter_date + response_due_days when
      // the letter states only a day count ("within 45 days of this letter").
      const dueDate = resolveResponseDueDate(analysis);
      const created = await base44.entities.AdrAuditCase.create({
        case_name: caseName,
        status: "checklist_ready",
        audit_type: analysis.audit_type || "other",
        contractor_name: analysis.contractor_name || "",
        patient_name: analysis.patient_name || "",
        medicare_number: analysis.medicare_number || "",
        claim_number: analysis.claim_number || "",
        dates_of_service: analysis.dates_of_service || "",
        letter_date: analysis.letter_date || undefined,
        response_due_date: dueDate.date || undefined,
        letter_file_url: letterFileUrl,
        letter_analysis: analysis,
        checklist,
      });
      if (dueDate.derived) {
        toast.info(`Response deadline computed as ${dueDate.date} from the letter date + ${analysis.response_due_days} days — verify it against the letter.`);
      } else if (!dueDate.date) {
        toast.warning("No response deadline could be read from the letter — set it manually so deadline reminders can fire.");
      }
      setPendingCase(null);
      setNewCaseOpen(false);
      refresh();
      setSelectedCaseId(created.id);
      toast.success("ADR case created — the requirement checklist is ready to print.");
    } catch (err) {
      // The upload + LLM analysis already succeeded (and were billed) — keep
      // the payload so a transient save failure only costs a retry click.
      setPendingCase(payload);
      toast.error(err?.message || "Failed to save the ADR case — the analysis was kept, use Retry save.");
    } finally {
      setIsSavingCase(false);
    }
  };

  const handleLetterAnalyzed = (payload) => saveAnalyzedCase(payload);

  const updateStatus = async (adrCase, status, message) => {
    try {
      await base44.entities.AdrAuditCase.update(adrCase.id, { status });
      refresh();
      if (message) toast.success(message);
    } catch (err) {
      toast.error(err?.message || "Failed to update the case.");
    }
  };

  const handleDelete = async () => {
    if (!caseToDelete) return;
    try {
      await base44.entities.AdrAuditCase.delete(caseToDelete.id);
      if (selectedCaseId === caseToDelete.id) setSelectedCaseId(null);
      setCaseToDelete(null);
      refresh();
      toast.success("ADR case deleted.");
    } catch (err) {
      toast.error(err?.message || "Failed to delete the case.");
    }
  };

  return (
    <PageContainer>
      <PageHeader
        icon={FileSearch}
        eyebrow="Office"
        title="ADR & Audit Response"
        description="Analyze ADR and audit letters, work the CMS-grounded documentation checklist, verify the assembled packet page by page, and generate a submission-ready response with a table of contents and key items flagged in red."
        actions={
          <Button
            onClick={() => setNewCaseOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full sm:w-auto"
          >
            <Plus className="w-4 h-4 mr-2" />
            New ADR Case
          </Button>
        }
      />

      {!selectedCase && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <StatCard label="Open cases" value={stats.open} icon={FolderOpen} tone="sky" />
            <StatCard label="Due ≤ 7 days / overdue" value={stats.dueSoon} icon={CalendarClock} tone="orange" />
            <StatCard label="Not submission-ready" value={stats.notReady} icon={ShieldAlert} tone="rose" />
            <StatCard label="Submitted / closed" value={stats.completed} icon={CheckCircle2} tone="emerald" />
          </div>

          {isLoading ? (
            <LoadingState label="Loading ADR cases..." />
          ) : cases.length === 0 ? (
            <EmptyState
              icon={FileSearch}
              title="No ADR cases yet"
              description="Upload an ADR or audit letter to analyze what the reviewer requires and build the response packet."
              action={
                <Button onClick={() => setNewCaseOpen(true)} className="bg-blue-600 hover:bg-blue-700 min-h-[44px]">
                  <Plus className="w-4 h-4 mr-2" />
                  New ADR Case
                </Button>
              }
            />
          ) : (
            <Card>
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Case</TableHead>
                      <TableHead>Program</TableHead>
                      <TableHead>Due</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Readiness</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {cases.map((c) => {
                      const meta = STATUS_META[c.status] || STATUS_META.letter_uploaded;
                      const days = daysUntil(c.response_due_date);
                      const readiness = c.verification_summary?.readiness;
                      return (
                        <TableRow key={c.id}>
                          <TableCell>
                            <button
                              type="button"
                              onClick={() => setSelectedCaseId(c.id)}
                              className="text-left font-medium text-navy-700 hover:underline"
                            >
                              {c.case_name || c.patient_name || "Untitled case"}
                            </button>
                            <p className="text-xs text-slate-500">
                              {c.claim_number ? `Claim ${c.claim_number} · ` : ""}
                              {c.dates_of_service || ""}
                            </p>
                          </TableCell>
                          <TableCell className="text-sm text-slate-600">
                            {AUDIT_TYPE_LABELS[c.audit_type] || "—"}
                          </TableCell>
                          <TableCell>
                            <span
                              className={
                                days !== null && days <= 7 && OPEN_STATUSES.includes(c.status)
                                  ? "text-red-600 font-semibold"
                                  : "text-slate-600"
                              }
                            >
                              {safeDate(c.response_due_date)}
                              {days !== null && OPEN_STATUSES.includes(c.status)
                                ? ` (${days >= 0 ? `${days}d left` : `${-days}d overdue`})`
                                : ""}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge className={meta.className}>{meta.label}</Badge>
                          </TableCell>
                          <TableCell>
                            {readiness ? (
                              readiness.level === "ready" ? (
                                <Badge className="bg-emerald-100 text-emerald-700">Ready</Badge>
                              ) : readiness.level === "not_ready" ? (
                                <Badge className="bg-red-100 text-red-700">Not ready</Badge>
                              ) : (
                                <Badge className="bg-amber-100 text-amber-700">Needs attention</Badge>
                              )
                            ) : (
                              <span className="text-xs text-slate-400">Not verified</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-h-[36px]"
                                onClick={() => setSelectedCaseId(c.id)}
                              >
                                Open
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="min-h-[36px] text-red-600 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setCaseToDelete(c)}
                                aria-label={`Delete case ${c.case_name || c.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Keyed on the case: the step panels below hold per-case local state
          (AdrSubmissionPanel seeds the fax recipient from contractor_name and
          keeps the typed fax number; AdrPacketVerifier keeps its in-flight /
          error state). Switching cases without a remount carried the previous
          case's fax recipient into the next case's submission. */}
      {selectedCase && (
        <div className="space-y-4" key={selectedCase.id}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <Button variant="outline" onClick={() => setSelectedCaseId(null)} className="min-h-[44px] w-full sm:w-auto">
              <ArrowLeft className="w-4 h-4 mr-2" />
              All cases
            </Button>
            <div className="flex flex-col sm:flex-row gap-2">
              {selectedCase.letter_file_url && isSafeExternalUrl(selectedCase.letter_file_url) && (
                <Button asChild variant="outline" className="min-h-[44px]">
                  <a href={selectedCase.letter_file_url} target="_blank" rel="noopener noreferrer">
                    <FileText className="w-4 h-4 mr-2" />
                    View letter
                  </a>
                </Button>
              )}
              {selectedCase.status === "packet_generated" && (
                <Button
                  onClick={() => updateStatus(selectedCase, "submitted", "Case marked as submitted.")}
                  className="min-h-[44px]"
                >
                  <Send className="w-4 h-4 mr-2" />
                  Mark submitted
                </Button>
              )}
              {selectedCase.status === "submitted" && (
                <Button
                  variant="outline"
                  onClick={() => updateStatus(selectedCase, "closed", "Case closed.")}
                  className="min-h-[44px]"
                >
                  Close case
                </Button>
              )}
            </div>
          </div>

          <Card>
            <CardContent className="pt-6">
              <div className="flex flex-wrap items-center gap-2 mb-2">
                <h2 className="text-lg font-semibold text-slate-900">
                  {selectedCase.case_name || "ADR case"}
                </h2>
                <Badge className={(STATUS_META[selectedCase.status] || STATUS_META.letter_uploaded).className}>
                  {(STATUS_META[selectedCase.status] || STATUS_META.letter_uploaded).label}
                </Badge>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-1 text-sm text-slate-600">
                <p>
                  <span className="font-medium text-slate-500">Program:</span>{" "}
                  {AUDIT_TYPE_LABELS[selectedCase.audit_type] || "—"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Contractor:</span>{" "}
                  {selectedCase.contractor_name || "—"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Beneficiary:</span>{" "}
                  {selectedCase.patient_name || "—"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Claim / DCN:</span>{" "}
                  {selectedCase.claim_number || "—"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Dates of service:</span>{" "}
                  {selectedCase.dates_of_service || "—"}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Response due:</span>{" "}
                  <span className="text-red-600 font-medium">{safeDate(selectedCase.response_due_date)}</span>
                </p>
              </div>
              <div className="mt-3 flex flex-col sm:flex-row sm:items-center gap-2">
                <Label htmlFor="adr-patient-link" className="text-sm font-medium text-slate-500 shrink-0">
                  Patient chart:
                </Label>
                <div className="w-full sm:w-72">
                  <SearchablePatientSelect
                    id="adr-patient-link"
                    patients={patients}
                    value={selectedCase.patient_id || ""}
                    onValueChange={async (patientId) => {
                      try {
                        await base44.entities.AdrAuditCase.update(selectedCase.id, { patient_id: patientId || "" });
                        refresh();
                        toast.success(patientId ? "Case linked to the patient chart." : "Patient link removed.");
                      } catch (err) {
                        toast.error(err?.message || "Failed to link the patient.");
                      }
                    }}
                    placeholder="Link to a patient chart..."
                  />
                </div>
                {selectedCase.patient_id && (
                  <Button asChild variant="outline" size="sm" className="min-h-[36px]">
                    <Link to={`${createPageUrl("PatientDetails")}?id=${selectedCase.patient_id}`}>Open chart</Link>
                  </Button>
                )}
              </div>
              {selectedCase.letter_analysis?.letter_summary && (
                <Alert className="bg-slate-50 border-slate-200 mt-3">
                  <FileText className="w-4 h-4 text-slate-500" />
                  <AlertDescription className="text-slate-700">
                    {selectedCase.letter_analysis.letter_summary}
                  </AlertDescription>
                </Alert>
              )}
            </CardContent>
          </Card>

          <section aria-label="Requirement checklist">
            <h3 className="text-base font-semibold text-slate-900 mb-2">
              Step 1 — Pull the required documentation
            </h3>
            <AdrChecklistPanel adrCase={selectedCase} />
          </section>

          <section aria-label="Packet verification">
            <h3 className="text-base font-semibold text-slate-900 mb-2 mt-6">
              Step 2 — Verify the assembled packet &amp; generate the response
            </h3>
            <AdrPacketVerifier adrCase={selectedCase} onUpdated={refresh} />
          </section>

          <section aria-label="Submission and outcome">
            <h3 className="text-base font-semibold text-slate-900 mb-2 mt-6">
              Step 3 — Submit &amp; track the decision
            </h3>
            <AdrSubmissionPanel adrCase={selectedCase} onUpdated={refresh} />
          </section>
        </div>
      )}

      <Dialog
        open={newCaseOpen}
        onOpenChange={(open) => {
          // The upload + letter analysis is a billed, minutes-long call — block
          // every dismissal path (Escape, X, outside click) while it runs so a
          // "cancelled" dialog can't silently create a case later.
          if (!open && (letterAnalyzing || isSavingCase)) return;
          if (!open) setPendingCase(null);
          setNewCaseOpen(open);
        }}
      >
        <DialogContent
          className="max-w-[98vw] sm:max-w-2xl max-h-[90vh] overflow-y-auto"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => (letterAnalyzing || isSavingCase) && e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>New ADR / audit case</DialogTitle>
          </DialogHeader>
          {pendingCase ? (
            <div className="space-y-3">
              <Alert className="bg-amber-50 border-amber-300">
                <ShieldAlert className="w-4 h-4 text-amber-600" />
                <AlertDescription className="text-amber-900">
                  The letter was analyzed successfully but saving the case failed. The analysis was kept — retry the
                  save without re-running the analysis.
                </AlertDescription>
              </Alert>
              <Button
                onClick={() => saveAnalyzedCase(pendingCase)}
                disabled={isSavingCase}
                className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full sm:w-auto"
              >
                {isSavingCase ? "Saving..." : "Retry save"}
              </Button>
            </div>
          ) : (
            <AdrLetterAnalyzer onComplete={handleLetterAnalyzed} onProcessingChange={setLetterAnalyzing} />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!caseToDelete} onOpenChange={(open) => !open && setCaseToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this ADR case?</AlertDialogTitle>
            <AlertDialogDescription>
              &ldquo;{caseToDelete?.case_name || "Untitled case"}&rdquo; and its checklist and verification results
              will be permanently removed. Uploaded files are not deleted from storage.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-red-600 hover:bg-red-700">
              Delete case
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
