import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Loader2, TrendingUp, AlertCircle, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";

export default function PatientOutcomeAnalytics() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [timePeriod, setTimePeriod] = useState("90days");

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('patientOutcomeAnalysis', {
        time_period: timePeriod
      });
      setData(response);
      toast.success("Patient outcome analysis loaded");
    } catch (error) {
      console.error('Analytics error:', error);
      toast.error("Failed to load analytics");
    } finally {
      setLoading(false);
    }
  };

  const chartData = data?.summary?.slice(0, 8)?.map(item => ({
    name: item.diagnosis.substring(0, 15),
    success: parseFloat(item.success_rate),
    cases: item.total_visits,
    compliance: parseFloat(item.avg_compliance_score)
  })) || [];

  const outcomeDistribution = data?.summary?.reduce((acc, item) => ({
    improved: acc.improved + item.improved_count,
    stable: acc.stable + item.stable_count,
    declined: acc.declined + item.declined_count,
    hospitalized: acc.hospitalized + item.hospitalized_count
  }), { improved: 0, stable: 0, declined: 0, hospitalized: 0 });

  const pieData = outcomeDistribution ? [
    { name: 'Improved', value: outcomeDistribution.improved, color: '#10b981' },
    { name: 'Stable', value: outcomeDistribution.stable, color: '#6366f1' },
    { name: 'Declined', value: outcomeDistribution.declined, color: '#f59e0b' },
    { name: 'Hospitalized', value: outcomeDistribution.hospitalized, color: '#ef4444' }
  ] : [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              <CardTitle>Patient Outcome Analysis</CardTitle>
            </div>
            <div className="flex gap-2 items-center flex-wrap">
              <Select value={timePeriod} onValueChange={setTimePeriod}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="30days">Last 30 Days</SelectItem>
                  <SelectItem value="90days">Last 90 Days</SelectItem>
                  <SelectItem value="6months">Last 6 Months</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={loadAnalytics} disabled={loading}>
                {loading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                Analyze
              </Button>
            </div>
          </div>
        </CardHeader>
      </Card>

      {data && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: 'Patients Analyzed', value: data.total_patients_analyzed, icon: '👥' },
              { label: 'Avg Success Rate', value: `${(data.summary.reduce((sum, s) => sum + parseFloat(s.success_rate), 0) / data.summary.length).toFixed(1)}%`, icon: '✅' },
              { label: 'Top Performer', value: data.top_performers[0]?.diagnosis.split('(')[0], icon: '⭐' },
              { label: 'Needs Attention', value: data.needs_attention.length, icon: '⚠️' }
            ].map((stat, idx) => (
              <Card key={idx} className="p-3">
                <p className="text-xs text-slate-600 dark:text-slate-400 mb-1">{stat.label}</p>
                <p className="text-lg font-bold flex items-center gap-2">
                  <span>{stat.icon}</span>
                  <span className="truncate">{stat.value}</span>
                </p>
              </Card>
            ))}
          </div>

          {/* Success Rate Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Success Rates by Diagnosis</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="success" fill="#10b981" name="Success Rate (%)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Outcome Distribution */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Overall Outcome Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, value }) => `${name} (${value})`}
                      outerRadius={80}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {pieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Outcome Summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {pieData.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 dark:bg-slate-800 rounded">
                    <div className="flex items-center gap-2">
                      <div className="w-3 h-3 rounded" style={{ backgroundColor: item.color }} />
                      <span className="text-sm">{item.name}</span>
                    </div>
                    <span className="font-semibold text-sm">{item.value}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          {/* Top Performers */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">✅ Top Performing Diagnoses</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.top_performers?.map((perf, idx) => (
                  <div key={idx} className="p-3 bg-green-50 dark:bg-green-900/20 rounded border border-green-200 dark:border-green-700">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{perf.diagnosis}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                          {perf.total_visits} cases • {perf.avg_recovery_days} days avg recovery
                        </p>
                      </div>
                      <Badge className="bg-green-600 text-white">{perf.success_rate}%</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Needs Attention */}
          {data.needs_attention?.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-orange-600" />
                  Diagnoses Needing Attention
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.needs_attention.slice(0, 5).map((item, idx) => (
                    <div key={idx} className="p-3 bg-orange-50 dark:bg-orange-900/20 rounded border border-orange-200 dark:border-orange-700">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="font-semibold text-sm">{item.diagnosis}</p>
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            {item.total_visits} cases • {item.declined_count} with decline
                          </p>
                        </div>
                        <Badge variant="outline" className="border-orange-600 text-orange-600">{item.success_rate}%</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* AI Insights */}
          {data.ai_insights && (
            <Card className="border-blue-300 dark:border-blue-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">🤖 AI Insights</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {data.ai_insights}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}