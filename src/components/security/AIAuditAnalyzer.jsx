import { useState } from 'react';
import { base44 } from '@/api/base44Client';
import { useAICall } from "@/hooks/useAICall";
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { AlertTriangle, CheckCircle, Clock, TrendingUp, FileText, Shield } from 'lucide-react';
import { toast } from 'sonner';

export default function AIAuditAnalyzer() {
  const ai = useAICall();
  const [analysisResults, setAnalysisResults] = useState(null);

  const { data: user } = useQuery({
    queryKey: ['current-user'],
    queryFn: () => base44.auth.me(),
  });

  const { data: activities = [] } = useQuery({
    queryKey: ['user-activities'],
    queryFn: () => base44.entities.UserActivity.list('-created_date', 500),
    enabled: user?.role === 'admin',
  });

  const { data: securityLogs = [] } = useQuery({
    queryKey: ['security-logs'],
    queryFn: () => base44.entities.SecurityLog.list('-timestamp', 500),
    enabled: user?.role === 'admin',
  });

  const { data: visits = [] } = useQuery({
    queryKey: ['visits-audit'],
    queryFn: () => base44.entities.Visit.list('-created_date', 200),
    enabled: user?.role === 'admin',
  });

  const analyzePatterns = async () => {
    try {
      const analysisPrompt = `Analyze the following healthcare documentation and user activity data for suspicious patterns, compliance violations, and security concerns:

User Activities (last 500 actions):
${JSON.stringify(activities.slice(0, 50), null, 2)}

Security Logs:
${JSON.stringify(securityLogs.slice(0, 30), null, 2)}

Recent Visits/Documentation:
${JSON.stringify(visits.slice(0, 30), null, 2)}

Analyze and identify:
1. Unusual access patterns (e.g., after-hours access, excessive data access)
2. Documentation anomalies (e.g., backdated entries, missing required fields)
3. Suspicious user behavior (e.g., rapid deletions, bulk exports)
4. Compliance violations (e.g., incomplete documentation, missing signatures)
5. Security concerns (e.g., multiple failed login attempts, unauthorized access)

For each issue found, provide:
- Type (access_pattern, documentation_anomaly, suspicious_behavior, compliance_violation, security_concern)
- Severity (critical, high, medium, low)
- Description
- Affected users/records
- Recommended actions`;

      const response = await ai.run({
        model: "claude_opus_4_8",
        prompt: analysisPrompt,
        response_json_schema: {
          type: 'object',
          properties: {
            issues: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string' },
                  severity: { type: 'string' },
                  description: { type: 'string' },
                  affected_items: { type: 'array', items: { type: 'string' } },
                  recommended_actions: { type: 'array', items: { type: 'string' } },
                  timestamp: { type: 'string' },
                },
              },
            },
            summary: { type: 'string' },
            overall_risk_score: { type: 'number' },
            trends: { type: 'array', items: { type: 'string' } },
          },
        },
      });

      setAnalysisResults(response);
      toast.success('AI audit analysis completed');
    } catch (error) {
      console.error('Analysis error:', error);
      toast.error('Failed to analyze audit data');
    }
  };

  const severityConfig = {
    critical: { color: 'bg-red-100 text-red-800 border-red-300', icon: AlertTriangle },
    high: { color: 'bg-orange-100 text-orange-800 border-orange-300', icon: AlertTriangle },
    medium: { color: 'bg-yellow-100 text-yellow-800 border-yellow-300', icon: Clock },
    low: { color: 'bg-blue-100 text-blue-800 border-blue-300', icon: CheckCircle },
  };

  const typeLabels = {
    access_pattern: 'Access Pattern',
    documentation_anomaly: 'Documentation Anomaly',
    suspicious_behavior: 'Suspicious Behavior',
    compliance_violation: 'Compliance Violation',
    security_concern: 'Security Concern',
  };

  if (user?.role !== 'admin') {
    return (
      <Alert>
        <Shield className="h-4 w-4" />
        <AlertTitle>Admin Access Required</AlertTitle>
        <AlertDescription>
          AI audit analysis is only available to administrators.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="shadow-lg">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="w-5 h-5" />
            AI-Powered Audit Analysis
          </CardTitle>
          <CardDescription>
            Leverage AI to detect suspicious patterns, compliance violations, and security concerns in real-time
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-slate-600">
              Analyzing {activities.length} activities, {securityLogs.length} security logs, and {visits.length} visits
            </div>
            <Button
              onClick={analyzePatterns}
              disabled={ai.loading}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {ai.loading ? (
                <>
                  <Clock className="w-4 h-4 mr-2 animate-spin" />
                  Analyzing...
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Run AI Analysis
                </>
              )}
            </Button>
          </div>

          {analysisResults && (
            <div className="space-y-6 mt-6">
              {/* Summary Stats */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <Card className="shadow-sm">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-blue-600">
                        {analysisResults.overall_risk_score || 0}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">Overall Risk Score</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-red-600">
                        {analysisResults.issues?.filter(i => i.severity === 'critical').length || 0}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">Critical Issues</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-orange-600">
                        {analysisResults.issues?.filter(i => i.severity === 'high').length || 0}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">High Priority</div>
                    </div>
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardContent className="pt-6">
                    <div className="text-center">
                      <div className="text-3xl font-bold text-slate-600">
                        {analysisResults.issues?.length || 0}
                      </div>
                      <div className="text-sm text-slate-600 mt-1">Total Issues</div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Summary */}
              {analysisResults.summary && (
                <Alert className="border-blue-300 bg-blue-50">
                  <FileText className="h-4 w-4" />
                  <AlertTitle>Analysis Summary</AlertTitle>
                  <AlertDescription>{analysisResults.summary}</AlertDescription>
                </Alert>
              )}

              {/* Trends */}
              {analysisResults.trends && analysisResults.trends.length > 0 && (
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-lg flex items-center gap-2">
                      <TrendingUp className="w-4 h-4" />
                      Identified Trends
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {analysisResults.trends.map((trend, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500 mt-2" />
                          <span className="text-sm text-slate-700">{trend}</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {/* Issues List */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold">Detected Issues</h3>
                {analysisResults.issues && analysisResults.issues.length > 0 ? (
                  analysisResults.issues.map((issue, idx) => {
                    const config = severityConfig[issue.severity] || severityConfig.medium;
                    const Icon = config.icon;

                    return (
                      <Card key={idx} className={`border-l-4 ${config.color} shadow-sm`}>
                        <CardContent className="pt-6">
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Icon className="w-5 h-5" />
                                <Badge variant="outline" className={config.color}>
                                  {issue.severity?.toUpperCase()}
                                </Badge>
                                <Badge variant="secondary">
                                  {typeLabels[issue.type] || issue.type}
                                </Badge>
                              </div>
                              <p className="text-sm font-medium text-slate-900 mb-2">
                                {issue.description}
                              </p>
                              
                              {issue.affected_items && issue.affected_items.length > 0 && (
                                <div className="mb-3">
                                  <div className="text-xs font-semibold text-slate-600 mb-1">
                                    Affected Items:
                                  </div>
                                  <div className="flex flex-wrap gap-1">
                                    {issue.affected_items.map((item, i) => (
                                      <Badge key={i} variant="outline" className="text-xs">
                                        {item}
                                      </Badge>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {issue.recommended_actions && issue.recommended_actions.length > 0 && (
                                <div className="bg-slate-50 rounded-lg p-3 mt-3">
                                  <div className="text-xs font-semibold text-slate-600 mb-2">
                                    Recommended Actions:
                                  </div>
                                  <ul className="space-y-1">
                                    {issue.recommended_actions.map((action, i) => (
                                      <li key={i} className="text-xs text-slate-700 flex items-start gap-2">
                                        <CheckCircle className="w-3 h-3 mt-0.5 text-green-600" />
                                        {action}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })
                ) : (
                  <Alert>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertTitle>No Issues Detected</AlertTitle>
                    <AlertDescription>
                      The AI analysis found no suspicious patterns or compliance violations.
                    </AlertDescription>
                  </Alert>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}