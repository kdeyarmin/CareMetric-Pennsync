import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, LineChart, Line } from "recharts";
import { Users, TrendingUp, Activity, Clock, Award, Target } from "lucide-react";
import { formatEastern } from "@/components/utils/timezone";

export default function UserInsightsDashboard({ users, activity, noteConversions, complianceAudits }) {
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
    
    return {
      totalUsers: users.length,
      activeUsers7d,
      activeUsers30d,
      engagementRate: users.length > 0 ? ((activeUsers30d / users.length) * 100).toFixed(1) : 0,
      segmentCounts,
      userSegments,
      dauTrend,
      hourlyData,
      topPerformers
    };
  }, [users, activity, noteConversions, complianceAudits]);

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
                  <tr key={idx} className="border-b hover:bg-gray-50">
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