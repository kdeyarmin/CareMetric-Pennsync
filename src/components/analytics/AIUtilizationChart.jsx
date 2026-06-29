import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function AIUtilizationChart({ data }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">AI Feature Utilization</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" style={{ fontSize: '12px' }} />
            <YAxis domain={[0, 100]} style={{ fontSize: '12px' }} />
            <Tooltip />
            <Legend />
            <Bar dataKey="aiUtilization" fill="#8b5cf6" name="AI Usage (%)" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}