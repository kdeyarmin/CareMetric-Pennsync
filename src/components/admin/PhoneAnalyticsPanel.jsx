import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Download, MessageSquare, PhoneCall, ShieldCheck, Users } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { summarizePhoneActivity, formatDuration } from "@/components/admin/phoneAnalytics";
import { toCsv, exportTimestamp } from "@/components/admin/csvExport";
import { downloadCsv } from "@/lib/downloadCsv";
import { useAuth } from "@/lib/AuthContext";
import TelecomUnavailable, {
  PHONE_ANALYTICS_UNAVAILABLE_MESSAGE,
} from "@/components/telecom/TelecomUnavailable";

// Metadata only, exactly as the server sends it: masked numbers, a body
// length and never a body, and no patient identifier.
const SMS_COLUMNS = [
  { key: "created_date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "from_masked", label: "From" },
  { key: "to_masked", label: "To" },
  { key: "nurse_email", label: "Staff member" },
  { key: "status", label: "Status" },
  { key: "patient_linked", label: "Linked to a chart", format: (v) => (v ? "yes" : "") },
  { key: "body_length", label: "Body length" },
];
const CALL_COLUMNS = [
  { key: "created_date", label: "Date" },
  { key: "direction", label: "Direction" },
  { key: "from_masked", label: "From" },
  { key: "to_masked", label: "To" },
  { key: "displayed_masked", label: "Caller ID shown" },
  { key: "nurse_email", label: "Staff member" },
  { key: "call_mode", label: "Mode" },
  { key: "status", label: "Status" },
  { key: "duration_seconds", label: "Duration (s)" },
  { key: "disposition", label: "Disposition" },
  { key: "has_voicemail", label: "Voicemail", format: (v) => (v ? "yes" : "") },
];

const WINDOWS = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "All time", days: 0 },
];

export const PHONE_ANALYTICS_QUERY_KEY = Object.freeze(["phone-analytics"]);

/**
 * Read the phone report through getUserActivityLog's `phone` mode. The server
 * decides the scope (built-in admin: platform; service-owned agency
 * administrator: their agency only) and refuses everyone else. A refusal or a
 * malformed answer is an error, never an empty report.
 */
export async function fetchPhoneReport(days) {
  const payload = { mode: "phone" };
  if (days > 0) payload.days = days;
  const response = await base44.functions.invoke("getUserActivityLog", payload);
  const report = response?.data ?? response;
  if (!report || report.success !== true || !Array.isArray(report.texts) || !Array.isArray(report.calls)
    || !Array.isArray(report.consents) || !Array.isArray(report.members)) {
    throw new Error(report?.error || "The phone report is unavailable.");
  }
  return report;
}

function refusalStatus(error) {
  return error?.response?.status ?? error?.status ?? null;
}

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
 * PhoneAnalyticsPanel — the administrator's overview of texting and calling
 * activity, delivery health, consent posture and provisioning coverage
 * (restored 2026-10-08, owner decision). Numbers come from the unit-tested
 * summarizePhoneActivity over the server's metadata-only report.
 */
