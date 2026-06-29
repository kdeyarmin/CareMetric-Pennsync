import { useState } from "react";
import { Link } from "react-router-dom";
import { createPageUrl } from "@/utils";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertTriangle,
  Shield,
  Activity,
  Clock,
  User,
  Eye,
  CheckCircle2
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { toast } from 'sonner';

export default function SecurityAnomalyDetector() {
  const [analyzing, setAnalyzing] = useState(false);
  const [anomalies, setAnomalies] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['recentSecurityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 500),
    enabled: currentUser?.role === 'admin'
  });

  const { data: userActivities = [] } = useQuery({
    queryKey: ['recentUserActivities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 1000),
    enabled: currentUser?.role === 'admin'
  });

  const analyzeSecurityPatterns = async () => {
    setAnalyzing(true);
    try {
      // Analyze patterns in the last 24 hours
      const last24h = Date.now() - (24 * 60 * 60 * 1000);
      const recentLogs = securityLogs.filter(log => 
        new Date(log.timestamp) > last24h
      );
      const recentActivities = userActivities.filter(log => 
        new Date(log.created_date) > last24h
      );

      const detectedAnomalies = [];

      // 1. Check for repeated failed actions by user
      const failedByUser = {};
      recentLogs.forEach(log => {
        if (log.action?.includes('FAILED') || log.action?.includes('DENIED')) {
          failedByUser[log.user_email] = (failedByUser[log.user_email] || 0) + 1;
        }
      });
      Object.entries(failedByUser).forEach(([email, count]) => {
        if (count >= 5) {
          detectedAnomalies.push({
            type: 'repeated_failures',
            severity: 'critical',
            user: email,
            message: `${count} failed actions in 24 hours`,
            recommendation: 'Investigate potential unauthorized access attempt',
            timestamp: new Date().toISOString()
          });
        }
      });

      // 2. Check for unusual access patterns
      const accessByHour = Array(24).fill(0);
      recentActivities.forEach(activity => {
        const hour = new Date(activity.created_date).getHours();
        accessByHour[hour]++;
      });
      accessByHour.forEach((count, hour) => {
        if ((hour < 6 || hour > 22) && count > 10) {
          detectedAnomalies.push({
            type: 'after_hours_activity',
            severity: 'warning',
            message: `${count} actions during off-hours (${hour}:00)`,
            recommendation: 'Review after-hours access justification',
            timestamp: new Date().toISOString()
          });
        }
      });

      // 3. Check for bulk operations
      const bulkOps = recentLogs.filter(log => 
        log.action?.includes('BULK') && log.details?.record_count > 20
      );
      bulkOps.forEach(op => {
        detectedAnomalies.push({
          type: 'bulk_operation',
          severity: 'warning',
          user: op.user_email,
          message: `Bulk ${op.action} on ${op.details.record_count} records`,
          recommendation: 'Verify bulk operation was authorized',
          timestamp: op.timestamp
        });
      });

      // 4. Check for rapid data exports
      const exports = recentLogs.filter(log => log.action === 'PHI_EXPORTED');
      const exportsByUser = {};
      exports.forEach(exp => {
        exportsByUser[exp.user_email] = (exportsByUser[exp.user_email] || 0) + 1;
      });
      Object.entries(exportsByUser).forEach(([email, count]) => {
        if (count >= 5) {
          detectedAnomalies.push({
            type: 'excessive_exports',
            severity: 'critical',
            user: email,
            message: `${count} data exports in 24 hours`,
            recommendation: 'Investigate potential data exfiltration',
            timestamp: new Date().toISOString()
          });
        }
      });

      // 5. Check for anomaly patterns (same user, many different actions rapidly)
      const actionsByUser = {};
      recentActivities.forEach(activity => {
        if (!actionsByUser[activity.user_email]) {
          actionsByUser[activity.user_email] = { actions: [], timestamps: [] };
        }
        actionsByUser[activity.user_email].actions.push(activity.action);
        actionsByUser[activity.user_email].timestamps.push(new Date(activity.created_date));
      });
      
      Object.entries(actionsByUser).forEach(([email, data]) => {
        if (data.actions.length > 100) {
          // Check if actions happened in short time span
          const timeSpan = Math.max(...data.timestamps) - Math.min(...data.timestamps);
          if (timeSpan < 60 * 60 * 1000) { // Within 1 hour
            detectedAnomalies.push({
              type: 'rapid_activity',
              severity: 'warning',
              user: email,
              message: `${data.actions.length} actions in ${Math.round(timeSpan / 60000)} minutes`,
              recommendation: 'Possible automated bot or script usage',
              timestamp: new Date().toISOString()
            });
          }
        }
      });

      setAnomalies({
        analyzed_at: new Date().toISOString(),
        time_window: '24 hours',
        total_logs_analyzed: recentLogs.length + recentActivities.length,
        anomalies_detected: detectedAnomalies.length,
        anomalies: detectedAnomalies
      });

    } catch (error) {
      console.error('Error analyzing security patterns:', error);
      toast.error('Failed to analyze security patterns');
    }
    setAnalyzing(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'warning': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  const getSeverityIcon = (severity) => {
    switch (severity) {
      case 'critical': return <AlertTriangle className="w-5 h-5 text-red-600" />;
      case 'warning': return <AlertTriangle className="w-5 h-5 text-yellow-600" />;
      default: return <Shield className="w-5 h-5 text-blue-600" />;
    }
  };

  return (
    <Card className="border-2 border-navy-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-navy-600" />
          Security Anomaly Detection
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-navy-50 border-navy-300">
          <AlertDescription className="text-navy-900">
            <p className="font-semibold mb-2">AI-Powered Security Analysis</p>
            <p className="text-sm">
              Automatically detects unusual patterns in user activity, failed access attempts, 
              bulk operations, and potential security threats.
            </p>
          </AlertDescription>
        </Alert>

        <Button
          onClick={analyzeSecurityPatterns}
          disabled={analyzing}
          className="w-full bg-navy-600 hover:bg-navy-700 min-h-[44px]"
        >
          {analyzing ? (
            <>
              <Activity className="w-4 h-4 mr-2 animate-pulse" />
              Analyzing Security Patterns...
            </>
          ) : (
            <>
              <Shield className="w-4 h-4 mr-2" />
              Run Security Analysis
            </>
          )}
        </Button>

        {anomalies && (
          <div className="space-y-4 mt-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Logs Analyzed</p>
                  <p className="text-2xl font-bold">{anomalies.total_logs_analyzed}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Anomalies Found</p>
                  <p className="text-2xl font-bold text-red-600">{anomalies.anomalies_detected}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Time Window</p>
                  <p className="text-lg font-bold">{anomalies.time_window}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Analysis Time</p>
                  <p className="text-sm font-medium truncate">
                    {formatEastern(new Date(anomalies.analyzed_at), 'HH:mm:ss')}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Anomaly List */}
            {anomalies.anomalies.length === 0 ? (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <p className="font-semibold">✓ No Security Anomalies Detected</p>
                  <p className="text-sm">All activity patterns appear normal.</p>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                {anomalies.anomalies.map((anomaly, idx) => (
                  <Card key={idx} className={`border-2 ${getSeverityColor(anomaly.severity)}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3 flex-1">
                          {getSeverityIcon(anomaly.severity)}
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge className={
                                anomaly.severity === 'critical' ? 'bg-red-600' :
                                anomaly.severity === 'warning' ? 'bg-yellow-600' : 'bg-blue-600'
                              }>
                                {anomaly.severity}
                              </Badge>
                              <Badge variant="outline">{anomaly.type.replace(/_/g, ' ')}</Badge>
                              {anomaly.user && (
                                <Badge variant="outline">
                                  <User className="w-3 h-3 mr-1" />
                                  {anomaly.user}
                                </Badge>
                              )}
                            </div>
                            <p className="font-semibold text-slate-900 mb-1">{anomaly.message}</p>
                            <p className="text-sm text-slate-700 mb-2">
                              <strong>Recommendation:</strong> {anomaly.recommendation}
                            </p>
                            <p className="text-xs text-slate-500">
                              <Clock className="w-3 h-3 inline mr-1" />
                              {formatEastern(new Date(anomaly.timestamp), 'MMM d, yyyy HH:mm:ss')}
                            </p>
                          </div>
                        </div>
                        <Button asChild size="sm" variant="outline" className="min-h-[44px]">
                          <Link
                            to={anomaly.user
                              ? `${createPageUrl('UserActivityReport')}?user=${encodeURIComponent(anomaly.user)}`
                              : createPageUrl('UserActivityReport')}
                          >
                            <Eye className="w-4 h-4 mr-1" />
                            Investigate
                          </Link>
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}