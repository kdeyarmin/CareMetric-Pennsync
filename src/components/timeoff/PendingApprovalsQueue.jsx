import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { reviewTimeOffRequest } from "@/functions/reviewTimeOffRequest";
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
import { Check, X, Hourglass, CalendarRange, User } from "lucide-react";
import { toast } from "sonner";
import {
  formatDateRange,
  typeLabel,
  totalRequestedDays,
  rangesOverlap,
} from "./timeOffUtils";

export default function PendingApprovalsQueue({ requests = [], allRequests = [] }) {
  const queryClient = useQueryClient();
  // { request, decision: 'approved' | 'denied' }
  const [review, setReview] = useState(null);
  const [note, setNote] = useState("");

  const pending = useMemo(
    () =>
      [...requests]
        .filter((r) => r.status === "pending")
        .sort((a, b) => (a.start_date || "").localeCompare(b.start_date || "")),
    [requests]
  );

  // Surface scheduling conflicts: other approved requests that overlap this one.
  const conflictsFor = (req) =>
    allRequests.filter(
      (other) =>
        other.id !== req.id &&
        other.status === "approved" &&
        other.employee_email !== req.employee_email &&
        rangesOverlap(req.start_date, req.end_date, other.start_date, other.end_date)
    );

  const decide = useMutation({
    mutationFn: async ({ request, decision }) => {
      // Authorization (admin or the assigned manager, never the employee) and
      // the employee notification are enforced server-side.
      const result = await reviewTimeOffRequest({
        request_id: request.id,
        decision,
        note: note.trim(),
      });
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, variables) => {
      toast.success(`Request ${variables.decision === "approved" ? "approved" : "denied"}.`);
      setReview(null);
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["timeoff"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error || err?.message || "Could not update the request."),
  });

  const openReview = (request, decision) => {
    setNote("");
    setReview({ request, decision });
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Hourglass className="w-5 h-5 text-amber-600" />
          Pending Approvals
          <span className="text-sm font-normal text-slate-400">({pending.length})</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {pending.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <Check className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">You're all caught up — no requests waiting for review.</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {pending.map((r) => {
              const days = Number(r.total_days) || totalRequestedDays(r.start_date, r.end_date, r.half_day);
              const conflicts = conflictsFor(r);
              return (
                <li key={r.id} className="rounded-lg border border-slate-200 p-4 hover:border-slate-300 transition-colors">
                  <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-slate-900 font-medium">
                        <User className="w-4 h-4 text-slate-400" />
                        {r.employee_name || r.employee_email}
                      </div>
                      <div className="flex items-center gap-2 text-sm text-slate-600 mt-1">
                        <CalendarRange className="w-4 h-4 text-slate-400" />
                        {formatDateRange(r.start_date, r.end_date)}
                        <span className="text-slate-300">·</span>
                        {typeLabel(r.request_type)}
                        <span className="text-slate-300">·</span>
                        {days} day{days === 1 ? "" : "s"}
                      </div>
                      {r.reason && <p className="text-sm text-slate-600 mt-2 italic">“{r.reason}”</p>}
                      {r.coverage && (
                        <p className="text-sm text-slate-500 mt-1">
                          <span className="font-medium text-slate-600">Coverage:</span> {r.coverage}
                        </p>
                      )}
                      {conflicts.length > 0 && (
                        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mt-2 inline-block">
                          Overlaps {conflicts.length} approved request{conflicts.length === 1 ? "" : "s"}:{" "}
                          {conflicts.map((c) => c.employee_name || c.employee_email).join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-red-200 text-red-600 hover:bg-red-50"
                        onClick={() => openReview(r, "denied")}
                      >
                        <X className="w-4 h-4 mr-1" />
                        Deny
                      </Button>
                      <Button
                        size="sm"
                        className="bg-emerald-600 hover:bg-emerald-700"
                        onClick={() => openReview(r, "approved")}
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
              {review?.decision === "approved" ? "Approve request" : "Deny request"}
            </DialogTitle>
            <DialogDescription>
              {review && (
                <>
                  {review.request.employee_name || review.request.employee_email} ·{" "}
                  {typeLabel(review.request.request_type)} ·{" "}
                  {formatDateRange(review.request.start_date, review.request.end_date)}
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="review-note">
              Note {review?.decision === "denied" ? "(recommended)" : "(optional)"}
            </Label>
            <Textarea
              id="review-note"
              className="mt-1"
              rows={3}
              placeholder={
                review?.decision === "approved"
                  ? "Add an optional note for the employee…"
                  : "Let the employee know why this was denied…"
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
              className={
                review?.decision === "approved" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700"
              }
              disabled={decide.isPending}
              onClick={() => review && decide.mutate(review)}
            >
              {decide.isPending
                ? "Saving…"
                : review?.decision === "approved"
                  ? "Confirm approval"
                  : "Confirm denial"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
