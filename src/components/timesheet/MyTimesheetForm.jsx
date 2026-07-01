import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitTimesheet } from "@/functions/submitTimesheet";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ClipboardList, Send, Info, Save, X, CalendarClock, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import {
  SERVICE_TYPES,
  paysByPoints,
  computePtoHoursForPeriod,
  getTimesheetValidationError,
  toNumber,
  NUMERIC_FIELDS,
} from "./timesheetUtils";
import {
  currentPayPeriod,
  listPayPeriods,
  payPeriodByIndex,
  periodIndexForDate,
  isPastDue,
  dueLabel,
  paydayLabel,
} from "./payPeriodSchedule";

const POINT_FIELDS = [
  { key: "regular_points", label: "Regular Points" },
  { key: "emergency_visit_points", label: "Emergency Visit Pts" },
];

const HOUR_FIELDS = [
  { key: "regular_hours", label: "Regular Hours" },
  { key: "overtime_hours", label: "Overtime (OT)" },
  { key: "holiday_hours", label: "Holiday" },
  { key: "on_call_hours", label: "On-Call Hours" },
];

const REIMB_FIELDS = [
  { key: "miles", label: "Miles" },
  { key: "reimbursement", label: "Other Reimbursement ($)" },
];

function blankForm(currentUser) {
  const period = currentPayPeriod();
  const base = {
    service_type: currentUser?.service_type === "hospice" ? "hospice" : "home_health",
    pay_period_start: period.start,
    pay_period_end: period.end,
    manager_email: "",
    notes: "",
  };
  for (const f of NUMERIC_FIELDS) base[f] = "";
  return base;
}

/**
 * Pay periods for the dropdown: the standard schedule window, plus the period of
 * the sheet being edited if it happens to fall outside that window (so an older
 * timesheet still shows its own period).
 */
function periodOptions(startISO, endISO) {
  const options = listPayPeriods();
  const key = `${startISO}__${endISO}`;
  if (startISO && !options.some((p) => p.key === key)) {
    const aligned = payPeriodByIndex(periodIndexForDate(startISO));
    options.unshift(
      aligned.key === key
        ? aligned
        : { key, start: startISO, end: endISO, label: `${startISO} → ${endISO}`, dueDate: "", payday: "" }
    );
  }
  return options;
}

function fromExisting(ts) {
  const base = {
    service_type: ts.service_type || "home_health",
    pay_period_start: ts.pay_period_start || "",
    pay_period_end: ts.pay_period_end || "",
    manager_email: ts.manager_email || "",
    notes: ts.notes || "",
  };
  for (const f of NUMERIC_FIELDS) base[f] = ts[f] == null || ts[f] === 0 ? "" : String(ts[f]);
  return base;
}

