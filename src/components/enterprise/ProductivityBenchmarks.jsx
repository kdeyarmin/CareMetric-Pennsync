import React from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

export default function ProductivityBenchmarks({ data }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Provider Productivity Benchmarks</CardTitle>
        <CardDescription>
          Notes generated per provider compared to agency average
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="name" />
            <YAxis />
            <Tooltip />
            <Legend />
            <Bar dataKey="notes" fill="#3b82f6" name="Notes Generated" />
            <Bar dataKey="avgNotes" fill="#94a3b8" name="Agency Average" />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  );
}