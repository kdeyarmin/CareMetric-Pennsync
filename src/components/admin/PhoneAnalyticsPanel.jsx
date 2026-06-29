import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BarChart3, MessageSquare, PhoneCall, ShieldCheck, Users, Download } from "lucide-react";
import { summarizePhoneActivity, formatDuration } from "@/components/admin/phoneAnalytics";
import { toCsv, exportTimestamp } from "@/components/admin/csvExport";
import { toast } from "sonner";

// PHI-conscious export columns: metadata only — never the SMS body or media.
const SMS_COLUMNS = [
  { key: "created_date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "from_number", label: "From" },
  { key: "to_number", label: "To" },
  { key: "nurse_email", label: "Nurse" },
  { key: "status", label: "Status" },
  { key: "patient_id", label: "Patient ID" },
  { key: "body", label: "Body length", format: (v) => (v ? String(v).length : 0) },
  { key: "failure_reason", label: "Failure reason" },
];
const CALL_COLUMNS = [
  { key: "created_date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "from_number", label: "From" },
  { key: "to_number", label: "To" },
  { key: "displayed_number", label: "Caller ID shown" },
  { key: "nurse_email", label: "Nurse" },
  { key: "call_mode", label: "Mode" },
  { key: "status", label: "Status" },
  { key: "duration_seconds", label: "Duration (s)" },
  { key: "disposition", label: "Disposition" },
  { key: "has_voicemail", label: "Voicemail", format: (v) => (v ? "yes" : "") },
];

/** Trigger a client-side CSV file download (browser only). */
function downloadCsv(filename, csv) {
  try {
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch {
    toast.error("Couldn't generate the export");
  }
}

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: 0 },
];

function Stat({ label, value, sub }) {
  return (
    <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
      <p className="text-2xl font-bold text-slate-900">{value}</p>
      <p className="text-xs text-slate-600">{label}</p>
      {sub && <p className="text-[11px] text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/**
 * PhoneAnalyticsPanel — admin read-only overview of texting/calling activity,
 * delivery health, consent posture, and provisioning coverage. All numbers are
 * derived client-side via the unit-tested summarizePhoneActivity helper.
 */
export default function PhoneAnalyticsPanel() {
  const [windowDays, setWindowDays] = useState(30);

  const { data: currentUser } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });
  const isAdmin = currentUser?.role === "admin";

  const { data: smsMessages = [] } = useQuery({
    queryKey: ["analytics-sms"],
    queryFn: () => base44.entities.SmsMessage.list("-created_date", 1000),
    enabled: isAdmin,
    initialData: [],
  });
  const { data: callLogs = [] } = useQuery({
    queryKey: ["analytics-calls"],
    queryFn: () => base44.entities.CallLog.list("-created_date", 1000),
    enabled: isAdmin,
    initialData: [],
  });
  const { data: consents = [] } = useQuery({
    queryKey: ["analytics-consents"],
    queryFn: () => base44.entities.SmsConsent.list("-captured_at", 1000),
    enabled: isAdmin,
    initialData: [],
  });
  const { data: users = [] } = useQuery({
    queryKey: ["analytics-users"],
    queryFn: () => base44.entities.User.list("full_name", 1000),
    enabled: isAdmin,
    initialData: [],
  });

  const stats = useMemo(
    () => summarizePhoneActivity({ smsMessages, callLogs, consents, users, sinceDays: windowDays }),
    [smsMessages, callLogs, consents, users, windowDays]
  );

  // Match summarizePhoneActivity's window semantics: keep rows whose date is
  // within the window, and keep (rather than drop) rows with an unparseable
  // date, so the exported CSV row count agrees with the on-screen totals.
  const inWindow = (rows) => {
    if (windowDays <= 0) return rows;
    const cutoff = Date.now() - windowDays * 86400000;
    return rows.filter((r) => {
      const t = new Date(r.created_date).getTime();
      return Number.isNaN(t) ? true : t >= cutoff;
    });
  };
  const exportSms = () => downloadCsv(`sms-export_${exportTimestamp()}.csv`, toCsv(SMS_COLUMNS, inWindow(smsMessages)));
  const exportCalls = () => downloadCsv(`calls-export_${exportTimestamp()}.csv`, toCsv(CALL_COLUMNS, inWindow(callLogs)));

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" />
            Phone &amp; SMS Analytics
          </span>
          <div className="flex gap-1">
            {WINDOWS.map((w) => (
              <Button
                key={w.label}
                type="button"
                size="sm"
                variant={windowDays === w.days ? "default" : "outline"}
                onClick={() => setWindowDays(w.days)}
                className="h-7 px-2 text-xs"
              >
                {w.label}
              </Button>
            ))}
          </div>
        </CardTitle>
        <CardDescription>Texting and calling activity, delivery health, consent, and nurse coverage.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 mr-1">Export current window (metadata only — no message content):</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={exportSms}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Texts CSV
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={exportCalls}>
            <Download className="w-3.5 h-3.5 mr-1.5" /> Calls CSV
          </Button>
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" /> Text messages
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Total texts" value={stats.sms.total} sub={`${stats.sms.inbound} in · ${stats.sms.outbound} out`} />
            <Stat label="Delivered" value={`${stats.sms.deliveryRate}%`} sub={`${stats.sms.delivered} of ${stats.sms.outbound} sent`} />
            <Stat label="Failed" value={stats.sms.failed} sub={`${stats.sms.failureRate}% of sent`} />
            <Stat label="Inbound" value={stats.sms.inbound} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5" /> Calls
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Total calls" value={stats.calls.total} sub={`${stats.calls.inbound} in · ${stats.calls.outbound} out`} />
            <Stat label="Completed" value={stats.calls.completed} />
            <Stat label="Missed" value={stats.calls.missed} sub={`${stats.calls.missedRate}% of calls`} />
            <Stat label="Avg duration" value={formatDuration(stats.calls.avgDurationSec)} />
            <Stat label="After-hours transfers" value={stats.calls.afterHoursTransfers} sub={`${stats.calls.autoTransferRate}% of inbound auto-handled`} />
            <Stat label="Off-duty transfers" value={stats.calls.offDutyTransfers} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" /> Consent (TCPA)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Opted in" value={stats.consent.optedIn} />
              <Stat label="Opted out" value={stats.consent.optedOut} sub={`${stats.consent.tracked} numbers tracked`} />
              <Stat label="New opt-outs" value={stats.consent.recentOptOuts} sub="in window" />
              <Stat label="New opt-ins" value={stats.consent.recentOptIns} sub="in window" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Nurse coverage
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="With work #" value={`${stats.provisioning.coverageRate}%`} sub={`${stats.provisioning.withWorkNumber} of ${stats.provisioning.totalUsers}`} />
              <Stat label="Fully set up" value={stats.provisioning.fullyProvisioned} sub="work # + bridge cell" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
