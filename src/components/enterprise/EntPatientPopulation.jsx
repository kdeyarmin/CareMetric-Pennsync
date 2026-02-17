import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Users, Activity, AlertTriangle, Heart } from "lucide-react";
import {
  PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from "recharts";

const COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function EntPatientPopulation({ patients }) {
  const stats = useMemo(() => {
    if (!patients.length) return null;

    // Status breakdown
    const statusCounts = {};
    patients.forEach(p => {
      const s = p.status || "active";
      statusCounts[s] = (statusCounts[s] || 0) + 1;
    });
    const statusData = Object.entries(statusCounts).map(([name, value]) => ({ name, value }));

    // Age distribution
    const ageBuckets = { "0-17": 0, "18-44": 0, "45-64": 0, "65-74": 0, "75-84": 0, "85+": 0 };
    patients.forEach(p => {
      if (!p.date_of_birth) return;
      const age = Math.floor((Date.now() - new Date(p.date_of_birth).getTime()) / (365.25 * 24 * 60 * 60 * 1000));
      if (age < 18) ageBuckets["0-17"]++;
      else if (age < 45) ageBuckets["18-44"]++;
      else if (age < 65) ageBuckets["45-64"]++;
      else if (age < 75) ageBuckets["65-74"]++;
      else if (age < 85) ageBuckets["75-84"]++;
      else ageBuckets["85+"]++;
    });
    const ageData = Object.entries(ageBuckets).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));

    // Top diagnoses
    const dxCounts = {};
    patients.forEach(p => {
      if (p.primary_diagnosis) {
        const dx = p.primary_diagnosis.substring(0, 40);
        dxCounts[dx] = (dxCounts[dx] || 0) + 1;
      }
    });
    const topDx = Object.entries(dxCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));

    // Risk scores
    const riskLevels = { low: 0, moderate: 0, high: 0, critical: 0 };
    let riskSum = 0, riskCount = 0;
    patients.forEach(p => {
      if (p.risk_assessment?.level) riskLevels[p.risk_assessment.level]++;
      if (p.risk_assessment?.score != null) { riskSum += p.risk_assessment.score; riskCount++; }
    });
    const avgRisk = riskCount > 0 ? (riskSum / riskCount).toFixed(1) : "N/A";
    const riskData = Object.entries(riskLevels).filter(([, v]) => v > 0).map(([name, value]) => ({ name, value }));

    // Care type
    const careTypes = {};
    patients.forEach(p => {
      const ct = p.care_type || "home_health";
      careTypes[ct] = (careTypes[ct] || 0) + 1;
    });

    return { statusData, ageData, topDx, riskData, avgRisk, careTypes, total: patients.length,
      active: statusCounts.active || 0, discharged: statusCounts.discharged || 0,
      hospitalized: statusCounts.hospitalized || 0 };
  }, [patients]);

  if (!stats) return null;

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatMini icon={Users} label="Total Patients" value={stats.total} color="text-blue-600" />
        <StatMini icon={Activity} label="Active" value={stats.active} color="text-green-600" />
        <StatMini icon={AlertTriangle} label="Hospitalized" value={stats.hospitalized} color="text-red-600" />
        <StatMini icon={Heart} label="Avg Risk Score" value={stats.avgRisk} color="text-amber-600" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Age Distribution */}
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Age Distribution</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={stats.ageData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" style={{ fontSize: "10px" }} />
                <YAxis style={{ fontSize: "10px" }} />
                <Tooltip />
                <Bar dataKey="value" fill="#3b82f6" name="Patients" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Risk Level Breakdown */}
        <Card>
          <CardHeader className="p-3"><CardTitle className="text-sm">Risk Level Distribution</CardTitle></CardHeader>
          <CardContent className="p-2">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={stats.riskData} cx="50%" cy="50%" outerRadius={70} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                  {stats.riskData.map((_, i) => <Cell key={i} fill={["#10b981", "#f59e0b", "#f97316", "#ef4444"][i % 4]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Top Diagnoses */}
      <Card>
        <CardHeader className="p-3"><CardTitle className="text-sm">Top Diagnoses</CardTitle></CardHeader>
        <CardContent className="p-2">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={stats.topDx} layout="vertical" margin={{ left: 100 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" style={{ fontSize: "10px" }} />
              <YAxis type="category" dataKey="name" style={{ fontSize: "9px" }} width={100} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" name="Patients" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
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