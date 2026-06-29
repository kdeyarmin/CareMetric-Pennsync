import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from 'recharts';
import { Users } from "lucide-react";

export default function NurseComparisonChart({ performanceData }) {
  if (!performanceData || performanceData.length === 0) {
    return null;
  }

  const chartData = performanceData.map(nurse => ({
    name: nurse.name,
    compliance: nurse.avg_compliance_score,
    visits: nurse.completed_visits,
    aiAdoption: nurse.ai_adoption_rate
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="w-5 h-5" />
          Team Performance Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="compliance" fill="#3557b0" name="Compliance %" />
            <Bar dataKey="visits" fill="#10B981" name="Visits" />
            <Bar dataKey="aiAdoption" fill="#8B5CF6" name="AI Adoption %" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}