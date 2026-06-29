import { useState, useEffect } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Phone, PhoneOff, Save, Info, CalendarClock, CalendarDays, MessageSquare } from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
import { scheduleState, getUpcomingWeekend, WEEK_MS } from "@/components/voice/dutyUtils";
import { cn } from "@/lib/utils";

/** ISO string -> value for an <input type="datetime-local"> (local time). */
function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value -> ISO string (interpreted as local time), or null. */
function fromLocalInput(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function prettyWindow(startIso, endIso) {
  if (!startIso || !endIso) return "";
  return `${format(new Date(startIso), "EEE MMM d, h:mm a")} – ${format(new Date(endIso), "EEE MMM d, h:mm a")}`;
}

/**
 * DutyStatusCard — a nurse's phone-availability controls:
 *  1. A simple On Duty / Off Duty switch (takes effect immediately).
 *  2. A separate "Schedule time off" toggle (e.g. the weekend) with a start
 *     and end time — calls/texts route to the main office during the window and
 *     the nurse is back on duty automatically when it ends.
 *  3. The off-duty greeting callers/texters receive.
 */
export default function DutyStatusCard() {
  const queryClient = useQueryClient();
  const [offDutyMessage, setOffDutyMessage] = useState("");
  const [scheduleOn, setScheduleOn] = useState(false);
  const [startInput, setStartInput] = useState("");
  const [endInput, setEndInput] = useState("");
  const [recurring, setRecurring] = useState(false);

  const { data: user, isLoading } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me(),
  });

  useEffect(() => {
    if (!user) return;
    setOffDutyMessage(user.off_duty_message || "");
    const isRecurring = !!user.scheduled_off_duty_recurring;
    const state = scheduleState(user.scheduled_off_duty_start, user.scheduled_off_duty_end, undefined, isRecurring);
    const live = state !== "none" && state !== "expired";
    setScheduleOn(live);
    setRecurring(live && isRecurring);
    setStartInput(live ? toLocalInput(user.scheduled_off_duty_start) : "");
    setEndInput(live ? toLocalInput(user.scheduled_off_duty_end) : "");
  }, [user]);

  const mutation = useMutation({
    mutationFn: (payload) => base44.functions.invoke("setNurseDutyStatus", payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["currentUser"] }),
    onError: (err) => toast.error(err?.message || "Failed to update duty status"),
  });

  if (isLoading) return null;

  const onDuty = user?.duty_status === "on_duty";
  const hasWorkNumber = !!user?.work_phone_number;
  const savedRecurring = !!user?.scheduled_off_duty_recurring;
  const savedState = scheduleState(
    user?.scheduled_off_duty_start,
    user?.scheduled_off_duty_end,
    undefined,
    savedRecurring
  );

  const handleToggle = (checked) => {
    mutation.mutate(
      { duty_status: checked ? "on_duty" : "off_duty" },
      { onSuccess: () => toast.success(checked ? "You're now on duty" : "You're now off duty") }
    );
  };

  const handleSaveMessage = () => {
    mutation.mutate(
      { off_duty_message: offDutyMessage },
      { onSuccess: () => toast.success("Off-duty message saved") }
    );
  };

  const fillWeekend = () => {
    const { start, end } = getUpcomingWeekend();
    setStartInput(toLocalInput(start.toISOString()));
    setEndInput(toLocalInput(end.toISOString()));
  };

  const handleScheduleToggle = (checked) => {
    setScheduleOn(checked);
    if (checked) {
      // Pre-fill the upcoming weekend so the common case is one tap.
      if (!startInput && !endInput) fillWeekend();
      return;
    }
    // Turning the schedule off clears any saved window.
    setStartInput("");
    setEndInput("");
    setRecurring(false);
    if (user?.scheduled_off_duty_start || user?.scheduled_off_duty_end) {
      mutation.mutate(
        { scheduled_off_duty_start: null, scheduled_off_duty_end: null, scheduled_off_duty_recurring: false },
        { onSuccess: () => toast.success("Scheduled time off cleared") }
      );
    }
  };

  const handleSaveSchedule = () => {
    const startIso = fromLocalInput(startInput);
    const endIso = fromLocalInput(endInput);
    if (!startIso || !endIso) {
      toast.error("Please choose both a start and end time.");
      return;
    }
    if (new Date(endIso) <= new Date(startIso)) {
      toast.error("End time must be after the start time.");
      return;
    }
    if (recurring && new Date(endIso) - new Date(startIso) >= WEEK_MS) {
      toast.error("A repeating time-off window must be shorter than 7 days.");
      return;
    }
    mutation.mutate(
      { scheduled_off_duty_start: startIso, scheduled_off_duty_end: endIso, scheduled_off_duty_recurring: recurring },
      { onSuccess: () => toast.success("Scheduled time off saved") }
    );
  };

  return (
    <div className="space-y-5">
      {!hasWorkNumber && (
        <Alert className="bg-amber-50 border-amber-200">
          <Info className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800">
            No work number is assigned to your account yet. Ask an administrator to provision one
            so patients can reach you privately.
          </AlertDescription>
        </Alert>
      )}

      {/* 1. Availability hero — the primary on/off control, color-coded so the
          nurse's current reachability is obvious at a glance. */}
      <Card className="overflow-hidden">
        <div
          className={cn(
            "p-5 sm:p-6 transition-colors",
            onDuty
              ? "bg-gradient-to-br from-emerald-50 via-green-50 to-white"
              : "bg-gradient-to-br from-amber-50 via-orange-50 to-white"
          )}
        >
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-4 min-w-0">
              <div
                className={cn(
                  "flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl text-white shadow-sm",
                  onDuty ? "bg-green-600" : "bg-amber-500"
                )}
              >
                {onDuty ? <Phone className="w-7 h-7" /> : <PhoneOff className="w-7 h-7" />}
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-xl font-bold text-slate-900">{onDuty ? "On Duty" : "Off Duty"}</h3>
                  <Badge className={onDuty ? "bg-green-600" : "bg-amber-500"}>
                    {onDuty ? "Available" : "Unavailable"}
                  </Badge>
                </div>
                <p className="mt-1.5 text-sm text-slate-600 max-w-md">
                  {onDuty
                    ? "Patient calls ring your phone (caller ID shows your work number) and texts reach your inbox."
                    : "Patient calls hear your off-duty greeting and transfer to the main office; texts get an auto-reply."}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-center flex-shrink-0">
              <span className={cn("text-sm font-medium", !onDuty ? "text-amber-700" : "text-slate-400")}>Off</span>
              <Switch
                checked={onDuty}
                onCheckedChange={handleToggle}
                disabled={mutation.isPending || !hasWorkNumber}
                aria-label="Toggle on duty"
                className="scale-125 data-[state=checked]:bg-green-600 data-[state=unchecked]:bg-amber-400"
              />
              <span className={cn("text-sm font-medium", onDuty ? "text-green-700" : "text-slate-400")}>On</span>
            </div>
          </div>
        </div>
      </Card>

      {/* Heads-up when a schedule is overriding an on-duty status right now */}
      {onDuty && savedState === "active" && (
        <Alert className="bg-amber-50 border-amber-200">
          <CalendarClock className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            {savedRecurring
              ? "Scheduled time off is active right now (weekly) — calls and texts are going to the main office."
              : `Scheduled time off is active right now — calls and texts are going to the main office until ${format(new Date(user.scheduled_off_duty_end), "EEE MMM d, h:mm a")}.`}
          </AlertDescription>
        </Alert>
      )}

      {/* 2. Scheduled time off */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-indigo-100 text-indigo-600">
                <CalendarClock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <CardTitle className="text-base">Schedule time off</CardTitle>
                <CardDescription className="mt-1">
                  Be off duty for a set window (like the weekend). You'll be back on duty automatically when it ends.
                </CardDescription>
              </div>
            </div>
            <Switch
              checked={scheduleOn}
              onCheckedChange={handleScheduleToggle}
              disabled={mutation.isPending || !hasWorkNumber}
              aria-label="Enable scheduled time off"
              className="flex-shrink-0 mt-0.5 data-[state=checked]:bg-indigo-600"
            />
          </div>
        </CardHeader>

        {scheduleOn && (
          <CardContent className="space-y-4 pt-0">
            <Button type="button" variant="outline" size="sm" onClick={fillWeekend}>
              <CalendarDays className="w-3.5 h-3.5 mr-1.5" />
              This weekend
            </Button>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="off-start" className="text-xs font-medium text-slate-600">Start</Label>
                <Input
                  id="off-start"
                  type="datetime-local"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  className="mt-1"
                />
              </div>
              <div>
                <Label htmlFor="off-end" className="text-xs font-medium text-slate-600">End</Label>
                <Input
                  id="off-end"
                  type="datetime-local"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 p-3">
              <div className="min-w-0">
                <Label htmlFor="off-recurring" className="text-sm font-medium text-slate-700">
                  Repeat every week
                </Label>
                <p className="text-xs text-slate-500">e.g. every weekend</p>
              </div>
              <Switch
                id="off-recurring"
                checked={recurring}
                onCheckedChange={setRecurring}
                disabled={mutation.isPending}
                className="flex-shrink-0 data-[state=checked]:bg-indigo-600"
              />
            </div>

            <div className="flex items-center justify-between flex-wrap gap-3 pt-1">
              <div>
                {savedState === "active" && (
                  <Badge className="bg-amber-600">
                    {savedRecurring ? "Active now · weekly" : `Active now · ends ${format(new Date(user.scheduled_off_duty_end), "EEE h:mm a")}`}
                  </Badge>
                )}
                {savedState === "upcoming" && (
                  <Badge className="bg-blue-600">Scheduled · {prettyWindow(user.scheduled_off_duty_start, user.scheduled_off_duty_end)}</Badge>
                )}
                {savedState === "recurring" && (
                  <Badge className="bg-indigo-600">
                    Weekly · {format(new Date(user.scheduled_off_duty_start), "EEE h:mm a")} – {format(new Date(user.scheduled_off_duty_end), "EEE h:mm a")}
                  </Badge>
                )}
              </div>
              <Button onClick={handleSaveSchedule} disabled={mutation.isPending} size="sm" className="bg-indigo-600 hover:bg-indigo-700">
                <Save className="w-4 h-4 mr-2" />
                Save schedule
              </Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* 3. Off-duty greeting */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-blue-100 text-blue-600">
              <MessageSquare className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <CardTitle className="text-base">Off-duty message</CardTitle>
              <CardDescription className="mt-1">
                Played to callers and sent as a text auto-reply while you're off duty. Avoid clinical details
                (no diagnoses). Use <code className="bg-slate-100 px-1 rounded text-slate-700">{"{office}"}</code> to insert the main office number.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-0">
          <Textarea
            id="off-duty-message"
            value={offDutyMessage}
            onChange={(e) => setOffDutyMessage(e.target.value)}
            rows={3}
            placeholder="Hi, you've reached your care team's off-hours line. For assistance please call our main office at {office}."
            className="resize-none"
          />
          <div className="flex justify-end">
            <Button onClick={handleSaveMessage} disabled={mutation.isPending} variant="outline">
              <Save className="w-4 h-4 mr-2" />
              Save message
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
