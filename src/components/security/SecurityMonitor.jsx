import React, { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Shield, AlertTriangle, Lock, Eye, Download } from "lucide-react";
import { detectBreachIndicators, logPHIAccess } from "./HIPAACompliance";

export default function SecurityMonitor() {
  const [breachIndicators, setBreachIndicators] = useState(null);

  const { data: user } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: recentActivity } = useQuery({
    queryKey: ['recentSecurityActivity'],
    queryFn: async () => {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      return await base44.entities.UserActivity.filter({
        created_date: { $gte: oneDayAgo }
      });
    },
    enabled: !!user && user.role === 'admin',
    refetchInterval: 60000 // Check every minute
  });

  useEffect(() => {
    const checkSecurity = async () => {
      const indicators = await detectBreachIndicators();
      setBreachIndicators(indicators);
    };

    if (user?.role === 'admin') {
      checkSecurity();
      const interval = setInterval(checkSecurity, 300000); // Every 5 minutes
      return () => clearInterval(interval);
    }
  }, [user]);

  useEffect(() => {
    // Track security page access
    if (user) {
      logPHIAccess('view', 'security_monitor', 'dashboard', {
        page: 'SecurityMonitor'
      });
    }
  }, [user]);

  if (!user || user.role !== 'admin') {
    return (
      <Alert variant="destructive">
        <AlertTriangle className="w-4 h-4" />
        <AlertDescription>
          Access Denied: Administrator privileges required
        </AlertDescription>
      </Alert>
    );
  }

  const suspiciousCount = breachIndicators ? 
    breachIndicators.unusualAccessTimes.length +
    breachIndicators.massExports.length +
    breachIndicators.failedAccessAttempts.length : 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              Security Status
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {suspiciousCount === 0 ? 'Secure' : 'Alert'}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              HIPAA Compliant
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Eye className="w-4 h-4 text-blue-600" />
              Access Events (24h)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {recentActivity?.length || 0}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              All activities logged
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-orange-600" />
              Suspicious Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-600">
              {suspiciousCount}
            </div>
            <p className="text-xs text-gray-600 mt-1">
              Requires review
            </p>
          </CardContent>
        </Card>
      </div>

      {suspiciousCount > 0 && breachIndicators && (
        <Card className="border-orange-200">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2 text-orange-600">
              <AlertTriangle className="w-4 h-4" />
              Security Alerts Detected
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {breachIndicators.unusualAccessTimes.length > 0 && (
              <Alert>
                <AlertDescription>
                  <strong>Unusual Access Times:</strong> {breachIndicators.unusualAccessTimes.length} events between 12am-5am
                </AlertDescription>
              </Alert>
            )}

            {breachIndicators.massExports.length > 0 && (
              <Alert>
                <AlertDescription>
                  <strong>Mass Export Events:</strong> {breachIndicators.massExports.length} large data exports detected
                </AlertDescription>
              </Alert>
            )}

            {breachIndicators.failedAccessAttempts.length > 0 && (
              <Alert variant="destructive">
                <AlertDescription>
                  <strong>Failed Access Attempts:</strong> {breachIndicators.failedAccessAttempts.length} unauthorized access attempts
                </AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="w-4 h-4" />
            HIPAA Compliance Checklist
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Data encryption at rest and in transit</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Automatic session timeout (15 minutes)</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Comprehensive audit logging</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Role-based access control (RBAC)</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ PHI de-identification for AI processing</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Secure data deletion</span>
            </div>
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600" />
              <span>✓ Breach detection monitoring</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}