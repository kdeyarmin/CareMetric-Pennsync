import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, differenceInCalendarDays } from "date-fns";
import { Printer, Send, Loader2, Gavel, CalendarClock } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { base44 } from "@/api/base44Client";
import { parseLocalDate } from "@/lib/dateLocal";

export const OUTCOME_LABELS = {
  pending: "Decision pending",
  paid_in_full: "Paid in full",
  partially_denied: "Partially denied",
  fully_denied: "Fully denied",
  appealed: "Appeal filed",
  appeal_favorable: "Appeal decided — favorable",
  appeal_unfavorable: "Appeal decided — unfavorable",
};

const DENIAL_OUTCOMES = ["partially_denied", "fully_denied"];

const fmtDate = (value) => {
  if (!value) return "—";
  const d = parseLocalDate(value);
  return d ? format(d, "MM/dd/yyyy") : String(value);
};

/**
 * Post-generation actions for an ADR case: fax the final packet to the
 * contractor through the office Telnyx line, log submissions, and record the
 * audit decision + appeal deadline once the contractor responds.
 */
export default function AdrSubmissionPanel({ adrCase, onUpdated }) {
  const [faxDialogOpen, setFaxDialogOpen] = useState(false);
  const [faxNumber, setFaxNumber] = useState("");
  const [faxName, setFaxName] = useState(adrCase?.contractor_name || "");
  const [isFaxing, setIsFaxing] = useState(false);
  const [outcomeDraft, setOutcomeDraft] = useState(null); // null = not editing
  const [isSavingOutcome, setIsSavingOutcome] = useState(false);

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
    retry: false,
  });

  const finalPacketIsCurrent =
    !!adrCase?.final_packet_url && ["packet_generated", "submitted", "closed"].includes(adrCase?.status);
  const submissions = adrCase?.submission_faxes || [];

  const sendPacketFax = async () => {
    const number = faxNumber.trim();
    if (!number) {
      toast.error("Enter the contractor's fax number.");
      return;
    }
    setIsFaxing(true);
    try {
      const response = await base44.functions.invoke("sendFax", {
        file_url: adrCase.final_packet_url,
        to_number: number,
        to_name: faxName.trim() || adrCase.contractor_name || "Review contractor",
        document_name: "ADR Response Packet",
        patient_id: adrCase.patient_id || undefined,
      });
      const data = response?.data || {};
      if (!data.success) throw new Error(data.error || "Fax was not accepted");
      await base44.entities.AdrAuditCase.update(adrCase.id, {
        submission_faxes: [
          ...submissions,
          {
            date: new Date().toISOString(),
            to_number: number,
            to_name: faxName.trim() || adrCase.contractor_name || "",
            fax_id: String(data.fax_sid || data.fax_id || ""),
            sent_by: currentUser?.email || "",
          },
        ],
        status: "submitted",
      });
      setFaxDialogOpen(false);
      onUpdated?.();
      toast.success("Packet queued to fax. Delivery status is tracked in the Fax Center.");
    } catch (err) {
      toast.error(err?.message || "Failed to fax the packet.");
    } finally {
      setIsFaxing(false);
    }
  };

  const saveOutcome = async () => {
    setIsSavingOutcome(true);
    try {
      await base44.entities.AdrAuditCase.update(adrCase.id, {
        outcome: outcomeDraft.outcome || "pending",
        decision_date: outcomeDraft.decision_date || undefined,
        appeal_due_date: outcomeDraft.appeal_due_date || undefined,
        outcome_notes: outcomeDraft.outcome_notes || "",
      });
      setOutcomeDraft(null);
      onUpdated?.();
      toast.success("Audit outcome saved.");
    } catch (err) {
      toast.error(err?.message || "Failed to save the outcome.");
    } finally {
      setIsSavingOutcome(false);
    }
  };

  const appealDays = adrCase?.appeal_due_date
    ? (() => {
        const d = parseLocalDate(adrCase.appeal_due_date);
        return d ? differenceInCalendarDays(d, new Date()) : null;
      })()
    : null;

  return (
    <div className="space-y-4">
      {/* ── Submit by fax ── */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-semibold text-navy-700">Submit the response</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <Button
              onClick={() => setFaxDialogOpen(true)}
              disabled={!finalPacketIsCurrent}
              className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full sm:w-auto"
            >
              <Printer className="w-4 h-4 mr-2" />
              Fax final packet to contractor
            </Button>
            {adrCase?.status === "packet_generated" && (
              <p className="text-xs text-slate-500 self-center">
                Faxing marks the case as submitted. Mailing or using esMD/portal instead? Use &ldquo;Mark
                submitted&rdquo; above after sending.
              </p>
            )}
          </div>
          {!finalPacketIsCurrent && (
            <p className="text-xs text-slate-500">
              Generate the final packet first — the fax always sends the generated, verified packet.
            </p>
          )}
          {submissions.length > 0 && (
            <div className="text-sm text-slate-600 space-y-1">
              <p className="font-medium text-slate-700">Fax submissions:</p>
              {submissions.map((s, i) => {
                const sent = s.date ? new Date(s.date) : null;
                const when = sent && !Number.isNaN(sent.getTime()) ? format(sent, "MM/dd/yyyy HH:mm") : "—";
                return (
                  <p key={i} className="text-xs text-slate-500">
                    {when} → {s.to_name || "contractor"} at {s.to_number}
                    {s.sent_by ? ` (by ${s.sent_by})` : ""}
                  </p>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Audit outcome ── */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-sm font-semibold text-navy-700 flex items-center gap-2">
            <Gavel className="w-4 h-4" />
            Audit outcome
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!outcomeDraft ? (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
                <Badge
                  className={
                    DENIAL_OUTCOMES.includes(adrCase?.outcome)
                      ? "bg-red-100 text-red-700"
                      : adrCase?.outcome === "paid_in_full" || adrCase?.outcome === "appeal_favorable"
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-slate-100 text-slate-600"
                  }
                >
                  {OUTCOME_LABELS[adrCase?.outcome] || OUTCOME_LABELS.pending}
                </Badge>
                {adrCase?.decision_date && <span>Decision: {fmtDate(adrCase.decision_date)}</span>}
                {adrCase?.appeal_due_date && (
                  <span className={appealDays !== null && appealDays <= 14 ? "text-red-600 font-semibold" : ""}>
                    Appeal due: {fmtDate(adrCase.appeal_due_date)}
                    {appealDays !== null ? ` (${appealDays >= 0 ? `${appealDays}d left` : `${-appealDays}d past`})` : ""}
                  </span>
                )}
              </div>
              {adrCase?.outcome_notes && <p className="text-sm text-slate-600">{adrCase.outcome_notes}</p>}
              {DENIAL_OUTCOMES.includes(adrCase?.outcome) && !adrCase?.appeal_due_date && (
                <Alert className="bg-amber-50 border-amber-300">
                  <CalendarClock className="w-4 h-4 text-amber-600" />
                  <AlertDescription className="text-amber-900 text-sm">
                    Denied claims can be appealed — a redetermination request is due within 120 days of the initial
                    determination (42 CFR 405.942). Record the appeal deadline so it is not missed.
                  </AlertDescription>
                </Alert>
              )}
              <Button
                variant="outline"
                className="min-h-[36px]"
                onClick={() =>
                  setOutcomeDraft({
                    outcome: adrCase?.outcome || "pending",
                    decision_date: adrCase?.decision_date || "",
                    appeal_due_date: adrCase?.appeal_due_date || "",
                    outcome_notes: adrCase?.outcome_notes || "",
                  })
                }
              >
                Record / update outcome
              </Button>
            </>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <Label htmlFor="adr-outcome">Decision</Label>
                  <Select
                    value={outcomeDraft.outcome}
                    onValueChange={(v) => setOutcomeDraft((d) => ({ ...d, outcome: v }))}
                  >
                    <SelectTrigger id="adr-outcome" className="mt-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(OUTCOME_LABELS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="adr-decision-date">Decision date</Label>
                  <Input
                    id="adr-decision-date"
                    type="date"
                    className="mt-1"
                    value={outcomeDraft.decision_date}
                    onChange={(e) => setOutcomeDraft((d) => ({ ...d, decision_date: e.target.value }))}
                  />
                </div>
                <div>
                  <Label htmlFor="adr-appeal-due">Appeal due date</Label>
                  <Input
                    id="adr-appeal-due"
                    type="date"
                    className="mt-1"
                    value={outcomeDraft.appeal_due_date}
                    onChange={(e) => setOutcomeDraft((d) => ({ ...d, appeal_due_date: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="adr-outcome-notes">Denial reasons / decision details</Label>
                <Textarea
                  id="adr-outcome-notes"
                  className="mt-1"
                  rows={3}
                  value={outcomeDraft.outcome_notes}
                  onChange={(e) => setOutcomeDraft((d) => ({ ...d, outcome_notes: e.target.value }))}
                  placeholder="e.g. Denied for insufficient homebound documentation on visits 3–7..."
                />
              </div>
              <div className="flex gap-2">
                <Button onClick={saveOutcome} disabled={isSavingOutcome} className="min-h-[36px]">
                  {isSavingOutcome && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Save outcome
                </Button>
                <Button variant="outline" className="min-h-[36px]" onClick={() => setOutcomeDraft(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Fax dialog ── */}
      <Dialog open={faxDialogOpen} onOpenChange={(open) => !isFaxing && setFaxDialogOpen(open)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Fax the final packet</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Sends the generated packet ({adrCase?.final_packet_pages || "—"} pages) from the office fax line. Use
              the fax number printed on the ADR letter.
            </p>
            <div>
              <Label htmlFor="adr-fax-name">Recipient</Label>
              <Input
                id="adr-fax-name"
                className="mt-1"
                value={faxName}
                onChange={(e) => setFaxName(e.target.value)}
                placeholder="Contractor name"
              />
            </div>
            <div>
              <Label htmlFor="adr-fax-number">Fax number</Label>
              <Input
                id="adr-fax-number"
                className="mt-1"
                value={faxNumber}
                onChange={(e) => setFaxNumber(e.target.value)}
                placeholder="+1 555 123 4567"
                inputMode="tel"
              />
            </div>
            <Button onClick={sendPacketFax} disabled={isFaxing} className="bg-blue-600 hover:bg-blue-700 min-h-[44px] w-full">
              {isFaxing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Send className="w-4 h-4 mr-2" />}
              {isFaxing ? "Sending..." : "Send fax"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
