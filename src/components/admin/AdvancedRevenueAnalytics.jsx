import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";
import { TrendingUp, TrendingDown, DollarSign, Users, Calendar, Target } from "lucide-react";

export default function AdvancedRevenueAnalytics({ subscriptions, payments }) {
  const analytics = useMemo(() => {
    const active = subscriptions.filter(s => s.status === 'active');
    const trialing = subscriptions.filter(s => s.status === 'trialing');
    const canceled = subscriptions.filter(s => s.status === 'canceled');
    const pastDue = subscriptions.filter(s => s.status === 'past_due');
    
    const totalMRR = active.reduce((sum, s) => sum + (s.monthly_amount || 0), 0);
    const totalARR = totalMRR * 12;
    
    // Calculate LTV (simplified)
    const avgSubscriptionLength = 12; // assume 12 months average
    const avgRevenuePerUser = active.length > 0 ? totalMRR / active.length : 0;
    const ltv = avgRevenuePerUser * avgSubscriptionLength;
    
    // Churn metrics
    const totalSubs = subscriptions.length;
    const churnRate = totalSubs > 0 ? (canceled.length / totalSubs) * 100 : 0;
    const retentionRate = 100 - churnRate;
    
    // Trial conversion
    const trialConversionRate = trialing.length > 0 
      ? ((active.filter(s => s.trial_end).length / trialing.length) * 100).toFixed(1)
      : 0;
    
    // Revenue by plan
    const planRevenue = active.reduce((acc, sub) => {
      const plan = sub.plan || 'Unknown';
      acc[plan] = (acc[plan] || 0) + (sub.monthly_amount || 0);
      return acc;
    }, {});
    
    const planDistribution = Object.entries(planRevenue).map(([name, value]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      value: parseFloat(value.toFixed(2)),
      percentage: ((value / totalMRR) * 100).toFixed(1)
    }));
    
    // 30-day trend
    const last30Days = Array.from({ length: 30 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (29 - i));
      return date.toISOString().split('T')[0];
    });
    
    const revenueByDay = last30Days.map(date => {
      const dayPayments = payments.filter(p => 
        p.payment_date && p.payment_date.startsWith(date) && p.status === 'succeeded'
      );
      return {
        date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        revenue: dayPayments.reduce((sum, p) => sum + (p.amount || 0), 0),
        payments: dayPayments.length
      };
    });
    
    // Cohort analysis - new subs per month
    const cohorts = subscriptions.reduce((acc, sub) => {
      if (!sub.created_date) return acc;
      const month = new Date(sub.created_date).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
      acc[month] = (acc[month] || 0) + 1;
      return acc;
    }, {});
    
    const cohortData = Object.entries(cohorts)
      .sort((a, b) => new Date(a[0]) - new Date(b[0]))
      .slice(-6)
      .map(([month, count]) => ({ month, newSubs: count }));
    
    return {
      totalMRR,
      totalARR,
      ltv,
      avgRevenuePerUser,
      churnRate,
      retentionRate,
      trialConversionRate,
      activeSubs: active.length,
      trialingSubs: trialing.length,
      canceledSubs: canceled.length,
      pastDueSubs: pastDue.length,
      planDistribution,
      revenueByDay,
      cohortData
    };
  }, [subscriptions, payments]);

  const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6'];

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-br from-green-50 to-green-100 border-green-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <DollarSign className="w-8 h-8 text-green-600" />
              <TrendingUp className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-3xl font-bold text-gray-900">${analytics.totalMRR.toFixed(2)}</p>
            <p className="text-sm text-gray-600">Monthly Recurring Revenue</p>
            <p className="text-xs text-green-700 mt-1">${analytics.totalARR.toFixed(2)} ARR</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Users className="w-8 h-8 text-blue-600" />
              <Badge className="bg-blue-600">{analytics.retentionRate.toFixed(1)}%</Badge>
            </div>
            <p className="text-3xl font-bold text-gray-900">${analytics.avgRevenuePerUser.toFixed(2)}</p>
            <p className="text-sm text-gray-600">Avg Revenue Per User</p>
            <p className="text-xs text-blue-700 mt-1">${analytics.ltv.toFixed(2)} LTV</p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Target className="w-8 h-8 text-purple-600" />
              {analytics.trialConversionRate > 50 ? (
                <TrendingUp className="w-5 h-5 text-green-600" />
              ) : (
                <TrendingDown className="w-5 h-5 text-red-600" />
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">{analytics.trialConversionRate}%</p>
            <p className="text-sm text-gray-600">Trial Conversion Rate</p>
            <p className="text-xs text-purple-700 mt-1">{analytics.trialingSubs} in trial</p>
          </CardContent>
        </Card>

        <Card className={analytics.churnRate > 10 ? 'bg-gradient-to-br from-red-50 to-red-100 border-red-200' : 'bg-gradient-to-br from-orange-50 to-orange-100 border-orange-200'}>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <Calendar className="w-8 h-8 text-orange-600" />
              {analytics.churnRate < 5 ? (
                <TrendingDown className="w-5 h-5 text-green-600" />
              ) : (
                <TrendingUp className="w-5 h-5 text-red-600" />
              )}
            </div>
            <p className="text-3xl font-bold text-gray-900">{analytics.churnRate.toFixed(1)}%</p>
            <p className="text-sm text-gray-600">Churn Rate</p>
            <p className="text-xs text-orange-700 mt-1">{analytics.canceledSubs} canceled</p>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-green-600" />
            30-Day Revenue Trend
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={analytics.revenueByDay}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip 
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    return (
                      <div className="bg-white p-3 border border-gray-200 rounded shadow-lg">
                        <p className="text-sm font-semibold">{payload[0].payload.date}</p>
                        <p className="text-sm text-green-600">Revenue: ${payload[0].value.toFixed(2)}</p>
                        <p className="text-xs text-gray-500">{payload[0].payload.payments} payments</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="revenue" 
                stroke="#10B981" 
                strokeWidth={3}
                dot={{ fill: '#10B981', r: 4 }}
                name="Revenue ($)"
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Plan Distribution */}
        <Card>
          <CardHeader>
            <CardTitle>Revenue by Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={analytics.planDistribution}
                  cx="50%"
                  cy="50%"
                  labelLine={false}
                  label={({ name, percentage }) => `${name}: ${percentage}%`}
                  outerRadius={80}
                  fill="#8884d8"
                  dataKey="value"
                >
                  {analytics.planDistribution.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* New Subscriber Cohorts */}
        <Card>
          <CardHeader>
            <CardTitle>New Subscribers (Last 6 Months)</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={analytics.cohortData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Legend />
                <Bar dataKey="newSubs" fill="#3B82F6" name="New Subscribers" radius={[8, 8, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Plan Breakdown Table */}
      <Card>
        <CardHeader>
          <CardTitle>Plan Performance Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left p-3">Plan</th>
                  <th className="text-center p-3">MRR</th>
                  <th className="text-center p-3">% of Total</th>
                  <th className="text-center p-3">Subscribers</th>
                </tr>
              </thead>
              <tbody>
                {analytics.planDistribution.map((plan, idx) => (
                  <tr key={idx} className="border-b hover:bg-gray-50">
                    <td className="p-3 font-medium">{plan.name}</td>
                    <td className="text-center p-3 font-semibold text-green-600">${plan.value.toFixed(2)}</td>
                    <td className="text-center p-3">
                      <Badge variant="outline">{plan.percentage}%</Badge>
                    </td>
                    <td className="text-center p-3">
                      {subscriptions.filter(s => s.status === 'active' && s.plan === plan.name.toLowerCase()).length}
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