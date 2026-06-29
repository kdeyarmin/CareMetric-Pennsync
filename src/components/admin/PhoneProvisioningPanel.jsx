import { useState, useEffect, useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { appParams } from "@/lib/app-params";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Phone, Save, ShieldCheck, Info, CheckCircle2, AlertTriangle, XCircle,
  Loader2, Copy, Check, Activity, Webhook, Send, Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { maskPhone, formatPhoneDisplay, normalizeE164 } from "@/components/voice/phoneUtils";
import {
  evaluateAgencyConfig, summarize, WEBHOOK_FUNCTIONS, functionUrlBase,
} from "@/components/admin/twilioSetup";
import { isAdminLike } from "@/lib/superAdmin";
import CallingHoursPanel from "@/components/admin/CallingHoursPanel";
import NumberPoolPanel from "@/components/admin/NumberPoolPanel";

const STATUS_META = {
  ok: { Icon: CheckCircle2, color: "text-green-600", badge: "bg-green-100 text-green-800" },
  warn: { Icon: AlertTriangle, color: "text-amber-600", badge: "bg-amber-100 text-amber-800" },
  fail: { Icon: XCircle, color: "text-red-600", badge: "bg-red-100 text-red-800" },
};

/** One row in a readiness checklist: status icon + label + detail. */
function CheckRow({ check }) {
  const meta = STATUS_META[check.status] || STATUS_META.warn;
  const { Icon } = meta;
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon className={`w-4 h-4 mt-0.5 flex-shrink-0 ${meta.color}`} />
      <div className="min-w-0">
        <p className="text-sm font-medium text-slate-900">{check.label}</p>
        <p className="text-xs text-slate-600">{check.detail}</p>
      </div>
    </div>
  );
}

/** Small copy-to-clipboard button with a transient checkmark. */
function CopyButton({ value, label }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };
  return (
    <Button type="button" variant="ghost" size="sm" onClick={copy} className="h-7 px-2" title={`Copy ${label}`}>
      {copied ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </Button>
  );
}

/**
 * PhoneProvisioningPanel — admin-only. Assigns Telnyx work numbers + private
 * cell bridge targets to nurses and configures agency-wide phone settings.
 */
