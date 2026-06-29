import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Shield,
  Calendar,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Play,
  FileText,
  TrendingUp
} from "lucide-react";
import { formatEastern } from "../utils/timezone";

export default function SecurityAuditScheduler() {
  const [runningAudit, setRunningAudit] = useState(false);
  const queryClient = useQueryClient();

  // Fetch security audit history
  const { data: auditHistory = [] } = useQuery({
    queryKey: ['securityAudits'],
    queryFn: async () => {
      const audits = await base44.entities.SecurityLog.filter(
        { action: 'security_audit' },
        '-created_date',
        50
      );
      return audits;
    },
    initialData: [],
  });

  // Run a security audit
  const runAudit = async () => {
    setRunningAudit(true);
    try {
      // Fetch all relevant data
      const [users, patients, _visits, activities] = await Promise.all([
        base44.asServiceRole.entities.User.list('-created_date', 100),
        base44.asServiceRole.entities.Patient.list('-created_date', 100),
        base44.asServiceRole.entities.Visit.list('-created_date', 100),
        base44.asServiceRole.entities.UserActivity.list('-created_date', 1000)
      ]);

      const findings = [];
      let score = 100;

      // Check 1: Inactive users with access
      const inactiveUsers = users.filter(user => {
        const lastActivity = activities.find(a => a.user_email === user.email);
        if (!lastActivity) return true;
        const daysSinceActivity = (Date.now() - new Date(lastActivity.created_date).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceActivity > 90;
      });

      if (inactiveUsers.length > 0) {
        findings.push({
          severity: 'medium',
          category: 'Access Control',
          issue: `${inactiveUsers.length} inactive user(s) detected (no activity in 90+ days)`,
          recommendation: 'Review and disable accounts that are no longer active',
          affected_count: inactiveUsers.length
        });
        score -= 5;
      }

      // Check 2: Failed login attempts
      const failedLogins = activities.filter(a => 
        a.action?.includes('login_failed') || a.action?.includes('access_denied')
      );

      if (failedLogins.length > 10) {
        findings.push({
          severity: 'high',
          category: 'Authentication',
          issue: `${failedLogins.length} failed authentication attempts detected`,
          recommendation: 'Monitor for potential brute force attacks. Consider implementing rate limiting.',
          affected_count: failedLogins.length
        });
        score -= 10;
      }

      // Check 3: PHI access patterns
      const phiAccess = activities.filter(a => 
        a.entity_type === 'Patient' || a.entity_type === 'Visit'
      );

      const suspiciousAccess = phiAccess.filter(access => {
        const userAccess = phiAccess.filter(a => a.user_email === access.user_email);
        // Flag if user accessed more than 50 patient records in a day
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayAccess = userAccess.filter(a => new Date(a.created_date) >= today);
        return todayAccess.length > 50;
      });

      if (suspiciousAccess.length > 0) {
        findings.push({
          severity: 'critical',
          category: 'Data Access',
          issue: 'Unusual PHI access patterns detected',
          recommendation: 'Review access patterns for potential data breach or misuse',
          affected_count: new Set(suspiciousAccess.map(s => s.user_email)).size
        });
        score -= 15;
      }

      // Check 4: Unencrypted sessions
      if (!window.isSecureContext) {
        findings.push({
          severity: 'critical',
          category: 'Encryption',
          issue: 'Application not running in secure context (HTTPS)',
          recommendation: 'Ensure all access is through HTTPS with valid SSL certificate',
          affected_count: 1
        });
        score -= 20;
      }

      // Check 5: Authentication strength — flag accounts without MFA enrolled.
      const usersWithoutStrongAuth = users.filter(u => !u.mfa_enabled);
      if (usersWithoutStrongAuth.length > 0) {
        findings.push({
          severity: 'medium',
          category: 'Authentication',
          issue: `${usersWithoutStrongAuth.length} user(s) without multi-factor authentication`,
          recommendation: 'Encourage or require MFA for all users, especially admins',
          affected_count: usersWithoutStrongAuth.length
        });
        score -= 5;
      }

      // Check 6: Data retention compliance
      const oldPatients = patients.filter(p => {
        if (!p.discharge_date) return false;
        const daysSinceDischarge = (Date.now() - new Date(p.discharge_date).getTime()) / (1000 * 60 * 60 * 24);
        return daysSinceDischarge > 2555; // 7 years
      });

      if (oldPatients.length > 0) {
        findings.push({
          severity: 'low',
          category: 'Data Retention',
          issue: `${oldPatients.length} patient record(s) older than 7 years`,
          recommendation: 'Review data retention policy and archive/purge old records',
          affected_count: oldPatients.length
        });
        score -= 2;
      }

      // Log the audit
      await base44.entities.SecurityLog.create({
        timestamp: new Date().toISOString(),
        user_email: (await base44.auth.me()).email,
        user_role: 'admin',
        action: 'security_audit',
        details: {
          audit_type: 'comprehensive',
          security_score: Math.max(0, score),
          findings_count: findings.length,
          findings: findings,
          checked_users: users.length,
          checked_patients: patients.length,
          checked_activities: activities.length
        }
      });

      queryClient.invalidateQueries({ queryKey: ['securityAudits'] });
      queryClient.invalidateQueries({ queryKey: ['securityLogs'] });
    } catch (error) {
      console.error('Audit failed:', error);
    } finally {
      setRunningAudit(false);
    }
  };

  const lastAudit = auditHistory[0];
  const lastAuditScore = lastAudit?.details?.security_score || 0;
  const lastAuditFindings = lastAudit?.details?.findings || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 border-blue-200">
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Shield className="w-5 h-5 text-blue-600" />
              Security Audit System
            </span>
            <Button 
              onClick={runAudit} 
              disabled={runningAudit}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {runningAudit ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Running Audit...
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 mr-2" />
                  Run Security Audit
                </>
              )}
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-slate-700">
            Comprehensive security audit checks access controls, authentication, data encryption, 
            PHI access patterns, and compliance with HIPAA security requirements.
          </p>
        </CardContent>
      </Card>

      {/* Last Audit Results */}
      {lastAudit && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Security Score</p>
                    <p className={`text-3xl font-bold ${
                      lastAuditScore >= 90 ? 'text-green-600' :
                      lastAuditScore >= 70 ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {lastAuditScore}%
                    </p>
                  </div>
                  <TrendingUp className={`w-8 h-8 ${
                    lastAuditScore >= 90 ? 'text-green-600' :
                    lastAuditScore >= 70 ? 'text-yellow-600' : 'text-red-600'
                  }`} />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Findings</p>
                    <p className="text-3xl font-bold text-slate-900">
                      {lastAuditFindings.length}
                    </p>
                  </div>
                  <FileText className="w-8 h-8 text-blue-600" />
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-600">Last Audit</p>
                    <p className="text-sm font-medium text-slate-900">
                      {formatEastern(new Date(lastAudit.created_date), 'MMM d, yyyy')}
                    </p>
                    <p className="text-xs text-slate-500">
                      {formatEastern(new Date(lastAudit.created_date), 'h:mm a')}
                    </p>
                  </div>
                  <Calendar className="w-8 h-8 text-slate-400" />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Findings */}
          {lastAuditFindings.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-600" />
                  Security Findings
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {lastAuditFindings.map((finding, idx) => (
                  <Alert 
                    key={idx} 
                    className={`${
                      finding.severity === 'critical' ? 'bg-red-50 border-red-300' :
                      finding.severity === 'high' ? 'bg-orange-50 border-orange-300' :
                      finding.severity === 'medium' ? 'bg-yellow-50 border-yellow-300' :
                      'bg-blue-50 border-blue-300'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <AlertTriangle className={`w-5 h-5 mt-0.5 ${
                        finding.severity === 'critical' ? 'text-red-600' :
                        finding.severity === 'high' ? 'text-orange-600' :
                        finding.severity === 'medium' ? 'text-yellow-600' :
                        'text-blue-600'
                      }`} />
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <Badge className={`${
                            finding.severity === 'critical' ? 'bg-red-600' :
                            finding.severity === 'high' ? 'bg-orange-600' :
                            finding.severity === 'medium' ? 'bg-yellow-600' :
                            'bg-blue-600'
                          } text-white text-xs`}>
                            {finding.severity.toUpperCase()}
                          </Badge>
                          <Badge variant="outline" className="text-xs">
                            {finding.category}
                          </Badge>
                        </div>
                        <p className="font-semibold text-sm text-slate-900 mb-1">
                          {finding.issue}
                        </p>
                        <p className="text-xs text-slate-700 mb-2">
                          <strong>Recommendation:</strong> {finding.recommendation}
                        </p>
                        {finding.affected_count > 0 && (
                          <p className="text-xs text-slate-600">
                            Affected: {finding.affected_count} item(s)
                          </p>
                        )}
                      </div>
                    </div>
                  </Alert>
                ))}
              </CardContent>
            </Card>
          )}

          {lastAuditFindings.length === 0 && (
            <Alert className="bg-green-50 border-green-300">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              <AlertDescription className="text-green-900">
                <p className="font-semibold">No Security Issues Detected</p>
                <p className="text-sm">All security checks passed successfully.</p>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Audit History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calendar className="w-5 h-5 text-blue-600" />
            Audit History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {auditHistory.length === 0 ? (
              <p className="text-slate-500 text-center py-8">
                No audit history available. Run your first security audit.
              </p>
            ) : (
              auditHistory.slice(0, 10).map((audit, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-3 rounded-lg border bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Calendar className="w-4 h-4 text-slate-400" />
                    <div>
                      <p className="text-sm font-medium text-slate-900">
                        {formatEastern(new Date(audit.created_date), 'MMM d, yyyy')}
                      </p>
                      <p className="text-xs text-slate-500">
                        {formatEastern(new Date(audit.created_date), 'h:mm a')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge className={`${
                      audit.details?.security_score >= 90 ? 'bg-green-600' :
                      audit.details?.security_score >= 70 ? 'bg-yellow-600' : 'bg-red-600'
                    } text-white`}>
                      {audit.details?.security_score || 0}%
                    </Badge>
                    <span className="text-xs text-slate-600">
                      {audit.details?.findings_count || 0} findings
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}