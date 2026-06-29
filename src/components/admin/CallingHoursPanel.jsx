import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Clock, Save, CheckCircle2, MoonStar } from "lucide-react";
import { toast } from "sonner";
import {
  DAY_KEYS, defaultBusinessHours, isWithinBusinessHours, summarizeSchedule,
} from "@/components/voice/businessHours";
import { backfillTcpaQuietHours } from "@/functions/backfillTcpaQuietHours";

const DAY_LABELS = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

// Common US zones; any stored IANA value still works even if not listed.
const TIMEZONES = [
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix",
  "America/Los_Angeles", "America/Anchorage", "Pacific/Honolulu",
];

const guessTimeZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York";
  } catch {
    return "America/New_York";
  }
};

/**
 * CallingHoursPanel — global "calling & texting hours" for the agency. Outside
 * these hours, inbound calls auto-transfer (or go to voicemail) and inbound
 * texts get an automatic after-hours reply; nurses sending out are warned but
 * not blocked. Writes only the business-hours fields on AgencySettings, so it
 * coexists with the other settings cards (Base44 updates are partial).
 */
export default function CallingHoursPanel() {
  const queryClient = useQueryClient();
  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    refetchOnWindowFocus: false,
    initialData: [],
  });
  const settings = settingsArr[0];

  const [form, setForm] = useState({
    business_hours_enabled: false,
    business_hours_timezone: guessTimeZone(),
    business_hours: defaultBusinessHours(),
    business_hours_holidays: [],
    after_hours_call_action: "transfer",
    after_hours_transfer_number_e164: "",
    after_hours_call_greeting: "",
    after_hours_sms_auto_reply_enabled: true,
    after_hours_sms_auto_reply: "",
    // TCPA quiet hours default ON: not texting patients overnight is the
    // legally-safer floor. An agency can still explicitly disable it.
    tcpa_quiet_hours_enabled: true,
    tcpa_quiet_start_hour: 8,
    tcpa_quiet_end_hour: 21,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      business_hours_enabled: settings.business_hours_enabled === true,
      business_hours_timezone: settings.business_hours_timezone || guessTimeZone(),
      business_hours:
        settings.business_hours && typeof settings.business_hours === "object"
          ? { ...defaultBusinessHours(), ...settings.business_hours }
          : defaultBusinessHours(),
      business_hours_holidays: Array.isArray(settings.business_hours_holidays) ? settings.business_hours_holidays : [],
      after_hours_call_action: settings.after_hours_call_action || "transfer",
      after_hours_transfer_number_e164: settings.after_hours_transfer_number_e164 || "",
      after_hours_call_greeting: settings.after_hours_call_greeting || "",
      after_hours_sms_auto_reply_enabled: settings.after_hours_sms_auto_reply_enabled !== false,
      after_hours_sms_auto_reply: settings.after_hours_sms_auto_reply || "",
      // Default ON when unset (only an explicit `false` disables quiet hours).
      tcpa_quiet_hours_enabled: settings.tcpa_quiet_hours_enabled !== false,
      tcpa_quiet_start_hour: settings.tcpa_quiet_start_hour ?? 8,
      tcpa_quiet_end_hour: settings.tcpa_quiet_end_hour ?? 21,
    });
  }, [settings]);

  // One-time, idempotent backfill: existing agencies that never configured TCPA
  // quiet hours get the legally-safer default enforced immediately in the
  // outbound SMS paths. Only touches records where the flag was never set; an
  // explicit "off" is respected.
  useEffect(() => {
    backfillTcpaQuietHours()
      .then((res) => {
        const updated = (res?.data ?? res)?.updated_count ?? 0;
        if (updated > 0) {
          queryClient.invalidateQueries({ queryKey: ["agency-settings"] });
          toast.success("TCPA quiet hours are now enforced by default for outbound texting.");
        }
      })
      .catch((e) => console.warn("TCPA quiet-hours backfill skipped:", e?.message));
  }, [queryClient]);

  const save = useMutation({
    mutationFn: () => {
      const payload = { ...form };
      return settings?.id
        ? base44.entities.AgencySettings.update(settings.id, payload)
        : base44.entities.AgencySettings.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency-settings"] });
      toast.success("Calling & texting hours saved");
    },
    onError: (err) => toast.error(err?.message || "Failed to save hours"),
  });

  // Live open/closed status using the same helper the backend mirrors.
  const status = useMemo(
    () =>
      isWithinBusinessHours(new Date(), {
        enabled: form.business_hours_enabled,
        timeZone: form.business_hours_timezone,
        days: form.business_hours,
        holidays: form.business_hours_holidays,
      }),
    [form],
  );

  const setDay = (key, patch) =>
    setForm((f) => ({ ...f, business_hours: { ...f.business_hours, [key]: { ...f.business_hours[key], ...patch } } }));

  const tzOptions = TIMEZONES.includes(form.business_hours_timezone)
    ? TIMEZONES
    : [form.business_hours_timezone, ...TIMEZONES];

  return (
    <Card id="twilio-hours" className="scroll-mt-24">
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-indigo-600" />
            Calling &amp; Texting Hours
          </span>
          {form.business_hours_enabled ? (
            status.open ? (
              <Badge className="bg-green-100 text-green-800">
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" /> Open now
              </Badge>
            ) : (
              <Badge className="bg-slate-200 text-slate-700">
                <MoonStar className="w-3.5 h-3.5 mr-1" /> Closed now
              </Badge>
            )
          ) : (
            <Badge variant="outline">Always on</Badge>
          )}
        </CardTitle>
        <CardDescription>
          Set when patients can reach the practice. Outside these hours, inbound calls auto-transfer (or go to
          voicemail) and inbound texts get an automatic reply. Nurses sending out are warned, not blocked.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
          <div>
            <Label className="text-sm font-semibold">Enforce calling &amp; texting hours</Label>
            <p className="text-xs text-slate-600">
              When off, the practice is treated as always open and only per-nurse duty status applies.
            </p>
          </div>
          <Switch
            checked={form.business_hours_enabled}
            onCheckedChange={(v) => setForm((f) => ({ ...f, business_hours_enabled: v }))}
          />
        </div>

        {form.business_hours_enabled && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">Time zone</Label>
                <Select
                  value={form.business_hours_timezone}
                  onValueChange={(v) => setForm((f) => ({ ...f, business_hours_timezone: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue placeholder="Select a time zone" />
                  </SelectTrigger>
                  <SelectContent>
                    {tzOptions.map((tz) => (
                      <SelectItem key={tz} value={tz}>{tz}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-500 mt-1">Hours below are interpreted in this zone.</p>
              </div>
              <div className="flex items-end">
                <p className="text-xs text-slate-500">Current schedule: {summarizeSchedule(form.business_hours)}</p>
              </div>
            </div>

            <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
              {DAY_KEYS.map((key) => {
                const day = form.business_hours[key] || {};
                return (
                  <div key={key} className="flex items-center gap-3 p-2.5 flex-wrap">
                    <div className="flex items-center gap-2 w-32">
                      <Switch checked={day.enabled !== false} onCheckedChange={(v) => setDay(key, { enabled: v })} />
                      <span className="text-sm font-medium text-slate-700">{DAY_LABELS[key]}</span>
                    </div>
                    {day.enabled !== false ? (
                      <div className="flex items-center gap-2">
                        <Input
                          type="time"
                          value={day.open || "08:00"}
                          onChange={(e) => setDay(key, { open: e.target.value })}
                          className="w-32"
                        />
                        <span className="text-slate-400 text-sm">to</span>
                        <Input
                          type="time"
                          value={day.close || "17:00"}
                          onChange={(e) => setDay(key, { close: e.target.value })}
                          className="w-32"
                        />
                      </div>
                    ) : (
                      <span className="text-sm text-slate-400">Closed</span>
                    )}
                  </div>
                );
              })}
            </div>

            <div>
              <Label className="text-sm font-medium">Holiday closures</Label>
              <Textarea
                rows={2}
                placeholder={"One date per line, YYYY-MM-DD\n2026-12-25\n2027-01-01"}
                value={(form.business_hours_holidays || []).join("\n")}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    business_hours_holidays: e.target.value
                      .split(/[\n,]/)
                      .map((s) => s.trim())
                      .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)),
                  }))
                }
                className="mt-1 resize-none font-mono text-xs"
              />
              <p className="text-xs text-slate-500 mt-1">
                The practice is treated as closed all day on these dates (interpreted in the time zone above).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label className="text-sm font-medium">After-hours call handling</Label>
                <Select
                  value={form.after_hours_call_action}
                  onValueChange={(v) => setForm((f) => ({ ...f, after_hours_call_action: v }))}
                >
                  <SelectTrigger className="mt-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="transfer">Transfer to a number</SelectItem>
                    <SelectItem value="voicemail">Send to voicemail</SelectItem>
                    <SelectItem value="hangup">Play a message &amp; hang up</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.after_hours_call_action === "transfer" && (
                <div>
                  <Label className="text-sm font-medium">After-hours transfer number</Label>
                  <Input
                    placeholder="Defaults to the main office number"
                    value={form.after_hours_transfer_number_e164}
                    onChange={(e) => setForm((f) => ({ ...f, after_hours_transfer_number_e164: e.target.value }))}
                    className="mt-1"
                  />
                </div>
              )}
            </div>
            <div>
              <Label className="text-sm font-medium">After-hours call greeting</Label>
              <Textarea
                rows={2}
                placeholder="Our office is currently closed. Please hold while we connect you, or call {office}."
                value={form.after_hours_call_greeting}
                onChange={(e) => setForm((f) => ({ ...f, after_hours_call_greeting: e.target.value }))}
                className="mt-1 resize-none"
              />
              <p className="text-xs text-slate-500 mt-1">Spoken before transfer/voicemail. {"{office}"} inserts the main office number. Keep it PHI-free.</p>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label className="text-sm font-semibold">Automatic after-hours text reply</Label>
                  <p className="text-xs text-slate-600">Auto-replies to inbound texts received while closed (skips opted-out patients).</p>
                </div>
                <Switch
                  checked={form.after_hours_sms_auto_reply_enabled}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, after_hours_sms_auto_reply_enabled: v }))}
                />
              </div>
              {form.after_hours_sms_auto_reply_enabled && (
                <Textarea
                  rows={2}
                  placeholder="Thanks for your message. Our office is currently closed. For anything urgent, call {office}. We'll reply during business hours."
                  value={form.after_hours_sms_auto_reply}
                  onChange={(e) => setForm((f) => ({ ...f, after_hours_sms_auto_reply: e.target.value }))}
                  className="resize-none"
                />
              )}
            </div>
          </>
        )}

        {/* TCPA quiet hours — independent of business hours; keyed to the
            recipient's own timezone (by area code). */}
        <div className="p-3 bg-slate-50 rounded-lg space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-semibold">Enforce TCPA quiet hours</Label>
              <p className="text-xs text-slate-600">
                Block outbound texts that would land outside the allowed window in the <strong>recipient's</strong>{" "}
                timezone (derived from their area code). A separate legal floor from the agency hours above.
              </p>
            </div>
            <Switch
              checked={form.tcpa_quiet_hours_enabled}
              onCheckedChange={(v) => setForm((f) => ({ ...f, tcpa_quiet_hours_enabled: v }))}
            />
          </div>
          {form.tcpa_quiet_hours_enabled && (
            <div className="flex items-center gap-3 flex-wrap">
              <div>
                <Label className="text-xs text-slate-500">Earliest (hour, 0–23)</Label>
                <Input
                  type="number" min={0} max={23}
                  value={form.tcpa_quiet_start_hour}
                  onChange={(e) => setForm((f) => ({ ...f, tcpa_quiet_start_hour: Number(e.target.value) }))}
                  className="mt-1 w-24"
                />
              </div>
              <div>
                <Label className="text-xs text-slate-500">Latest (hour, 0–23)</Label>
                <Input
                  type="number" min={0} max={23}
                  value={form.tcpa_quiet_end_hour}
                  onChange={(e) => setForm((f) => ({ ...f, tcpa_quiet_end_hour: Number(e.target.value) }))}
                  className="mt-1 w-24"
                />
              </div>
              <p className="text-[11px] text-slate-500 max-w-xs">
                Default 8–21 (8:00am–9:00pm). Texts to numbers whose timezone can't be determined are allowed.
              </p>
            </div>
          )}
        </div>

        <div className="flex justify-end">
          <Button onClick={() => save.mutate()} disabled={save.isPending} className="bg-indigo-600 hover:bg-indigo-700">
            <Save className="w-4 h-4 mr-2" />
            Save Hours
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
