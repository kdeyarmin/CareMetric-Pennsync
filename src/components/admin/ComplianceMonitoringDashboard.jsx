import React, { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, CheckCircle2, Clock, Shield, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

export default function ComplianceMonitoringDashboard() {
  const [activeTab, setActiveTab] = useState('anomalies');

  const { data: anomalies = [], refetch: refetchAnomalies } = useQuery({
    queryKey: ['anomalyAlerts'],
    queryFn: () => base44.asServiceRole.entities.AnomalyAlert.filter({ status: 'new' })
  });

  const { data: violations = [], refetch: refetchViolations } = useQuery({
    queryKey: ['complianceViolations'],
    queryFn: () => base44.asServiceRole.entities.ComplianceViolation.filter({ status: 'open' })
  });

  const runAnomalyDetection = async () => {
    try {
      await base44.functions.invoke('auditAnomalies', {});
      toast.success('Anomaly detection completed');
      refetchAnomalies();
    } catch (error) {
      toast.error('Failed to run anomaly detection');
    }
  };

  const runComplianceCheck = async () => {
    try {
      await base44.functions.invoke('detectComplianceViolations', {});
      toast.success('Compliance check completed');
      refetchViolations();
    } catch (error) {
      toast.error('Failed to run compliance check');
    }
  };

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 text-red-800';
      case 'high':
        return 'bg-orange-100 text-orange-800';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800';
      default:
        return 'bg-blue-100 text-blue-800';
    }
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Shield className="w-4 h-4" />
              Anomalies Detected
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{anomalies.length}</div>
            <p className="text-xs text-gray-600 mt-1">Requires attention</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <AlertCircle className="w-4 h-4" />
              Violations Found
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-3xl font-bold">{violations.length}</div>
            <p className="text-xs text-gray-600 mt-1">Need remediation</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-sm">
              <Clock className="w-4 h-4" />
              Last Check
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-sm font-semibold">Just now</div>
            <p className="text-xs text-gray-600 mt-1">Real-time monitoring</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-4">
        <Button onClick={runAnomalyDetection} className="bg-blue-600 hover:bg-blue-700">
          <Shield className="w-4 h-4 mr-2" />
          Run Anomaly Detection
        </Button>
        <Button onClick={runComplianceCheck} className="bg-green-600 hover:bg-green-700">
          <CheckCircle2 className="w-4 h-4 mr-2" />
          Run Compliance Check
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Security Anomalies</CardTitle>
        </CardHeader>
        <CardContent>
          {anomalies.length === 0 ? (
            <p className="text-gray-600">No anomalies detected</p>
          ) : (
            <div className="space-y-3">
              {anomalies.map((anomaly) => (
                <div key={anomaly.id} className="border rounded-lg p-3 flex items-start gap-3">
                  <AlertTriangle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                    anomaly.severity === 'critical' ? 'text-red-600' : 'text-orange-600'
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm">{anomaly.alert_type.replace(/_/g, ' ')}</p>
                      <Badge className={getSeverityColor(anomaly.severity)}>
                        {anomaly.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600">User: {anomaly.user_email}</p>
                    <p className="text-xs text-gray-600 mt-1">
                      {JSON.stringify(anomaly.details)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Compliance Violations</CardTitle>
        </CardHeader>
        <CardContent>
          {violations.length === 0 ? (
            <p className="text-gray-600">No violations detected</p>
          ) : (
            <div className="space-y-3">
              {violations.map((violation) => (
                <div key={violation.id} className="border rounded-lg p-3 flex items-start gap-3">
                  <AlertCircle className={`w-5 h-5 mt-0.5 flex-shrink-0 ${
                    violation.severity === 'critical' ? 'text-red-600' : 'text-yellow-600'
                  }`} />
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-sm">{violation.violation_type}</p>
                      <Badge className={getSeverityColor(violation.severity)}>
                        {violation.severity}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-600">{violation.description}</p>
                    <p className="text-xs text-gray-500 mt-1">Ref: {violation.regulatory_reference}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}