export default function PhoneAnalyticsPanel() {
  const { user: currentUser } = useAuth();
  const [windowDays, setWindowDays] = useState(30);
  const [exportError, setExportError] = useState(false);

  const reportQuery = useQuery({
    queryKey: [...PHONE_ANALYTICS_QUERY_KEY, currentUser?.email || null, windowDays],
    queryFn: () => fetchPhoneReport(windowDays),
    enabled: !!currentUser,
    retry: false,
  });
  const report = reportQuery.data;

  const stats = useMemo(
    () => (report
      ? summarizePhoneActivity({
        smsMessages: report.texts,
        callLogs: report.calls,
        consents: report.consents,
        users: report.members,
        sinceDays: windowDays,
      })
      : null),
    [report, windowDays],
  );

  // Not an administrator: the server refused, and the panel is not theirs.
  if (reportQuery.isError && refusalStatus(reportQuery.error) === 403) return null;
  if (!currentUser) return null;

  if (reportQuery.isError) {
    return (
      <TelecomUnavailable
        title="Phone and SMS analytics unavailable"
        message={PHONE_ANALYTICS_UNAVAILABLE_MESSAGE}
      />
    );
  }

  const onExportError = () => setExportError(true);
  const exportSms = () => {
    setExportError(false);
    downloadCsv(`sms-export_${exportTimestamp()}.csv`, toCsv(SMS_COLUMNS, report?.texts || []), { onError: onExportError });
  };
  const exportCalls = () => {
    setExportError(false);
    downloadCsv(`calls-export_${exportTimestamp()}.csv`, toCsv(CALL_COLUMNS, report?.calls || []), { onError: onExportError });
  };
  const show = (value) => (stats ? value : "…");

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-2 flex-wrap">
          <span className="flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-indigo-600" aria-hidden="true" />
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
        <CardDescription>
          Texting and calling activity, delivery health, consent, and staff coverage
          {report ? ` (${report.scope === "platform" ? "all agencies" : "your agency"})` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {report?.truncated && (
          <p role="status" className="text-xs text-amber-800">
            Only the most recent {report.row_limit} rows of each kind were read; totals below are a lower bound.
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500 mr-1">Export current window (metadata only, numbers masked, no message content):</span>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={exportSms} disabled={!report}>
            <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Texts CSV
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={exportCalls} disabled={!report}>
            <Download className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" /> Calls CSV
          </Button>
          {exportError && <span role="alert" className="text-xs text-red-700">The export could not be generated.</span>}
        </div>
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" /> Text messages
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Total texts" value={show(stats?.sms.total)} sub={stats ? `${stats.sms.inbound} in · ${stats.sms.outbound} out` : null} />
            <Stat label="Delivered" value={show(`${stats?.sms.deliveryRate}%`)} sub={stats ? `${stats.sms.delivered} of ${stats.sms.outbound} sent` : null} />
            <Stat label="Failed" value={show(stats?.sms.failed)} sub={stats ? `${stats.sms.failureRate}% of sent` : null} />
            <Stat label="Inbound" value={show(stats?.sms.inbound)} />
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
            <PhoneCall className="w-3.5 h-3.5" aria-hidden="true" /> Calls
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Stat label="Total calls" value={show(stats?.calls.total)} sub={stats ? `${stats.calls.inbound} in · ${stats.calls.outbound} out` : null} />
            <Stat label="Completed" value={show(stats?.calls.completed)} />
            <Stat label="Missed" value={show(stats?.calls.missed)} sub={stats ? `${stats.calls.missedRate}% of calls` : null} />
            <Stat label="Avg duration" value={show(formatDuration(stats?.calls.avgDurationSec))} />
            <Stat label="Office transfers" value={show(stats?.calls.officeTransfers)} sub={stats ? `${stats.calls.autoTransferRate}% of inbound auto-handled` : null} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <ShieldCheck className="w-3.5 h-3.5" aria-hidden="true" /> Consent (TCPA)
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Opted in" value={show(stats?.consent.optedIn)} />
              <Stat label="Opted out" value={show(stats?.consent.optedOut)} sub={stats ? `${stats.consent.tracked} line-and-number scopes tracked` : null} />
              <Stat label="New opt-outs" value={show(stats?.consent.recentOptOuts)} sub="in window" />
              <Stat label="New opt-ins" value={show(stats?.consent.recentOptIns)} sub="in window" />
            </div>
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" aria-hidden="true" /> Staff coverage
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="With work #" value={show(`${stats?.provisioning.coverageRate}%`)} sub={stats ? `${stats.provisioning.withWorkNumber} of ${stats.provisioning.totalUsers}` : null} />
              <Stat label="Fully set up" value={show(stats?.provisioning.fullyProvisioned)} sub="work # + bridge cell" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