export default function PhoneProvisioningPanel() {
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdmin = isAdminLike(currentUser);

  const { data: users = [] } = useQuery({
    queryKey: ["phone-users"],
    queryFn: () => base44.entities.User.list("full_name", 200),
    enabled: isAdmin,
    initialData: [],
  });

  const { data: settingsArr = [] } = useQuery({
    queryKey: ["agency-settings"],
    queryFn: () => base44.entities.AgencySettings.list("-created_date", 1),
    enabled: isAdmin,
    // Don't refetch on window focus: it would re-run the form-init effect below
    // and overwrite the admin's unsaved edits.
    refetchOnWindowFocus: false,
    initialData: [],
  });
  const settings = settingsArr[0];

  const [agency, setAgency] = useState({
    main_office_number_e164: "",
    office_fax_number_e164: "",
    default_off_duty_template: "",
    sms_messaging_enabled: true,
    sms_quick_replies: [],
    sms_templates: [],
    voicemail_enabled: false,
    voicemail_greeting: "",
    allow_international: false,
    monthly_sms_cap: "",
  });
  const [inputs, setInputs] = useState({}); // email -> { work, cell }

  useEffect(() => {
    if (settings) {
      setAgency({
        main_office_number_e164: settings.main_office_number_e164 || "",
        office_fax_number_e164: settings.office_fax_number_e164 || "",
        default_off_duty_template: settings.default_off_duty_template || "",
        sms_messaging_enabled: settings.sms_messaging_enabled ?? true,
        sms_quick_replies: Array.isArray(settings.sms_quick_replies) ? settings.sms_quick_replies : [],
        sms_templates: Array.isArray(settings.sms_templates) ? settings.sms_templates : [],
        voicemail_enabled: settings.voicemail_enabled === true,
        voicemail_greeting: settings.voicemail_greeting || "",
        allow_international: settings.allow_international === true,
        monthly_sms_cap: settings.monthly_sms_cap ?? "",
      });
    }
  }, [settings]);

  const saveAgency = useMutation({
    mutationFn: () => {
      // Coerce the monthly cap to a positive number or null ("no cap").
      const capNum = Number(agency.monthly_sms_cap);
      const payload = {
        ...agency,
        monthly_sms_cap: Number.isFinite(capNum) && capNum > 0 ? capNum : null,
      };
      return settings?.id
        ? base44.entities.AgencySettings.update(settings.id, payload)
        : base44.entities.AgencySettings.create(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agency-settings"] });
      toast.success("Agency phone settings saved");
    },
    onError: (err) => toast.error(err?.message || "Failed to save settings"),
  });

  const provision = useMutation({
    mutationFn: (payload) => base44.functions.invoke("provisionNurseWorkNumber", payload),
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["phone-users"] });
      setInputs((prev) => ({ ...prev, [vars.target_user_email]: { work: "", cell: "" } }));
      toast.success("Work number provisioned");
    },
    onError: (err) => toast.error(err?.message || "Failed to provision number"),
  });

  // One-click: hand every user without a work number the next available pool
  // number. Fax is shared (the office number), so there's nothing per-user there.
  const autoAssign = useMutation({
    mutationFn: () => base44.functions.invoke("autoAssignWorkNumbers", {}),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["phone-users"] });
      const d = res?.data || res;
      toast.success(d?.message || `Assigned ${d?.assigned_count ?? 0} work number(s)`);
    },
    onError: (err) => toast.error(err?.message || "Auto-assign failed"),
  });

  // Live Telnyx connection test (backend probe of secrets + SMS API + provisioning).
  const [liveResult, setLiveResult] = useState(null);
  const testConnection = useMutation({
    mutationFn: () => base44.functions.invoke("testTelnyxConnection", {}),
    onSuccess: (res) => {
      const data = res?.data || res;
      setLiveResult(data);
      const sev = summarize(data?.checks || []).severity;
      if (sev === "fail") toast.error("Connection test found problems — see the checklist.");
      else if (sev === "warn") toast("Connection test passed with warnings.");
      else toast.success("Telnyx connection looks healthy.");
    },
    onError: (err) => toast.error(err?.message || "Connection test failed"),
  });

  // End-to-end test send: deliver one real, fixed, PHI-free text to a number
  // the admin controls — the definitive check the read-only probe can't make.
  const [testNumber, setTestNumber] = useState("");
  const [testSendResult, setTestSendResult] = useState(null);
  const sendTest = useMutation({
    mutationFn: (to_number) => base44.functions.invoke("sendTestSms", { to_number }),
    onSuccess: (res) => {
      const data = res?.data || res;
      setTestSendResult({ ok: true, ...data });
      toast.success("Test text sent — check that phone.");
    },
    onError: (err) => {
      setTestSendResult({ ok: false, error: err?.message || "Failed to send test text" });
      toast.error(err?.message || "Failed to send test text");
    },
  });

  // Config checklist reflects the live form values so it updates as the admin
  // edits; the live test below reads the *saved* settings from the backend.
  const configChecks = useMemo(() => evaluateAgencyConfig(agency), [agency]);
  const configSummary = useMemo(() => summarize(configChecks), [configChecks]);
  const liveChecks = liveResult?.checks || [];
  const urlBase = functionUrlBase(appParams?.serverUrl);

  if (!isAdmin) return null;

  const setInput = (email, key, value) =>
    setInputs((prev) => ({ ...prev, [email]: { ...prev[email], [key]: value } }));

  // Inline E.164 validity for a provisioning input (null/"" => no error shown).
  const invalidNumber = (value) => !!value && value.trim() !== "" && !normalizeE164(value);

  const sevMeta = STATUS_META[configSummary.severity] || STATUS_META.ok;

  return (
    <div className="space-y-6">
      {/* Setup & Health — readiness checklist + live connection test */}
      <Card id="twilio-health" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-indigo-600" />
              Telnyx Setup &amp; Health
            </span>
            <Badge className={sevMeta.badge}>
              {configSummary.ready
                ? configSummary.warn > 0
                  ? `Ready · ${configSummary.warn} warning${configSummary.warn > 1 ? "s" : ""}`
                  : "Ready"
                : `${configSummary.fail} item${configSummary.fail > 1 ? "s" : ""} need attention`}
            </Badge>
          </CardTitle>
          <CardDescription>
            A quick readiness check of your Telnyx configuration. Edit values below and save, then run
            the live test to confirm your Telnyx API key actually works.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6">
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Configuration</p>
              <div className="divide-y divide-slate-100">
                {configChecks.map((c) => <CheckRow key={c.id} check={c} />)}
              </div>
              <p className="text-[11px] text-slate-400 mt-1">Reflects the values in the form below (save to apply).</p>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Live connection</p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => testConnection.mutate()}
                  disabled={testConnection.isPending}
                >
                  {testConnection.isPending
                    ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Testing…</>
                    : <><Activity className="w-3.5 h-3.5 mr-1.5" /> Test live connection</>}
                </Button>
              </div>
              {liveChecks.length === 0 ? (
                <p className="text-sm text-slate-500 py-3">
                  Run the test to probe backend secrets, reach the Telnyx API, and check nurse provisioning.
                  Nothing is sent — it's a read-only health check.
                </p>
              ) : (
                <>
                  <div className="divide-y divide-slate-100">
                    {liveChecks.map((c) => <CheckRow key={c.id} check={c} />)}
                  </div>
                  {liveResult?.stats && (
                    <p className="text-[11px] text-slate-500 mt-2">
                      {liveResult.stats.nurses_with_work_number}/{liveResult.stats.total_users} users have a work number ·
                      {" "}checked {new Date(liveResult.generated_at).toLocaleTimeString()}
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* End-to-end test send */}
          <div className="border-t pt-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Send a test text</p>
            <p className="text-xs text-slate-500 mb-2">
              The definitive check: sends one real, non-PHI message from a provisioned work number to a phone you
              control. Honors opt-outs; bypasses the SMS kill switch since it's a diagnostic.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Input
                placeholder="Your mobile +1…"
                value={testNumber}
                onChange={(e) => setTestNumber(e.target.value)}
                className={`sm:max-w-xs ${testNumber && !normalizeE164(testNumber) ? "border-red-400 focus-visible:ring-red-400" : ""}`}
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => sendTest.mutate(testNumber)}
                disabled={sendTest.isPending || !testNumber || !normalizeE164(testNumber)}
              >
                {sendTest.isPending
                  ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> Sending…</>
                  : <><Send className="w-3.5 h-3.5 mr-1.5" /> Send test text</>}
              </Button>
            </div>
            {testSendResult && (
              <p className={`text-xs mt-2 flex items-start gap-1.5 ${testSendResult.ok ? "text-green-700" : "text-red-700"}`}>
                {testSendResult.ok
                  ? <><CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> Sent from {formatPhoneDisplay(testSendResult.from_number)} to {formatPhoneDisplay(testSendResult.to_number)}.</>
                  : <><XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {testSendResult.error}</>}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Webhook endpoints to register in Twilio */}
      <Card id="twilio-webhooks" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Webhook className="w-5 h-5 text-indigo-600" />
            Telnyx Webhook Endpoints
          </CardTitle>
          <CardDescription>
            In the Telnyx Portal, set the webhook URL on your messaging/fax profile and your voice
            (Call Control) connection to the matching deployed function URL. The handlers verify the
            Telnyx webhook signature (Ed25519 public key) and fail closed. Copy each function name (and
            confirm its exact deployed URL in the Base44 dashboard) when configuring Telnyx.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {WEBHOOK_FUNCTIONS.map((w) => {
            const candidateUrl = urlBase ? `${urlBase}/functions/${w.fn}` : null;
            return (
              <div key={w.fn} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-900">{w.event}</p>
                    <p className="text-xs text-slate-500">Configure on: {w.configuredOn}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <code className="text-xs bg-white border border-slate-200 rounded px-2 py-1 text-indigo-700">{w.fn}</code>
                    <CopyButton value={candidateUrl || w.fn} label="endpoint" />
                  </div>
                </div>
                {candidateUrl && (
                  <p className="text-[11px] text-slate-400 mt-1 break-all">Suggested URL: {candidateUrl}</p>
                )}
              </div>
            );
          })}
          <Alert className="bg-slate-50 border-slate-200">
            <Info className="w-4 h-4 text-slate-600" />
            <AlertDescription className="text-slate-700 text-xs">
              <strong>Webhooks failing signature checks?</strong> Set the function secret{" "}
              <code className="bg-white border border-slate-200 rounded px-1">TELNYX_WEBHOOK_DEBUG=1</code>{" "}
              in the Base44 dashboard to log which signature header names Telnyx sends and whether each verifies
              (header <em>names</em> only — never secret values). Check the function logs, then turn it off.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>

      <Card id="twilio-settings" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Phone className="w-5 h-5 text-indigo-600" />
            Telnyx Phone — Agency Settings
          </CardTitle>
          <CardDescription>
            Main office number, off-duty defaults, templates, and voicemail. The Telnyx API key is
            set in the Telnyx Credentials card above (or via TELNYX_API_KEY in the dashboard env) —
            not here.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label className="text-sm font-medium">Main office number (E.164)</Label>
              <Input
                placeholder="+17244650440"
                value={agency.main_office_number_e164}
                onChange={(e) => setAgency((a) => ({ ...a, main_office_number_e164: e.target.value }))}
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">Off-duty / unanswered calls roll here; texts reference it.</p>
            </div>
            <div>
              <Label className="text-sm font-medium">Shared office fax number (E.164)</Label>
              <Input
                placeholder="+17244650441"
                value={agency.office_fax_number_e164}
                onChange={(e) => setAgency((a) => ({ ...a, office_fax_number_e164: e.target.value }))}
                className="mt-1"
              />
              <p className="text-xs text-slate-500 mt-1">Every user faxes from this one number, so replies go to the office.</p>
            </div>
          </div>

          {/* Cost controls */}
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 space-y-3">
            <p className="text-sm font-semibold text-slate-800">Cost controls</p>
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label className="text-sm font-medium">Allow international destinations</Label>
                <p className="text-xs text-slate-500">Off by default — only US/Canada (+1) numbers can be texted/called. Premium 900/976 are always blocked.</p>
              </div>
              <Switch
                checked={agency.allow_international}
                onCheckedChange={(v) => setAgency((a) => ({ ...a, allow_international: v }))}
              />
            </div>
            <div>
              <Label className="text-sm font-medium">Monthly outbound SMS cap</Label>
              <Input
                type="number"
                min="0"
                placeholder="No limit"
                value={agency.monthly_sms_cap}
                onChange={(e) => setAgency((a) => ({ ...a, monthly_sms_cap: e.target.value }))}
                className="mt-1 max-w-[200px]"
              />
              <p className="text-xs text-slate-500 mt-1">Blocks new outbound texts once reached this calendar month. Blank / 0 = no cap.</p>
            </div>
          </div>
          <div>
            <Label className="text-sm font-medium">Default off-duty message</Label>
            <Textarea
              rows={2}
              placeholder="Your nurse is currently off duty. Please call our main office at {office} for assistance."
              value={agency.default_off_duty_template}
              onChange={(e) => setAgency((a) => ({ ...a, default_off_duty_template: e.target.value }))}
              className="mt-1 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">Used when a nurse hasn't set their own. {"{office}"} inserts the main office number.</p>
          </div>
          <div>
            <Label className="text-sm font-medium">Text quick replies</Label>
            <Textarea
              rows={4}
              placeholder={"One per line, e.g.\nRunning about 15 minutes late.\nI'm on my way now."}
              value={(agency.sms_quick_replies || []).map((q) => (typeof q === "string" ? q : q?.text || "")).filter(Boolean).join("\n")}
              onChange={(e) =>
                setAgency((a) => ({
                  ...a,
                  sms_quick_replies: e.target.value.split("\n").map((s) => s.trim()).filter(Boolean),
                }))
              }
              className="mt-1 resize-none"
            />
            <p className="text-xs text-slate-500 mt-1">
              One-tap snippets nurses can insert when texting (keep them PHI-free). Leave blank to use the built-in defaults.
            </p>
          </div>
          <div>
            <Label className="text-sm font-medium">Message templates</Label>
            <Textarea
              rows={5}
              placeholder={"One per line as  Label | body  e.g.\nReminder | Hi {first_name}, reminder of your visit. Call {office} with questions."}
              value={(agency.sms_templates || [])
                .map((t) => (typeof t === "string" ? t : `${t.label || ""} | ${t.body || ""}`))
                .join("\n")}
              onChange={(e) =>
                setAgency((a) => ({
                  ...a,
                  sms_templates: e.target.value
                    .split("\n")
                    .map((line) => {
                      const i = line.indexOf("|");
                      if (i === -1) {
                        const body = line.trim();
                        return body ? { label: body.slice(0, 24), body } : null;
                      }
                      const label = line.slice(0, i).trim();
                      const body = line.slice(i + 1).trim();
                      return body ? { label: label || body.slice(0, 24), body } : null;
                    })
                    .filter(Boolean),
                }))
              }
              className="mt-1 resize-none font-mono text-xs"
            />
            <p className="text-xs text-slate-500 mt-1">
              Longer reusable messages with merge fields. Available: <code className="bg-slate-100 px-1 rounded">{"{first_name}"}</code>{" "}
              <code className="bg-slate-100 px-1 rounded">{"{last_name}"}</code>{" "}
              <code className="bg-slate-100 px-1 rounded">{"{nurse_name}"}</code>{" "}
              <code className="bg-slate-100 px-1 rounded">{"{office}"}</code>. Keep them PHI-free; leave blank for built-in defaults.
            </p>
          </div>
          <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
            <div>
              <Label className="text-sm font-semibold">SMS messaging enabled</Label>
              <p className="text-xs text-slate-600">Agency-wide kill switch for outbound texting.</p>
            </div>
            <Switch
              checked={agency.sms_messaging_enabled}
              onCheckedChange={(v) => setAgency((a) => ({ ...a, sms_messaging_enabled: v }))}
            />
          </div>
          <div className="p-3 bg-slate-50 rounded-lg space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-semibold">Voicemail capture</Label>
                <p className="text-xs text-slate-600">
                  Record a voicemail when a patient's masked call to an on-duty nurse goes unanswered.
                  Requires your Telnyx voice connection webhook to be configured and the voicemail webhook.
                </p>
              </div>
              <Switch
                checked={agency.voicemail_enabled}
                onCheckedChange={(v) => setAgency((a) => ({ ...a, voicemail_enabled: v }))}
              />
            </div>
            {agency.voicemail_enabled && (
              <div>
                <Label className="text-xs font-medium text-slate-600">Voicemail greeting</Label>
                <Textarea
                  rows={2}
                  placeholder="You've reached your care team. Please leave a message after the tone and we'll call you back. Call {office} for urgent needs."
                  value={agency.voicemail_greeting}
                  onChange={(e) => setAgency((a) => ({ ...a, voicemail_greeting: e.target.value }))}
                  className="mt-1 resize-none"
                />
                <p className="text-[11px] text-slate-500 mt-1">{"{office}"} inserts the main office number. Keep it PHI-free.</p>
              </div>
            )}
          </div>
          <div className="flex justify-end">
            <Button onClick={() => saveAgency.mutate()} disabled={saveAgency.isPending} className="bg-indigo-600 hover:bg-indigo-700">
              <Save className="w-4 h-4 mr-2" />
              Save Agency Settings
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Global calling & texting hours + after-hours auto-handling */}
      <CallingHoursPanel />

      {/* Easy provisioning: a pool of numbers assignable in one click */}
      <NumberPoolPanel />

      <Card id="twilio-nurses" className="scroll-mt-24">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
            <span className="flex items-center gap-2">
              <Phone className="w-5 h-5 text-indigo-600" />
              Nurse Work Numbers
            </span>
            {(() => {
              const missing = users.filter((u) => !u.work_phone_number).length;
              return (
                <Button
                  size="sm"
                  className="bg-indigo-600 hover:bg-indigo-700"
                  disabled={autoAssign.isPending || missing === 0}
                  onClick={() => autoAssign.mutate()}
                  title="Give every user without a work number the next available pool number"
                >
                  {autoAssign.isPending ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Wand2 className="w-4 h-4 mr-2" />}
                  {missing > 0 ? `Auto-assign ${missing} number${missing === 1 ? "" : "s"}` : "All assigned"}
                </Button>
              );
            })()}
          </CardTitle>
          <CardDescription>
            Each user gets their own number for voice + SMS. Click <strong>Auto-assign</strong> to hand
            every user without one the next available number from the pool — or set them individually
            below. (Fax is shared: everyone sends from the single office fax number.)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Alert className="bg-blue-50 border-blue-200">
            <Info className="w-4 h-4 text-blue-600" />
            <AlertDescription className="text-blue-900 text-sm">
              Personal cell numbers are never displayed in full — only the last 4 digits are shown once set.
            </AlertDescription>
          </Alert>
          {users.map((u) => (
            <div key={u.email} className="p-3 rounded-lg border border-slate-200 bg-slate-50">
              <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                <div>
                  <p className="text-sm font-semibold text-slate-900">{u.full_name || u.email}</p>
                  <p className="text-xs text-slate-500">{u.email} · {u.role}</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.work_phone_number ? (
                    <Badge className="bg-green-100 text-green-800">Work: {formatPhoneDisplay(u.work_phone_number)}</Badge>
                  ) : (
                    <Badge variant="outline">No work number</Badge>
                  )}
                  {u.personal_cell_e164 && (
                    <Badge className="bg-slate-200 text-slate-700">
                      <ShieldCheck className="w-3 h-3 mr-1" /> Cell {maskPhone(u.personal_cell_e164)}
                    </Badge>
                  )}
                </div>
              </div>
              {(() => {
                const workVal = inputs[u.email]?.work || "";
                const cellVal = inputs[u.email]?.cell || "";
                const workInvalid = invalidNumber(workVal);
                const cellInvalid = invalidNumber(cellVal);
                const nothingEntered = !workVal && !cellVal;
                return (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <div>
                        <Input
                          placeholder="Work number +1…"
                          value={workVal}
                          onChange={(e) => setInput(u.email, "work", e.target.value)}
                          className={workInvalid ? "border-red-400 focus-visible:ring-red-400" : ""}
                          aria-invalid={workInvalid}
                        />
                        {workInvalid && <p className="text-[11px] text-red-600 mt-0.5">Enter a valid phone number.</p>}
                      </div>
                      <div>
                        <Input
                          placeholder="Personal cell +1…"
                          value={cellVal}
                          onChange={(e) => setInput(u.email, "cell", e.target.value)}
                          className={cellInvalid ? "border-red-400 focus-visible:ring-red-400" : ""}
                          aria-invalid={cellInvalid}
                        />
                        {cellInvalid && <p className="text-[11px] text-red-600 mt-0.5">Enter a valid phone number.</p>}
                      </div>
                      <Button
                        variant="outline"
                        disabled={provision.isPending || nothingEntered || workInvalid || cellInvalid}
                        onClick={() =>
                          provision.mutate({
                            target_user_email: u.email,
                            work_phone_number: workVal || undefined,
                            personal_cell_e164: cellVal || undefined,
                          })
                        }
                      >
                        <Save className="w-4 h-4 mr-2" />
                        {u.work_phone_number ? "Update" : "Assign"}
                      </Button>
                    </div>
                  </>
                );
              })()}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
