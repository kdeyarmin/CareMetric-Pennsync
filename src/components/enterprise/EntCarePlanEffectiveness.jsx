import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function EntCarePlanEffectiveness({ carePlans }) {
  const stats = useMemo(() => {
    if (!carePlans.length) return null;

    const statusCounts = { active: 0, met: 0, not_met: 0, revised: 0 };
    carePlans.forEach(cp => { statusCounts[cp.status || "active"]++; });

    const total = carePlans.length;
    const completionRate = total > 0 ? (((statusCounts.met) / total) * 100).toFixed(1) : 0;
    const revisionRate = total > 0 ? ((statusCounts.revised / total) * 100).toFixed(1) : 0;

    const statusData = Object.entries(statusCounts)
      .filter(([, v]) => v > 0)
      .map(([name, value]) => ({ name: name.replace("_", " "), value }));

    // Progress distribution
    const progressBuckets = { "0-25%": 0, "26-50%": 0, "51-75%": 0, "76-100%": 0 };
    carePlans.forEach(cp => {
      const p = cp.progress_percentage || 0;
      if (p <= 25) progressBuckets["0-25%"]++;
      else if (p <= 50) progressBuckets["26-50%"]++;
      else if (p <= 75) progressBuckets["51-75%"]++;
      else progressBuckets["76-100%"]++;
    });
    const progressData = Object.entries(progressBuckets).map(([name, value]) => ({ name, value }));

    // Avg progress
    const avgProgress = carePlans.length > 0
      ? (carePlans.reduce((s, cp) => s + (cp.progress_percentage || 0), 0) / carePlans.length).toFixed(0)
      : 0;

    return { statusCounts, statusData, progressData, total, completionRate, revisionRate, avgProgress };
  }, [carePlans]);

  if (!stats) return <EmptyState />;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini icon={Target} label="Total Plans" value={stats.total} color="text-blue-600" />
        <StatMini icon={CheckCircle2} label="Goal Met Rate" value={`${stats.completionRate}%`} color="text-green-600" />
        <StatMini icon={RefreshCw} label="Revision Rate" value={`${stats.revisionRate}%`} color="text-amber-600" />
        <StatMini icon={Target} label="Avg Progress" value={`${stats.avgProgress}%`} color="text-purple-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Status Breakdown</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.statusData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {stats.statusData.map((_, i) => <Cell key={i} fill={["#3b82f6", "#10b981", "#ef4444", "#f59e0b"][i % 4]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Progress Distribution</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.progressData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" style={{ fontSize: "10px" }} />
                <YAxis style={{ fontSize: "10px" }} />
                <Tooltip />
                <Bar dataKey="value" fill="#8b5cf6" name="Plans" radius={[4, 4, 0, 0]} />
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

function EmptyState() {
  return <div className="text-center py-8 text-slate-500 text-sm">No care plan data available</div>;
}