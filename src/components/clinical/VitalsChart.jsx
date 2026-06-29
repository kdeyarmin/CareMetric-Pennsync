import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Heart, Wind } from "lucide-react";

const VITAL_CONFIG = [
  { key: "blood_pressure_systolic", label: "BP Systolic", color: "#ef4444", unit: "mmHg" },
  { key: "blood_pressure_diastolic", label: "BP Diastolic", color: "#f97316", unit: "mmHg" },
  { key: "heart_rate", label: "Heart Rate", color: "#3557b0", unit: "bpm" },
  { key: "oxygen_saturation", label: "O₂ Sat", color: "#10b981", unit: "%" },
  { key: "temperature", label: "Temperature", color: "#a855f7", unit: "°F" },
  { key: "pain_level", label: "Pain Level", color: "#f59e0b", unit: "/10" },
];

export default function VitalsChart({ patientId }) {
  const { data: visits = [], isLoading } = useQuery({
    queryKey: ["patient-visits-vitals", patientId],
    queryFn: () => base44.entities.Visit.filter({ patient_id: patientId, status: "completed" }, "-visit_date", 30),
    enabled: !!patientId,
    initialData: [],
  });

  const chartData = useMemo(() =>
    visits
      .filter((v) => v.vital_signs && Object.keys(v.vital_signs).length > 0)
      .map((v) => ({
        date: new Date(v.visit_date).toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        ...v.vital_signs,
      }))
      .reverse(),
    [visits]
  );

  const latestVitals = visits.find((v) => v.vital_signs && Object.keys(v.vital_signs).length > 0)?.vital_signs || {};

  if (isLoading) {
    return <div className="h-64 animate-pulse bg-slate-100 rounded-xl" />;
  }

  if (chartData.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center text-slate-400 flex flex-col items-center gap-3">
          <Activity className="w-10 h-10" />
          <p>No completed visits with vital signs recorded yet.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary badges */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {VITAL_CONFIG.map(({ key, label, color, unit }) =>
          latestVitals[key] != null ? (
            <Card key={key} className="text-center">
              <CardContent className="p-3">
                <p className="text-xs text-slate-500 mb-1">{label}</p>
                <p className="text-xl font-bold" style={{ color }}>
                  {latestVitals[key]}
                  <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>
                </p>
                <Badge variant="outline" className="text-xs mt-1">Latest</Badge>
              </CardContent>
            </Card>
          ) : null
        )}
      </div>

      {/* BP + HR chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Heart className="w-4 h-4 text-red-500" />
            Blood Pressure & Heart Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="blood_pressure_systolic" name="Systolic" stroke="#ef4444" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="blood_pressure_diastolic" name="Diastolic" stroke="#f97316" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="heart_rate" name="Heart Rate" stroke="#3557b0" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* O2 + Pain chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wind className="w-4 h-4 text-emerald-500" />
            O₂ Saturation & Pain
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={chartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="oxygen_saturation" name="O₂ Sat %" stroke="#10b981" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="pain_level" name="Pain (0-10)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} />
              <Line type="monotone" dataKey="temperature" name="Temp °F" stroke="#a855f7" strokeWidth={2} dot={{ r: 3 }} />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}