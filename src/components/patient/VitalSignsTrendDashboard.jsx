import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Activity } from "lucide-react";

export default function VitalSignsTrendDashboard({ patientId }) {
  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["patientVisits", patientId],
    queryFn: () =>
      patientId
        ? base44.entities.Visit.filter({ patient_id: patientId }, "-visit_date", 10)
        : Promise.resolve([]),
    enabled: !!patientId,
  });

  // Parse and format vitals data for charts
  const chartData = useMemo(() => {
    return visits
      .sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date))
      .map((visit, idx) => {
        const v = visit.vital_signs || {};
        return {
          visit: idx + 1,
          date: new Date(visit.visit_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
          visitType: visit.visit_type?.replace(/_/g, " ") || "—",
          systolic: v.blood_pressure_systolic || null,
          diastolic: v.blood_pressure_diastolic || null,
          o2: v.oxygen_saturation || null,
          hr: v.heart_rate || null,
          temp: v.temperature || null,
        };
      });
  }, [visits]);

  // Calculate trends
  const trends = useMemo(() => {
    if (chartData.length < 2) return {};

    const first = chartData[0];
    const last = chartData[chartData.length - 1];

    return {
      systolic: last.systolic && first.systolic ? last.systolic - first.systolic : null,
      diastolic: last.diastolic && first.diastolic ? last.diastolic - first.diastolic : null,
      o2: last.o2 && first.o2 ? last.o2 - first.o2 : null,
      hr: last.hr && first.hr ? last.hr - first.hr : null,
    };
  }, [chartData]);

  const TrendBadge = ({ value, unit, label }) => {
    if (value === null || value === undefined) return null;
    const isPositive = (label === "O₂" || label === "Temp") ? value > 0 : value < 0;
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-white border">
        {isPositive ? (
          <TrendingUp className="w-3.5 h-3.5 text-green-600" />
        ) : (
          <TrendingDown className="w-3.5 h-3.5 text-red-600" />
        )}
        <span className={isPositive ? "text-green-700" : "text-red-700"}>
          {label}: {value > 0 ? "+" : ""}{value.toFixed(1)} {unit}
        </span>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-slate-200 rounded w-1/3" />
          <div className="h-64 bg-slate-100 rounded" />
        </div>
      </div>
    );
  }

  if (chartData.length === 0) {
    return (
      <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-center">
        <Activity className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No visits with vital signs data available yet.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Trend Summary */}
      <div className="bg-gradient-to-r from-indigo-50 to-navy-50 border border-indigo-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-indigo-900 mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" /> Vital Signs Trends (First to Last Visit)
        </p>
        <div className="flex flex-wrap gap-2">
          <TrendBadge value={trends.systolic} unit="mmHg" label="Systolic" />
          <TrendBadge value={trends.diastolic} unit="mmHg" label="Diastolic" />
          <TrendBadge value={trends.o2} unit="%" label="O₂" />
          <TrendBadge value={trends.hr} unit="bpm" label="HR" />
        </div>
      </div>

      {/* Blood Pressure Chart */}
      {chartData.some(d => d.systolic || d.diastolic) && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-red-500" /> Blood Pressure
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[60, 180]} tick={{ fontSize: 12 }} label={{ value: "mmHg", angle: -90, position: "insideLeft" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                  formatter={(value) => (value ? value.toFixed(0) : "—")}
                  labelFormatter={(label) => `Visit ${label}`}
                />
                <Legend wrapperStyle={{ paddingTop: "10px" }} />
                <Line type="monotone" dataKey="systolic" stroke="#dc2626" strokeWidth={2.5} name="Systolic" isAnimationActive={false} />
                <Line type="monotone" dataKey="diastolic" stroke="#f97316" strokeWidth={2.5} name="Diastolic" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* O₂ Saturation Chart */}
      {chartData.some(d => d.o2) && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-blue-500" /> Oxygen Saturation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis domain={[90, 100]} tick={{ fontSize: 12 }} label={{ value: "%", angle: -90, position: "insideLeft" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                  formatter={(value) => (value ? `${value.toFixed(1)}%` : "—")}
                  labelFormatter={(label) => `Visit ${label}`}
                />
                <Line type="monotone" dataKey="o2" stroke="#264491" strokeWidth={2.5} name="O₂ Sat" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* Heart Rate & Temperature Chart */}
      {chartData.some(d => d.hr || d.temp) && (
        <Card className="border-slate-200 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <span className="w-3 h-3 rounded-full bg-navy-500" /> Heart Rate & Temperature
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={chartData} margin={{ top: 5, right: 60, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                <YAxis yAxisId="left" tick={{ fontSize: 12 }} label={{ value: "bpm", angle: -90, position: "insideLeft" }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 12 }} label={{ value: "°F", angle: 90, position: "insideRight" }} />
                <Tooltip
                  contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                  formatter={(value) => (value ? value.toFixed(1) : "—")}
                  labelFormatter={(label) => `Visit ${label}`}
                />
                <Legend wrapperStyle={{ paddingTop: "10px" }} />
                <Line yAxisId="left" type="monotone" dataKey="hr" stroke="#7c3aed" strokeWidth={2.5} name="HR (bpm)" isAnimationActive={false} />
                <Line yAxisId="right" type="monotone" dataKey="temp" stroke="#f59e0b" strokeWidth={2.5} name="Temp (°F)" isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}