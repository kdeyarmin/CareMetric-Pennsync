import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reviewTimesheet } from "@/functions/reviewTimesheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, CheckCheck, X, Hourglass, CalendarRange, User } from "lucide-react";
import { toast } from "sonner";
import {
  payPeriodLabel,
  serviceTypeLabel,
  totalPaidHours,
  effectiveVacationHours,
  toNumber,
  paysByPoints,
  VISIT_TYPES,
  totalVisits,
} from "./timesheetUtils";

export default function TimesheetApprovalsQueue({ timesheets = [] }) {
  const queryClient = useQueryClient();
  // { timesheet, decision: 'approved' | 'rejected' }
  const [review, setReview] = useState(null);
  const [note, setNote] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkNote, setBulkNote] = useState("");

  const submitted = useMemo(
    () =>
      [...timesheets]
        .filter((t) => t.status === "submitted")
        .sort((a, b) => (a.pay_period_start || "").localeCompare(b.pay_period_start || "")),
    [timesheets]
  );

  const decide = useMutation({
    mutationFn: async ({ timesheet, decision }) => {
      const result = await reviewTimesheet({
        timesheet_id: timesheet.id,
        decision,
        note: note.trim(),
      });
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, variables) => {
      toast.success(`Timesheet ${variables.decision === "approved" ? "approved" : "returned for changes"}.`);
      setReview(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error || err?.message || "Could not update the timesheet."),
  });

  // Approve every submitted timesheet in the queue at once. Runs the same
  // server-side reviewTimesheet per row (authorization + notifications enforced
  // there); tolerates partial failures and reports the counts.
  const bulkApprove = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(
        submitted.map((t) =>
          reviewTimesheet({ timesheet_id: t.id, decision: "approved", note: bulkNote.trim() }).then((r) => {
            if (r?.error) throw new Error(r.error);
            return r;
          })
        )
      );
      const ok = results.filter((r) => r.status === "fulfilled").length;
      return { ok, failed: results.length - ok };
    },
    onSuccess: ({ ok, failed }) => {
      toast[failed ? "warning" : "success"](
        `Approved ${ok} timesheet${ok === 1 ? "" : "s"}${failed ? ` · ${failed} could not be approved` : ""}.`
      );
      setBulkOpen(false);
      setBulkNote("");
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (err) => toast.error(err?.message || "Bulk approval failed."),
  });

  const openReview = (timesheet, decision) => {
    setNote("");
    setReview({ timesheet, decision });
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <Hourglass className="w-5 h-5 text-amber-600" />
            Timesheets Awaiting Approval
            <span className="text-sm font-normal text-slate-400">({submitted.length})</span>
          </CardTitle>
          {submitted.length > 1 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setBulkNote("");
                setBulkOpen(true);
              }}
            >
              <CheckCheck className="w-4 h-4 mr-1.5" />
              Approve all ({submitted.length})
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {submitted.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Check className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">You're all caught up — no timesheets waiting for review.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {submitted.map((t) => {
              const hours = totalPaidHours(t);
              const vacation = effectiveVacationHours(t);
              const isHH = paysByPoints(t.service_type);
              return (
                <li key={t.id} className="rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-slate-900 font-medium">
                        <User className="w-4 h-4 text-slate-400" />
                        {t.employee_name || t.employee_email}
                        <span className="text-xs font-normal text-slate-400">· {serviceTypeLabel(t.service_type)}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                        <CalendarRange className="w-4 h-4 text-slate-400" />
                        {payPeriodLabel(t.pay_period_start, t.pay_period_end)}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-600 mt-2">
                        <span>Regular: <span className="font-medium text-slate-900">{toNumber(t.regular_hours)}</span></span>
                        {toNumber(t.overtime_hours) > 0 && <span>OT: <span className="font-medium">{toNumber(t.overtime_hours)}</span></span>}
                        {toNumber(t.holiday_hours) > 0 && <span>Holiday: <span className="font-medium">{toNumber(t.holiday_hours)}</span></span>}
                        {toNumber(t.on_call_hours) > 0 && <span>On-call: <span className="font-medium">{toNumber(t.on_call_hours)}</span></span>}
                        {vacation > 0 && <span>PTO: <span className="font-medium">{vacation}</span></span>}
                        {isHH && toNumber(t.regular_points) > 0 && <span>Points: <span className="font-medium">{toNumber(t.regular_points)}</span></span>}
                        {!isHH && toNumber(t.on_call_visits) > 0 && <span>Visits: <span className="font-medium">{toNumber(t.on_call_visits)}</span></span>}
                        <span className="text-slate-400">Total {hours} hrs</span>
                      </div>
                      {isHH && totalVisits(t.visit_counts) > 0 && (
                        <p className="text-xs text-slate-500 mt-1">
                          Visits:{" "}
                          {VISIT_TYPES.filter((vt) => toNumber(t.visit_counts?.[vt.key]) > 0)
                            .map((vt) => `${vt.label} ${toNumber(t.visit_counts[vt.key])}`)
                            .join(" · ")}
                        </p>
                      )}
                      {toNumber(t.auto_pto_hours) > 0 && (
                        <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mt-2 inline-block">
                          {toNumber(t.auto_pto_hours)} PTO hrs auto-carried from approved time off
                        </p>
                      )}
                      {t.notes && <p className="text-sm text-slate-600 mt-2 italic">“{t.notes}”</p>}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => openReview(t, "rejected")}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Return
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => openReview(t, "approved")}
                      >
                        <Check className="w-4 h-4 mr-1" />
                        Approve
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <Dialog open={!!review} onOpenChange={(open) => !open && setReview(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {review?.decision === "approved" ? "Approve timesheet" : "Return timesheet for changes"}
            </DialogTitle>
            <DialogDescription>
              {review && (
                <>
                  {review.timesheet.employee_name || review.timesheet.employee_email} ·{" "}
                  {serviceTypeLabel(review.timesheet.service_type)} ·{" "}
                  {payPeriodLabel(review.timesheet.pay_period_start, review.timesheet.pay_period_end)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="ts-review-note">
              Note {review?.decision === "rejected" ? "(recommended)" : "(optional)"}
            </Label>
            <Textarea
              id="ts-review-note"
              className="mt-1"
              rows={3}
              placeholder={
                review?.decision === "approved"
                  ? "Add an optional note for the employee…"
                  : "Let the employee know what needs to change…"
              }
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReview(null)} disabled={decide.isPending}>
              Cancel
            </Button>
            <Button
              variant={review?.decision === "approved" ? "default" : "destructive"}
              disabled={decide.isPending}
              onClick={() => review && decide.mutate(review)}
            >
              {decide.isPending
                ? "Saving…"
                : review?.decision === "approved"
                  ? "Confirm approval"
                  : "Return for changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bulkOpen} onOpenChange={(open) => !open && setBulkOpen(false)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve all {submitted.length} timesheets?</DialogTitle>
            <DialogDescription>
              This approves every timesheet currently awaiting your review. Each employee is notified.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="ts-bulk-note">Note for all (optional)</Label>
            <Textarea
              id="ts-bulk-note"
              className="mt-1"
              rows={2}
              placeholder="Optional note applied to each approval…"
              value={bulkNote}
              onChange={(e) => setBulkNote(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulkApprove.isPending}>
              Cancel
            </Button>
            <Button
              disabled={bulkApprove.isPending}
              onClick={() => bulkApprove.mutate()}
            >
              {bulkApprove.isPending ? "Approving…" : `Approve all ${submitted.length}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
