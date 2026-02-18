import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, Legend,
  BarChart, Bar, XAxis, YAxis, CartesianGrid
} from "recharts";

const RISK_COLORS = { low: "#22c55e", moderate: "#f59e0b", high: "#ef4444", critical: "#7c2d12", unknown: "#94a3b8" };
const STATUS_COLORS = { active: "#3b82f6", met: "#22c55e", not_met: "#ef4444", revised: "#f59e0b" };

export default function AgencyRiskDistributionChart({ patients, carePlans }) {
  const riskData = useMemo(() => {
    const counts = { low: 0, moderate: 0, high: 0, critical: 0, unknown: 0 };
    patients.filter(p => p.status === "active").forEach(p => {
      const level = p.risk_assessment?.level || "unknown";
      counts[level] = (counts[level] || 0) + 1;
    });
    return Object.entries(counts).filter(([_, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [patients]);

  const carePlanStatusData = useMemo(() => {
    const counts = { active: 0, met: 0, not_met: 0, revised: 0 };
    carePlans.forEach(cp => { counts[cp.status] = (counts[cp.status] || 0) + 1; });
    return Object.entries(counts).filter(([_, v]) => v > 0).map(([name, value]) => ({ name, value }));
  }, [carePlans]);

  const diagnosisData = useMemo(() => {
    const counts = {};
    patients.filter(p => p.status === "active" && p.primary_diagnosis).forEach(p => {
      const diag = p.primary_diagnosis.split(" - ")[0].substring(0, 25);
      counts[diag] = (counts[diag] || 0) + 1;
    });
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([name, count]) => ({ name, count }));
  }, [patients]);

  const BAR_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#a855f7", "#c084fc", "#d8b4fe", "#ede9fe", "#f5f3ff"];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
      {/* Risk Distribution */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Patient Risk Distribution</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={riskData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={35} paddingAngle={2}>
                {riskData.map((entry) => (
                  <Cell key={entry.name} fill={RISK_COLORS[entry.name] || RISK_COLORS.unknown} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [value, "Patients"]} />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Care Plan Status */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Care Plan Status</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie data={carePlanStatusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={65} innerRadius={35} paddingAngle={2}>
                {carePlanStatusData.map((entry) => (
                  <Cell key={entry.name} fill={STATUS_COLORS[entry.name] || "#94a3b8"} />
                ))}
              </Pie>
              <Tooltip formatter={(value) => [value, "Plans"]} />
              <Legend wrapperStyle={{ fontSize: "10px" }} />
            </PieChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Diagnoses */}
      <Card>
        <CardHeader className="p-3 pb-1">
          <CardTitle className="text-xs">Top Diagnoses</CardTitle>
        </CardHeader>
        <CardContent className="p-2">
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={diagnosisData} layout="vertical" margin={{ left: 5, right: 10 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" style={{ fontSize: "9px" }} />
              <YAxis dataKey="name" type="category" width={80} style={{ fontSize: "8px" }} tick={{ width: 75 }} />
              <Tooltip />
              <Bar dataKey="count" name="Patients">
                {diagnosisData.map((_, i) => (
                  <Cell key={i} fill={BAR_COLORS[i % BAR_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}