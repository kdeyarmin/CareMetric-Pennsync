import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line, PieChart, Pie, Cell } from "recharts";
import { Users, TrendingUp, Activity, Clock, Award, Target, FileText, Calendar, Zap, TrendingDown, UserCheck, MapPin, Smartphone } from "lucide-react";
import { formatEastern } from "@/components/utils/timezone";
import { differenceInDays, format } from "date-fns";

export default function UserInsightsDashboard({ users, activity, noteConversions, complianceAudits }) {
  const [selectedMetric, setSelectedMetric] = useState("all");
  const [sortBy, setSortBy] = useState("compliance");

  const insights = useMemo(() => {
    // User engagement levels
    const now = new Date();
    const last7Days = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    
    const activeUsers7d = new Set(activity.filter(a => 
      new Date(a.created_date) >= last7Days
    ).map(a => a.user_email)).size;
    
    const activeUsers30d = new Set(activity.filter(a => 
      new Date(a.created_date) >= last30Days
    ).map(a => a.user_email)).size;
    
    // User segments
    const userSegments = users.map(user => {
      const userActivity = activity.filter(a => a.user_email === user.email);
      const userConversions = noteConversions.filter(n => n.nurse_email === user.email);
      const userAudits = complianceAudits.filter(a => a.nurse_email === user.email);
      
      const recentActivity = userActivity.filter(a => 
        new Date(a.created_date) >= last7Days
      ).length;
      
      let segment = 'Inactive';
      if (recentActivity > 10) segment = 'Power User';
      else if (recentActivity > 5) segment = 'Active';
      else if (recentActivity > 0) segment = 'Casual';
      
      return {
        email: user.email,
        name: user.full_name,
        segment,
        activityCount: userActivity.length,
        conversions: userConversions.length,
        avgCompliance: userAudits.length > 0 
          ? (userAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / userAudits.length).toFixed(1)
          : 0,
        lastActive: userActivity.length > 0 
          ? userActivity.sort((a, b) => new Date(b.created_date) - new Date(a.created_date))[0].created_date
          : null
      };
    });
    
    const segmentCounts = userSegments.reduce((acc, user) => {
      acc[user.segment] = (acc[user.segment] || 0) + 1;
      return acc;
    }, {});
    
    // Daily active users trend (last 30 days)
    const last30DaysArray = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });
    
    const dauTrend = last30DaysArray.map(date => {
      const activeOnDay = new Set(activity.filter(a => 
        a.created_date && a.created_date.startsWith(date)
      ).map(a => a.user_email)).size;
      
      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        dau: activeOnDay
      };
    });
    
    // Most active hours
    const hourlyActivity = activity.reduce((acc, a) => {
      if (!a.created_date) return acc;
      const hour = new Date(a.created_date).getHours();
      acc[hour] = (acc[hour] || 0) + 1;
      return acc;
    }, {});
    
    const hourlyData = Object.entries(hourlyActivity)
      .map(([hour, count]) => ({
        hour: `${hour}:00`,
        activity: count
      }))
      .sort((a, b) => parseInt(a.hour) - parseInt(b.hour));
    
    // Top performers
    const topPerformers = userSegments
      .filter(u => u.conversions > 0)
      .sort((a, b) => b.avgCompliance - a.avgCompliance)
      .slice(0, 10);
    
    // Provider type distribution
    const providerTypeDistribution = users.reduce((acc, user) => {
      const type = user.credential_type || user.provider_type || 'Unknown';
      acc[type] = (acc[type] || 0) + 1;
      return acc;
    }, {});
    
    const providerTypeData = Object.entries(providerTypeDistribution).map(([type, count]) => ({
      type,
      count,
      percentage: ((count / users.length) * 100).toFixed(1)
    }));
    
    // Feature adoption rates
    const featureAdoption = {
      smartNotes: new Set(noteConversions.map(n => n.nurse_email)).size,
      carePlans: new Set(activity.filter(a => a.action?.includes('care_plan')).map(a => a.user_email)).size,
      training: new Set(activity.filter(a => a.action?.includes('training')).map(a => a.user_email)).size,
      telehealth: new Set(activity.filter(a => a.action?.includes('telehealth')).map(a => a.user_email)).size,
      aiAssistant: new Set(activity.filter(a => a.action?.includes('ai_chat')).map(a => a.user_email)).size
    };
    
    const featureAdoptionData = [
      { feature: 'Smart Notes', users: featureAdoption.smartNotes, rate: ((featureAdoption.smartNotes / users.length) * 100).toFixed(1) },
      { feature: 'Care Plans', users: featureAdoption.carePlans, rate: ((featureAdoption.carePlans / users.length) * 100).toFixed(1) },
      { feature: 'Training', users: featureAdoption.training, rate: ((featureAdoption.training / users.length) * 100).toFixed(1) },
      { feature: 'Telehealth', users: featureAdoption.telehealth, rate: ((featureAdoption.telehealth / users.length) * 100).toFixed(1) },
      { feature: 'AI Assistant', users: featureAdoption.aiAssistant, rate: ((featureAdoption.aiAssistant / users.length) * 100).toFixed(1) }
    ];
    
    // Page visit distribution
    const pageVisits = activity.reduce((acc, a) => {
      if (a.page) {
        acc[a.page] = (acc[a.page] || 0) + 1;
      }
      return acc;
    }, {});
    
    const topPages = Object.entries(pageVisits)
      .map(([page, count]) => ({ page, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    // User retention by cohort (users who joined in last 90 days)
    const cohortData = Array.from({ length: 12 }, (_, i) => {
      const weekStart = new Date();
      weekStart.setDate(weekStart.getDate() - (i * 7));
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      
      const cohortUsers = users.filter(u => {
        const joinDate = new Date(u.created_date);
        return joinDate >= weekStart && joinDate < weekEnd;
      });
      
      const activeInCohort = cohortUsers.filter(u => {
        return activity.some(a => 
          a.user_email === u.email && 
          new Date(a.created_date) >= last7Days
        );
      });
      
      return {
        week: `Week ${12-i}`,
        joined: cohortUsers.length,
        retained: activeInCohort.length,
        retentionRate: cohortUsers.length > 0 ? ((activeInCohort.length / cohortUsers.length) * 100).toFixed(0) : 0
      };
    }).reverse();
    
    // User engagement depth
    const engagementDepth = userSegments.map(user => {
      const pages = new Set(activity.filter(a => a.user_email === user.email && a.page).map(a => a.page)).size;
      const actionTypes = new Set(activity.filter(a => a.user_email === user.email && a.action).map(a => a.action)).size;
      
      return {
        ...user,
        uniquePages: pages,
        uniqueActions: actionTypes,
        engagementScore: pages * 2 + actionTypes + user.conversions * 3
      };
    }).sort((a, b) => b.engagementScore - a.engagementScore);
    
    // Login frequency
    const loginActivity = activity.filter(a => a.action === 'login' || a.action === 'page_visit');
    const loginsByUser = loginActivity.reduce((acc, a) => {
      acc[a.user_email] = (acc[a.user_email] || 0) + 1;
      return acc;
    }, {});
    
    const avgLoginsPerUser = Object.values(loginsByUser).length > 0
      ? (Object.values(loginsByUser).reduce((a, b) => a + b, 0) / Object.values(loginsByUser).length).toFixed(1)
      : 0;
    
    return {
      totalUsers: users.length,
      activeUsers7d,
      activeUsers30d,
      engagementRate: users.length > 0 ? ((activeUsers30d / users.length) * 100).toFixed(1) : 0,
      segmentCounts,
      userSegments,
      dauTrend,
      hourlyData,
      topPerformers,
      providerTypeData,
      featureAdoptionData,
      topPages,
      cohortData,
      engagementDepth,
      avgLoginsPerUser,
      totalLogins: loginActivity.length
    };
  }, [users, activity, noteConversions, complianceAudits, selectedMetric]);

  return (
    <div className="space-y-6">
      {/* Top Stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <Badge className="bg-blue-600">{insights.engagementRate}%</Badge>
            </div>
            <p className="text-3xl font-bold text-gray-900">{insights.totalUsers}</p>
            <p className="text-sm text-gray-600">Total Users</p>
            <p className="text-xs text-blue-700 mt-1">{insights.activeUsers30d} active (30d)</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Activity className="w-8 h-8 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{insights.activeUsers7d}</p>
            <p className="text-sm text-gray-600">Active Users (7d)</p>
            <p className="text-xs text-green-700 mt-1">Weekly active</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{insights.segmentCounts['Power User'] || 0}</p>
            <p className="text-sm text-gray-600">Power Users</p>
            <p className="text-xs text-purple-700 mt-1">10+ actions/week</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Clock className="w-8 h-8 text-orange-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">{insights.segmentCounts['Inactive'] || 0}</p>
            <p className="text-sm text-gray-600">Inactive Users</p>
            <p className="text-xs text-orange-700 mt-1">Need re-engagement</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Active Users Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-600" />
              Daily Active Users (30 Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart data={insights.dauTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="dau" 
                  stroke="#3B82F6" 
                  strokeWidth={2}
                  dot={{ fill: '#3B82F6', r: 3 }}
                  name="Active Users"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Hourly Activity Pattern */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="w-5 h-5 text-green-600" />
              Activity by Hour
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={insights.hourlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="activity" fill="#10B981" name="Actions" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* User Segments */}
      <Card>
        <CardHeader>
          <CardTitle>User Segments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Object.entries(insights.segmentCounts).map(([segment, count]) => (
              <div key={segment} className="text-center p-4 bg-gray-50 rounded-lg border">
                <p className="text-2xl font-bold text-gray-900">{count}</p>
                <p className="text-sm text-gray-600">{segment}</p>
                <p className="text-xs text-gray-500 mt-1">
                  {((count / insights.totalUsers) * 100).toFixed(1)}%
                </p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Provider Type Distribution */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCheck className="w-5 h-5 text-blue-600" />
            Provider Type Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={insights.providerTypeData}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ type, percentage }) => `${type}: ${percentage}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="count"
                >
                  {insights.providerTypeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B', '#EF4444', '#EC4899', '#6366F1'][index % 7]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2">
              {insights.providerTypeData.map((item, idx) => (
                <div key={idx} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded">
                  <span className="text-sm font-medium">{item.type}</span>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{item.count} users</Badge>
                    <span className="text-xs text-gray-600">{item.percentage}%</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Feature Adoption Rates */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="w-5 h-5 text-purple-600" />
            Feature Adoption Rates
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={insights.featureAdoptionData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis type="number" domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} />
              <YAxis dataKey="feature" type="category" width={120} tick={{ fontSize: 12 }} />
              <Tooltip content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  return (
                    <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                      <p className="text-sm font-semibold">{payload[0].payload.feature}</p>
                      <p className="text-sm text-gray-700">{payload[0].payload.users} users ({payload[0].value}%)</p>
                    </div>
                  );
                }
                return null;
              }} />
              <Bar dataKey="rate" fill="#8B5CF6" radius={[0, 8, 8, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Top Pages by Traffic */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-green-600" />
            Most Visited Pages
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={insights.topPages}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="page" tick={{ fontSize: 11 }} angle={-45} textAnchor="end" height={100} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" fill="#10B981" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* User Retention by Cohort */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-orange-600" />
            Weekly Retention Cohorts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={insights.cohortData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="week" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="joined" stroke="#3B82F6" strokeWidth={2} name="Joined" />
              <Line type="monotone" dataKey="retained" stroke="#10B981" strokeWidth={2} name="Active Now" />
            </LineChart>
          </ResponsiveContainer>
          <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
            {insights.cohortData.slice(-4).map((cohort, idx) => (
              <div key={idx} className="text-center p-3 bg-gray-50 dark:bg-gray-800 rounded">
                <p className="text-xs text-gray-600 mb-1">{cohort.week}</p>
                <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{cohort.retentionRate}%</p>
                <p className="text-xs text-gray-500">{cohort.retained}/{cohort.joined} retained</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Engagement Depth Ranking */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-600" />
              User Engagement Depth
            </CardTitle>
            <Select value={sortBy} onValueChange={setSortBy}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="compliance">By Compliance</SelectItem>
                <SelectItem value="engagement">By Engagement</SelectItem>
                <SelectItem value="activity">By Activity</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white dark:bg-gray-900 border-b">
                <tr>
                  <th className="text-left p-3">User</th>
                  <th className="text-center p-3">Segment</th>
                  <th className="text-center p-3">Pages</th>
                  <th className="text-center p-3">Actions</th>
                  <th className="text-center p-3">Notes</th>
                  <th className="text-center p-3">Compliance</th>
                  <th className="text-center p-3">Engagement</th>
                </tr>
              </thead>
              <tbody>
                {insights.engagementDepth
                  .sort((a, b) => {
                    if (sortBy === 'compliance') return b.avgCompliance - a.avgCompliance;
                    if (sortBy === 'engagement') return b.engagementScore - a.engagementScore;
                    return b.activityCount - a.activityCount;
                  })
                  .map((user, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                      <td className="p-3">
                        <div>
                          <p className="font-medium text-sm">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge className={
                          user.segment === 'Power User' ? 'bg-purple-600' :
                          user.segment === 'Active' ? 'bg-blue-600' :
                          user.segment === 'Casual' ? 'bg-green-600' :
                          'bg-gray-600'
                        }>
                          {user.segment}
                        </Badge>
                      </td>
                      <td className="text-center p-3">{user.uniquePages}</td>
                      <td className="text-center p-3">{user.uniqueActions}</td>
                      <td className="text-center p-3">{user.conversions}</td>
                      <td className="text-center p-3">
                        <Badge className="bg-green-600">{user.avgCompliance || 0}%</Badge>
                      </td>
                      <td className="text-center p-3">
                        <div className="flex items-center justify-center gap-1">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div 
                              className="bg-blue-600 h-2 rounded-full"
                              style={{ width: `${Math.min((user.engagementScore / 100) * 100, 100)}%` }}
                            />
                          </div>
                          <span className="text-xs text-gray-600">{user.engagementScore}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Login & Session Analytics */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="w-5 h-5 text-indigo-600" />
            Login & Session Analytics
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-4 bg-indigo-50 dark:bg-indigo-950 rounded-lg">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{insights.totalLogins}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Total Sessions</p>
            </div>
            <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{insights.avgLoginsPerUser}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Avg per User</p>
            </div>
            <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{insights.activeUsers7d}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Weekly Active</p>
            </div>
            <div className="text-center p-4 bg-purple-50 dark:bg-purple-950 rounded-lg">
              <p className="text-2xl font-bold text-gray-900 dark:text-gray-100">{insights.activeUsers30d}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Monthly Active</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Top Performers */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Award className="w-5 h-5 text-yellow-600" />
            Top 10 Performers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Rank</th>
                  <th className="text-left p-3">User</th>
                  <th className="text-center p-3">Segment</th>
                  <th className="text-center p-3">Actions</th>
                  <th className="text-center p-3">Conversions</th>
                  <th className="text-center p-3">Avg Compliance</th>
                  <th className="text-left p-3">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {insights.topPerformers.map((user, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50 dark:hover:bg-gray-800">
                    <td className="p-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center font-bold text-white ${
                        idx === 0 ? 'bg-yellow-500' : idx === 1 ? 'bg-gray-400' : idx === 2 ? 'bg-orange-600' : 'bg-gray-300 text-gray-700'
                      }`}>
                        {idx + 1}
                      </div>
                    </td>
                    <td className="p-3">
                      <div>
                        <p className="font-medium">{user.name}</p>
                        <p className="text-xs text-gray-500">{user.email}</p>
                      </div>
                    </td>
                    <td className="text-center p-3">
                      <Badge className={
                        user.segment === 'Power User' ? 'bg-purple-600' :
                        user.segment === 'Active' ? 'bg-blue-600' :
                        user.segment === 'Casual' ? 'bg-green-600' :
                        'bg-gray-600'
                      }>
                        {user.segment}
                      </Badge>
                    </td>
                    <td className="text-center p-3">{user.activityCount}</td>
                    <td className="text-center p-3">{user.conversions}</td>
                    <td className="text-center p-3">
                      <Badge className="bg-green-600">{user.avgCompliance}%</Badge>
                    </td>
                    <td className="p-3 text-xs text-gray-600">
                      {user.lastActive ? formatEastern(user.lastActive, 'MMM d, h:mm a') : 'Never'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* All Users Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>All Users Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-white border-b">
                <tr>
                  <th className="text-left p-3">User</th>
                  <th className="text-center p-3">Segment</th>
                  <th className="text-center p-3">Activity</th>
                  <th className="text-left p-3">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {insights.userSegments
                  .sort((a, b) => b.activityCount - a.activityCount)
                  .map((user, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="p-3">
                        <div>
                          <p className="font-medium">{user.name}</p>
                          <p className="text-xs text-gray-500">{user.email}</p>
                        </div>
                      </td>
                      <td className="text-center p-3">
                        <Badge variant="outline" className={
                          user.segment === 'Power User' ? 'bg-purple-50 text-purple-700 border-purple-300' :
                          user.segment === 'Active' ? 'bg-blue-50 text-blue-700 border-blue-300' :
                          user.segment === 'Casual' ? 'bg-green-50 text-green-700 border-green-300' :
                          'bg-gray-50 text-gray-700 border-gray-300'
                        }>
                          {user.segment}
                        </Badge>
                      </td>
                      <td className="text-center p-3">{user.activityCount}</td>
                      <td className="p-3 text-xs text-gray-600">
                        {user.lastActive ? formatEastern(user.lastActive, 'MMM d, yyyy h:mm a') : 'Never'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}