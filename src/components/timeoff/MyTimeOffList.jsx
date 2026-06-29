import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { cancelTimeOffRequest } from "@/functions/cancelTimeOffRequest";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { CalendarDays, MessageSquare, X } from "lucide-react";
import { toast } from "sonner";
import TimeOffStatusBadge from "./TimeOffStatusBadge";
import {
  formatDateRange,
  typeLabel,
  isUpcoming,
  totalRequestedDays,
  availableYears,
  parseISODate,
  STATUSES,
} from "./timeOffUtils";

export default function MyTimeOffList({ requests = [] }) {
  const queryClient = useQueryClient();
  const [toCancel, setToCancel] = useState(null);
  const [yearFilter, setYearFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

  const cancel = useMutation({
    mutationFn: async (request) => {
      const result = await cancelTimeOffRequest({ request_id: request.id });
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success("Request cancelled.");
      setToCancel(null);
      queryClient.invalidateQueries({ queryKey: ["timeoff"] });
    },
    onError: (err) =>
      toast.error(err?.response?.data?.error || err?.message || "Could not cancel the request."),
  });

  const years = useMemo(() => availableYears(requests), [requests]);

  const sorted = useMemo(() => {
    return [...requests]
      .filter((r) => {
        if (yearFilter === "all") return true;
        const s = parseISODate(r.start_date);
        return s && String(s.getFullYear()) === yearFilter;
      })
      .filter((r) => (statusFilter === "all" ? true : r.status === statusFilter))
      .sort((a, b) => (b.start_date || "").localeCompare(a.start_date || ""));
  }, [requests, yearFilter, statusFilter]);

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <CalendarDays className="w-5 h-5 text-slate-600" />
            My Requests
            <span className="text-sm font-normal text-slate-400">({sorted.length})</span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-8 w-[130px] text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="h-8 w-[100px] text-xs">
                <SelectValue placeholder="Year" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All years</SelectItem>
                {years.map((y) => (
                  <SelectItem key={y} value={String(y)}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {sorted.length === 0 ? (
          <div className="text-center py-10 text-slate-400">
            <CalendarDays className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p className="text-sm">
              {requests.length === 0
                ? "You haven't requested any time off yet."
                : "No requests match your filters."}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-slate-100">
            {sorted.map((r) => {
              const days = Number(r.total_days) || totalRequestedDays(r.start_date, r.end_date, r.half_day);
              const canCancel = r.status === "pending" || (r.status === "approved" && isUpcoming(r));
              return (
                <li key={r.id} className="py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-slate-900">{formatDateRange(r.start_date, r.end_date)}</span>
                      <TimeOffStatusBadge status={r.status} />
                    </div>
                    <p className="text-sm text-slate-500 mt-0.5">
                      {typeLabel(r.request_type)} · {days} day{days === 1 ? "" : "s"}
                      {r.manager_name ? ` · to ${r.manager_name}` : ""}
                    </p>
                    {r.reason && <p className="text-sm text-slate-600 mt-1 italic">“{r.reason}”</p>}
                    {r.review_notes && (
                      <p className="text-sm text-slate-600 mt-1 flex items-start gap-1.5">
                        <MessageSquare className="w-3.5 h-3.5 mt-0.5 text-slate-400 flex-shrink-0" />
                        <span>
                          <span className="font-medium">{r.reviewer_name || "Reviewer"}:</span> {r.review_notes}
                        </span>
                      </p>
                    )}
                  </div>
                  {canCancel && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-slate-500 hover:text-red-600 flex-shrink-0"
                      onClick={() => setToCancel(r)}
                    >
                      <X className="w-4 h-4 mr-1" />
                      Cancel
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!toCancel} onOpenChange={(open) => !open && setToCancel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this request?</AlertDialogTitle>
            <AlertDialogDescription>
              {toCancel && (
                <>
                  {typeLabel(toCancel.request_type)} for {formatDateRange(toCancel.start_date, toCancel.end_date)}.
                  This can't be undone — you'd need to submit a new request.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep request</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => toCancel && cancel.mutate(toCancel)}
            >
              Cancel request
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
