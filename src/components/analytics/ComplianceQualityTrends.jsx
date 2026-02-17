import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { Loader2, Shield, TrendingDown, Award } from "lucide-react";
import { toast } from "sonner";

export default function ComplianceQualityTrends() {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [timePeriod, setTimePeriod] = useState("90days");

  const loadAnalytics = async () => {
    setLoading(true);
    try {
      const response = await base44.functions.invoke('complianceAnalytics', {
        time_period: timePeriod
      });
      setData(response);
      toast.success("Compliance trends loaded");
    } catch (error) {
      console.error('Analytics error:', error);
      toast.error("Failed to load compliance data");
    } finally {
      setLoading(false);
    }
  };

  const violationChartData = data?.violations_by_category?.slice(0, 6)?.map(item => ({
    category: item.category.substring(0, 15),
    count: item.count
  })) || [];

  return (
    <div className="space-y-4">
      {/* Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              <CardTitle>Documentation Quality & Compliance</CardTitle>
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
              { label: 'Avg Compliance', value: `${data.average_compliance}%`, icon: '📊' },
              { label: 'Total Violations', value: data.total_violations, icon: '⚠️' },
              { label: 'Top Provider', value: data.provider_rankings[0]?.provider, icon: '⭐' },
              { label: 'Providers Ranked', value: data.provider_rankings.length, icon: '👥' }
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

          {/* Trend Chart */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Compliance Trend Over Time</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={data.trend_data}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" angle={-45} textAnchor="end" height={80} fontSize={12} />
                  <YAxis domain={[0, 100]} />
                  <Tooltip formatter={(value) => `${value}%`} />
                  <Legend />
                  <Line type="monotone" dataKey="avg_score" stroke="#10b981" name="Avg Score (%)" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Provider Rankings */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Provider Performance Rankings</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data.provider_rankings?.map((provider, idx) => (
                  <div key={idx} className="p-3 bg-slate-50 dark:bg-slate-800 rounded border">
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex-1">
                        <p className="font-semibold text-sm">{idx + 1}. {provider.provider}</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">
                          {provider.total_documents} documents • {provider.violations_count} violations
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-lg">{provider.avg_compliance_score}%</p>
                        <p className="text-xs text-slate-600 dark:text-slate-400">Compliance</p>
                      </div>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                      <div
                        className={`h-2 rounded-full transition-all ${
                          parseFloat(provider.avg_compliance_score) >= 85 ? 'bg-green-600' :
                          parseFloat(provider.avg_compliance_score) >= 70 ? 'bg-yellow-600' : 'bg-red-600'
                        }`}
                        style={{ width: `${provider.avg_compliance_score}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Violations by Category */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Top Violation Categories</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={violationChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="category" angle={-45} textAnchor="end" height={80} fontSize={12} />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="count" fill="#ef4444" name="Violation Count" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* AI Recommendations */}
          {data.ai_analysis && (
            <Card className="border-green-300 dark:border-green-600">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">🤖 AI Recommendations</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap">
                  {data.ai_analysis}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}