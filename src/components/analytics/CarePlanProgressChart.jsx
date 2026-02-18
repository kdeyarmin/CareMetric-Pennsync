import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell
} from "recharts";
import { Target } from "lucide-react";

export default function CarePlanProgressChart({ carePlans, patients }) {
  const patientMap = useMemo(() => {
    const map = {};
    patients.forEach(p => { map[p.id] = p; });
    return map;
  }, [patients]);

  const activePlans = useMemo(() => {
    return carePlans
      .filter(cp => cp.status === "active")
      .map(cp => {
        const patient = patientMap[cp.patient_id];
        const daysRemaining = cp.target_date
          ? Math.ceil((new Date(cp.target_date) - new Date()) / (1000 * 60 * 60 * 24))
          : null;
        return {
          name: patient ? `${patient.first_name} ${patient.last_name?.charAt(0)}.` : "Unknown",
          problem: cp.problem?.substring(0, 30) || "N/A",
          progress: cp.progress_percentage || 0,
          daysRemaining,
          onTrack: daysRemaining === null || daysRemaining > 0 ? (cp.progress_percentage || 0) >= 25 : (cp.progress_percentage || 0) >= 50,
        };
      })
      .sort((a, b) => a.progress - b.progress)
      .slice(0, 12);
  }, [carePlans, patientMap]);

  const stats = useMemo(() => {
    const active = carePlans.filter(cp => cp.status === "active");
    const withProgress = active.filter(cp => (cp.progress_percentage || 0) > 0);
    const avgProgress = withProgress.length > 0
      ? withProgress.reduce((s, cp) => s + (cp.progress_percentage || 0), 0) / withProgress.length
      : 0;
    const overdue = active.filter(cp => cp.target_date && new Date(cp.target_date) < new Date()).length;
    return { total: active.length, avgProgress: avgProgress.toFixed(0), overdue };
  }, [carePlans]);

  return (
    <Card>
      <CardHeader className="p-3 pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Target className="w-4 h-4 text-blue-500" /> Care Plan Progress Overview
          </CardTitle>
          <div className="flex gap-2">
            <Badge variant="outline" className="text-[9px]">{stats.total} active</Badge>
            <Badge className="bg-blue-100 text-blue-700 text-[9px]">{stats.avgProgress}% avg</Badge>
            {stats.overdue > 0 && <Badge className="bg-red-100 text-red-700 text-[9px]">{stats.overdue} overdue</Badge>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-2">
        {activePlans.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-6">No active care plans</p>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(180, activePlans.length * 28)}>
            <BarChart data={activePlans} layout="vertical" margin={{ left: 5, right: 15 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" domain={[0, 100]} style={{ fontSize: "9px" }} tickFormatter={(v) => `${v}%`} />
              <YAxis dataKey="name" type="category" width={75} style={{ fontSize: "9px" }} />
              <Tooltip
                formatter={(value, name, props) => [`${value}%`, props.payload.problem]}
                labelFormatter={(label) => label}
              />
              <Bar dataKey="progress" name="Progress" radius={[0, 4, 4, 0]} barSize={16}>
                {activePlans.map((entry, i) => (
                  <Cell key={i} fill={entry.onTrack ? "#22c55e" : entry.progress < 15 ? "#ef4444" : "#f59e0b"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}