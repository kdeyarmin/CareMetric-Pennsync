import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function ComplianceTrendChart({ data }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance & Quality Trends</CardTitle>
        <CardDescription>
          Agency-wide compliance and quality scores over time
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="month" />
            <YAxis domain={[0, 100]} />
            <Tooltip />
            <Legend />
            <Line 
              type="monotone" 
              dataKey="compliance" 
              stroke="#3b82f6" 
              strokeWidth={2}
              name="Compliance Score" 
            />
            <Line 
              type="monotone" 
              dataKey="quality" 
              stroke="#10b981" 
              strokeWidth={2}
              name="Quality Score" 
            />
          </LineChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}