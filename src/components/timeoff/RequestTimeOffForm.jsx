import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitTimeOffRequest } from "@/functions/submitTimeOffRequest";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarPlus, Send, Info } from "lucide-react";
import { toast } from "sonner";
import {
  REQUEST_TYPES,
  totalRequestedDays,
  getRequestValidationError,
} from "./timeOffUtils";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const EMPTY = {
  request_type: "vacation",
  start_date: "",
  end_date: "",
  half_day: false,
  manager_email: "",
  reason: "",
  coverage: "",
};

export default function RequestTimeOffForm({
  currentUser,
  approvers = [],
  defaultManagerEmail = "",
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ ...EMPTY, manager_email: defaultManagerEmail || "" });
  const [error, setError] = useState("");

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // currentUser resolves asynchronously; once a profile manager is known,
  // pre-select it — but never clobber a choice the employee already made.
  useEffect(() => {
    if (defaultManagerEmail) {
      setForm((prev) => (prev.manager_email ? prev : { ...prev, manager_email: defaultManagerEmail }));
    }
  }, [defaultManagerEmail]);

  const totalDays = useMemo(
    () => totalRequestedDays(form.start_date, form.end_date, form.half_day),
    [form.start_date, form.end_date, form.half_day]
  );

  const submit = useMutation({
    mutationFn: async () => {
      const validationError = getRequestValidationError(form.start_date, form.end_date, form.half_day);
      if (validationError) throw new Error(validationError);

      // Identity, day totals, approver validation, and notifications are all
      // handled server-side by the function (the entity is admin-write-only),
      // which prevents filing on behalf of others or self-approval.
      const result = await submitTimeOffRequest({
        request_type: form.request_type,
        start_date: form.start_date,
        end_date: form.end_date,
        half_day: form.half_day,
        manager_email: form.manager_email || "",
        reason: form.reason?.trim() || "",
        coverage: form.coverage?.trim() || "",
      });
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: () => {
      toast.success("Time-off request submitted for approval.");
      setForm({ ...EMPTY, manager_email: form.manager_email });
      setError("");
      queryClient.invalidateQueries({ queryKey: ["timeoff"] });
    },
    onError: (err) => {
      setError(err?.response?.data?.error || err?.message || "Something went wrong submitting your request.");
    },
  });

  const canSubmit =
    form.start_date && form.end_date && totalDays > 0 && !submit.isPending && !!currentUser?.email;

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <CalendarPlus className="w-5 h-5 text-blue-600" />
          Request Time Off
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <div>
            <Label htmlFor="to-type">Type of leave</Label>
            <Select value={form.request_type} onValueChange={(v) => update({ request_type: v })}>
              <SelectTrigger id="to-type" className="mt-1">
                <SelectValue placeholder="Select a type" />
              </SelectTrigger>
              <SelectContent>
                {REQUEST_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="to-start">Start date</Label>
              <Input
                id="to-start"
                type="date"
                className="mt-1"
                min={todayISO()}
                value={form.start_date}
                onChange={(e) => {
                  const start_date = e.target.value;
                  // Keep end_date in sync so it never precedes the start.
                  update({
                    start_date,
                    end_date: form.end_date && form.end_date < start_date ? start_date : form.end_date,
                  });
                }}
              />
            </div>
            <div>
              <Label htmlFor="to-end">End date</Label>
              <Input
                id="to-end"
                type="date"
                className="mt-1"
                min={form.start_date || todayISO()}
                value={form.end_date}
                onChange={(e) => update({ end_date: e.target.value })}
              />
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="to-half"
              checked={form.half_day}
              onCheckedChange={(checked) => update({ half_day: checked === true })}
            />
            <Label htmlFor="to-half" className="font-normal cursor-pointer">
              Half day (applies a ½-day reduction)
            </Label>
          </div>

          {approvers.length > 0 ? (
            <div>
              <Label htmlFor="to-manager">Send to manager</Label>
              <Select value={form.manager_email} onValueChange={(v) => update({ manager_email: v })}>
                <SelectTrigger id="to-manager" className="mt-1">
                  <SelectValue placeholder="Select an approver" />
                </SelectTrigger>
                <SelectContent>
                  {approvers.map((a) => (
                    <SelectItem key={a.email} value={a.email}>
                      {a.name} {a.role === "admin" ? "(Admin)" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-slate-400 mt-1">
                Leave unset to route the request to administrators.
              </p>
            </div>
          ) : (
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                Your request will be routed to administrators for approval.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="to-reason">Reason / notes (optional)</Label>
            <Textarea
              id="to-reason"
              className="mt-1"
              rows={2}
              placeholder="Add any context for your manager…"
              value={form.reason}
              onChange={(e) => update({ reason: e.target.value })}
            />
          </div>

          <div>
            <Label htmlFor="to-coverage">Coverage plan (optional)</Label>
            <Textarea
              id="to-coverage"
              className="mt-1"
              rows={2}
              placeholder="Who will cover your visits / responsibilities?"
              value={form.coverage}
              onChange={(e) => update({ coverage: e.target.value })}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between gap-3 pt-1">
            <p className="text-sm text-slate-600">
              {totalDays > 0 ? (
                <>
                  Requesting <span className="font-semibold text-slate-900">{totalDays}</span> business day
                  {totalDays === 1 ? "" : "s"}
                </>
              ) : form.start_date && form.end_date ? (
                <span className="text-amber-600">No working days in range (weekends excluded)</span>
              ) : (
                "Select a date range"
              )}
            </p>
            <Button type="submit" disabled={!canSubmit} className="min-w-[140px]">
              <Send className="w-4 h-4 mr-2" />
              {submit.isPending ? "Submitting…" : "Submit request"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
