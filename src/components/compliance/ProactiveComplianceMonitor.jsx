import { useState, useEffect, useCallback } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  TrendingDown,
  Users,
  FileText,
  Eye,
  Bell
} from "lucide-react";

export default function ProactiveComplianceMonitor({ 
  autoMonitor = true,
  refreshInterval = 60000 
}) {
  const [alerts, setAlerts] = useState([]);
  const ai = useAICall();

  const { data: recentAudits = [] } = useQuery({
    queryKey: ['recentComplianceAudits'],
    queryFn: async () => {
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return base44.entities.ComplianceAudit.list('-audit_date', 100);
    },
    initialData: [],
    refetchInterval: autoMonitor ? refreshInterval : false,
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const analyzePatterns = useCallback(async () => {
    if (recentAudits.length < 5) return;

    try {
      // Analyze patterns in recent audits
      const allIssues = recentAudits.flatMap(a => a.issues || []);
      const issueFrequency = {};
      
      allIssues.forEach(issue => {
        const key = issue.element;
        issueFrequency[key] = (issueFrequency[key] || 0) + 1;
      });

      // Identify declining trends
      const recentScores = recentAudits.slice(0, 10).map(a => a.compliance_score || 0);
      const avgRecent = recentScores.reduce((a, b) => a + b, 0) / recentScores.length;
      const olderScores = recentAudits.slice(10, 20).map(a => a.compliance_score || 0);
      const avgOlder = olderScores.length > 0 
        ? olderScores.reduce((a, b) => a + b, 0) / olderScores.length 
        : avgRecent;

      // Nurse-specific patterns
      const nurseStats = {};
      recentAudits.forEach(audit => {
        const nurse = audit.nurse_email;
        if (!nurseStats[nurse]) {
          nurseStats[nurse] = { scores: [], issues: [] };
        }
        nurseStats[nurse].scores.push(audit.compliance_score || 0);
        nurseStats[nurse].issues.push(...(audit.issues || []));
      });

      // Use AI to identify critical patterns
      const patternAnalysis = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Analyze Medicare compliance patterns for Pennsylvania home health agency. Identify critical trends requiring immediate attention.

RECENT DATA:
- Total Audits: ${recentAudits.length}
- Recent Avg Score (last 10): ${avgRecent.toFixed(1)}%
- Previous Avg Score: ${avgOlder.toFixed(1)}%
- Score Trend: ${avgRecent < avgOlder ? 'DECLINING' : avgRecent > avgOlder ? 'IMPROVING' : 'STABLE'}

FREQUENT ISSUES:
${Object.entries(issueFrequency)
  .sort((a, b) => b[1] - a[1])
  .slice(0, 5)
  .map(([issue, count]) => `${issue}: ${count} occurrences`)
  .join('\n')}

MEDICARE RULES REFERENCE:
${medicareRules.slice(0, 3).map(r => `${r.rule_name} (${r.cop_reference})`).join('\n')}

Identify:
1. Critical patterns (systemic issues appearing >20% of audits)
2. Declining trends (specific CoP areas getting worse)
3. At-risk nurses (consistently low scores <80%)
4. Urgent interventions needed

Return JSON with: critical_patterns array (with pattern, frequency, cop_reference, severity, recommended_action), declining_areas array, at_risk_nurses array, urgent_actions array.`,
        response_json_schema: {
          type: "object",
          properties: {
            critical_patterns: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  pattern: { type: "string" },
                  frequency: { type: "number" },
                  cop_reference: { type: "string" },
                  severity: { type: "string" },
                  recommended_action: { type: "string" }
                }
              }
            },
            declining_areas: { type: "array", items: { type: "string" } },
            at_risk_nurses: { type: "array", items: { type: "string" } },
            urgent_actions: { type: "array", items: { type: "string" } }
          }
        }
      });

      // Create alerts
      const newAlerts = [];

      // Score decline alert
      if (avgRecent < avgOlder - 5) {
        newAlerts.push({
          type: 'trend',
          severity: 'high',
          title: 'Compliance Scores Declining',
          message: `Average compliance dropped from ${avgOlder.toFixed(1)}% to ${avgRecent.toFixed(1)}% in recent visits.`,
          action: 'Review recent documentation training and identify root causes.',
          icon: TrendingDown
        });
      }

      // Critical pattern alerts
      patternAnalysis.critical_patterns?.forEach(pattern => {
        if (pattern.frequency > recentAudits.length * 0.2) {
          newAlerts.push({
            type: 'pattern',
            severity: pattern.severity,
            title: `Recurring: ${pattern.pattern}`,
            message: `Appears in ${pattern.frequency} of ${recentAudits.length} audits (${(pattern.frequency / recentAudits.length * 100).toFixed(1)}%)`,
            cop_reference: pattern.cop_reference,
            action: pattern.recommended_action,
            icon: FileText
          });
        }
      });

      // At-risk nurse alerts
      patternAnalysis.at_risk_nurses?.forEach(nurse => {
        const nurseData = nurseStats[nurse];
        if (nurseData) {
          const avgScore = nurseData.scores.reduce((a, b) => a + b, 0) / nurseData.scores.length;
          if (avgScore < 80) {
            newAlerts.push({
              type: 'nurse',
              severity: 'medium',
              title: `Nurse Needs Support: ${nurse}`,
              message: `Average compliance score: ${avgScore.toFixed(1)}%`,
              action: 'Provide targeted training and mentoring.',
              icon: Users
            });
          }
        }
      });

      setAlerts(newAlerts);
    } catch (error) {
      console.error('Pattern analysis error:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- AI hook object is intentionally omitted; its run() is stable, and including it would re-fire the call every render
  }, [medicareRules, recentAudits]);

  useEffect(() => {
    if (autoMonitor && recentAudits.length > 0) {
      analyzePatterns();
    }
  }, [recentAudits, autoMonitor, analyzePatterns]);

  const getSeverityColor = (severity) => {
    switch (severity) {
      case 'critical': return 'border-red-400 bg-red-50';
      case 'high': return 'border-orange-400 bg-orange-50';
      case 'medium': return 'border-yellow-400 bg-yellow-50';
      default: return 'border-blue-400 bg-blue-50';
    }
  };

  if (ai.loading) {
    return (
      <Card className="border-2 border-blue-200">
        <CardContent className="p-6 text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-sm text-slate-600">Analyzing compliance patterns...</p>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) {
    return (
      <Card className="border-2 border-green-200 bg-green-50">
        <CardContent className="p-6 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <Bell className="w-8 h-8 text-green-600" />
          </div>
          <p className="text-sm font-medium text-green-900">No Critical Compliance Alerts</p>
          <p className="text-xs text-green-700 mt-1">System is monitoring for patterns</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-2 border-orange-200">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600" />
          Proactive Compliance Alerts
          <Badge className="ml-auto bg-orange-600">{alerts.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {alerts.map((alert, idx) => (
          <Alert key={idx} className={`${getSeverityColor(alert.severity)} border-2`}>
            <alert.icon className="w-5 h-5" />
            <AlertDescription>
              <div className="space-y-2">
                <div>
                  <p className="font-semibold text-sm">{alert.title}</p>
                  <p className="text-xs mt-1">{alert.message}</p>
                  {alert.cop_reference && (
                    <Badge variant="outline" className="mt-1 text-xs">
                      {alert.cop_reference}
                    </Badge>
                  )}
                </div>
                <div className="bg-white p-2 rounded border">
                  <p className="text-xs font-semibold text-slate-700">Recommended Action:</p>
                  <p className="text-xs text-slate-600">{alert.action}</p>
                </div>
              </div>
            </AlertDescription>
          </Alert>
        ))}

        <Button 
          variant="outline" 
          size="sm" 
          onClick={analyzePatterns}
          className="w-full"
        >
          <Eye className="w-4 h-4 mr-2" />
          Refresh Analysis
        </Button>
      </CardContent>
    </Card>
  );
}