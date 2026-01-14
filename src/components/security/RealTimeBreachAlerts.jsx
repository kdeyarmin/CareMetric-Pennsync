/**
 * Real-Time Breach Alerts
 * 
 * Connects breach detection to notification system
 * Provides immediate admin alerts for security incidents
 */

import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Shield, XCircle, Lock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// Critical breach types that require immediate action
const CRITICAL_BREACH_TYPES = [
  'EXCESSIVE_FAILED_LOGINS',
  'EXCESSIVE_BULK_ACCESS',
  'EXCESSIVE_EXPORTS',
  'UNAUTHORIZED_ACCESS'
];

export function RealTimeBreachMonitor() {
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [lastCheck, setLastCheck] = useState(Date.now());

  const { data: currentUser } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => base44.auth.me()
  });

  const isAdmin = currentUser?.role === 'admin';

  // Poll for new security alerts
  useQuery({
    queryKey: ['securityAlerts', lastCheck],
    queryFn: async () => {
      if (!isAdmin) return [];

      const alerts = await base44.entities.PatientAlert.filter({
        alert_type: 'security_breach',
        status: 'active',
        created_date: { $gte: new Date(lastCheck - 60000).toISOString() }
      });

      // Show toast notifications for new alerts
      alerts.forEach(alert => {
        if (alert.severity === 'critical' || alert.severity === 'high') {
          toast.error(alert.title, {
            description: alert.description,
            duration: 10000,
            action: {
              label: "View",
              onClick: () => window.location.href = '/HIPAACompliance'
            }
          });

          // Browser notification if permitted
          if (Notification.permission === 'granted') {
            new Notification('🚨 Security Alert', {
              body: alert.description,
              icon: '/security-alert-icon.png',
              tag: alert.id,
              requireInteraction: true
            });
          }
        }
      });

      setActiveAlerts(prev => [...alerts, ...prev].slice(0, 10));
      return alerts;
    },
    enabled: isAdmin,
    refetchInterval: 30000, // Check every 30 seconds
    onSuccess: () => setLastCheck(Date.now())
  });

  // Request notification permission on mount
  useEffect(() => {
    if (isAdmin && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [isAdmin]);

  if (!isAdmin || activeAlerts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-md">
      {activeAlerts.slice(0, 3).map((alert) => (
        <Card key={alert.id} className="mb-2 border-red-500 bg-red-50">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-red-600" />
                <CardTitle className="text-sm">{alert.title}</CardTitle>
              </div>
              <Badge variant="destructive">{alert.severity}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-xs text-gray-700">{alert.description}</p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={async () => {
                  await base44.entities.PatientAlert.update(alert.id, {
                    status: 'acknowledged'
                  });
                  setActiveAlerts(prev => prev.filter(a => a.id !== alert.id));
                }}
              >
                Acknowledge
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => window.location.href = '/HIPAACompliance'}
              >
                View Details
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

/**
 * Send breach alert via multiple channels
 */
export async function sendBreachAlert(breach) {
  const { type, severity, description, userEmail, metadata } = breach;

  try {
    // 1. Create database alert
    await base44.entities.PatientAlert.create({
      alert_type: 'security_breach',
      severity: severity.toLowerCase(),
      title: `Security Breach: ${type.replace(/_/g, ' ')}`,
      description,
      status: 'active',
      metadata: {
        ...metadata,
        userEmail,
        detectedAt: new Date().toISOString()
      }
    });

    // 2. Log security event
    await base44.entities.SecurityLog.create({
      timestamp: new Date().toISOString(),
      user_email: userEmail || 'system',
      user_role: metadata?.userRole || 'unknown',
      action: 'BREACH_DETECTED',
      details: {
        type,
        severity,
        description,
        metadata
      }
    });

    // 3. Send email to admins (if critical)
    if (CRITICAL_BREACH_TYPES.includes(type)) {
      const admins = await base44.entities.User.filter({ role: 'admin' });
      
      for (const admin of admins) {
        try {
          await base44.integrations.Core.SendEmail({
            from_name: 'CareMetric Security',
            to: admin.email,
            subject: `🚨 Critical Security Alert: ${type.replace(/_/g, ' ')}`,
            body: `
              <h2>Critical Security Incident Detected</h2>
              <p><strong>Type:</strong> ${type.replace(/_/g, ' ')}</p>
              <p><strong>Severity:</strong> ${severity}</p>
              <p><strong>User:</strong> ${userEmail}</p>
              <p><strong>Description:</strong> ${description}</p>
              <p><strong>Time:</strong> ${new Date().toLocaleString()}</p>
              <p><strong>Action Required:</strong> Please review immediately in the HIPAA Compliance Dashboard.</p>
              <hr>
              <p><em>This is an automated security alert from CareMetric AI.</em></p>
            `
          });
        } catch (error) {
          console.error('Failed to send email to admin:', admin.email, error);
        }
      }
    }

    return true;
  } catch (error) {
    console.error('Failed to send breach alert:', error);
    return false;
  }
}

/**
 * Hook to monitor user's own security status
 */
export function useSecurityStatus() {
  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: userAlerts } = useQuery({
    queryKey: ['userSecurityAlerts', user?.email],
    queryFn: async () => {
      if (!user) return [];
      
      return await base44.entities.SecurityLog.filter({
        user_email: user.email,
        action: { $in: ['BREACH_ATTEMPT', 'ACCOUNT_LOCKED', 'SUSPICIOUS_ACTIVITY'] },
        timestamp: { $gte: new Date(Date.now() - 86400000).toISOString() } // Last 24h
      });
    },
    enabled: !!user,
    refetchInterval: 60000
  });

  return {
    hasSecurityIssues: (userAlerts?.length || 0) > 0,
    alertCount: userAlerts?.length || 0,
    alerts: userAlerts || []
  };
}