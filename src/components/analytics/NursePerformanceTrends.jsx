import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, Area, AreaChart } from "recharts";
import { TrendingUp, Clock, Award, Activity } from "lucide-react";
import { format, subDays } from "date-fns";

export default function NursePerformanceTrends({ noteConversions = [], complianceAudits = [], dateRange = 30 }) {
  // Process data for charts
  const processedData = React.useMemo(() => {
    const days = [];
    for (let i = dateRange - 1; i >= 0; i--) {
      const date = subDays(new Date(), i);
      const dateStr = format(date, 'yyyy-MM-dd');
      
      const dayNotes = noteConversions.filter(nc => 
        nc.created_date && format(new Date(nc.created_date), 'yyyy-MM-dd') === dateStr
      );
      
      const dayAudits = complianceAudits.filter(ca =>
        ca.audit_date && format(new Date(ca.audit_date), 'yyyy-MM-dd') === dateStr
      );
      
      days.push({
        date: format(date, 'MMM dd'),
        notes_count: dayNotes.length,
        avg_quality: dayNotes.length > 0 ? 
          Math.round(dayNotes.reduce((sum, n) => sum + (n.quality_score || 0), 0) / dayNotes.length) : null,
        avg_compliance: dayAudits.length > 0 ?
          Math.round(dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length) : null,
        avg_time_minutes: dayNotes.length > 0 ?
          Math.round(dayNotes.reduce((sum, n) => sum + ((n.conversion_time_ms || 0) / 60000), 0) / dayNotes.length) : null,
        compliance_improvement: dayNotes.length > 0 ?
          Math.round(dayNotes.reduce((sum, n) => sum + (n.compliance_improvement || 0), 0) / dayNotes.length) : null
      });
    }
    return days;
  }, [noteConversions, complianceAudits, dateRange]);

  // Calculate stats
  const stats = React.useMemo(() => {
    const recentData = processedData.slice(-7);
    return {
      avgQuality: Math.round(recentData.filter(d => d.avg_quality).reduce((sum, d) => sum + d.avg_quality, 0) / recentData.filter(d => d.avg_quality).length) || 0,
      avgCompliance: Math.round(recentData.filter(d => d.avg_compliance).reduce((sum, d) => sum + d.avg_compliance, 0) / recentData.filter(d => d.avg_compliance).length) || 0,
      avgTime: Math.round(recentData.filter(d => d.avg_time_minutes).reduce((sum, d) => sum + d.avg_time_minutes, 0) / recentData.filter(d => d.avg_time_minutes).length) || 0,
      totalNotes: noteConversions.length
    };
  }, [processedData, noteConversions]);

  return (
    <div className="space-y-4">
      {/* Quick Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-blue-600 font-medium">Avg Quality</p>
                <p className="text-2xl font-bold text-blue-900">{stats.avgQuality}%</p>
                <p className="text-xs text-blue-600">Last 7 days</p>
              </div>
              <Award className="w-8 h-8 text-blue-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-green-600 font-medium">Avg Compliance</p>
                <p className="text-2xl font-bold text-green-900">{stats.avgCompliance}%</p>
                <p className="text-xs text-green-600">Last 7 days</p>
              </div>
              <TrendingUp className="w-8 h-8 text-green-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-purple-600 font-medium">Avg Time</p>
                <p className="text-2xl font-bold text-purple-900">{stats.avgTime}m</p>
                <p className="text-xs text-purple-600">Per note</p>
              </div>
              <Clock className="w-8 h-8 text-purple-400" />
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-orange-600 font-medium">Total Notes</p>
                <p className="text-2xl font-bold text-orange-900">{stats.totalNotes}</p>
                <p className="text-xs text-orange-600">Last {dateRange} days</p>
              </div>
              <Activity className="w-8 h-8 text-orange-400" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Compliance & Quality Trends */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-blue-600" />
            Compliance & Quality Trends
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={processedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Area type="monotone" dataKey="avg_compliance" stroke="#10b981" fill="#10b981" fillOpacity={0.3} name="Compliance %" />
              <Area type="monotone" dataKey="avg_quality" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.3} name="Quality Score %" />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Documentation Time Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-5 h-5 text-purple-600" />
            Documentation Time Efficiency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={processedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="avg_time_minutes" stroke="#a855f7" strokeWidth={2} name="Avg Time (min)" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Daily Activity */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="w-5 h-5 text-orange-600" />
            Daily Documentation Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={processedData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="notes_count" fill="#f97316" name="Notes Enhanced" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}