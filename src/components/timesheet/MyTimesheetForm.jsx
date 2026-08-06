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
  VISIT_TYPES,
  serviceTypeLabel,
  computePtoHoursForPeriod,
  computeVisitPoints,
  normalizeVisitCounts,
  pointFieldFor,
  payPeriodDays,
  dailyStateToEntries,
  sumDailyEntries,
  getTimesheetValidationError,
  toNumber,
  NUMERIC_FIELDS,
} from "./timesheetUtils";
import DailyEntryGrid from "./DailyEntryGrid";
import {
  currentPayPeriod,
  listPayPeriods,
  payPeriodByIndex,
  periodIndexForDate,
  isPastDue,
  dueLabel,
  paydayLabel,
} from "./payPeriodSchedule";

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

function blankForm(serviceType) {
  const period = currentPayPeriod();
  const base = {
    service_type: serviceType === "hospice" ? "hospice" : "home_health",
    pay_period_start: period.start,
    pay_period_end: period.end,
    manager_email: "",
    notes: "",
    visit_counts: {},
    entry_mode: "bulk",
    daily: {},
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
    visit_counts: {},
    entry_mode: ts.entry_mode === "daily" ? "daily" : "bulk",
    daily: {},
  };
  for (const f of NUMERIC_FIELDS) base[f] = ts[f] == null || ts[f] === 0 ? "" : String(ts[f]);
  for (const vt of VISIT_TYPES) {
    const n = ts.visit_counts?.[vt.key];
    base.visit_counts[vt.key] = n == null || n === 0 ? "" : String(n);
  }
  // Rebuild the per-day grid state (flat cells keyed by date) from stored rows.
  for (const e of Array.isArray(ts.daily_entries) ? ts.daily_entries : []) {
    if (!e?.date) continue;
    const cell = {};
    for (const f of ["regular_hours", "overtime_hours", "holiday_hours", "on_call_hours", "on_call_visits"]) {
      if (e[f]) cell[f] = String(e[f]);
    }
    for (const vt of VISIT_TYPES) {
      const v = e.visit_counts?.[vt.key];
      if (v) cell[vt.key] = String(v);
    }
    base.daily[e.date] = cell;
  }
  return base;
}

