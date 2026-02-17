import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Shield, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format } from "date-fns";

export default function EntComplianceTrends({ audits, violations }) {
  const stats = useMemo(() => {
    if (!audits.length && !violations.length) return null;

    // Audit score over time (weekly)
    const weeklyScores = {};
    audits.forEach(a => {
      if (!a.created_date) return;
      const d = new Date(a.created_date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = format(weekStart, "MMM dd");
      if (!weeklyScores[key]) weeklyScores[key] = { scores: [], passed: 0, flagged: 0, critical: 0 };
      weeklyScores[key].scores.push(a.compliance_score || 0);
      if (a.status === "passed") weeklyScores[key].passed++;
      else if (a.status === "critical") weeklyScores[key].critical++;
      else weeklyScores[key].flagged++;
    });
    const trendData = Object.entries(weeklyScores).slice(-12).map(([name, data]) => ({
      name,
      avgScore: data.scores.length > 0 ? +(data.scores.reduce((a, b) => a + b, 0) / data.scores.length).toFixed(1) : 0,
      passed: data.passed,
      flagged: data.flagged,
      critical: data.critical,
    }));

    // Violation severity breakdown
    const severityCounts = { critical: 0, high: 0, medium: 0, low: 0 };
    const statusCounts = { open: 0, in_progress: 0, resolved: 0, dismissed: 0 };
    violations.forEach(v => {
      if (v.severity) severityCounts[v.severity] = (severityCounts[v.severity] || 0) + 1;
      if (v.status) statusCounts[v.status] = (statusCounts[v.status] || 0) + 1;
    });

    // Avg compliance score
    const avgScore = audits.length > 0
      ? (audits.reduce((s, a) => s + (a.compliance_score || 0), 0) / audits.length).toFixed(1)
      : "N/A";
    const passRate = audits.length > 0
      ? ((audits.filter(a => a.status === "passed").length / audits.length) * 100).toFixed(1)
      : 0;

    return { trendData, severityCounts, statusCounts, avgScore, passRate, totalAudits: audits.length, totalViolations: violations.length, openViolations: statusCounts.open };
  }, [audits, violations]);

  if (!stats) return <div className="text-center py-8 text-slate-500 text-sm">No compliance data available</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini icon={Shield} label="Avg Score" value={stats.avgScore} color="text-blue-600" />
        <StatMini icon={CheckCircle2} label="Pass Rate" value={`${stats.passRate}%`} color="text-green-600" />
        <StatMini icon={AlertTriangle} label="Open Violations" value={stats.openViolations} color="text-red-600" />
        <StatMini icon={TrendingUp} label="Total Audits" value={stats.totalAudits} color="text-purple-600" />
      </div>

      {/* Score trend */}
      {stats.trendData.length > 0 && (
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Compliance Score Trend (Weekly)</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={stats.trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" style={{ fontSize: "9px" }} angle={-45} textAnchor="end" height={50} />
                <YAxis domain={[0, 100]} style={{ fontSize: "10px" }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: "11px" }} />
                <Line type="monotone" dataKey="avgScore" stroke="#3b82f6" strokeWidth={2} name="Avg Score" dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Violation severity */}
      <Card>
        <CardHeader className="p-3"><CardTitle className="text-sm">Violation Severity Summary</CardTitle></CardHeader>
        <CardContent className="p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {Object.entries(stats.severityCounts).map(([sev, count]) => (
              <div key={sev} className="text-center p-2 bg-slate-50 rounded-lg">
                <p className="text-lg font-bold text-slate-800">{count}</p>
                <Badge className={`text-[10px] ${sev === "critical" ? "bg-red-100 text-red-700" : sev === "high" ? "bg-orange-100 text-orange-700" : sev === "medium" ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>{sev}</Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatMini({ icon: Icon, label, value, color }) {
  return (
    <Card>
      <CardContent className="p-3 flex items-center gap-2">
        <Icon className={`w-5 h-5 ${color} flex-shrink-0`} />
        <div className="min-w-0">
          <p className="text-lg font-bold text-slate-900">{value}</p>
          <p className="text-[10px] text-slate-500 truncate">{label}</p>
        </div>
      </CardContent>
    </Card>
  );
}