export default function MyTimesheetForm({
  currentUser,
  approvers = [],
  defaultManagerEmail = "",
  approvedTimeOff = [],
  phoneReimbursement = 0,
  editing = null,
  onCancelEdit,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    ...blankForm(currentUser),
    manager_email: defaultManagerEmail || "",
  }));
  const [error, setError] = useState("");

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // Load an existing timesheet into the form when the user chooses to edit one.
  useEffect(() => {
    if (editing) setForm(fromExisting(editing));
  }, [editing]);

  // Pre-select the profile manager once known, without clobbering a choice.
  useEffect(() => {
    if (defaultManagerEmail && !editing) {
      setForm((prev) => (prev.manager_email ? prev : { ...prev, manager_email: defaultManagerEmail }));
    }
  }, [defaultManagerEmail, editing]);

  const isHomeHealth = paysByPoints(form.service_type);

  // Approved PTO overlapping the chosen period — auto-added to the Vacation
  // column on payroll. This is a live preview; the server recomputes it
  // authoritatively on submit so it can't be tampered with.
  const autoPtoHours = useMemo(
    () => computePtoHoursForPeriod(approvedTimeOff, form.pay_period_start, form.pay_period_end),
    [approvedTimeOff, form.pay_period_start, form.pay_period_end]
  );

  // Scheduled pay periods (Sun→Sat biweekly). The selected one carries its due
  // date (noon Monday after period end) and payday.
  const periods = useMemo(
    () => periodOptions(form.pay_period_start, form.pay_period_end),
    [form.pay_period_start, form.pay_period_end]
  );
  const selectedKey = `${form.pay_period_start}__${form.pay_period_end}`;
  const selectedPeriod = periods.find((p) => p.key === selectedKey) || null;
  const pastDue = selectedPeriod ? isPastDue(selectedPeriod) : false;

  const save = useMutation({
    mutationFn: async (status) => {
      const payload = {
        service_type: form.service_type,
        pay_period_start: form.pay_period_start,
        pay_period_end: form.pay_period_end,
        manager_email: form.manager_email || "",
        notes: form.notes?.trim() || "",
        status,
      };
      for (const f of NUMERIC_FIELDS) payload[f] = toNumber(form[f]);
      if (editing?.id) payload.timesheet_id = editing.id;

      if (status === "submitted") {
        const validationError = getTimesheetValidationError({ ...payload, auto_pto_hours: autoPtoHours });
        if (validationError) throw new Error(validationError);
      }

      const result = await submitTimesheet(payload);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, status) => {
      toast.success(status === "submitted" ? "Timesheet submitted for approval." : "Draft saved.");
      setForm({ ...blankForm(currentUser), manager_email: form.manager_email });
      setError("");
      onCancelEdit?.();
      queryClient.invalidateQueries({ queryKey: ["timesheets"] });
    },
    onError: (err) => {
      setError(err?.response?.data?.error || err?.message || "Something went wrong saving your timesheet.");
    },
  });

  const busy = save.isPending;
  const canSubmit = !!form.pay_period_start && !!form.pay_period_end && !busy && !!currentUser?.email;

  // Rendered as a plain function call (not a nested <Component/>) so the inputs
  // keep their identity across re-renders and never lose focus mid-typing.
  const numberField = (field) => (
    <div key={field.key}>
      <Label htmlFor={`ts-${field.key}`}>{field.label}</Label>
      <Input
        id={`ts-${field.key}`}
        type="number"
        min="0"
        step="0.25"
        inputMode="decimal"
        className="mt-1"
        placeholder="0"
        value={form[field.key]}
        onChange={(e) => update({ [field.key]: e.target.value })}
      />
    </div>
  );

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <ClipboardList className="w-5 h-5 text-blue-600" />
          {editing ? "Edit Timesheet" : "New Timesheet"}
          {editing && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto text-slate-500"
              onClick={() => {
                onCancelEdit?.();
                setForm({ ...blankForm(currentUser), manager_email: form.manager_email });
              }}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel edit
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate("submitted");
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <Label htmlFor="ts-service">Service line</Label>
              <Select value={form.service_type} onValueChange={(v) => update({ service_type: v })}>
                <SelectTrigger id="ts-service" className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SERVICE_TYPES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="ts-period">Pay period</Label>
              <Select
                value={selectedKey}
                onValueChange={(v) => {
                  const p = periods.find((x) => x.key === v);
                  if (p) update({ pay_period_start: p.start, pay_period_end: p.end });
                }}
              >
                <SelectTrigger id="ts-period" className="mt-1">
                  <SelectValue placeholder="Select a pay period" />
                </SelectTrigger>
                <SelectContent>
                  {periods.map((p) => (
                    <SelectItem key={p.key} value={p.key}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedPeriod?.dueDate && (
            <div
              className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-sm rounded-lg border px-3 py-2 ${
                pastDue ? "bg-red-50 border-red-200 text-red-700" : "bg-slate-50 border-slate-200 text-slate-600"
              }`}
            >
              <span className="inline-flex items-center gap-1.5">
                <CalendarClock className="w-4 h-4" />
                Due <span className="font-semibold">{dueLabel(selectedPeriod)}</span>
              </span>
              <span className="text-slate-300">·</span>
              <span>
                Payday <span className="font-semibold">{paydayLabel(selectedPeriod)}</span>
              </span>
              {pastDue && (
                <span className="inline-flex items-center gap-1 font-semibold ml-auto">
                  <AlertTriangle className="w-4 h-4" /> Past due
                </span>
              )}
            </div>
          )}

          <Alert className="bg-blue-50 border-blue-200">
            <Info className="h-4 w-4 text-blue-600" />
            <AlertDescription className="text-blue-800 text-sm">
              {isHomeHealth
                ? "Home health is paid by the point and by the hour — enter both your visit points and your hours."
                : "Hospice is paid by the hour — enter your hours and on-call visits."}
            </AlertDescription>
          </Alert>

          {isHomeHealth && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Points</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {POINT_FIELDS.map((f) => numberField(f))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Hours</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {HOUR_FIELDS.map((f) => numberField(f))}
              {!isHomeHealth && numberField({ key: "on_call_visits", label: "On-Call Visits" })}
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700">Vacation</p>
              {autoPtoHours > 0 && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                  +{autoPtoHours} hrs from approved PTO (auto-added)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {numberField({ key: "vacation_hours", label: "Extra Vacation Hours" })}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {autoPtoHours > 0
                ? `Your approved time off in this period (${autoPtoHours} hrs) is added to Vacation automatically — only enter additional vacation here.`
                : "Approved time-off requests overlapping this pay period are added to Vacation automatically."}
            </p>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700">Mileage &amp; reimbursement</p>
              {phoneReimbursement > 0 && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                  +${phoneReimbursement} phone reimbursement (auto-added)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {REIMB_FIELDS.map((f) => numberField(f))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {phoneReimbursement > 0
                ? `Your $${phoneReimbursement}/pay phone reimbursement is added automatically — enter any other reimbursement or mileage here. `
                : ""}
              {isHomeHealth
                ? "Mileage is reimbursed at $0.45/mile."
                : "On-call pay is $5.00/hour; on-call visits are $50.00/visit."}
            </p>
          </div>

          {approvers.length > 0 ? (
            <div>
              <Label htmlFor="ts-manager">Send to approver</Label>
              <Select value={form.manager_email} onValueChange={(v) => update({ manager_email: v })}>
                <SelectTrigger id="ts-manager" className="mt-1">
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
              <p className="text-xs text-slate-400 mt-1">Leave unset to route to administrators.</p>
            </div>
          ) : (
            <Alert className="bg-blue-50 border-blue-200">
              <Info className="h-4 w-4 text-blue-600" />
              <AlertDescription className="text-blue-800 text-sm">
                Your timesheet will be routed to administrators for approval.
              </AlertDescription>
            </Alert>
          )}

          <div>
            <Label htmlFor="ts-notes">Notes (optional)</Label>
            <Textarea
              id="ts-notes"
              className="mt-1"
              rows={2}
              placeholder="Anything the approver should know…"
              value={form.notes}
              onChange={(e) => update({ notes: e.target.value })}
            />
          </div>

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="outline"
              disabled={busy || !currentUser?.email}
              onClick={() => save.mutate("draft")}
            >
              <Save className="w-4 h-4 mr-2" />
              Save draft
            </Button>
            <Button type="submit" disabled={!canSubmit} className="min-w-[150px]">
              <Send className="w-4 h-4 mr-2" />
              {busy ? "Saving…" : editing ? "Resubmit" : "Submit for approval"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
