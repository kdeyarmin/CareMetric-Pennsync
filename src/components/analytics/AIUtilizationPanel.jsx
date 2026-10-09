import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Sparkles } from "lucide-react";
import { format } from "date-fns";
import { parseLocalDate } from "@/lib/dateLocal";
import UserActivityUnavailable from "@/components/security/UserActivityUnavailable";
import { daysSince, useActivityReport } from "@/hooks/useActivityReport";

// Activity actions that mean "AI did documentation work", and the wider set of
// documentation actions they are a share of.
export const AI_DOCUMENTATION_ACTIONS = Object.freeze([
  "note_enhanced", "note_ai_generated", "template_generated", "ai_feature_used",
]);
export const DOCUMENTATION_ACTIONS = Object.freeze(["visit_document", ...AI_DOCUMENTATION_ACTIONS]);

const AI_SET = new Set(AI_DOCUMENTATION_ACTIONS);
const DOC_SET = new Set(DOCUMENTATION_ACTIONS);
const pct = (part, whole) => (whole > 0 ? (part / whole) * 100 : null);

/**
 * Summarize AI utilization from activity rows already limited to the window
 * and person in question. Pure, so the arithmetic is testable on its own.
 */
export function summarizeAiUtilization(rows, startDate, endDate) {
  const days = {};
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    days[format(d, "yyyy-MM-dd")] = { date: format(d, "MMM dd"), ai: 0, total: 0 };
  }
  const byUser = new Map();
  let ai = 0;
  let total = 0;
  for (const row of rows) {
    if (!DOC_SET.has(row?.action)) continue;
    const isAi = AI_SET.has(row.action);
    total += 1;
    if (isAi) ai += 1;
    const at = parseLocalDate(row.created_date);
    const key = at && !Number.isNaN(at.getTime()) ? format(at, "yyyy-MM-dd") : null;
    if (key && days[key]) {
      days[key].total += 1;
      if (isAi) days[key].ai += 1;
    }
    const email = row.user_email || "unknown";
    const entry = byUser.get(email) || { email, name: row.user_name || email, ai: 0, total: 0 };
    entry.total += 1;
    if (isAi) entry.ai += 1;
    byUser.set(email, entry);
  }
  return {
    aiActions: ai,
    documentationActions: total,
    rate: pct(ai, total),
    trend: Object.values(days).map((day) => ({ date: day.date, aiUtilization: pct(day.ai, day.total) })),
    users: [...byUser.values()]
      .map((user) => ({ ...user, rate: pct(user.ai, user.total) }))
      .sort((a, b) => b.total - a.total),
  };
}

/**
 * AI utilization for the Performance Analytics page (owner decision,
 * 2026-10-08). Read through getUserActivityLog's report mode: the server scopes
 * the trail (the built-in administrator platform-wide, an agency administrator
 * to their agency) and strips identifying details. A failed read is shown as
 * unavailable, never as zero usage.
 */
export default function AIUtilizationPanel({ startDate, endDate, selectedUser = "all", enabled = true, scopeKey = null }) {
  const days = daysSince(`${startDate}T00:00:00`);
  const reportQuery = useActivityReport({ days, enabled: enabled && days !== null, scopeKey });
  const report = reportQuery.data || null;

  const summary = useMemo(() => {
    if (!report) return null;
    const from = new Date(`${startDate}T00:00:00`);
    const to = new Date(`${endDate}T23:59:59.999`);
    const rows = report.activity.filter((row) => {
      const at = parseLocalDate(row.created_date);
      if (!(at >= from && at <= to)) return false;
      return selectedUser === "all" || row.user_email === selectedUser;
    });
    return summarizeAiUtilization(rows, startDate, endDate);
  }, [report, startDate, endDate, selectedUser]);

  if (reportQuery.isError) {
    return (
      <div className="mb-4 sm:mb-6">
        <UserActivityUnavailable title="AI utilization analytics unavailable" />
      </div>
    );
  }

  return (
    <Card className="mb-4 sm:mb-6">
      <CardHeader className="p-3 sm:p-4 md:p-6">
        <CardTitle className="text-base sm:text-lg flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-navy-600" aria-hidden="true" />
          AI Utilization
        </CardTitle>
      </CardHeader>
      <CardContent className="p-3 sm:p-4 md:p-6 space-y-4">
        {!summary ? (
          <p className="text-sm text-slate-500" role="status">Loading AI utilization…</p>
        ) : (
          <>
            {report.truncated && (
              <p className="text-xs text-amber-700" role="status">
                Based on the most recent {report.rowLimit?.toLocaleString() || "available"} activity events.
              </p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-2xl font-bold text-slate-900">
                  {summary.rate === null ? "—" : `${summary.rate.toFixed(1)}%`}
                </p>
                <p className="text-xs text-slate-600">AI utilization rate</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-2xl font-bold text-slate-900">{summary.aiActions}</p>
                <p className="text-xs text-slate-600">AI-assisted documentation actions</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                <p className="text-2xl font-bold text-slate-900">{summary.documentationActions}</p>
                <p className="text-xs text-slate-600">Documentation actions</p>
              </div>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={summary.trend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" style={{ fontSize: "12px" }} />
                <YAxis domain={[0, 100]} style={{ fontSize: "12px" }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="aiUtilization" fill="#8b5cf6" name="AI Utilization (%)" />
              </BarChart>
            </ResponsiveContainer>
            {summary.users.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="py-1 pr-3">User</th>
                      <th className="py-1 pr-3">AI actions</th>
                      <th className="py-1 pr-3">Documentation actions</th>
                      <th className="py-1">AI share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.users.slice(0, 15).map((user) => (
                      <tr key={user.email} className="border-t border-slate-100">
                        <td className="py-1 pr-3">{user.name}</td>
                        <td className="py-1 pr-3">{user.ai}</td>
                        <td className="py-1 pr-3">{user.total}</td>
                        <td className="py-1">{user.rate === null ? "—" : `${user.rate.toFixed(1)}%`}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
