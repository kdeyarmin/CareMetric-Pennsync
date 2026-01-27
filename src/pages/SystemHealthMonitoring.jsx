import React, { useState, useEffect } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, BarChart, Bar } from 'recharts';
import { AlertCircle, Activity, TrendingUp, CheckCircle2 } from 'lucide-react';

export default function SystemHealthMonitoring() {
  const [timeRange, setTimeRange] = useState('24h');

  // Fetch health metrics
  const { data: metrics, isLoading: metricsLoading } = useQuery({
    queryKey: ['systemMetrics', timeRange],
    queryFn: async () => {
      const cutoffDate = new Date();
      if (timeRange === '24h') cutoffDate.setHours(cutoffDate.getHours() - 24);
      else if (timeRange === '7d') cutoffDate.setDate(cutoffDate.getDate() - 7);
      else if (timeRange === '30d') cutoffDate.setDate(cutoffDate.getDate() - 30);

      return base44.entities.SystemHealthMetric.filter({
        timestamp: { $gte: cutoffDate.toISOString() }
      });
    }
  });

  const criticalMetrics = metrics?.filter(m => m.status === 'critical') || [];
  const warningMetrics = metrics?.filter(m => m.status === 'warning') || [];
  const healthyMetrics = metrics?.filter(m => m.status === 'healthy') || [];

  // Group metrics by service
  const metricsByService = metrics?.reduce((acc, metric) => {
    if (!acc[metric.service]) acc[metric.service] = [];
    acc[metric.service].push(metric);
    return acc;
  }, {}) || {};

  // Prepare chart data
  const chartData = metrics?.slice(-20).map(m => ({
    timestamp: new Date(m.timestamp).toLocaleTimeString(),
    value: m.value,
    service: m.service
  })) || [];

  const getStatusColor = (status) => {
    switch (status) {
      case 'critical': return 'bg-red-100 text-red-800';
      case 'warning': return 'bg-yellow-100 text-yellow-800';
      default: return 'bg-green-100 text-green-800';
    }
  };

  const getStatusIcon = (status) => {
    if (status === 'critical') return <AlertCircle className="w-4 h-4" />;
    if (status === 'warning') return <TrendingUp className="w-4 h-4" />;
    return <CheckCircle2 className="w-4 h-4" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">System Health Monitoring</h1>
            <p className="text-gray-600 mt-2">Real-time performance and health metrics</p>
          </div>
          <div className="flex gap-2">
            {['24h', '7d', '30d'].map(range => (
              <Button
                key={range}
                variant={timeRange === range ? 'default' : 'outline'}
                onClick={() => setTimeRange(range)}
              >
                {range}
              </Button>
            ))}
          </div>
        </div>

        {/* Status Summary */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-500" />
                Critical Issues
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-red-600">{criticalMetrics.length}</p>
              <p className="text-sm text-gray-600 mt-1">Requiring immediate attention</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-yellow-500" />
                Warnings
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-yellow-600">{warningMetrics.length}</p>
              <p className="text-sm text-gray-600 mt-1">Monitor closely</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-green-500" />
                Healthy
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold text-green-600">{healthyMetrics.length}</p>
              <p className="text-sm text-gray-600 mt-1">Operating normally</p>
            </CardContent>
          </Card>
        </div>

        {/* Critical Alerts */}
        {criticalMetrics.length > 0 && (
          <Alert className="border-red-500 bg-red-50">
            <AlertCircle className="h-4 w-4 text-red-600" />
            <AlertDescription className="text-red-800">
              <strong>{criticalMetrics.length} critical issues detected</strong>
              <div className="mt-2 space-y-1 text-sm">
                {criticalMetrics.slice(0, 3).map((m, i) => (
                  <div key={i}>{m.service} - {m.metric_type}: {m.value}{m.unit}</div>
                ))}
                {criticalMetrics.length > 3 && <div>+{criticalMetrics.length - 3} more...</div>}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {/* Performance Chart */}
        <Card>
          <CardHeader>
            <CardTitle>Performance Over Time</CardTitle>
            <CardDescription>API and service response times</CardDescription>
          </CardHeader>
          <CardContent>
            {chartData.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timestamp" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Line type="monotone" dataKey="value" stroke="#3b82f6" name="Response Time (ms)" />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-500 text-center py-8">No data available</p>
            )}
          </CardContent>
        </Card>

        {/* Metrics by Service */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {Object.entries(metricsByService).map(([service, serviceMetrics]) => (
            <Card key={service}>
              <CardHeader>
                <CardTitle className="text-lg">{service}</CardTitle>
                <CardDescription>Service health metrics</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {serviceMetrics.slice(0, 5).map((metric, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      {getStatusIcon(metric.status)}
                      <div>
                        <p className="font-medium text-sm">{metric.metric_type}</p>
                        <p className="text-xs text-gray-600">{metric.value}{metric.unit}</p>
                      </div>
                    </div>
                    <Badge className={getStatusColor(metric.status)}>
                      {metric.status}
                    </Badge>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}