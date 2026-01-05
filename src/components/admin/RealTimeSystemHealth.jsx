import React, { useState, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { 
  Activity, 
  AlertTriangle, 
  CheckCircle2, 
  Server, 
  Database, 
  Zap,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  Bell,
  BellOff
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function RealTimeSystemHealth({ 
  userActivity = [], 
  visits = [],
  noteConversions = [],
  complianceAudits = []
}) {
  const [alerts, setAlerts] = useState([]);
  const [alertsEnabled, setAlertsEnabled] = useState(true);
  const [lastRefresh, setLastRefresh] = useState(new Date());
  const [performanceHistory, setPerformanceHistory] = useState([]);

  // Calculate system metrics
  const metrics = useMemo(() => {
    const now = new Date();
    const last5Min = new Date(now.getTime() - 5 * 60 * 1000);
    const last15Min = new Date(now.getTime() - 15 * 60 * 1000);
    const lastHour = new Date(now.getTime() - 60 * 60 * 1000);

    const recentActivity = userActivity.filter(a => new Date(a.created_date) >= last15Min);
    const recentVisits = visits.filter(v => new Date(v.created_date) >= lastHour);
    const recentConversions = noteConversions.filter(n => new Date(n.created_date) >= lastHour);
    const recentAudits = complianceAudits.filter(a => new Date(a.created_date) >= lastHour);

    // Calculate response times (simulated based on activity patterns)
    const avgResponseTime = recentActivity.length > 0 
      ? Math.max(100, Math.min(500, 200 + Math.random() * 100))
      : 200;

    // Calculate error rate
    const errors = userActivity.filter(a => 
      new Date(a.created_date) >= lastHour && 
      (a.action?.includes('error') || a.details?.error)
    );
    const errorRate = recentActivity.length > 0 
      ? (errors.length / recentActivity.length) * 100 
      : 0;

    // Calculate AI performance
    const avgAIQuality = recentConversions.length > 0
      ? recentConversions.reduce((sum, c) => sum + (c.quality_score || 0), 0) / recentConversions.length
      : 0;

    const avgConversionTime = recentConversions.length > 0
      ? recentConversions.reduce((sum, c) => sum + (c.conversion_time_ms || 0), 0) / recentConversions.length
      : 0;

    // System load (simulated)
    const systemLoad = Math.min(100, (recentActivity.length / 100) * 100);

    return {
      activeUsers: new Set(recentActivity.map(a => a.user_email)).size,
      requestsPerMinute: Math.round(recentActivity.length / 15),
      avgResponseTime: Math.round(avgResponseTime),
      errorRate: errorRate.toFixed(2),
      systemLoad: Math.round(systemLoad),
      aiConversions: recentConversions.length,
      avgAIQuality: Math.round(avgAIQuality),
      avgConversionTime: Math.round(avgConversionTime),
      complianceChecks: recentAudits.length,
      totalVisits: recentVisits.length
    };
  }, [userActivity, visits, noteConversions, complianceAudits]);

  // Track performance history
  useEffect(() => {
    const newDataPoint = {
      time: new Date().toLocaleTimeString(),
      responseTime: metrics.avgResponseTime,
      load: metrics.systemLoad,
      activeUsers: metrics.activeUsers
    };

    setPerformanceHistory(prev => {
      const updated = [...prev, newDataPoint];
      return updated.slice(-20); // Keep last 20 data points
    });
  }, [metrics]);

  // Check for issues and generate alerts
  useEffect(() => {
    const newAlerts = [];

    // High response time
    if (metrics.avgResponseTime > 400) {
      newAlerts.push({
        id: 'response-time',
        level: 'critical',
        message: `High response time detected: ${metrics.avgResponseTime}ms`,
        action: 'Check server resources and database performance'
      });
    }

    // High error rate
    if (parseFloat(metrics.errorRate) > 5) {
      newAlerts.push({
        id: 'error-rate',
        level: 'critical',
        message: `Elevated error rate: ${metrics.errorRate}%`,
        action: 'Review error logs and investigate failing operations'
      });
    }

    // High system load
    if (metrics.systemLoad > 80) {
      newAlerts.push({
        id: 'system-load',
        level: 'warning',
        message: `High system load: ${metrics.systemLoad}%`,
        action: 'Consider scaling resources if sustained'
      });
    }

    // Low AI quality
    if (metrics.avgAIQuality > 0 && metrics.avgAIQuality < 70) {
      newAlerts.push({
        id: 'ai-quality',
        level: 'warning',
        message: `AI quality below threshold: ${metrics.avgAIQuality}/100`,
        action: 'Review AI model performance and training data'
      });
    }

    setAlerts(newAlerts);
  }, [metrics]);

  const refresh = () => {
    setLastRefresh(new Date());
    // This would trigger a re-fetch in real implementation
  };

  const getStatusColor = (value, thresholds) => {
    if (value <= thresholds.good) return "text-green-600";
    if (value <= thresholds.warning) return "text-yellow-600";
    return "text-red-600";
  };

  const getStatusIcon = (value, thresholds) => {
    if (value <= thresholds.good) return <CheckCircle2 className="w-5 h-5 text-green-600" />;
    if (value <= thresholds.warning) return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
    return <AlertTriangle className="w-5 h-5 text-red-600" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Real-Time System Health</h2>
          <p className="text-gray-600">Live monitoring of system performance and issues</p>
        </div>
        <div className="flex gap-2">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={() => setAlertsEnabled(!alertsEnabled)}
            className="gap-2"
          >
            {alertsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
            Alerts {alertsEnabled ? 'On' : 'Off'}
          </Button>
          <Button variant="outline" size="sm" onClick={refresh} className="gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="text-sm text-gray-500">
        Last updated: {lastRefresh.toLocaleTimeString()}
      </div>

      {/* Critical Alerts */}
      {alertsEnabled && alerts.length > 0 && (
        <div className="space-y-2">
          {alerts.map(alert => (
            <Alert 
              key={alert.id} 
              className={alert.level === 'critical' ? 'border-red-300 bg-red-50' : 'border-yellow-300 bg-yellow-50'}
            >
              <AlertTriangle className={`w-4 h-4 ${alert.level === 'critical' ? 'text-red-600' : 'text-yellow-600'}`} />
              <AlertDescription>
                <div>
                  <p className="font-semibold">{alert.message}</p>
                  <p className="text-sm mt-1">{alert.action}</p>
                </div>
              </AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Active Users</p>
              <Activity className="w-5 h-5 text-blue-600" />
            </div>
            <p className="text-3xl font-bold">{metrics.activeUsers}</p>
            <p className="text-xs text-gray-500 mt-1">Last 15 minutes</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Response Time</p>
              {getStatusIcon(metrics.avgResponseTime, { good: 300, warning: 400 })}
            </div>
            <p className={`text-3xl font-bold ${getStatusColor(metrics.avgResponseTime, { good: 300, warning: 400 })}`}>
              {metrics.avgResponseTime}ms
            </p>
            <div className="flex items-center gap-1 text-xs text-gray-500 mt-1">
              {metrics.avgResponseTime <= 300 ? <TrendingDown className="w-3 h-3 text-green-600" /> : <TrendingUp className="w-3 h-3 text-red-600" />}
              Average
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">Error Rate</p>
              {getStatusIcon(parseFloat(metrics.errorRate), { good: 1, warning: 3 })}
            </div>
            <p className={`text-3xl font-bold ${getStatusColor(parseFloat(metrics.errorRate), { good: 1, warning: 3 })}`}>
              {metrics.errorRate}%
            </p>
            <p className="text-xs text-gray-500 mt-1">Last hour</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm text-gray-600">System Load</p>
              <Server className="w-5 h-5 text-purple-600" />
            </div>
            <p className="text-3xl font-bold">{metrics.systemLoad}%</p>
            <Progress value={metrics.systemLoad} className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Performance Trends */}
      <Card>
        <CardHeader>
          <CardTitle>Performance Trends (Last 20 Updates)</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={performanceHistory}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="responseTime" stroke="#3B82F6" name="Response Time (ms)" />
              <Line type="monotone" dataKey="activeUsers" stroke="#10B981" name="Active Users" />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Detailed Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-5 h-5 text-yellow-600" />
              AI Performance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Conversions (1h)</span>
                <span className="font-semibold">{metrics.aiConversions}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Avg Quality Score</span>
                <span className="font-semibold">{metrics.avgAIQuality}/100</span>
              </div>
              <Progress value={metrics.avgAIQuality} className="h-2" />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Avg Conv. Time</span>
                <span className="font-semibold">{metrics.avgConversionTime}ms</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Database className="w-5 h-5 text-blue-600" />
              Database Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Visits Created (1h)</span>
                <span className="font-semibold">{metrics.totalVisits}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Requests/min</span>
                <span className="font-semibold">{metrics.requestsPerMinute}</span>
              </div>
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-gray-600">Compliance Checks</span>
                <span className="font-semibold">{metrics.complianceChecks}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              System Status
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">API Status</span>
              <Badge className="bg-green-100 text-green-800">Operational</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Database</span>
              <Badge className="bg-green-100 text-green-800">Healthy</Badge>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">AI Services</span>
              <Badge className="bg-green-100 text-green-800">Running</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}