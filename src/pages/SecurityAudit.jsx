import React, { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield, CheckCircle2, AlertTriangle, XCircle, Loader2, Play, 
  Lock, Eye, FileText, Database, Server, Key, Activity, Download
} from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";

export default function SecurityAudit() {
  const [auditResults, setAuditResults] = useState(null);
  const [runningAudit, setRunningAudit] = useState(false);
  const queryClient = useQueryClient();

  const { data: currentUser } = useQuery({
    queryKey: ['currentUser'],
    queryFn: () => base44.auth.me()
  });

  const { data: recentAudits = [] } = useQuery({
    queryKey: ['recentSecurityAudits'],
    queryFn: async () => {
      const logs = await base44.entities.SecurityLog.filter({
        action: 'SECURITY_AUDIT_COMPLETED'
      }, '-timestamp', 10);
      return logs;
    },
    enabled: currentUser?.role === 'admin'
  });

  const runAudit = async () => {
    setRunningAudit(true);
    try {
      const response = await base44.functions.invoke('runSecurityAudit', {});
      const result = response.data || response;
      
      setAuditResults(result);
      queryClient.invalidateQueries({ queryKey: ['recentSecurityAudits'] });
      
      if (result.summary?.status === 'CRITICAL') {
        toast.error('Critical security issues found!');
      } else if (result.summary?.status === 'NEEDS_ATTENTION') {
        toast.warning('Security warnings detected');
      } else {
        toast.success('Security audit passed!');
      }
    } catch (error) {
      toast.error('Audit failed: ' + error.message);
      console.error(error);
    } finally {
      setRunningAudit(false);
    }
  };

  const downloadReport = () => {
    const reportText = JSON.stringify(auditResults, null, 2);
    const blob = new Blob([reportText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `security-audit-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success('Report downloaded');
  };

  if (currentUser?.role !== 'admin') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6">
        <Card className="max-w-md border-red-300">
          <CardContent className="p-12 text-center">
            <Shield className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h2 className="text-2xl font-bold mb-2">Access Denied</h2>
            <p className="text-gray-600">Administrator privileges required</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <Shield className="w-8 h-8 text-blue-600" />
          HIPAA Security Audit
        </h1>
        <p className="text-gray-600 dark:text-gray-400 mt-1">
          Comprehensive security and compliance audit for all systems
        </p>
      </div>

      {/* Run Audit */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Run Security Audit</CardTitle>
          <CardDescription>
            Performs comprehensive HIPAA compliance and security checks across all systems
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-3">
            <Button 
              onClick={runAudit} 
              disabled={runningAudit}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {runningAudit ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Running Audit...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Full Audit
                </>
              )}
            </Button>
            {auditResults && (
              <Button 
                onClick={downloadReport}
                variant="outline"
              >
                <Download className="w-4 h-4 mr-2" />
                Download Report
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Audit Results */}
      {auditResults && (
        <div className="space-y-6">
          {/* Summary */}
          <Card className={
            auditResults.summary?.status === 'CRITICAL' ? 'border-red-500' :
            auditResults.summary?.status === 'NEEDS_ATTENTION' ? 'border-yellow-500' :
            'border-green-500'
          }>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Audit Summary</span>
                <Badge className={
                  auditResults.summary?.status === 'CRITICAL' ? 'bg-red-600' :
                  auditResults.summary?.status === 'NEEDS_ATTENTION' ? 'bg-yellow-600' :
                  'bg-green-600'
                }>
                  {auditResults.summary?.status}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="text-center">
                  <p className="text-3xl font-bold text-green-600">{auditResults.summary?.passed}</p>
                  <p className="text-sm text-gray-600">Passed</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-yellow-600">{auditResults.summary?.warnings}</p>
                  <p className="text-sm text-gray-600">Warnings</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-red-600">{auditResults.summary?.critical}</p>
                  <p className="text-sm text-gray-600">Critical</p>
                </div>
                <div className="text-center">
                  <p className="text-3xl font-bold text-blue-600">{auditResults.summary?.compliance_score}%</p>
                  <p className="text-sm text-gray-600">Score</p>
                </div>
              </div>
              <p className="text-xs text-gray-500 mt-4 text-center">
                Audited by: {auditResults.auditor} • {format(new Date(auditResults.generated_at), 'PPpp')}
              </p>
            </CardContent>
          </Card>

          {/* Critical Issues */}
          {auditResults.findings?.critical?.length > 0 && (
            <Card className="border-red-500">
              <CardHeader className="bg-red-50">
                <CardTitle className="flex items-center gap-2 text-red-900">
                  <XCircle className="w-5 h-5" />
                  Critical Issues ({auditResults.findings.critical.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {auditResults.findings.critical.map((item, idx) => (
                    <Alert key={idx} className="border-red-300 bg-red-50">
                      <AlertDescription>
                        <div className="space-y-2">
                          <div className="flex items-start justify-between">
                            <div>
                              <Badge className="bg-red-600 mb-2">{item.category}</Badge>
                              <p className="font-semibold text-red-900">{item.issue}</p>
                              {item.error && <p className="text-xs text-red-700 mt-1">Error: {item.error}</p>}
                            </div>
                          </div>
                          {item.recommendation && (
                            <div className="bg-white rounded p-3 border border-red-200">
                              <p className="text-sm text-red-900">
                                <strong>Action Required:</strong> {item.recommendation}
                              </p>
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Warnings */}
          {auditResults.findings?.warnings?.length > 0 && (
            <Card className="border-yellow-500">
              <CardHeader className="bg-yellow-50">
                <CardTitle className="flex items-center gap-2 text-yellow-900">
                  <AlertTriangle className="w-5 h-5" />
                  Warnings ({auditResults.findings.warnings.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="space-y-3">
                  {auditResults.findings.warnings.map((item, idx) => (
                    <Alert key={idx} className="border-yellow-300 bg-yellow-50">
                      <AlertDescription>
                        <div className="space-y-2">
                          <div>
                            <Badge className="bg-yellow-600 mb-2">{item.category}</Badge>
                            <p className="font-semibold text-yellow-900">{item.issue}</p>
                            {item.severity && (
                              <Badge variant="outline" className="text-xs mt-1">
                                Severity: {item.severity}
                              </Badge>
                            )}
                          </div>
                          {item.recommendation && (
                            <div className="bg-white rounded p-3 border border-yellow-200">
                              <p className="text-sm text-yellow-900">
                                <strong>Recommendation:</strong> {item.recommendation}
                              </p>
                            </div>
                          )}
                        </div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Passed Checks */}
          {auditResults.findings?.passed?.length > 0 && (
            <Card className="border-green-500">
              <CardHeader className="bg-green-50">
                <CardTitle className="flex items-center gap-2 text-green-900">
                  <CheckCircle2 className="w-5 h-5" />
                  Passed Checks ({auditResults.findings.passed.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4">
                <div className="grid md:grid-cols-2 gap-3">
                  {auditResults.findings.passed.map((item, idx) => (
                    <div key={idx} className="flex items-start gap-2 p-3 bg-green-50 rounded-lg border border-green-200">
                      <CheckCircle2 className="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs text-green-700 font-medium">{item.category}</p>
                        <p className="text-sm text-green-900">{item.check}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          {auditResults.findings?.recommendations?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="w-5 h-5" />
                  Recommendations ({auditResults.findings.recommendations.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {auditResults.findings.recommendations.map((item, idx) => (
                    <div key={idx} className="p-3 bg-blue-50 rounded-lg border border-blue-200">
                      <Badge variant="outline" className="mb-2">{item.category}</Badge>
                      <p className="text-sm text-blue-900">{item.recommendation}</p>
                      {item.notes && <p className="text-xs text-blue-700 mt-1">{item.notes}</p>}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Recent Audit History */}
      {recentAudits.length > 0 && !auditResults && (
        <Card>
          <CardHeader>
            <CardTitle>Recent Audit History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {recentAudits.map((audit, idx) => (
                <div key={idx} className="p-3 border rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">{format(new Date(audit.timestamp), 'PPpp')}</p>
                    <p className="text-xs text-gray-600">
                      By: {audit.user_email} • 
                      Passed: {audit.details?.findings_count?.passed} • 
                      Warnings: {audit.details?.findings_count?.warnings} • 
                      Critical: {audit.details?.findings_count?.critical}
                    </p>
                  </div>
                  <Badge className={
                    audit.details?.summary?.status === 'CRITICAL' ? 'bg-red-600' :
                    audit.details?.summary?.status === 'NEEDS_ATTENTION' ? 'bg-yellow-600' :
                    'bg-green-600'
                  }>
                    {audit.details?.summary?.compliance_score}%
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* HIPAA Compliance Checklist */}
      {!auditResults && (
        <Card>
          <CardHeader>
            <CardTitle>HIPAA Compliance Checklist</CardTitle>
            <CardDescription>Areas covered by the security audit</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Lock className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Authentication & Authorization</p>
                  <p className="text-xs text-gray-600 mt-1">User roles, access controls, session management</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <FileText className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Audit Trail Logging</p>
                  <p className="text-xs text-gray-600 mt-1">PHI access tracking and compliance logs</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Database className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Data Encryption</p>
                  <p className="text-xs text-gray-600 mt-1">At-rest and in-transit encryption verification</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Eye className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Access Controls (RLS)</p>
                  <p className="text-xs text-gray-600 mt-1">Row-level security and data minimization</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Server className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Webhook Security</p>
                  <p className="text-xs text-gray-600 mt-1">Signature verification and secure endpoints</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Key className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">API Key Management</p>
                  <p className="text-xs text-gray-600 mt-1">Secure key storage and production validation</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Activity className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Breach Detection</p>
                  <p className="text-xs text-gray-600 mt-1">Suspicious activity and anomaly detection</p>
                </div>
              </div>
              <div className="flex items-start gap-3 p-3 bg-blue-50 rounded-lg">
                <Shield className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-sm">Session Security</p>
                  <p className="text-xs text-gray-600 mt-1">Timeout policies and inactive user monitoring</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}