import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { TrendingUp, DollarSign, Calendar, Target } from 'lucide-react';

export default function RevenueForecasting() {
  const { data: pdgmRecords } = useQuery({
    queryKey: ['pdgm-all'],
    queryFn: () => base44.entities.PDGMCaseMix.filter({})
  });

  const { data: billing } = useQuery({
    queryKey: ['billing-all'],
    queryFn: () => base44.entities.Billing.filter({})
  });

  // Group by month
  const monthlyData = pdgmRecords?.reduce((acc, record) => {
    const month = record.period_start_date?.substring(0, 7) || 'Unknown';
    if (!acc[month]) {
      acc[month] = {
        month,
        estimated_revenue: 0,
        actual_revenue: 0,
        episodes: 0,
        avg_case_mix: 0
      };
    }
    acc[month].estimated_revenue += record.estimated_payment || 0;
    acc[month].episodes += 1;
    acc[month].avg_case_mix += record.case_mix_weight || 0;
    return acc;
  }, {}) || {};

  // Add actual revenue from billing
  billing?.forEach(bill => {
    const month = bill.billing_period_start?.substring(0, 7);
    if (monthlyData[month]) {
      monthlyData[month].actual_revenue += bill.total_paid || 0;
    }
  });

  // Calculate averages
  Object.values(monthlyData).forEach(data => {
    if (data.episodes > 0) {
      data.avg_case_mix = data.avg_case_mix / data.episodes;
    }
  });

  const chartData = Object.values(monthlyData).sort((a, b) => 
    a.month.localeCompare(b.month)
  );

  // Simple forecast for next 3 months
  if (chartData.length >= 3) {
    const lastThree = chartData.slice(-3);
    const avgRevenue = lastThree.reduce((sum, d) => sum + d.estimated_revenue, 0) / 3;
    const avgGrowth = 1.05; // 5% growth assumption

    for (let i = 1; i <= 3; i++) {
      const lastMonth = chartData[chartData.length - 1].month;
      const nextMonth = new Date(lastMonth + '-01');
      nextMonth.setMonth(nextMonth.getMonth() + i);
      const nextMonthStr = nextMonth.toISOString().substring(0, 7);

      chartData.push({
        month: nextMonthStr,
        estimated_revenue: avgRevenue * Math.pow(avgGrowth, i),
        actual_revenue: null,
        episodes: Math.round(lastThree[lastThree.length - 1].episodes * avgGrowth),
        avg_case_mix: lastThree[lastThree.length - 1].avg_case_mix,
        is_forecast: true
      });
    }
  }

  const totalEstimated = chartData.reduce((sum, d) => sum + (d.estimated_revenue || 0), 0);
  const totalActual = chartData.reduce((sum, d) => sum + (d.actual_revenue || 0), 0);
  const variance = totalActual > 0 ? ((totalActual - totalEstimated) / totalEstimated) * 100 : 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-lg">
                <DollarSign className="h-5 w-5 text-blue-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalEstimated.toLocaleString()}</p>
                <p className="text-xs text-slate-600">Total Estimated</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-green-100 rounded-lg">
                <Target className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <p className="text-2xl font-bold">${totalActual.toLocaleString()}</p>
                <p className="text-xs text-slate-600">Total Actual</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className={`p-3 rounded-lg ${variance >= 0 ? 'bg-green-100' : 'bg-red-100'}`}>
                <TrendingUp className={`h-5 w-5 ${variance >= 0 ? 'text-green-600' : 'text-red-600'}`} />
              </div>
              <div>
                <p className="text-2xl font-bold">{variance >= 0 ? '+' : ''}{variance.toFixed(1)}%</p>
                <p className="text-xs text-slate-600">Variance</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Revenue Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Revenue Trend & Forecast</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip 
                formatter={(value) => `$${value?.toLocaleString()}`}
                labelFormatter={(label) => {
                  const data = chartData.find(d => d.month === label);
                  return data?.is_forecast ? `${label} (Forecast)` : label;
                }}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="estimated_revenue" 
                stroke="#3b82f6" 
                strokeWidth={2}
                name="Estimated"
              />
              <Line 
                type="monotone" 
                dataKey="actual_revenue" 
                stroke="#10b981" 
                strokeWidth={2}
                name="Actual"
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Episode Volume */}
      <Card>
        <CardHeader>
          <CardTitle>Monthly Episode Volume</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="episodes" fill="#8b5cf6" name="Episodes" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}