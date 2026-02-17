import React, { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, Send, CheckCircle2, AlertCircle, Clock, TrendingUp, Users, DollarSign, Loader2 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import PremiumFeatureGate from "@/components/subscription/PremiumFeatureGate";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

export default function FaxAnalytics() {
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: () => base44.auth.me() });

  const { data: faxes = [], isLoading } = useQuery({
    queryKey: ["faxAnalytics", user?.email],
    queryFn: () => base44.entities.FaxHistory.filter({ user_email: user.email }, "-created_date", 500),
    enabled: !!user?.email,
  });

  const stats = useMemo(() => {
    const total = faxes.length;
    const sent = faxes.filter(f => f.status === "sent" || f.status === "delivered").length;
    const failed = faxes.filter(f => f.status === "failed").length;
    const delivered = faxes.filter(f => f.status === "delivered").length;
    const successRate = total > 0 ? ((sent / total) * 100).toFixed(1) : 0;
    const estCost = faxes.reduce((sum, f) => sum + (f.page_count || 1) * 0.07, 0);

    // Volume by day (last 30 days)
    const last30 = Array.from({ length: 30 }, (_, i) => {
      const d = new Date(); d.setDate(d.getDate() - (29 - i));
      return d.toISOString().split("T")[0];
    });
    const volumeByDay = last30.map(date => ({
      date: new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
      count: faxes.filter(f => f.created_date?.startsWith(date)).length,
    }));

    // Status distribution
    const statusDist = {};
    faxes.forEach(f => { statusDist[f.status] = (statusDist[f.status] || 0) + 1; });
    const statusData = Object.entries(statusDist).map(([name, value]) => ({ name, value }));

    // Top recipients
    const recipientCounts = {};
    faxes.forEach(f => {
      const key = f.recipient_name || f.recipient_fax_number || "Unknown";
      recipientCounts[key] = (recipientCounts[key] || 0) + 1;
    });
    const topRecipients = Object.entries(recipientCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name: name.length > 20 ? name.substring(0, 20) + "..." : name, count }));

    // Peak hours
    const hourCounts = Array(24).fill(0);
    faxes.forEach(f => {
      if (f.created_date) hourCounts[new Date(f.created_date).getHours()]++;
    });
    const peakHours = hourCounts.map((count, hour) => ({
      hour: `${hour.toString().padStart(2, "0")}:00`,
      count,
    }));

    return { total, sent, failed, delivered, successRate, estCost, volumeByDay, statusData, topRecipients, peakHours };
  }, [faxes]);

  if (isLoading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
    </div>
  );

  return (
    <PremiumFeatureGate featureName="Fax Analytics" allowTrial={true}>
      <div className="p-3 sm:p-6 max-w-7xl mx-auto pb-20 sm:pb-6">
        <div className="mb-5">
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" /> Fax Analytics
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 mt-1">Track fax volume, success rates, costs, and usage patterns</p>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
          <MetricCard icon={Send} label="Total Sent" value={stats.total} color="text-blue-600" bg="bg-blue-50" />
          <MetricCard icon={CheckCircle2} label="Delivered" value={stats.delivered} color="text-green-600" bg="bg-green-50" />
          <MetricCard icon={AlertCircle} label="Failed" value={stats.failed} color="text-red-600" bg="bg-red-50" />
          <MetricCard icon={TrendingUp} label="Success Rate" value={`${stats.successRate}%`} color="text-emerald-600" bg="bg-emerald-50" />
          <MetricCard icon={DollarSign} label="Est. Cost" value={`$${stats.estCost.toFixed(2)}`} color="text-amber-600" bg="bg-amber-50" />
          <MetricCard icon={Users} label="Recipients" value={stats.topRecipients.length} color="text-purple-600" bg="bg-purple-50" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
          {/* Volume Trend */}
          <Card>
            <CardHeader className="p-3"><CardTitle className="text-sm">30-Day Volume</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0">
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={stats.volumeByDay}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Faxes" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Status Distribution */}
          <Card>
            <CardHeader className="p-3"><CardTitle className="text-sm">Status Distribution</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0">
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={stats.statusData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                    {stats.statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Top Recipients */}
          <Card>
            <CardHeader className="p-3"><CardTitle className="text-sm">Top Recipients</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0">
              <ResponsiveContainer width="100%" height={250}>
                <BarChart data={stats.topRecipients} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={120} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#8b5cf6" radius={[0, 4, 4, 0]} name="Faxes" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Peak Usage Hours */}
          <Card>
            <CardHeader className="p-3"><CardTitle className="text-sm">Peak Usage Hours</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0">
              <ResponsiveContainer width="100%" height={250}>
                <LineChart data={stats.peakHours}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={2} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  <Line type="monotone" dataKey="count" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} name="Faxes" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      </div>
    </PremiumFeatureGate>
  );
}

function MetricCard({ icon: Icon, label, value, color, bg }) {
  return (
    <Card className={bg}>
      <CardContent className="p-3">
        <Icon className={`w-4 h-4 ${color} mb-1`} />
        <p className={`text-lg font-bold ${color}`}>{value}</p>
        <p className="text-[10px] text-slate-600">{label}</p>
      </CardContent>
    </Card>
  );
}