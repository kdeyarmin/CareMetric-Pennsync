import React, { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DollarSign, TrendingUp, TrendingDown, Users, CreditCard,
  Download, Calendar, AlertCircle, CheckCircle2, XCircle,
  Target, BarChart3, PieChart as PieChartIcon, Activity
} from "lucide-react";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  AreaChart, Area
} from "recharts";
import { formatEastern } from "@/components/utils/timezone";

export default function SubscriptionAnalyticsDashboard({ subscriptions = [], payments = [], users = [], activity = [], complianceAudits = [] }) {
  const [timeframe, setTimeframe] = useState("30");
  const [exportFormat, setExportFormat] = useState("csv");

  // Calculate comprehensive subscription metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const daysAgo = parseInt(timeframe);
    const cutoffDate = new Date(now.getTime() - daysAgo * 24 * 60 * 60 * 1000);

    // Active subscriptions
    const active = subscriptions.filter(s => s.status === 'active' || s.status === 'trialing');
    const canceled = subscriptions.filter(s => s.status === 'canceled');
    const pastDue = subscriptions.filter(s => s.status === 'past_due');
    const lifetimeFree = subscriptions.filter(s => s.status === 'lifetime_free');

    // MRR calculation
    const mrr = active.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);

    // Revenue calculations
    const recentPayments = payments.filter(p => 
      p.payment_date && new Date(p.payment_date) >= cutoffDate
    );
    const totalRevenue = recentPayments
      .filter(p => p.status === 'succeeded')
      .reduce((sum, p) => sum + (p.amount || 0), 0);
    
    const failedRevenue = recentPayments
      .filter(p => p.status === 'failed')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    // Churn calculations
    const recentCancellations = subscriptions.filter(s => 
      s.canceled_at && new Date(s.canceled_at) >= cutoffDate
    );
    const churnRate = active.length > 0 
      ? ((recentCancellations.length / (active.length + recentCancellations.length)) * 100).toFixed(2)
      : 0;

    // LTV calculation (simple: MRR * average customer lifetime in months)
    const avgLifetimeMonths = 24; // Industry standard assumption
    const ltv = active.length > 0 
      ? (mrr / active.length) * avgLifetimeMonths
      : 0;

    // ARPU (Average Revenue Per User)
    const arpu = active.length > 0 ? mrr / active.length : 0;

    // New subscriptions in timeframe
    const newSubs = subscriptions.filter(s => 
      s.created_date && new Date(s.created_date) >= cutoffDate
    );

    // Growth rate
    const previousPeriodStart = new Date(cutoffDate.getTime() - daysAgo * 24 * 60 * 60 * 1000);
    const previousPeriodSubs = subscriptions.filter(s =>
      s.created_date && 
      new Date(s.created_date) >= previousPeriodStart &&
      new Date(s.created_date) < cutoffDate
    );
    const growthRate = previousPeriodSubs.length > 0
      ? (((newSubs.length - previousPeriodSubs.length) / previousPeriodSubs.length) * 100).toFixed(2)
      : 0;

    // Renewal rate
    const renewals = subscriptions.filter(s =>
      s.current_period_start && 
      new Date(s.current_period_start) >= cutoffDate &&
      s.status === 'active'
    );
    const renewalRate = active.length > 0 
      ? ((renewals.length / active.length) * 100).toFixed(2)
      : 0;

    return {
      mrr,
      totalRevenue,
      failedRevenue,
      activeCount: active.length,
      canceledCount: canceled.length,
      pastDueCount: pastDue.length,
      lifetimeFreeCount: lifetimeFree.length,
      churnRate,
      ltv,
      arpu,
      newSubscriptions: newSubs.length,
      growthRate,
      renewalRate,
      totalSubscriptions: subscriptions.length
    };
  }, [subscriptions, payments, timeframe]);

  // MRR Trend over time
  const mrrTrend = useMemo(() => {
    const days = parseInt(timeframe);
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const activeSubs = subscriptions.filter(s => {
        const startDate = s.created_date ? new Date(s.created_date) : null;
        const endDate = s.canceled_at ? new Date(s.canceled_at) : null;
        
        return startDate && startDate <= date && (!endDate || endDate > date) &&
               (s.status === 'active' || s.status === 'trialing');
      });

      const dayMrr = activeSubs.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);

      trend.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        mrr: dayMrr,
        count: activeSubs.length
      });
    }

    return trend;
  }, [subscriptions, timeframe]);

  // Revenue by plan
  const revenueByPlan = useMemo(() => {
    const planRevenue = {};
    
    payments.filter(p => p.status === 'succeeded').forEach(payment => {
      const plan = payment.plan_name || 'Unknown';
      planRevenue[plan] = (planRevenue[plan] || 0) + (payment.amount || 0);
    });

    return Object.entries(planRevenue)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [payments]);

  // Subscription status distribution
  const statusDistribution = useMemo(() => {
    const statusCounts = subscriptions.reduce((acc, sub) => {
      const status = sub.status || 'unknown';
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});

    const colors = {
      active: '#10B981',
      trialing: '#3B82F6',
      canceled: '#EF4444',
      past_due: '#F59E0B',
      lifetime_free: '#8B5CF6',
      unpaid: '#DC2626',
      incomplete: '#94A3B8'
    };

    return Object.entries(statusCounts).map(([status, count]) => ({
      name: status.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()),
      value: count,
      color: colors[status] || '#6B7280'
    }));
  }, [subscriptions]);

  // User activity trend
  const userActivityTrend = useMemo(() => {
    const days = parseInt(timeframe);
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayActivity = activity.filter(a =>
        a.created_date && a.created_date.startsWith(dateStr)
      );

      const uniqueUsers = new Set(dayActivity.map(a => a.user_email)).size;

      trend.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        activities: dayActivity.length,
        users: uniqueUsers
      });
    }

    return trend;
  }, [activity, timeframe]);

  // Compliance trend
  const complianceTrend = useMemo(() => {
    const days = parseInt(timeframe);
    const trend = [];

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];

      const dayAudits = complianceAudits.filter(a =>
        a.audit_date && a.audit_date.startsWith(dateStr)
      );

      const avgScore = dayAudits.length > 0
        ? dayAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / dayAudits.length
        : null;

      trend.push({
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        score: avgScore ? Math.round(avgScore) : null,
        count: dayAudits.length
      });
    }

    return trend;
  }, [complianceAudits, timeframe]);

  // Export data function
  const handleExport = () => {
    const data = {
      generated_at: new Date().toISOString(),
      timeframe_days: timeframe,
      metrics: {
        mrr: metrics.mrr,
        total_revenue: metrics.totalRevenue,
        failed_revenue: metrics.failedRevenue,
        active_subscriptions: metrics.activeCount,
        canceled_subscriptions: metrics.canceledCount,
        churn_rate: metrics.churnRate,
        ltv: metrics.ltv,
        arpu: metrics.arpu,
        new_subscriptions: metrics.newSubscriptions,
        growth_rate: metrics.growthRate,
        renewal_rate: metrics.renewalRate
      },
      subscriptions: subscriptions,
      payments: payments,
      mrr_trend: mrrTrend,
      revenue_by_plan: revenueByPlan,
      status_distribution: statusDistribution
    };

    if (exportFormat === 'json') {
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `subscription-analytics-${new Date().toISOString().split('T')[0]}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } else {
      // CSV export
      const csvRows = [
        ['Metric', 'Value'],
        ['MRR', `$${metrics.mrr.toFixed(2)}`],
        ['Total Revenue', `$${metrics.totalRevenue.toFixed(2)}`],
        ['Failed Revenue', `$${metrics.failedRevenue.toFixed(2)}`],
        ['Active Subscriptions', metrics.activeCount],
        ['Canceled Subscriptions', metrics.canceledCount],
        ['Churn Rate', `${metrics.churnRate}%`],
        ['LTV', `$${metrics.ltv.toFixed(2)}`],
        ['ARPU', `$${metrics.arpu.toFixed(2)}`],
        ['New Subscriptions', metrics.newSubscriptions],
        ['Growth Rate', `${metrics.growthRate}%`],
        ['Renewal Rate', `${metrics.renewalRate}%`]
      ];

      const csv = csvRows.map(row => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `subscription-metrics-${new Date().toISOString().split('T')[0]}.csv`;
      link.click();
      URL.revokeObjectURL(url);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header with Controls */}
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-blue-600" />
            Subscription Analytics
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Comprehensive revenue, growth, and retention metrics
          </p>
        </div>
        <div className="flex gap-2">
          <Select value={timeframe} onValueChange={setTimeframe}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="7">7 Days</SelectItem>
              <SelectItem value="30">30 Days</SelectItem>
              <SelectItem value="90">90 Days</SelectItem>
              <SelectItem value="365">1 Year</SelectItem>
            </SelectContent>
          </Select>
          <Select value={exportFormat} onValueChange={setExportFormat}>
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="csv">CSV</SelectItem>
              <SelectItem value="json">JSON</SelectItem>
            </SelectContent>
          </Select>
          <Button onClick={handleExport} className="gap-2">
            <Download className="w-4 h-4" />
            Export
          </Button>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-green-600" />
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">${metrics.mrr.toFixed(2)}</p>
            <p className="text-xs text-gray-600">Monthly Recurring Revenue</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <Badge className="bg-blue-600">{metrics.activeCount}</Badge>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.activeCount}</p>
            <p className="text-xs text-gray-600">Active Subscribers</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8 text-purple-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">${metrics.ltv.toFixed(2)}</p>
            <p className="text-xs text-gray-600">Customer LTV</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <TrendingDown className="w-8 h-8 text-orange-600" />
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.churnRate}%</p>
            <p className="text-xs text-gray-600">Churn Rate ({timeframe}d)</p>
          </CardContent>
        </Card>
      </div>

      {/* Secondary Metrics */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-gray-600" />
              <p className="text-sm font-medium text-gray-600">ARPU</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">${metrics.arpu.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Per subscriber/month</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-gray-600" />
              <p className="text-sm font-medium text-gray-600">Growth Rate</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.growthRate}%</p>
            <p className="text-xs text-gray-500">vs previous period</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CheckCircle2 className="w-5 h-5 text-gray-600" />
              <p className="text-sm font-medium text-gray-600">Renewal Rate</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">{metrics.renewalRate}%</p>
            <p className="text-xs text-gray-500">Successful renewals</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="w-5 h-5 text-gray-600" />
              <p className="text-sm font-medium text-gray-600">Total Revenue</p>
            </div>
            <p className="text-2xl font-bold text-gray-900">${metrics.totalRevenue.toFixed(2)}</p>
            <p className="text-xs text-gray-500">Last {timeframe} days</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* MRR Trend Chart */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <TrendingUp className="w-5 h-5 text-green-600" />
              MRR Trend ({timeframe} Days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={mrrTrend}>
                <defs>
                  <linearGradient id="mrrGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip 
                  content={({ active, payload }) => {
                    if (active && payload?.length) {
                      return (
                        <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                          <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                          <p className="text-sm text-green-600">MRR: ${payload[0].value.toFixed(2)}</p>
                          <p className="text-xs text-gray-500">{payload[0].payload.count} active subs</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area 
                  type="monotone" 
                  dataKey="mrr" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  fill="url(#mrrGradient)"
                  name="MRR"
                />
              </AreaChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Status Distribution */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PieChartIcon className="w-5 h-5 text-blue-600" />
              Subscription Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={statusDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
                  outerRadius={100}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {statusDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue by Plan */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <BarChart3 className="w-5 h-5 text-purple-600" />
              Revenue by Plan (All Time)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={revenueByPlan}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="name" 
                  tick={{ fontSize: 11 }}
                  angle={-15}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip 
                  formatter={(value) => `$${value.toFixed(2)}`}
                  labelStyle={{ color: '#000' }}
                />
                <Bar 
                  dataKey="value" 
                  fill="#8B5CF6" 
                  radius={[8, 8, 0, 0]}
                  name="Revenue"
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* User Activity Trend */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Activity className="w-5 h-5 text-blue-600" />
              User Activity Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={userActivityTrend}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis 
                  dataKey="date" 
                  tick={{ fontSize: 11 }}
                  interval="preserveStartEnd"
                />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line 
                  yAxisId="left"
                  type="monotone" 
                  dataKey="activities" 
                  stroke="#3B82F6" 
                  strokeWidth={2}
                  name="Activities"
                />
                <Line 
                  yAxisId="right"
                  type="monotone" 
                  dataKey="users" 
                  stroke="#10B981" 
                  strokeWidth={2}
                  name="Active Users"
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Compliance Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            Compliance Score Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={complianceTrend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 11 }}
                interval="preserveStartEnd"
              />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload?.length && payload[0].value !== null) {
                    return (
                      <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                        <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                        <p className="text-sm text-green-600">Score: {payload[0].value}%</p>
                        <p className="text-xs text-gray-500">{payload[0].payload.count} audits</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="score" 
                stroke="#10B981" 
                strokeWidth={3}
                dot={{ fill: '#10B981', r: 4 }}
                name="Compliance Score"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Subscription Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Subscription Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-green-50 border border-green-200 rounded-lg">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <span className="text-sm font-medium">Active</span>
              </div>
              <Badge className="bg-green-600">{metrics.activeCount}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-blue-600" />
                <span className="text-sm font-medium">New ({timeframe}d)</span>
              </div>
              <Badge className="bg-blue-600">{metrics.newSubscriptions}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-orange-600" />
                <span className="text-sm font-medium">Past Due</span>
              </div>
              <Badge className="bg-orange-600">{metrics.pastDueCount}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-red-50 border border-red-200 rounded-lg">
              <div className="flex items-center gap-2">
                <XCircle className="w-5 h-5 text-red-600" />
                <span className="text-sm font-medium">Canceled</span>
              </div>
              <Badge className="bg-red-600">{metrics.canceledCount}</Badge>
            </div>
            <div className="flex items-center justify-between p-3 bg-purple-50 border border-purple-200 rounded-lg">
              <div className="flex items-center gap-2">
                <Users className="w-5 h-5 text-purple-600" />
                <span className="text-sm font-medium">Lifetime Free</span>
              </div>
              <Badge className="bg-purple-600">{metrics.lifetimeFreeCount}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Financial Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm font-medium">Total Revenue ({timeframe}d)</span>
              <span className="text-lg font-bold text-green-600">${metrics.totalRevenue.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm font-medium">Failed Revenue</span>
              <span className="text-lg font-bold text-red-600">${metrics.failedRevenue.toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm font-medium">ARR (Projected)</span>
              <span className="text-lg font-bold text-blue-600">${(metrics.mrr * 12).toFixed(2)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200 rounded-lg">
              <span className="text-sm font-medium">Total Subscribers</span>
              <span className="text-lg font-bold text-gray-900">{metrics.totalSubscriptions}</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Active Subscriptions Details */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-blue-600" />
            Active Subscriptions Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left p-2">User</th>
                  <th className="text-center p-2">Status</th>
                  <th className="text-center p-2">Plan</th>
                  <th className="text-center p-2">MRR</th>
                  <th className="text-left p-2">Started</th>
                  <th className="text-left p-2">Next Billing</th>
                </tr>
              </thead>
              <tbody>
                {subscriptions
                  .filter(s => s.status === 'active' || s.status === 'trialing')
                  .slice(0, 20)
                  .map((sub, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50">
                      <td className="p-2 text-xs">{sub.user_email}</td>
                      <td className="text-center p-2">
                        <Badge className={sub.status === 'active' ? 'bg-green-600' : 'bg-blue-600'}>
                          {sub.status}
                        </Badge>
                      </td>
                      <td className="text-center p-2 text-xs">{sub.plan_name || 'N/A'}</td>
                      <td className="text-center p-2 font-semibold">${(sub.monthly_amount || 0).toFixed(2)}</td>
                      <td className="p-2 text-xs">
                        {sub.created_date ? formatEastern(sub.created_date, 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="p-2 text-xs">
                        {sub.current_period_end ? formatEastern(sub.current_period_end, 'MMM d, yyyy') : 'N/A'}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
            {subscriptions.filter(s => s.status === 'active' || s.status === 'trialing').length === 0 && (
              <p className="text-center text-gray-500 py-8">No active subscriptions</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}