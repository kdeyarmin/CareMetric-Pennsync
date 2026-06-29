import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { useAICall } from "@/hooks/useAICall";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  FileText,
  Download,
  TrendingUp,
  AlertTriangle,
  Users,
  Calendar
} from "lucide-react";
import { format } from "date-fns";

export default function ComplianceReportGenerator({ 
  dateRange = 7,
  nurseEmail = null 
}) {
  const ai = useAICall();
  const [reportData, setReportData] = useState(null);

  const { data: audits = [] } = useQuery({
    queryKey: ['complianceAudits', dateRange],
    queryFn: async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - dateRange);
      const all = await base44.entities.ComplianceAudit.filter({}, '-audit_date', 1000);
      // Actually apply the date window (previously computed but never used).
      return (all || []).filter((a) => {
        if (!a.audit_date) return false;
        const d = new Date(a.audit_date);
        return !Number.isNaN(d.getTime()) && d >= startDate;
      });
    },
    initialData: [],
  });

  const { data: medicareRules = [] } = useQuery({
    queryKey: ['medicareComplianceRules'],
    queryFn: () => base44.entities.MedicareComplianceRule.list(),
    initialData: [],
  });

  const generateReport = async () => {
    try {
      const filteredAudits = nurseEmail 
        ? audits.filter(a => a.nurse_email === nurseEmail)
        : audits;

      // Aggregate compliance data. Guard the divide-by-zero so an empty set shows
      // "no data" instead of NaN.
      const totalAudits = filteredAudits.length;
      const avgScore = totalAudits > 0
        ? filteredAudits.reduce((sum, a) => sum + (a.compliance_score || 0), 0) / totalAudits
        : null;

      const criticalIssues = filteredAudits.flatMap(a => 
        (a.issues || []).filter(i => i.severity === 'critical')
      );

      const commonGaps = {};
      filteredAudits.forEach(audit => {
        (audit.issues || []).forEach(issue => {
          const key = issue.element;
          commonGaps[key] = (commonGaps[key] || 0) + 1;
        });
      });

      const topGaps = Object.entries(commonGaps)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([element, count]) => ({ element, count, percentage: (count / totalAudits * 100).toFixed(1) }));

      // Use AI to generate insights
      const aiInsights = await ai.run({
        model: "claude_opus_4_8",
        prompt: `Generate Medicare compliance insights report for Pennsylvania home health agency.

DATA:
- Total Visits Audited: ${totalAudits}
- Average Compliance Score: ${avgScore == null ? 'No data' : `${avgScore.toFixed(1)}%`}
- Critical Issues Found: ${criticalIssues.length}
- Top Documentation Gaps: ${topGaps.map(g => `${g.element} (${g.count} occurrences)`).join(', ')}

MEDICARE RULES REFERENCE:
${medicareRules.slice(0, 5).map(r => `${r.rule_name} (${r.cop_reference})`).join('\n')}

Generate:
1. Executive Summary (2-3 sentences)
2. Key Findings (3-5 bullet points)
3. Compliance Trends (improving, stable, declining)
4. Top Remediation Actions (specific steps to improve)
5. Training Recommendations (what staff need to learn)
6. Risk Assessment (low, medium, high risk areas)

Focus on 42 CFR 484 CoP requirements for home health.

Return JSON with sections: executive_summary, key_findings array, trends, remediation_actions array, training_recommendations array, risk_assessment.`,
        response_json_schema: {
          type: "object",
          properties: {
            executive_summary: { type: "string" },
            key_findings: { type: "array", items: { type: "string" } },
            trends: { type: "string" },
            remediation_actions: { type: "array", items: { type: "string" } },
            training_recommendations: { type: "array", items: { type: "string" } },
            risk_assessment: { type: "string" }
          }
        }
      });

      setReportData({
        metadata: {
          generated_date: new Date().toISOString(),
          date_range: dateRange,
          total_audits: totalAudits,
          nurse_email: nurseEmail
        },
        metrics: {
          average_compliance_score: avgScore,
          critical_issues_count: criticalIssues.length,
          total_issues: filteredAudits.reduce((sum, a) => sum + (a.issues?.length || 0), 0)
        },
        top_gaps: topGaps,
        ai_insights: aiInsights,
        critical_issues: criticalIssues.slice(0, 10)
      });
    } catch (error) {
      console.error('Error generating report:', error);
      toast.error("The AI request didn't complete. Please try again.");
    }
  };

  const downloadReport = async () => {
    if (!reportData) return;

    const reportText = `
MEDICARE COMPLIANCE REPORT
Pennsylvania Home Health Agency
42 CFR 484 Conditions of Participation

Generated: ${format(new Date(reportData.metadata.generated_date), 'PPpp')}
Period: Last ${dateRange} days
${nurseEmail ? `Nurse: ${nurseEmail}` : 'All Nurses'}

============================================
EXECUTIVE SUMMARY
============================================
${reportData.ai_insights.executive_summary}

============================================
KEY METRICS
============================================
• Total Visits Audited: ${reportData.metadata.total_audits}
• Average Compliance Score: ${reportData.metrics.average_compliance_score == null ? 'No data' : `${reportData.metrics.average_compliance_score.toFixed(1)}%`}
• Critical Issues: ${reportData.metrics.critical_issues_count}
• Total Issues: ${reportData.metrics.total_issues}

============================================
TOP DOCUMENTATION GAPS
============================================
${reportData.top_gaps.map((gap, i) => 
  `${i + 1}. ${gap.element} - ${gap.count} occurrences (${gap.percentage}% of visits)`
).join('\n')}

============================================
KEY FINDINGS
============================================
${reportData.ai_insights.key_findings.map((f, i) => `${i + 1}. ${f}`).join('\n')}

============================================
COMPLIANCE TRENDS
============================================
${reportData.ai_insights.trends}

============================================
REMEDIATION ACTIONS
============================================
${reportData.ai_insights.remediation_actions.map((a, i) => `${i + 1}. ${a}`).join('\n')}

============================================
TRAINING RECOMMENDATIONS
============================================
${reportData.ai_insights.training_recommendations.map((r, i) => `${i + 1}. ${r}`).join('\n')}

============================================
RISK ASSESSMENT
============================================
${reportData.ai_insights.risk_assessment}

============================================
CRITICAL ISSUES REQUIRING IMMEDIATE ATTENTION
============================================
${reportData.critical_issues.slice(0, 10).map((issue, i) => 
  `${i + 1}. ${issue.element}: ${issue.problem}\n   CMS Reference: ${issue.cop_reference || 'See 42 CFR 484'}`
).join('\n\n')}

Report generated by Penn Sync AI Compliance System
    `.trim();

    const blob = new Blob([reportText], { type: 'text/plain' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Medicare_Compliance_Report_${format(new Date(), 'yyyy-MM-dd')}.txt`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    a.remove();
  };

  return (
    <Card className="border-2 border-blue-200">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="w-5 h-5 text-blue-600" />
          Medicare Compliance Report Generator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {!reportData ? (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              Generate comprehensive compliance report analyzing documentation against 42 CFR 484 requirements.
            </p>
            <div className="flex items-center gap-2 text-sm text-slate-700">
              <Calendar className="w-4 h-4" />
              <span>Last {dateRange} days</span>
              {nurseEmail && (
                <>
                  <Users className="w-4 h-4 ml-2" />
                  <span>{nurseEmail}</span>
                </>
              )}
            </div>
            <Button 
              onClick={generateReport} 
              disabled={ai.loading || audits.length === 0}
              className="w-full"
            >
              {ai.loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Generating Report...
                </>
              ) : (
                <>
                  <TrendingUp className="w-4 h-4 mr-2" />
                  Generate Compliance Report
                </>
              )}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Metrics Overview */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 p-3 rounded border border-blue-200">
                <p className="text-2xl font-bold text-blue-600">
                  {reportData.metrics.average_compliance_score == null
                    ? 'No data'
                    : `${reportData.metrics.average_compliance_score.toFixed(1)}%`}
                </p>
                <p className="text-xs text-slate-600">Avg Score</p>
              </div>
              <div className="bg-red-50 p-3 rounded border border-red-200">
                <p className="text-2xl font-bold text-red-600">
                  {reportData.metrics.critical_issues_count}
                </p>
                <p className="text-xs text-slate-600">Critical Issues</p>
              </div>
              <div className="bg-green-50 p-3 rounded border border-green-200">
                <p className="text-2xl font-bold text-green-600">
                  {reportData.metadata.total_audits}
                </p>
                <p className="text-xs text-slate-600">Audits</p>
              </div>
            </div>

            {/* Executive Summary */}
            <Card className="bg-gradient-to-r from-blue-50 to-indigo-50">
              <CardContent className="p-4">
                <p className="text-sm font-semibold text-blue-900 mb-2">Executive Summary</p>
                <p className="text-sm text-slate-700">{reportData.ai_insights.executive_summary}</p>
              </CardContent>
            </Card>

            {/* Top Gaps */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-600" />
                  Top Documentation Gaps
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {reportData.top_gaps.map((gap, idx) => (
                  <div key={idx} className="flex items-center justify-between p-2 bg-slate-50 rounded">
                    <span className="text-sm">{gap.element}</span>
                    <Badge variant="outline">{gap.count} ({gap.percentage}%)</Badge>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Key Findings */}
            <Card>
              <CardHeader className="py-3">
                <CardTitle className="text-sm">Key Findings</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {reportData.ai_insights.key_findings.map((finding, idx) => (
                    <li key={idx} className="text-sm text-slate-700 flex items-start gap-2">
                      <span className="text-blue-600 font-bold">{idx + 1}.</span>
                      {finding}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Remediation Actions */}
            <Card className="bg-green-50 border-green-200">
              <CardHeader className="py-3">
                <CardTitle className="text-sm text-green-900">Recommended Actions</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {reportData.ai_insights.remediation_actions.map((action, idx) => (
                    <li key={idx} className="text-sm text-green-800 flex items-start gap-2">
                      <span>✓</span>
                      {action}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button onClick={downloadReport} className="flex-1">
                <Download className="w-4 h-4 mr-2" />
                Download Report
              </Button>
              <Button variant="outline" onClick={() => setReportData(null)}>
                Generate New
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}