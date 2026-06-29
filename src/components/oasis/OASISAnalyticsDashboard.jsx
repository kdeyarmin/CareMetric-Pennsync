import React from "react";
import { CHART_COLORS } from "@/constants/chartColors";
import {
  aggregateDemographics,
  aggregateTopDiagnoses,
  aggregateFunctionalScores,
  aggregatePaymentTrends,
  computeSummaryStats,
} from "@/components/oasis/oasisAnalytics";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import EmptyState from "@/components/ui/empty-state";
import {
  FileText,
  Target,
  DollarSign,
  Activity,
  TrendingUp,
  ClipboardCheck,
  Users,
} from "lucide-react";
import { BarChart3 } from "lucide-react";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

// Analytics Dashboard Component — payment trends & revenue stats.
// Extracted from OASISAnalyzer.jsx; pure aggregation logic lives in oasisAnalytics.js (unit-tested).
export default function OASISAnalyticsDashboard({ savedOASISUploads }) {
  const COLORS = CHART_COLORS;

  const demographicsData = React.useMemo(() => aggregateDemographics(savedOASISUploads), [savedOASISUploads]);
  const diagnosesData = React.useMemo(() => aggregateTopDiagnoses(savedOASISUploads), [savedOASISUploads]);
  const functionalScoresData = React.useMemo(() => aggregateFunctionalScores(savedOASISUploads), [savedOASISUploads]);
  const paymentTrendsData = React.useMemo(() => aggregatePaymentTrends(savedOASISUploads), [savedOASISUploads]);
  const summaryStats = React.useMemo(() => computeSummaryStats(savedOASISUploads), [savedOASISUploads]);

  if (savedOASISUploads.length === 0) {
    return (
      <EmptyState
        icon={BarChart3}
        title="No data available"
        description="Upload and analyze OASIS documents to see analytics and trends."
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-2 border-blue-200 bg-blue-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-600 font-medium">Total Assessments</p>
                <p className="text-3xl font-bold text-blue-700">{summaryStats.totalAssessments}</p>
              </div>
              <FileText className="w-10 h-10 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-green-200 bg-green-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-green-600 font-medium">Avg Quality Score</p>
                <p className="text-3xl font-bold text-green-700">{summaryStats.avgScore.toFixed(0)}%</p>
              </div>
              <Target className="w-10 h-10 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-navy-200 bg-navy-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-navy-600 font-medium">Avg Payment</p>
                <p className="text-3xl font-bold text-navy-700">${summaryStats.avgPayment.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <DollarSign className="w-10 h-10 text-navy-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-2 border-orange-200 bg-orange-50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-600 font-medium">Total Revenue</p>
                <p className="text-3xl font-bold text-orange-700">${summaryStats.totalRevenue.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
              </div>
              <TrendingUp className="w-10 h-10 text-orange-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Patient Demographics */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-600" />
              Gender Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={demographicsData.gender}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, value, percent }) => `${name}: ${value} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={80}
                  fill="#264491"
                  dataKey="value"
                >
                  {demographicsData.gender.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-600" />
              Age Distribution
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={demographicsData.age}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="value" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Common Diagnoses */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <ClipboardCheck className="w-5 h-5 text-navy-600" />
            Top 10 Primary Diagnoses
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart data={diagnosesData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" />
              <YAxis dataKey="name" type="category" width={200} />
              <Tooltip />
              <Bar dataKey="count" fill="#8b5cf6" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Functional Scores Over Time */}
      {functionalScoresData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Functional Scores Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={functionalScoresData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
                <YAxis label={{ value: 'Score', angle: -90, position: 'insideLeft' }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="ambulation" stroke="#3557b0" name="Ambulation" strokeWidth={2} />
                <Line type="monotone" dataKey="transferring" stroke="#10b981" name="Transferring" strokeWidth={2} />
                <Line type="monotone" dataKey="bathing" stroke="#f59e0b" name="Bathing" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* PDGM Payment Trends */}
      {paymentTrendsData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-green-600" />
              PDGM Payment Trends
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={350}>
              <LineChart data={paymentTrendsData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} />
                <YAxis label={{ value: 'Payment ($)', angle: -90, position: 'insideLeft' }} />
                <Tooltip formatter={(value) => `$${value.toLocaleString()}`} />
                <Legend />
                <Line type="monotone" dataKey="payment" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}