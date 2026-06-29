import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { Activity, TrendingUp } from "lucide-react";
import { format } from "date-fns";

export default function HealthTrendsChart({ visits, _patient }) {
  const completedVisits = visits
    .filter(v => v.status === 'completed' && v.vital_signs)
    .slice(0, 10)
    .reverse();

  const chartData = completedVisits.map(v => ({
    date: format(new Date(v.visit_date), 'MMM d'),
    bp_systolic: v.vital_signs?.blood_pressure_systolic || null,
    bp_diastolic: v.vital_signs?.blood_pressure_diastolic || null,
    hr: v.vital_signs?.heart_rate || null,
    o2: v.vital_signs?.oxygen_saturation || null,
    weight: v.vital_signs?.weight || null,
    pain: v.vital_signs?.pain_level || null
  }));

  if (chartData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-5 h-5 text-blue-600" />
            Vital Signs Trends
          </CardTitle>
        </CardHeader>
        <CardContent className="text-center py-8">
          <p className="text-slate-500">No vital signs data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Vital Signs Trends
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={250}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'white', 
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                fontSize: '12px'
              }}
            />
            <Legend wrapperStyle={{ fontSize: '12px' }} />
            <Line 
              type="monotone" 
              dataKey="bp_systolic" 
              stroke="#ef4444" 
              name="BP Systolic"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
            <Line 
              type="monotone" 
              dataKey="hr" 
              stroke="#3557b0" 
              name="Heart Rate"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
            <Line 
              type="monotone" 
              dataKey="o2" 
              stroke="#10b981" 
              name="O2 Sat %"
              strokeWidth={2}
              dot={{ r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}