export default function MyTimesheetForm({
  currentUser,
  approvers = [],
  defaultManagerEmail = "",
  approvedTimeOff = [],
  phoneReimbursement = 0,
  visitPointConfig = null,
  employeeServiceType = "home_health",
  employeeEarnsPoints = false,
  editing = null,
  onCancelEdit,
}) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(() => ({
    ...blankForm(employeeServiceType),
    manager_email: defaultManagerEmail || "",
  }));
  const [error, setError] = useState("");

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));
  const updateVisit = (key, val) =>
    setForm((prev) => ({ ...prev, visit_counts: { ...prev.visit_counts, [key]: val } }));
  const updateDaily = (date, key, val) =>
    setForm((prev) => ({
      ...prev,
      daily: { ...prev.daily, [date]: { ...prev.daily?.[date], [key]: val } },
    }));

  // Service line + points-eligibility are admin-set (props), not chosen here.
  // Declared before the effects below, which depend on `serviceType`.
  const serviceType = employeeServiceType === "hospice" ? "hospice" : "home_health";
  const isHomeHealth = serviceType === "home_health";
  const earnsPoints = employeeEarnsPoints === true;

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

  // Keep the (admin-set) service line in sync once the profile resolves.
  useEffect(() => {
    if (!editing) {
      setForm((prev) => (prev.service_type === serviceType ? prev : { ...prev, service_type: serviceType }));
    }
  }, [serviceType, editing]);

  const mode = form.entry_mode === "daily" ? "daily" : "bulk";

  // Daily-entry rollup: the per-day rows summed into period totals + visit counts.
  const days = useMemo(
    () => payPeriodDays(form.pay_period_start, form.pay_period_end),
    [form.pay_period_start, form.pay_period_end]
  );
  // Only the days visible in the currently selected period are submitted/rolled
  // up. Cells left in state from a previously selected period (form.daily is
  // keyed by date and never pruned when the period changes) are excluded so they
  // can't leak into this period's totals/points/payload. The pure helper stays
  // unchanged — we just feed it the in-period subset.
  const dailyEntries = useMemo(() => {
    const inPeriod = new Set(days);
    const scoped = {};
    for (const [date, cell] of Object.entries(form.daily || {})) {
      if (inPeriod.has(date)) scoped[date] = cell;
    }
    return dailyStateToEntries(scoped);
  }, [form.daily, days]);
  const rollup = useMemo(() => sumDailyEntries(dailyEntries), [dailyEntries]);

  // Effective visit counts drive the live points total for whichever mode is active.
  const effectiveVisitCounts = mode === "daily" ? rollup.visit_counts : form.visit_counts;
  const computedPoints = useMemo(
    () => computeVisitPoints(effectiveVisitCounts, visitPointConfig),
    [effectiveVisitCounts, visitPointConfig]
  );
  const hasPointConfig =
    !!visitPointConfig && VISIT_TYPES.some((vt) => toNumber(visitPointConfig?.[pointFieldFor(vt.key)]) > 0);

  // Approved PTO overlapping the chosen period — auto-added to the PTO
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
    /**
     * @param {"draft" | "submitted"} status
     */
    mutationFn: async (/** @type {"draft" | "submitted"} */ status) => {
      const payload = {
        // service_type is resolved server-side from the employee's payroll
        // profile; sent here only for reference.
        service_type: serviceType,
        pay_period_start: form.pay_period_start,
        pay_period_end: form.pay_period_end,
        manager_email: form.manager_email || "",
        notes: form.notes?.trim() || "",
        status,
      };
      for (const f of NUMERIC_FIELDS) payload[f] = toNumber(form[f]);
      payload.entry_mode = mode;
      if (mode === "daily") {
        // Server sums the per-day rows into the totals + visit_counts.
        payload.daily_entries = dailyEntries;
      } else if (earnsPoints) {
        payload.visit_counts = normalizeVisitCounts(form.visit_counts);
      }
      if (editing?.id) payload.timesheet_id = editing.id;

      if (status === "submitted") {
        // Validate against the EFFECTIVE values (daily rollup or bulk fields).
        const effective =
          mode === "daily"
            ? { ...payload, ...rollup, visit_counts: rollup.visit_counts }
            : { ...payload, visit_counts: normalizeVisitCounts(form.visit_counts) };
        const validationError = getTimesheetValidationError({ ...effective, auto_pto_hours: autoPtoHours });
        if (validationError) throw new Error(validationError);
      }

      const result = await submitTimesheet(payload);
      if (result?.error) throw new Error(result.error);
      return result;
    },
    onSuccess: (_data, /** @type {"draft" | "submitted"} */ status) => {
      toast.success(status === "submitted" ? "Timesheet submitted for approval." : "Draft saved.");
      setForm({ ...blankForm(serviceType), manager_email: form.manager_email });
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

  const visitField = (vt) => {
    const ptVal = toNumber(visitPointConfig?.[pointFieldFor(vt.key)]);
    return (
      <div key={vt.key}>
        <Label htmlFor={`ts-visit-${vt.key}`} className="flex items-center gap-1">
          {vt.label}
          {ptVal > 0 && (
            <span className="text-xs font-normal text-slate-400">
              ({ptVal} pt{ptVal === 1 ? "" : "s"})
            </span>
          )}
        </Label>
        <Input
          id={`ts-visit-${vt.key}`}
          type="number"
          min="0"
          step="1"
          inputMode="numeric"
          className="mt-1"
          placeholder="0"
          value={form.visit_counts?.[vt.key] ?? ""}
          onChange={(e) => updateVisit(vt.key, e.target.value)}
        />
      </div>
    );
  };

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
                setForm({ ...blankForm(serviceType), manager_email: form.manager_email });
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
              <Label>Service line</Label>
              <div className="mt-1 flex h-10 items-center rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
                {serviceTypeLabel(serviceType)}
                <span className="ml-2 text-slate-400">· {earnsPoints ? "Paid by points + hourly" : "Hourly"}</span>
              </div>
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
              {earnsPoints
                ? "Home health field staff are paid by the point and by the hour — enter your visits and your hours."
                : isHomeHealth
                  ? "You're paid by the hour — enter your hours."
                  : "Hospice is paid by the hour — enter your hours and on-call visits."}
            </AlertDescription>
          </Alert>

          <div>
            <p className="text-sm font-semibold text-slate-700 mb-2">Entry mode</p>
            <div className="inline-flex rounded-lg border border-slate-200 p-0.5 bg-slate-50">
              {["bulk", "daily"].map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => update({ entry_mode: m })}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                    mode === m ? "bg-white shadow-sm font-semibold text-slate-900" : "text-slate-500 hover:text-slate-700"
                  }`}
                >
                  {m === "bulk" ? "Bulk (period total)" : "Daily entry"}
                </button>
              ))}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {mode === "daily"
                ? "Enter your hours and visits for each day — totals roll up automatically."
                : "Enter your totals for the whole pay period at once."}
            </p>
          </div>

          {earnsPoints && mode === "bulk" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-700">Visits (points)</p>
                <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
                  Total points: {computedPoints}
                </span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                {VISIT_TYPES.map((vt) => visitField(vt))}
              </div>
              <p className="text-xs text-slate-400 mt-1">
                {hasPointConfig
                  ? "Total points are calculated from your visit counts and the facility's point value for each visit type."
                  : "Enter your visits by type. Your administrator sets the point value for each type; totals appear once configured."}
              </p>
            </div>
          )}

          {mode === "bulk" && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Hours</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {HOUR_FIELDS.map((f) => numberField(f))}
                {!isHomeHealth && numberField({ key: "on_call_visits", label: "On-Call Visits" })}
              </div>
            </div>
          )}

          {mode === "daily" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-slate-700">
                  Daily hours{earnsPoints ? " & visits" : ""}
                </p>
                {earnsPoints && (
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-2.5 py-0.5">
                    Total points: {computedPoints}
                  </span>
                )}
              </div>
              <DailyEntryGrid
                days={days}
                serviceType={serviceType}
                earnsPoints={earnsPoints}
                visitPointConfig={visitPointConfig}
                value={form.daily}
                onCell={updateDaily}
              />
              <p className="text-xs text-slate-400 mt-1">
                Fill the days you worked — totals roll up below. PTO, mileage
                {earnsPoints ? ", emergency points," : ""} and other reimbursement are entered once below.
              </p>
            </div>
          )}

          {earnsPoints && (
            <div>
              <p className="text-sm font-semibold text-slate-700 mb-2">Emergency visit points</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {numberField({ key: "emergency_visit_points", label: "Emerg Visit Pts" })}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-semibold text-slate-700">PTO</p>
              {autoPtoHours > 0 && (
                <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-0.5">
                  +{autoPtoHours} hrs from approved PTO (auto-added)
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {numberField({ key: "vacation_hours", label: "Extra PTO Hours" })}
            </div>
            <p className="text-xs text-slate-400 mt-1">
              {autoPtoHours > 0
                ? `Your approved time off in this period (${autoPtoHours} hrs) is added to PTO automatically — only enter additional PTO here.`
                : "Approved time-off requests overlapping this pay period are added to PTO automatically."}
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
