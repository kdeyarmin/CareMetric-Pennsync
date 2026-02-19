import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { base44 } from '@/api/base44Client';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  Shield, 
  CheckCircle,
  AlertTriangle,
  TrendingUp,
  Award
} from 'lucide-react';

export default function ComplianceScorecard({ nurseEmail }) {
  const { data: complianceAudits } = useQuery({
    queryKey: ['compliance-audits', nurseEmail],
    queryFn: async () => {
      if (nurseEmail) {
        return await base44.entities.ComplianceAudit.filter({ user_email: nurseEmail });
      }
      return await base44.entities.ComplianceAudit.filter({});
    }
  });

  const { data: violations } = useQuery({
    queryKey: ['compliance-violations', nurseEmail],
    queryFn: async () => {
      if (nurseEmail) {
        return await base44.entities.ComplianceViolation.filter({ user_email: nurseEmail, status: 'open' });
      }
      return await base44.entities.ComplianceViolation.filter({ status: 'open' });
    }
  });

  const avgComplianceScore = complianceAudits?.reduce((sum, a) => 
    sum + (a.compliance_score || 0), 0
  ) / (complianceAudits?.length || 1) || 0;

  const criticalViolations = violations?.filter(v => v.severity === 'critical').length || 0;
  const highViolations = violations?.filter(v => v.severity === 'high').length || 0;
  const mediumViolations = violations?.filter(v => v.severity === 'medium').length || 0;

  const getScoreColor = (score) => {
    if (score >= 95) return 'text-green-600';
    if (score >= 85) return 'text-yellow-600';
    return 'text-red-600';
  };

  const getScoreStatus = (score) => {
    if (score >= 95) return { label: 'Excellent', color: 'bg-green-100 text-green-800' };
    if (score >= 85) return { label: 'Good', color: 'bg-yellow-100 text-yellow-800' };
    if (score >= 70) return { label: 'Fair', color: 'bg-orange-100 text-orange-800' };
    return { label: 'Needs Improvement', color: 'bg-red-100 text-red-800' };
  };

  const status = getScoreStatus(avgComplianceScore);

  return (
    <div className="space-y-4">
      {/* Overall Score */}
      <Card className="border-2 border-blue-300">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Compliance Scorecard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center mb-6">
            <div className={`text-6xl font-bold mb-2 ${getScoreColor(avgComplianceScore)}`}>
              {avgComplianceScore.toFixed(1)}
            </div>
            <Badge className={status.color}>
              {status.label}
            </Badge>
          </div>

          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">Compliance Score</span>
              <span className="text-sm font-bold">{avgComplianceScore.toFixed(0)}%</span>
            </div>
            <Progress value={avgComplianceScore} className="h-3" />
          </div>

          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-2xl font-bold text-red-900">{criticalViolations}</p>
              <p className="text-xs text-red-700">Critical</p>
            </div>
            <div className="p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-2xl font-bold text-orange-900">{highViolations}</p>
              <p className="text-xs text-orange-700">High</p>
            </div>
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <p className="text-2xl font-bold text-yellow-900">{mediumViolations}</p>
              <p className="text-xs text-yellow-700">Medium</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Recent Audits */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Recent Compliance Audits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {complianceAudits?.slice(0, 5).map(audit => (
              <div key={audit.id} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                <div className="flex-1">
                  <p className="text-sm font-medium">{audit.audit_type}</p>
                  <p className="text-xs text-slate-600">
                    {new Date(audit.audit_date).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-sm font-bold ${getScoreColor(audit.compliance_score)}`}>
                    {audit.compliance_score.toFixed(0)}%
                  </span>
                  {audit.compliance_score >= 95 ? (
                    <CheckCircle className="h-4 w-4 text-green-600" />
                  ) : (
                    <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  )}
                </div>
              </div>
            ))}

            {(!complianceAudits || complianceAudits.length === 0) && (
              <p className="text-sm text-slate-600 text-center py-4">No audits yet</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Improvement Areas */}
      {violations && violations.length > 0 && (
        <Card className="border-2 border-yellow-300">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-600" />
              Areas for Improvement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {violations.slice(0, 5).map(violation => (
                <div key={violation.id} className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                  <p className="font-medium text-sm text-yellow-900 mb-1">
                    {violation.rule_name}
                  </p>
                  <p className="text-xs text-yellow-800">{violation.violation_description}</p>
                  <Badge className="mt-2 text-xs bg-yellow-100 text-yellow-800">
                    {violation.severity}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}