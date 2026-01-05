import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area } from "recharts";
import { Download, TrendingUp, Users, Activity, FileText, Clock } from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { subDays, format } from "date-fns";

export default function AdvancedReportingDashboard({ 
  userActivity = [], 
  users = [], 
  noteConversions = [],
  visits = [],
  complianceAudits = []
}) {
  const [dateRange, setDateRange] = useState("30");
  const [reportType, setReportType] = useState("overview");

  // Calculate date range
  const startDate = useMemo(() => subDays(new Date(), parseInt(dateRange)), [dateRange]);

  // Filter data by date range
  const filteredActivity = useMemo(() => 
    userActivity.filter(a => new Date(a.created_date) >= startDate),
    [userActivity, startDate]
  );

  const filteredConversions = useMemo(() =>
    noteConversions.filter(n => new Date(n.created_date) >= startDate),
    [noteConversions, startDate]
  );

  const filteredVisits = useMemo(() =>
    visits.filter(v => new Date(v.created_date) >= startDate),
    [visits, startDate]
  );

  // User Activity Trends
  const activityTrends = useMemo(() => {
    const dailyActivity = {};
    filteredActivity.forEach(activity => {
      const date = format(new Date(activity.created_date), 'yyyy-MM-dd');
      if (!dailyActivity[date]) {
        dailyActivity[date] = { date, logins: 0, actions: 0, uniqueUsers: new Set() };
      }
      dailyActivity[date].actions++;
      if (activity.action === 'login') dailyActivity[date].logins++;
      dailyActivity[date].uniqueUsers.add(activity.user_email);
    });

    return Object.values(dailyActivity)
      .map(d => ({ ...d, uniqueUsers: d.uniqueUsers.size }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredActivity]);

  // Feature Adoption Analysis
  const featureAdoption = useMemo(() => {
    const features = {};
    filteredActivity.forEach(activity => {
      const feature = activity.page || activity.action || 'Unknown';
      features[feature] = (features[feature] || 0) + 1;
    });

    return Object.entries(features)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  }, [filteredActivity]);

  // AI Performance Metrics
  const aiMetrics = useMemo(() => {
    const daily = {};
    filteredConversions.forEach(conv => {
      const date = format(new Date(conv.created_date), 'yyyy-MM-dd');
      if (!daily[date]) {
        daily[date] = { 
          date, 
          conversions: 0, 
          avgQuality: 0, 
          avgCompliance: 0,
          totalQuality: 0,
          totalCompliance: 0
        };
      }
      daily[date].conversions++;
      daily[date].totalQuality += conv.quality_score || 0;
      daily[date].totalCompliance += conv.compliance_score || 0;
    });

    return Object.values(daily).map(d => ({
      date: d.date,
      conversions: d.conversions,
      avgQuality: Math.round(d.totalQuality / d.conversions),
      avgCompliance: Math.round(d.totalCompliance / d.conversions)
    })).sort((a, b) => a.date.localeCompare(b.date));
  }, [filteredConversions]);

  // User Engagement Segmentation
  const userSegments = useMemo(() => {
    const userStats = {};
    filteredActivity.forEach(activity => {
      if (!userStats[activity.user_email]) {
        userStats[activity.user_email] = { actions: 0, lastSeen: activity.created_date };
      }
      userStats[activity.user_email].actions++;
      if (new Date(activity.created_date) > new Date(userStats[activity.user_email].lastSeen)) {
        userStats[activity.user_email].lastSeen = activity.created_date;
      }
    });

    const segments = {
      'Power Users (20+ actions)': 0,
      'Active Users (10-19 actions)': 0,
      'Regular Users (5-9 actions)': 0,
      'Low Activity (1-4 actions)': 0,
      'Inactive': users.length - Object.keys(userStats).length
    };

    Object.values(userStats).forEach(stats => {
      if (stats.actions >= 20) segments['Power Users (20+ actions)']++;
      else if (stats.actions >= 10) segments['Active Users (10-19 actions)']++;
      else if (stats.actions >= 5) segments['Regular Users (5-9 actions)']++;
      else segments['Low Activity (1-4 actions)']++;
    });

    return Object.entries(segments).map(([name, value]) => ({ name, value }));
  }, [filteredActivity, users]);

  // Export report as CSV
  const exportReport = () => {
    const csvContent = [
      ['Date', 'Unique Users', 'Total Actions', 'Logins', 'AI Conversions', 'Avg Quality Score'],
      ...activityTrends.map(day => {
        const aiDay = aiMetrics.find(a => a.date === day.date);
        return [
          day.date,
          day.uniqueUsers,
          day.actions,
          day.logins,
          aiDay?.conversions || 0,
          aiDay?.avgQuality || 0
        ];
      })
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `admin-report-${format(new Date(), 'yyyy-MM-dd')}.csv`;
    a.click();
  };

  const COLORS = ['#3B82F6', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B', '#6366F1'];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Advanced Analytics & Reporting</h2>
          <p className="text-gray-600">Comprehensive insights into system usage and performance</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          <Select value={dateRange} onValueChange={setDateRange}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">Last 7 days</SelectItem>
              <SelectItem value="30">Last 30 days</SelectItem>
              <SelectItem value="60">Last 60 days</SelectItem>
              <SelectItem value="90">Last 90 days</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={exportReport} variant="outline" className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      <Tabs value={reportType} onValueChange={setReportType}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="users">User Activity</TabsTrigger>
          <TabsTrigger value="features">Features</TabsTrigger>
          <TabsTrigger value="ai">AI Performance</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Users</p>
                    <p className="text-3xl font-bold">{users.length}</p>
                  </div>
                  <Users className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Total Actions</p>
                    <p className="text-3xl font-bold">{filteredActivity.length}</p>
                  </div>
                  <Activity className="w-8 h-8 text-purple-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">AI Enhancements</p>
                    <p className="text-3xl font-bold">{filteredConversions.length}</p>
                  </div>
                  <FileText className="w-8 h-8 text-green-600" />
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-gray-600">Avg Quality</p>
                    <p className="text-3xl font-bold">
                      {Math.round(filteredConversions.reduce((sum, c) => sum + (c.quality_score || 0), 0) / (filteredConversions.length || 1))}
                    </p>
                  </div>
                  <TrendingUp className="w-8 h-8 text-orange-600" />
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>User Engagement Segments</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie
                    data={userSegments}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ name, value }) => `${name}: ${value}`}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {userSegments.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="users" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Daily Active Users & Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart data={activityTrends}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Area type="monotone" dataKey="uniqueUsers" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.6} name="Unique Users" />
                  <Area type="monotone" dataKey="actions" stroke="#8B5CF6" fill="#8B5CF6" fillOpacity={0.6} name="Total Actions" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Top 10 Most Used Features</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <BarChart data={featureAdoption} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis dataKey="name" type="category" width={150} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#3B82F6" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ai" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Performance Trends</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={400}>
                <LineChart data={aiMetrics}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="conversions" stroke="#10B981" name="Daily Conversions" />
                  <Line type="monotone" dataKey="avgQuality" stroke="#3B82F6" name="Avg Quality Score" />
                  <Line type="monotone" dataKey="avgCompliance" stroke="#8B5CF6" name="Avg Compliance Score" />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}