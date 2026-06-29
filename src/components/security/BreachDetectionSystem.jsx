import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  AlertTriangle,
  Activity,
  Bell,
  CheckCircle2,
  XCircle,
  Clock
} from "lucide-react";
import { formatEastern } from "../utils/timezone";
import { toast } from 'sonner';

/**
 * Breach Detection System
 * Monitors for potential HIPAA security breaches
 */
export default function BreachDetectionSystem() {
  const [scanning, setScanning] = useState(false);
  const [breachIndicators, setBreachIndicators] = useState(null);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me(),
  });

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['securityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 1000),
    enabled: currentUser?.role === 'admin'
  });

  const { data: userActivities = [] } = useQuery({
    queryKey: ['userActivities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 2000),
    enabled: currentUser?.role === 'admin'
  });

  const scanForBreaches = async () => {
    setScanning(true);
    
    try {
      const last24h = Date.now() - (24 * 60 * 60 * 1000);
      const indicators = [];

      // 1. Unauthorized Access Attempts
      const failedLogins = securityLogs.filter(log => 
        log.action?.includes('FAILED') && 
        new Date(log.timestamp) > last24h
      );
      
      const failedByUser = {};
      failedLogins.forEach(log => {
        failedByUser[log.user_email] = (failedByUser[log.user_email] || 0) + 1;
      });
      
      Object.entries(failedByUser).forEach(([email, count]) => {
        if (count >= 10) {
          indicators.push({
            type: 'Unauthorized Access Attempt',
            severity: 'critical',
            description: `${count} failed access attempts by ${email}`,
            recommendation: 'Lock account and investigate',
            requires_notification: true,
            timestamp: new Date().toISOString()
          });
        }
      });

      // 2. Unusual Data Access Patterns
      const phiAccess = securityLogs.filter(log => 
        log.action === 'PHI_ACCESSED' &&
        new Date(log.timestamp) > last24h
      );
      
      const accessByUser = {};
      phiAccess.forEach(log => {
        accessByUser[log.user_email] = (accessByUser[log.user_email] || 0) + 1;
      });
      
      Object.entries(accessByUser).forEach(([email, count]) => {
        if (count > 50) {
          indicators.push({
            type: 'Excessive PHI Access',
            severity: 'warning',
            description: `${count} patient records accessed by ${email} in 24h`,
            recommendation: 'Review access justification',
            requires_notification: true,
            timestamp: new Date().toISOString()
          });
        }
      });

      // 3. Bulk Data Exports
      const bulkExports = securityLogs.filter(log => 
        log.action === 'PHI_EXPORTED' &&
        log.details?.is_bulk_export &&
        new Date(log.timestamp) > last24h
      );
      
      if (bulkExports.length > 0) {
        bulkExports.forEach(exp => {
          indicators.push({
            type: 'Bulk Data Export',
            severity: 'critical',
            description: `${exp.details.record_count} records exported by ${exp.user_email}`,
            recommendation: 'Verify export authorization and business need',
            requires_notification: true,
            timestamp: exp.timestamp
          });
        });
      }

      // 4. After-Hours Access
      const afterHoursAccess = userActivities.filter(activity => {
        const activityDate = new Date(activity.created_date);
        if (activityDate < last24h) return false;
        
        const hour = activityDate.getHours();
        return hour < 6 || hour > 22;
      });
      
      if (afterHoursAccess.length > 20) {
        const byUser = {};
        afterHoursAccess.forEach(a => {
          byUser[a.user_email] = (byUser[a.user_email] || 0) + 1;
        });
        
        Object.entries(byUser).forEach(([email, count]) => {
          if (count > 10) {
            indicators.push({
              type: 'After-Hours Access',
              severity: 'warning',
              description: `${count} after-hours activities by ${email}`,
              recommendation: 'Confirm legitimate business need',
              requires_notification: false,
              timestamp: new Date().toISOString()
            });
          }
        });
      }

      // 5. Deleted Records
      const deletions = userActivities.filter(activity =>
        activity.action?.includes('DELETE') &&
        new Date(activity.created_date) > last24h
      );
      
      if (deletions.length > 10) {
        indicators.push({
          type: 'Excessive Deletions',
          severity: 'warning',
          description: `${deletions.length} records deleted in 24 hours`,
          recommendation: 'Review deletion justifications',
          requires_notification: true,
          timestamp: new Date().toISOString()
        });
      }

      // 6. Security Anomalies Already Logged
      const anomalies = securityLogs.filter(log =>
        log.action === 'SECURITY_ANOMALY_DETECTED' &&
        new Date(log.timestamp) > last24h
      );
      
      anomalies.forEach(anomaly => {
        indicators.push({
          type: 'Security Anomaly',
          severity: anomaly.details?.anomaly_severity || 'warning',
          description: anomaly.details?.anomaly_message || 'Anomaly detected',
          recommendation: 'Review anomaly details',
          requires_notification: true,
          timestamp: anomaly.timestamp
        });
      });

      setBreachIndicators({
        scan_timestamp: new Date().toISOString(),
        indicators_found: indicators.length,
        critical_count: indicators.filter(i => i.severity === 'critical').length,
        notification_required: indicators.filter(i => i.requires_notification).length,
        indicators: indicators.sort((a, b) => {
          if (a.severity === 'critical' && b.severity !== 'critical') return -1;
          if (a.severity !== 'critical' && b.severity === 'critical') return 1;
          return 0;
        })
      });

      // Log the breach scan
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: 'BREACH_SCAN_COMPLETED',
        details: {
          indicators_found: indicators.length,
          critical_indicators: indicators.filter(i => i.severity === 'critical').length
        },
        ip_address: 'client-side',
        user_agent: navigator.userAgent
      });

    } catch (error) {
      console.error('Breach detection error:', error);
      toast.error('Failed to complete breach detection scan');
    }
    
    setScanning(false);
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-500 bg-red-50';
      case 'warning': return 'border-yellow-500 bg-yellow-50';
      default: return 'border-blue-500 bg-blue-50';
    }
  };

  return (
    <Card className="border-2 border-red-300">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-6 h-6 text-red-600" />
          HIPAA Breach Detection System
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert className="bg-red-50 border-red-300">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <AlertDescription className="text-red-900">
            <p className="font-semibold mb-1">Automated Breach Monitoring</p>
            <p className="text-sm">
              Scans for potential HIPAA security incidents: unauthorized access, 
              excessive data exports, unusual patterns, and policy violations.
            </p>
          </AlertDescription>
        </Alert>

        <Button
          onClick={scanForBreaches}
          disabled={scanning}
          className="w-full bg-red-600 hover:bg-red-700 min-h-[44px]"
        >
          {scanning ? (
            <>
              <Activity className="w-4 h-4 mr-2 animate-pulse" />
              Scanning for Security Incidents...
            </>
          ) : (
            <>
              <Shield className="w-4 h-4 mr-2" />
              Run Breach Detection Scan
            </>
          )}
        </Button>

        {breachIndicators && (
          <div className="space-y-4 mt-6">
            {/* Summary */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Total Indicators</p>
                  <p className="text-2xl font-bold">{breachIndicators.indicators_found}</p>
                </CardContent>
              </Card>
              <Card className="border-red-200">
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Critical</p>
                  <p className="text-2xl font-bold text-red-600">{breachIndicators.critical_count}</p>
                </CardContent>
              </Card>
              <Card className="border-yellow-200">
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Need Review</p>
                  <p className="text-2xl font-bold text-yellow-600">{breachIndicators.notification_required}</p>
                </CardContent>
              </Card>
              <Card>
                <CardContent className="p-3">
                  <p className="text-xs text-slate-600 mb-1">Scan Time</p>
                  <p className="text-sm font-medium truncate">
                    {formatEastern(new Date(breachIndicators.scan_timestamp), 'HH:mm:ss')}
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Indicators */}
            {breachIndicators.indicators.length === 0 ? (
              <Alert className="bg-green-50 border-green-300">
                <CheckCircle2 className="w-4 h-4 text-green-600" />
                <AlertDescription className="text-green-800">
                  <p className="font-semibold">✓ No Security Incidents Detected</p>
                  <p className="text-sm">All activity patterns are within normal parameters.</p>
                </AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-3">
                <Alert className="bg-yellow-50 border-yellow-300">
                  <Bell className="w-4 h-4 text-yellow-600" />
                  <AlertDescription className="text-yellow-900">
                    <p className="font-semibold">
                      ⚠️ {breachIndicators.indicators_found} Potential Security Incident{breachIndicators.indicators_found > 1 ? 's' : ''} Detected
                    </p>
                    <p className="text-sm">
                      {breachIndicators.notification_required} require immediate review and potential breach notification per HIPAA.
                    </p>
                  </AlertDescription>
                </Alert>

                {breachIndicators.indicators.map((indicator, idx) => (
                  <Card key={idx} className={`border-2 ${getSeverityColor(indicator.severity)}`}>
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className={
                              indicator.severity === 'critical' ? 'bg-red-600' :
                              indicator.severity === 'warning' ? 'bg-yellow-600' : 'bg-blue-600'
                            }>
                              {indicator.severity}
                            </Badge>
                            <Badge variant="outline">{indicator.type}</Badge>
                            {indicator.requires_notification && (
                              <Badge className="bg-orange-600">
                                <Bell className="w-3 h-3 mr-1" />
                                Notification Required
                              </Badge>
                            )}
                          </div>
                          <p className="font-semibold text-slate-900 mb-1">{indicator.description}</p>
                          <p className="text-sm text-slate-700 mb-2">
                            <strong>Action Required:</strong> {indicator.recommendation}
                          </p>
                          <p className="text-xs text-slate-500">
                            <Clock className="w-3 h-3 inline mr-1" />
                            {formatEastern(new Date(indicator.timestamp), 'MMM d, yyyy HH:mm:ss')}
                          </p>
                        </div>
                        {indicator.severity === 'critical' ? (
                          <XCircle className="w-8 h-8 text-red-600 flex-shrink-0" />
                        ) : (
                          <AlertTriangle className="w-8 h-8 text-yellow-600 flex-shrink-0" />
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}

            {breachIndicators.critical_count > 0 && (
              <Alert className="bg-red-50 border-red-300">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <AlertDescription className="text-red-900">
                  <p className="font-semibold mb-2">🚨 HIPAA Breach Notification May Be Required</p>
                  <p className="text-sm mb-2">
                    Critical security incidents detected. Per HIPAA Breach Notification Rule (45 CFR §§ 164.400-414):
                  </p>
                  <ul className="list-disc ml-5 text-sm space-y-1">
                    <li>Conduct risk assessment within 60 days</li>
                    <li>Document investigation and findings</li>
                    <li>Notify affected individuals if breach confirmed</li>
                    <li>Report to HHS if affecting 500+ individuals</li>
                    <li>Notify media if affecting 500+ individuals in same state</li>
                  </ul>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}