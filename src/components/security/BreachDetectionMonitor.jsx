import React, { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Shield, AlertTriangle, CheckCircle, Bell, Eye } from "lucide-react";
import { format } from "date-fns";

export default function BreachDetectionMonitor() {
  const queryClient = useQueryClient();
  const [realtimeBreaches, setRealtimeBreaches] = useState([]);

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: recentLogs = [] } = useQuery({
    queryKey: ['recentSecurityLogs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 100),
    refetchInterval: 30000, // Check every 30 seconds
    enabled: currentUser?.role === 'admin'
  });

  const { data: auditTrail = [] } = useQuery({
    queryKey: ['recentAuditTrail'],
    queryFn: () => base44.entities.AuditTrail.list('-timestamp', 100),
    refetchInterval: 30000,
    enabled: currentUser?.role === 'admin'
  });

  const acknowledgeBreachMutation = useMutation({
    mutationFn: async (breach) => {
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action: 'breach_acknowledged',
        details: {
          breach_type: breach.type,
          breach_id: breach.id,
          severity: breach.severity
        }
      });
    },
    onSuccess: () => {
      toast.success('Breach acknowledged');
      queryClient.invalidateQueries({ queryKey: ['recentSecurityLogs'] });
    }
  });

  // Analyze logs for potential breaches
  useEffect(() => {
    if (recentLogs.length === 0) return;

    const detectedBreaches = [];
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    // Detect unusual access patterns
    const accessEvents = recentLogs.filter(log => 
      log.action?.includes('access') && new Date(log.timestamp) > oneHourAgo
    );

    const accessByUser = {};
    accessEvents.forEach(event => {
      if (!accessByUser[event.user_email]) {
        accessByUser[event.user_email] = [];
      }
      accessByUser[event.user_email].push(event);
    });

    // Flag users with excessive access attempts
    Object.entries(accessByUser).forEach(([email, events]) => {
      if (events.length > 50) {
        detectedBreaches.push({
          id: `excessive-access-${email}`,
          type: 'excessive_access',
          severity: 'high',
          user: email,
          message: `${events.length} access events in the last hour`,
          timestamp: new Date().toISOString(),
          details: { count: events.length }
        });
      }
    });

    // Detect unauthorized deletion attempts
    const deletions = auditTrail.filter(log => 
      log.action === 'delete' && new Date(log.timestamp) > oneHourAgo
    );
    
    if (deletions.length > 10) {
      detectedBreaches.push({
        id: 'mass-deletion',
        type: 'mass_deletion',
        severity: 'critical',
        message: `${deletions.length} deletion events detected in the last hour`,
        timestamp: new Date().toISOString(),
        details: { count: deletions.length }
      });
    }

    // Detect after-hours access
    const hour = now.getHours();
    if (hour < 6 || hour > 22) {
      const afterHoursAccess = recentLogs.filter(log => {
        const logHour = new Date(log.timestamp).getHours();
        return logHour < 6 || logHour > 22;
      });

      if (afterHoursAccess.length > 5) {
        detectedBreaches.push({
          id: 'after-hours-access',
          type: 'unusual_hours',
          severity: 'medium',
          message: `${afterHoursAccess.length} after-hours access events`,
          timestamp: new Date().toISOString(),
          details: { events: afterHoursAccess.length }
        });
      }
    }

    setRealtimeBreaches(detectedBreaches);

    // Alert on critical breaches
    const criticalBreaches = detectedBreaches.filter(b => b.severity === 'critical');
    if (criticalBreaches.length > 0 && currentUser?.role === 'admin') {
      toast.error(`${criticalBreaches.length} critical security breach(es) detected!`);
    }
  }, [recentLogs, auditTrail, currentUser]);

  if (currentUser?.role !== 'admin') {
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-600" />
          Real-Time Breach Detection
          {realtimeBreaches.length > 0 && (
            <Badge className="bg-red-600 ml-auto">
              <Bell className="w-3 h-3 mr-1" />
              {realtimeBreaches.length} Alert{realtimeBreaches.length > 1 ? 's' : ''}
            </Badge>
          )}
        </CardTitle>
        <CardDescription>Automated monitoring of security events and anomalies</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {realtimeBreaches.length === 0 ? (
          <Alert className="bg-green-50 border-green-200">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <AlertDescription className="text-green-900">
              No security breaches detected. System is secure.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-3">
            {realtimeBreaches.map((breach) => (
              <Alert key={breach.id} className={
                breach.severity === 'critical' ? 'bg-red-50 border-red-300' :
                breach.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                'bg-yellow-50 border-yellow-300'
              }>
                <AlertTriangle className={`w-4 h-4 ${
                  breach.severity === 'critical' ? 'text-red-600' :
                  breach.severity === 'high' ? 'text-orange-600' :
                  'text-yellow-600'
                }`} />
                <AlertDescription>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <Badge className={
                          breach.severity === 'critical' ? 'bg-red-600' :
                          breach.severity === 'high' ? 'bg-orange-600' :
                          'bg-yellow-600'
                        }>
                          {breach.severity}
                        </Badge>
                        <span className="font-semibold text-sm">{breach.type.replace(/_/g, ' ').toUpperCase()}</span>
                      </div>
                      <p className="text-sm">{breach.message}</p>
                      {breach.user && <p className="text-xs text-slate-600 mt-1">User: {breach.user}</p>}
                      <p className="text-xs text-slate-500 mt-1">
                        Detected: {format(new Date(breach.timestamp), 'MMM d, yyyy HH:mm:ss')}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => acknowledgeBreachMutation.mutate(breach)}
                      >
                        <Eye className="w-3 h-3 mr-1" />
                        Acknowledge
                      </Button>
                    </div>
                  </div>
                </AlertDescription>
              </Alert>
            ))}
          </div>
        )}

        {/* Monitoring Stats */}
        <div className="grid grid-cols-3 gap-3 pt-4 border-t">
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-900">{recentLogs.length}</p>
            <p className="text-xs text-slate-600">Events Monitored</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-slate-900">{realtimeBreaches.length}</p>
            <p className="text-xs text-slate-600">Active Alerts</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-green-600">
              {recentLogs.length - realtimeBreaches.length}
            </p>
            <p className="text-xs text-slate-600">Safe Events</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}