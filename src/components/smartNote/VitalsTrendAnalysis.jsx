import { useMemo } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, TrendingUp, Activity } from "lucide-react";

export default function VitalsTrendAnalysis({ patientId }) {
  // Fetch all visits for the patient
  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["patient-visits", patientId],
    queryFn: () => patientId ? base44.entities.Visit.filter({ patient_id: patientId }, "-visit_date", 100) : Promise.resolve([]),
    enabled: !!patientId,
  });

  // Extract vital signs from visits and prepare chart data
  const chartData = useMemo(() => {
    const extracted = visits
      .filter(v => v.vital_signs && Object.keys(v.vital_signs).length > 0)
      .sort((a, b) => new Date(a.visit_date) - new Date(b.visit_date))
      .map(v => ({
        date: new Date(v.visit_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        bp_systolic: v.vital_signs.blood_pressure_systolic,
        bp_diastolic: v.vital_signs.blood_pressure_diastolic,
        heart_rate: v.vital_signs.heart_rate,
        oxygen: v.vital_signs.oxygen_saturation,
        full_date: v.visit_date,
      }))
      .filter(d => d.bp_systolic || d.heart_rate || d.oxygen);
    return extracted;
  }, [visits]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (chartData.length === 0) return null;
    return {
      bp_systolic: {
        latest: chartData[chartData.length - 1].bp_systolic,
        avg: Math.round(chartData.reduce((sum, d) => sum + (d.bp_systolic || 0), 0) / chartData.length),
        trend: chartData.length > 1 ? chartData[chartData.length - 1].bp_systolic - chartData[0].bp_systolic : 0,
      },
      heart_rate: {
        latest: chartData[chartData.length - 1].heart_rate,
        avg: Math.round(chartData.reduce((sum, d) => sum + (d.heart_rate || 0), 0) / chartData.length),
        trend: chartData.length > 1 ? chartData[chartData.length - 1].heart_rate - chartData[0].heart_rate : 0,
      },
      oxygen: {
        latest: chartData[chartData.length - 1].oxygen,
        avg: Math.round(chartData.reduce((sum, d) => sum + (d.oxygen || 0), 0) / chartData.length),
        trend: chartData.length > 1 ? chartData[chartData.length - 1].oxygen - chartData[0].oxygen : 0,
      },
    };
  }, [chartData]);

  const _isLoaded = !isLoading && chartData.length > 0;

  return (
    <div className="space-y-4">
      {!patientId ? (
        <Alert className="border-blue-300 bg-blue-50">
          <AlertCircle className="w-4 h-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            Select a patient to view vital signs trends over time.
          </AlertDescription>
        </Alert>
      ) : isLoading ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
          <div className="animate-pulse text-slate-400">Loading vital signs history…</div>
        </div>
      ) : chartData.length === 0 ? (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertCircle className="w-4 h-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            No vital signs recorded for this patient yet. Vital signs from visit records will appear here.
          </AlertDescription>
        </Alert>
      ) : (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Systolic BP", key: "bp_systolic", unit: "mmHg", normal: "< 120" },
              { label: "Heart Rate", key: "heart_rate", unit: "bpm", normal: "60-100" },
              { label: "Oxygen (SpO2)", key: "oxygen", unit: "%", normal: "> 95" },
            ].map(metric => {
              const data = stats[metric.key];
              const trendIcon = data.trend > 0 ? "↑" : data.trend < 0 ? "↓" : "→";
              const trendColor = metric.key === "oxygen"
                ? data.trend < 0 ? "text-red-600" : "text-green-600"
                : metric.key === "bp_systolic"
                ? data.trend > 0 ? "text-red-600" : "text-green-600"
                : data.trend > 0 ? "text-red-600" : "text-green-600";

              return (
                <Card key={metric.key} className="bg-white border border-slate-200 shadow-sm">
                  <CardContent className="p-3">
                    <p className="text-xs text-slate-500 font-semibold uppercase mb-1">{metric.label}</p>
                    <div className="flex items-baseline justify-between">
                      <span className="text-2xl font-bold text-slate-900">
                        {data.latest || "—"}
                        <span className="text-xs text-slate-400 ml-1">{metric.unit}</span>
                      </span>
                      <span className={`text-sm font-semibold ${trendColor}`}>{trendIcon}</span>
                    </div>
                    <div className="text-xs text-slate-500 mt-2">
                      <span>Avg: <strong>{data.avg}</strong> | Normal: {metric.normal}</span>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {/* Blood Pressure Chart */}
          <Card className="bg-white border border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-blue-500" /> Blood Pressure Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} domain={[80, 160]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                    formatter={(value) => value ? `${value} mmHg` : "—"}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="bp_systolic"
                    stroke="#ef4444"
                    name="Systolic (High)"
                    dot={{ fill: "#ef4444", r: 4 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="bp_diastolic"
                    stroke="#f97316"
                    name="Diastolic (Low)"
                    dot={{ fill: "#f97316", r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Heart Rate Chart */}
          <Card className="bg-white border border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-navy-500" /> Heart Rate Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} domain={[40, 120]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                    formatter={(value) => value ? `${value} bpm` : "—"}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="heart_rate"
                    stroke="#8b5cf6"
                    name="Heart Rate"
                    dot={{ fill: "#8b5cf6", r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Oxygen Saturation Chart */}
          <Card className="bg-white border border-slate-200 shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-green-500" /> Oxygen Saturation (SpO2) Trend
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" fontSize={12} />
                  <YAxis fontSize={12} domain={[85, 100]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#fff", border: "1px solid #ddd", borderRadius: "6px" }}
                    formatter={(value) => value ? `${value}%` : "—"}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="oxygen"
                    stroke="#22c55e"
                    name="SpO2"
                    dot={{ fill: "#22c55e", r: 4 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3">
            📊 Showing {chartData.length} visits with vital signs data. Charts update as new visit records are added.
          </div>
        </>
      )}
    </div>
  );
}