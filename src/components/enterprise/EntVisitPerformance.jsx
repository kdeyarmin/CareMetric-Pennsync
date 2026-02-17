import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar, CheckCircle2, XCircle, Clock } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { format, differenceInMinutes, parseISO } from "date-fns";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function EntVisitPerformance({ visits }) {
  const stats = useMemo(() => {
    if (!visits.length) return null;

    // Status breakdown
    const statusCounts = {};
    visits.forEach(v => { statusCounts[v.status || "scheduled"] = (statusCounts[v.status || "scheduled"] || 0) + 1; });

    // Visit type breakdown
    const typeCounts = {};
    visits.forEach(v => {
      const t = (v.visit_type || "other").replace(/_/g, " ");
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    });
    const typeData = Object.entries(typeCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));

    // Completion rate
    const total = visits.length;
    const completed = statusCounts.completed || 0;
    const cancelled = statusCounts.cancelled || 0;
    const completionRate = total > 0 ? ((completed / total) * 100).toFixed(1) : 0;
    const cancelRate = total > 0 ? ((cancelled / total) * 100).toFixed(1) : 0;

    // Duration analysis (for visits with start/end time)
    const durations = [];
    visits.forEach(v => {
      if (v.start_time && v.end_time) {
        try {
          const start = new Date(`2000-01-01T${v.start_time}`);
          const end = new Date(`2000-01-01T${v.end_time}`);
          const mins = differenceInMinutes(end, start);
          if (mins > 0 && mins < 480) durations.push(mins);
        } catch {}
      }
    });
    const avgDuration = durations.length > 0 ? (durations.reduce((s, d) => s + d, 0) / durations.length).toFixed(0) : "N/A";

    // Weekly volume
    const weeklyVolume = {};
    visits.forEach(v => {
      if (!v.visit_date) return;
      const d = new Date(v.visit_date);
      const weekStart = new Date(d);
      weekStart.setDate(d.getDate() - d.getDay());
      const key = format(weekStart, "MMM dd");
      weeklyVolume[key] = (weeklyVolume[key] || 0) + 1;
    });
    const volumeData = Object.entries(weeklyVolume)
      .slice(-12)
      .map(([name, count]) => ({ name, count }));

    return { statusCounts, typeData, total, completed, completionRate, cancelRate, avgDuration, volumeData };
  }, [visits]);

  if (!stats) return <div className="text-center py-8 text-slate-500 text-sm">No visit data available</div>;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini icon={Calendar} label="Total Visits" value={stats.total} color="text-blue-600" />
        <StatMini icon={CheckCircle2} label="Completion Rate" value={`${stats.completionRate}%`} color="text-green-600" />
        <StatMini icon={XCircle} label="Cancel Rate" value={`${stats.cancelRate}%`} color="text-red-600" />
        <StatMini icon={Clock} label="Avg Duration" value={stats.avgDuration !== "N/A" ? `${stats.avgDuration}m` : "N/A"} color="text-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Visit Types</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.typeData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {stats.typeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Weekly Visit Volume</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.volumeData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" style={{ fontSize: "9px" }} angle={-45} textAnchor="end" height={50} />
                <YAxis style={{ fontSize: "10px" }} />
                <Tooltip />
                <Bar dataKey="count" fill="#3b82f6" name="Visits" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>
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